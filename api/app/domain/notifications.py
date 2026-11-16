"""Block reminders: the text the student sees, and the checks on a push subscription.

Everything here is pure, so the API (which stores subscriptions) and the worker (which
sends to them) apply the very same rules.
"""

import base64
import binascii
import ipaddress
import json
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Final
from urllib.parse import urlsplit
from uuid import UUID

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from app.domain.time import InvalidTimezoneError, ensure_utc, parse_timezone

PUSH_ENDPOINT_INVALID: Final = "push_endpoint_invalid"
MAX_ENDPOINT_LENGTH: Final = 2048
TITLE_MAX_CHARS: Final = 80
EXAM_NAME_MAX_CHARS: Final = 80
REMINDER_URL: Final = "/today"
# An en dash between the hours, the usual way to write a time range.
_RANGE_DASH: Final = "\u2013"

# The push services of Chrome and Android, Firefox, Safari and iOS, and Edge. The worker
# POSTs to whatever URL a user registered, so anything else (an internal address, a
# metadata service) is refused before it is stored or sent to (SSRF).
_EXACT_HOSTS: Final = frozenset({"fcm.googleapis.com"})
_HOST_SUFFIXES: Final = (".push.services.mozilla.com", ".push.apple.com", ".notify.windows.com")
_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?")
_BASE64URL = re.compile(r"[A-Za-z0-9_-]*")
_P256_POINT_BYTES: Final = 65
_AUTH_SECRET_BYTES: Final = 16


@dataclass(frozen=True, slots=True)
class ReminderText:
    title: str
    body: str


def _truncate(text: str, limit: int) -> str:
    text = text.strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _lead(seconds_left: float) -> str:
    # Rounded to the nearest minute, not down: blocks start on a whole minute and the ticker
    # wakes a moment after one, so a 15-minute reminder sees 14:59 left and must say 15.
    # The count comes from the real time left (not the setting), so a late one does not lie.
    minutes = int((seconds_left + 30) // 60)
    if minutes <= 0:
        return "מתחיל עכשיו"
    if minutes == 1:
        return "בעוד דקה"
    return f"בעוד {minutes} דקות"


def reminder_text(
    *,
    task_title: str,
    exam_name: str,
    starts_at: datetime,
    ends_at: datetime,
    now: datetime,
    timezone: str,
) -> ReminderText:
    """The fixed Hebrew template, for example "בעוד 10 דקות · 09:00-10:30 · הסתברות".

    The hours (joined by an en dash) are wall-clock times in the profile's timezone:
    starts_at is an absolute instant, so a block on a DST night shows the offset it really
    falls in, and the lead is a difference of real minutes. The strings are plain text:
    the notification API never renders markup, so nothing is escaped here.
    """
    try:
        tz = parse_timezone(timezone)
    except InvalidTimezoneError:
        raise ValueError(f"Unknown timezone: {timezone!r}") from None
    start = ensure_utc(starts_at)
    end = ensure_utc(ends_at)
    seconds_left = (start - ensure_utc(now)).total_seconds()
    hours = f"{start.astimezone(tz):%H:%M}{_RANGE_DASH}{end.astimezone(tz):%H:%M}"
    exam = _truncate(exam_name, EXAM_NAME_MAX_CHARS)
    return ReminderText(
        title=_truncate(task_title, TITLE_MAX_CHARS),
        body=f"{_lead(seconds_left)} · {hours} · {exam}",
    )


def reminder_payload(block_id: UUID, text: ReminderText) -> bytes:
    """The JSON the service worker reads. The tag replaces an earlier reminder of this block."""
    data = {"title": text.title, "body": text.body, "url": REMINDER_URL, "tag": f"block:{block_id}"}
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _allowed_host(host: str) -> bool:
    if host in _EXACT_HOSTS:
        return True
    for suffix in _HOST_SUFFIXES:
        if host.endswith(suffix):
            prefix = host[: -len(suffix)]
            return bool(prefix) and all(_LABEL.fullmatch(label) for label in prefix.split("."))
    return False


def check_push_endpoint(url: str) -> str | None:
    """None for an https URL of a known push service, otherwise PUSH_ENDPOINT_INVALID."""
    # Printable ASCII only: urlsplit silently drops tabs and newlines, and a backslash or
    # a space is read differently by different URL parsers.
    if not url or len(url) > MAX_ENDPOINT_LENGTH or not url.startswith("https://"):
        return PUSH_ENDPOINT_INVALID
    if any(not ("!" <= char <= "~") or char == "\\" for char in url):
        return PUSH_ENDPOINT_INVALID
    parts = urlsplit(url)
    try:
        port = parts.port
    except ValueError:
        return PUSH_ENDPOINT_INVALID
    host = parts.hostname
    if (
        parts.scheme != "https"
        or "@" in parts.netloc
        or parts.fragment
        or "#" in url
        or port not in (None, 443)
        or not host
    ):
        return PUSH_ENDPOINT_INVALID
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        return PUSH_ENDPOINT_INVALID
    return None if _allowed_host(host) else PUSH_ENDPOINT_INVALID


def decode_base64url(value: str) -> bytes:
    """Strict base64url: padding tolerated, but no other alphabet and no stray bits."""
    stripped = value[:-2] if value.endswith("==") else value.removesuffix("=")
    if not _BASE64URL.fullmatch(stripped) or len(stripped) % 4 == 1:
        raise ValueError("Not base64url")
    try:
        raw = base64.urlsafe_b64decode(stripped + "=" * (-len(stripped) % 4))
    except binascii.Error:
        raise ValueError("Not base64url") from None
    # Only one spelling per value, so the same key never looks like two different keys.
    if base64.urlsafe_b64encode(raw).decode().rstrip("=") != stripped:
        raise ValueError("Not base64url")
    return raw


def check_push_keys(p256dh: str, auth: str) -> bool:
    """Whether p256dh is an uncompressed P-256 point and auth a 16-byte secret, in base64url."""
    try:
        point = decode_base64url(p256dh)
        secret = decode_base64url(auth)
    except ValueError:
        return False
    if len(point) != _P256_POINT_BYTES or point[0] != 0x04 or len(secret) != _AUTH_SECRET_BYTES:
        return False
    try:
        # A point off the curve would only fail later, inside the encryption.
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), point)
    except ValueError:
        return False
    return True


def uncompressed_point(key: ec.EllipticCurvePublicKey) -> bytes:
    return key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)


def load_vapid_key(private_key_b64: str, public_key_b64: str) -> ec.EllipticCurvePrivateKey:
    """The VAPID private key from its 32-byte scalar, checked against the public key.

    Messages never carry either key, since they reach logs and settings errors.
    """
    try:
        raw = decode_base64url(private_key_b64)
        if len(raw) != 32:
            raise ValueError
        key = ec.derive_private_key(int.from_bytes(raw, "big"), ec.SECP256R1())
        public = decode_base64url(public_key_b64)
    except ValueError:
        raise ValueError(
            "VAPID_PRIVATE_KEY must be the base64url of a 32-byte P-256 private key, "
            "and VAPID_PUBLIC_KEY base64url"
        ) from None
    if uncompressed_point(key.public_key()) != public:
        raise ValueError("VAPID_PUBLIC_KEY is not the public key of VAPID_PRIVATE_KEY")
    return key
