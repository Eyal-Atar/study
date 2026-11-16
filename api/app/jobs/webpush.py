"""Web Push from the worker: aes128gcm encryption (RFC 8291), a VAPID JWT (RFC 8292), one POST.

The endpoint is a bearer secret (whoever holds it can push to that browser), so neither it
nor the subscription keys are ever logged: at most the host and the status.
"""

import base64
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Final, Protocol
from urllib.parse import urlsplit

import http_ece
import httpx2
import jwt
from cryptography.hazmat.primitives.asymmetric import ec

from app.domain.notifications import (
    check_push_endpoint,
    check_push_keys,
    decode_base64url,
    load_vapid_key,
    uncompressed_point,
)
from app.domain.time import ensure_utc

logger = logging.getLogger(__name__)

JWT_LIFETIME: Final = timedelta(hours=12)
_GONE_STATUSES: Final = frozenset({404, 410})


class _HidePushUrls(logging.Filter):
    """Drops httpx2's request log line when its URL is a push endpoint.

    httpx2 logs every request URL at INFO. The worker raises that logger to WARNING, but
    the endpoint must stay out of the logs even where someone lowers it again.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args if isinstance(record.args, tuple) else ()
        return not any(
            isinstance(arg, httpx2.URL) and check_push_endpoint(str(arg)) is None for arg in args
        )


logging.getLogger("httpx2").addFilter(_HidePushUrls())


class SendKind(StrEnum):
    SENT = "sent"
    # The service says the subscription no longer exists: delete it.
    GONE = "gone"
    # Anything else (403 from Apple on a bad JWT, 429, 5xx, the network): keep it, count it.
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class SendOutcome:
    kind: SendKind
    # The service's HTTP status, or None when no response came (network, refused locally).
    status: int | None


@dataclass(frozen=True, slots=True)
class PushTarget:
    endpoint: str
    p256dh: str
    auth: str

    def __repr__(self) -> str:
        return "PushTarget(...)"


class PushSender(Protocol):
    def send(
        self, target: PushTarget, payload: bytes, *, ttl: int, now: datetime
    ) -> SendOutcome: ...


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


class WebPushSender:
    """Sends one encrypted message per call; the client is reused across sends."""

    def __init__(
        self,
        private_key_b64: str,
        public_key_b64: str,
        subject: str,
        *,
        timeout: float,
        transport: httpx2.BaseTransport | None = None,
    ) -> None:
        self._key = load_vapid_key(private_key_b64, public_key_b64)
        self._public = _b64url(uncompressed_point(self._key.public_key()))
        self._subject = subject
        # Redirects are not followed: a push service never redirects, and following one
        # would send the worker to a host that never passed check_push_endpoint.
        self._client = httpx2.Client(transport=transport, timeout=timeout, follow_redirects=False)

    def __repr__(self) -> str:
        return "WebPushSender()"

    def close(self) -> None:
        self._client.close()

    def _vapid_jwt(self, audience: str, now: datetime) -> str:
        # Fresh claims for every send, with this endpoint's own origin as aud (the legacy
        # code shared one claims dict, and an old aud leaked into other endpoints).
        claims = {
            "aud": audience,
            "exp": int((now + JWT_LIFETIME).timestamp()),
            "sub": self._subject,
        }
        return jwt.encode(claims, self._key, algorithm="ES256", headers={"typ": "JWT"})

    def send(self, target: PushTarget, payload: bytes, *, ttl: int, now: datetime) -> SendOutcome:
        now = ensure_utc(now)
        # Checked again here, not only in the API: a row written to the table some other
        # way must not turn the worker into a proxy for internal addresses.
        if check_push_endpoint(target.endpoint) is not None:
            logger.warning("push refused: endpoint not on the push service list")
            return SendOutcome(SendKind.FAILED, None)
        if not check_push_keys(target.p256dh, target.auth):
            logger.warning("push refused: invalid subscription keys")
            return SendOutcome(SendKind.FAILED, None)
        parts = urlsplit(target.endpoint)
        host = parts.hostname or ""
        body = http_ece.encrypt(
            payload,
            # A fresh ephemeral key per message, as RFC 8291 requires.
            private_key=ec.generate_private_key(ec.SECP256R1()),
            dh=decode_base64url(target.p256dh),
            auth_secret=decode_base64url(target.auth),
            version="aes128gcm",
        )
        headers = {
            "Authorization": f"vapid t={self._vapid_jwt(f'https://{host}', now)}, k={self._public}",
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            "TTL": str(max(ttl, 0)),
            # Without it, Android in battery saver holds the message back.
            "Urgency": "high",
        }
        try:
            # Streamed so an error body is never read: only the status matters.
            with self._client.stream(
                "POST", target.endpoint, content=body, headers=headers
            ) as response:
                status = response.status_code
        except httpx2.TransportError as exc:
            logger.warning("push to %s failed: %s", host, type(exc).__name__)
            return SendOutcome(SendKind.FAILED, None)
        if 200 <= status < 300:
            return SendOutcome(SendKind.SENT, status)
        logger.warning("push to %s: status %d", host, status)
        if status in _GONE_STATUSES:
            return SendOutcome(SendKind.GONE, status)
        return SendOutcome(SendKind.FAILED, status)
