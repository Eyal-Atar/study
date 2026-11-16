import base64
import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import http_ece
import httpx2
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from app.jobs.webpush import PushSender, PushTarget, SendKind, SendOutcome, WebPushSender

NOW = datetime(2026, 11, 16, 7, 0, tzinfo=UTC)
ENDPOINT = "https://fcm.googleapis.com/fcm/send/secret-token-abc"
Handler = Callable[[httpx2.Request], httpx2.Response]


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def public_bytes(key: ec.EllipticCurvePrivateKey) -> bytes:
    return key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)


# The server's VAPID pair, in the form the settings hold it.
VAPID_KEY = ec.generate_private_key(ec.SECP256R1())
VAPID_PRIVATE = b64(VAPID_KEY.private_numbers().private_value.to_bytes(32, "big"))
VAPID_PUBLIC = b64(public_bytes(VAPID_KEY))
SUBJECT = "mailto:studyflow-dev@example.com"

# The browser's subscription keys.
BROWSER_KEY = ec.generate_private_key(ec.SECP256R1())
AUTH = bytes(range(16))


def target(endpoint: str = ENDPOINT) -> PushTarget:
    return PushTarget(endpoint=endpoint, p256dh=b64(public_bytes(BROWSER_KEY)), auth=b64(AUTH))


def make(handler: Handler) -> WebPushSender:
    return WebPushSender(
        VAPID_PRIVATE,
        VAPID_PUBLIC,
        SUBJECT,
        timeout=5.0,
        transport=httpx2.MockTransport(handler),
    )


def capture(status: int = 201) -> tuple[list[httpx2.Request], WebPushSender]:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(status)

    return seen, make(handler)


def jwt_of(request: httpx2.Request) -> tuple[str, str]:
    scheme, _, rest = request.headers["authorization"].partition(" ")
    assert scheme == "vapid"
    parts = dict(item.strip().split("=", 1) for item in rest.split(","))
    return parts["t"], parts["k"]


def test_the_body_decrypts_with_the_browser_key() -> None:
    seen, sender = capture()
    payload = '{"title":"שלום"}'.encode()
    outcome = sender.send(target(), payload, ttl=600, now=NOW)
    assert outcome == SendOutcome(SendKind.SENT, 201)
    (request,) = seen
    assert request.method == "POST"
    assert str(request.url) == ENDPOINT
    plain = http_ece.decrypt(
        request.content, private_key=BROWSER_KEY, auth_secret=AUTH, version="aes128gcm"
    )
    assert plain == payload


def test_each_send_uses_a_fresh_ephemeral_key() -> None:
    seen, sender = capture()
    sender.send(target(), b"x", ttl=60, now=NOW)
    sender.send(target(), b"x", ttl=60, now=NOW)
    # aes128gcm header: salt(16) rs(4) idlen(1) keyid(65): the keyid is the sender's key.
    keys = {request.content[21:86] for request in seen}
    assert len(keys) == 2
    assert public_bytes(VAPID_KEY) not in keys


def test_the_headers() -> None:
    seen, sender = capture()
    sender.send(target(), b"x", ttl=1234, now=NOW)
    (request,) = seen
    assert request.headers["content-encoding"] == "aes128gcm"
    assert request.headers["content-type"] == "application/octet-stream"
    assert request.headers["ttl"] == "1234"
    assert request.headers["urgency"] == "high"
    _, k = jwt_of(request)
    assert k == VAPID_PUBLIC


def test_the_jwt_is_signed_by_the_vapid_key_for_this_origin() -> None:
    seen, sender = capture()
    sender.send(target(), b"x", ttl=60, now=NOW)
    token, _ = jwt_of(seen[0])
    assert jwt.get_unverified_header(token) == {"typ": "JWT", "alg": "ES256"}
    claims = jwt.decode(
        token,
        VAPID_KEY.public_key(),
        algorithms=["ES256"],
        audience="https://fcm.googleapis.com",
        options={"verify_exp": False},
    )
    assert claims == {
        "aud": "https://fcm.googleapis.com",
        "exp": int((NOW + timedelta(hours=12)).timestamp()),
        "sub": SUBJECT,
    }


def test_each_endpoint_gets_its_own_audience() -> None:
    seen, sender = capture()
    sender.send(target(), b"x", ttl=60, now=NOW)
    sender.send(target("https://web.push.apple.com:443/QGz9"), b"x", ttl=60, now=NOW)
    sender.send(target(), b"x", ttl=60, now=NOW + timedelta(hours=1))
    auds = [jwt.decode(jwt_of(r)[0], options={"verify_signature": False}) for r in seen]
    assert [c["aud"] for c in auds] == [
        "https://fcm.googleapis.com",
        "https://web.push.apple.com",
        "https://fcm.googleapis.com",
    ]
    assert auds[2]["exp"] == auds[0]["exp"] + 3600


@pytest.mark.parametrize(
    ("status", "outcome"),
    [
        (200, SendOutcome(SendKind.SENT, 200)),
        (201, SendOutcome(SendKind.SENT, 201)),
        (202, SendOutcome(SendKind.SENT, 202)),
        (404, SendOutcome(SendKind.GONE, 404)),
        (410, SendOutcome(SendKind.GONE, 410)),
        # 403 is Apple rejecting our JWT, not a dead subscription.
        (403, SendOutcome(SendKind.FAILED, 403)),
        (400, SendOutcome(SendKind.FAILED, 400)),
        (413, SendOutcome(SendKind.FAILED, 413)),
        (429, SendOutcome(SendKind.FAILED, 429)),
        (500, SendOutcome(SendKind.FAILED, 500)),
        (301, SendOutcome(SendKind.FAILED, 301)),
    ],
)
def test_the_status_decides_the_outcome(status: int, outcome: SendOutcome) -> None:
    _, sender = capture(status)
    assert sender.send(target(), b"x", ttl=60, now=NOW) == outcome


def test_a_redirect_is_not_followed() -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(307, headers={"location": "https://169.254.169.254/"})

    outcome = make(handler).send(target(), b"x", ttl=60, now=NOW)
    assert outcome == SendOutcome(SendKind.FAILED, 307)
    assert len(seen) == 1


@pytest.mark.parametrize(
    "error", [httpx2.ConnectError("refused"), httpx2.ReadTimeout("slow"), httpx2.ConnectTimeout("")]
)
def test_a_network_failure_is_failed_without_status(
    error: httpx2.TransportError, caplog: pytest.LogCaptureFixture
) -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise error

    with caplog.at_level(logging.DEBUG):
        outcome = make(handler).send(target(), b"x", ttl=60, now=NOW)
    assert outcome == SendOutcome(SendKind.FAILED, None)
    assert "secret-token-abc" not in caplog.text


@pytest.mark.parametrize(
    "endpoint",
    ["https://169.254.169.254/latest", "http://fcm.googleapis.com/x", "https://evil.com/x"],
)
def test_an_endpoint_off_the_list_never_reaches_the_network(endpoint: str) -> None:
    seen, sender = capture()
    assert sender.send(target(endpoint), b"x", ttl=60, now=NOW) == SendOutcome(
        SendKind.FAILED, None
    )
    assert seen == []


def test_bad_subscription_keys_never_reach_the_network() -> None:
    seen, sender = capture()
    bad = PushTarget(endpoint=ENDPOINT, p256dh="AAAA", auth=b64(AUTH))
    assert sender.send(bad, b"x", ttl=60, now=NOW) == SendOutcome(SendKind.FAILED, None)
    assert seen == []


def test_logs_carry_the_host_and_status_but_never_the_endpoint_or_keys(
    caplog: pytest.LogCaptureFixture,
) -> None:
    _, sender = capture(500)
    with caplog.at_level(logging.DEBUG):
        sender.send(target(), b"x", ttl=60, now=NOW)
    assert "fcm.googleapis.com" in caplog.text
    assert "500" in caplog.text
    for secret in ("secret-token-abc", target().p256dh, target().auth, VAPID_PRIVATE):
        assert secret not in caplog.text


def test_a_naive_now_is_rejected() -> None:
    _, sender = capture()
    with pytest.raises(ValueError, match="aware"):
        sender.send(target(), b"x", ttl=60, now=datetime(2026, 11, 16, 7, 0))


def test_a_public_key_that_does_not_match_is_rejected() -> None:
    other = b64(public_bytes(ec.generate_private_key(ec.SECP256R1())))
    with pytest.raises(ValueError, match="VAPID") as info:
        WebPushSender(VAPID_PRIVATE, other, SUBJECT, timeout=5.0)
    assert VAPID_PRIVATE not in str(info.value)


def test_the_sender_hides_its_key_and_satisfies_the_protocol() -> None:
    _, sender = capture()
    assert VAPID_PRIVATE not in repr(sender)
    as_protocol: PushSender = sender
    assert as_protocol is sender
    sender.close()
