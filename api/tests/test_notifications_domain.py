# ruff: noqa: RUF001
import base64
import json
from datetime import UTC, datetime, timedelta, timezone
from uuid import UUID

import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from app.domain.notifications import (
    PUSH_ENDPOINT_INVALID,
    ReminderText,
    check_push_endpoint,
    check_push_keys,
    decode_base64url,
    reminder_payload,
    reminder_text,
)

TZ = "Asia/Jerusalem"
# 09:00 in Israel in November (UTC+2).
START = datetime(2026, 11, 16, 7, 0, tzinfo=UTC)
END = START + timedelta(minutes=90)


def text_at(now: datetime, **overrides: object) -> ReminderText:
    args: dict[str, object] = {
        "task_title": "חזרה על פרק 3",
        "exam_name": "הסתברות",
        "starts_at": START,
        "ends_at": END,
        "now": now,
        "timezone": TZ,
    }
    args.update(overrides)
    return reminder_text(**args)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("before", "lead"),
    [
        (timedelta(0), "מתחיל עכשיו"),
        (timedelta(seconds=20), "מתחיל עכשיו"),
        (timedelta(minutes=1), "בעוד דקה"),
        (timedelta(minutes=2), "בעוד 2 דקות"),
        (timedelta(minutes=5), "בעוד 5 דקות"),
        (timedelta(minutes=15), "בעוד 15 דקות"),
        # The ticker wakes a moment into the minute, so a 15-minute reminder sees 14:59.
        (timedelta(minutes=14, seconds=59), "בעוד 15 דקות"),
        # A late reminder (the worker was down) does not claim time is left.
        (-timedelta(minutes=3), "התחיל לפני 3 דקות"),
        (-timedelta(seconds=75), "התחיל לפני דקה"),
        (-timedelta(seconds=25), "מתחיל עכשיו"),
    ],
)
def test_the_lead_counts_the_real_time_left(before: timedelta, lead: str) -> None:
    text = text_at(START - before)
    assert text.body == f"{lead} · 09:00–10:30 · הסתברות"
    assert text.title == "חזרה על פרק 3"


def test_summer_time_is_utc_plus_three() -> None:
    start = datetime(2026, 7, 1, 6, 0, tzinfo=UTC)
    text = text_at(start, starts_at=start, ends_at=start + timedelta(hours=1))
    assert text.body == "מתחיל עכשיו · 09:00–10:00 · הסתברות"


def test_winter_time_is_utc_plus_two() -> None:
    start = datetime(2026, 12, 1, 6, 0, tzinfo=UTC)
    text = text_at(start, starts_at=start, ends_at=start + timedelta(hours=1))
    assert text.body == "מתחיל עכשיו · 08:00–09:00 · הסתברות"


@pytest.mark.parametrize(
    ("start", "end_wall"),
    [
        # 2026-10-25 02:00 IDT goes back to 01:00 IST, so 01:30 happens twice.
        # The first 01:30 (IDT): half an hour later the clock has gone back to 01:00.
        (datetime(2026, 10, 24, 22, 30, tzinfo=UTC), "01:00"),
        # The second 01:30 (IST).
        (datetime(2026, 10, 24, 23, 30, tzinfo=UTC), "02:00"),
    ],
)
def test_both_repeated_times_on_the_fall_back_night_read_0130(
    start: datetime, end_wall: str
) -> None:
    text = text_at(
        start - timedelta(minutes=15), starts_at=start, ends_at=start + timedelta(minutes=30)
    )
    assert text.body == f"בעוד 15 דקות · 01:30–{end_wall} · הסתברות"


def test_a_block_across_the_fall_back_shows_each_end_in_its_own_offset() -> None:
    start = datetime(2026, 10, 24, 22, 30, tzinfo=UTC)  # 01:30 IDT
    end = start + timedelta(hours=1)  # 01:30 IST: an hour later, same wall clock
    assert text_at(start, starts_at=start, ends_at=end).body == (
        "מתחיל עכשיו · 01:30–01:30 · הסתברות"
    )


def test_any_aware_input_offset_gives_the_same_text() -> None:
    plus5 = timezone(timedelta(hours=5))
    text = text_at(
        (START - timedelta(minutes=5)).astimezone(plus5),
        starts_at=START.astimezone(plus5),
        ends_at=END.astimezone(plus5),
    )
    assert text.body == "בעוד 5 דקות · 09:00–10:30 · הסתברות"


def test_naive_datetimes_are_rejected() -> None:
    with pytest.raises(ValueError, match="aware"):
        text_at(datetime(2026, 11, 16, 7, 0))


def test_an_unknown_timezone_is_rejected() -> None:
    with pytest.raises(ValueError, match="timezone"):
        text_at(START, timezone="Mars/Base")


def test_a_long_title_is_cut_to_80_characters_with_an_ellipsis() -> None:
    title = "א" * 81
    text = text_at(START, task_title=title)
    assert len(text.title) == 80
    assert text.title == "א" * 79 + "…"
    assert text_at(START, task_title="ב" * 80).title == "ב" * 80


def test_markup_stays_plain_text() -> None:
    text = text_at(START, task_title="<b>bold</b>", exam_name="<i>x</i>")
    assert text.title == "<b>bold</b>"
    assert text.body.endswith("· <i>x</i>")
    payload = json.loads(reminder_payload(UUID(int=1), text))
    assert payload["title"] == "<b>bold</b>"


def test_the_payload_is_utf8_json_with_the_block_tag() -> None:
    block_id = UUID("0b0e8a8e-0000-4000-8000-000000000001")
    raw = reminder_payload(block_id, ReminderText(title="כותרת", body="גוף"))
    assert "כותרת".encode() in raw  # UTF-8, not \u escapes
    assert json.loads(raw.decode("utf-8")) == {
        "title": "כותרת",
        "body": "גוף",
        "url": "/today",
        "tag": f"block:{block_id}",
    }


@pytest.mark.parametrize(
    "url",
    [
        "https://fcm.googleapis.com/fcm/send/x",
        "https://fcm.googleapis.com:443/wp/abc",
        "https://updates.push.services.mozilla.com/wpush/v2/gAAA",
        "https://web.push.apple.com/QGz9",
        "https://wns2-db5p.notify.windows.com/w/?token=BQYAAA",
        "https://FCM.googleapis.com/fcm/send/x",
    ],
)
def test_known_push_services_are_accepted(url: str) -> None:
    assert check_push_endpoint(url) is None


@pytest.mark.parametrize(
    "url",
    [
        "http://fcm.googleapis.com/fcm/send/x",
        "https://fcm.googleapis.com:8443/fcm/send/x",
        "https://fcm.googleapis.com:0/x",
        "https://fcm.googleapis.com:abc/x",
        "https://evil.com/fcm.googleapis.com",
        "https://fcm.googleapis.com.evil.com/x",
        "https://evilfcm.googleapis.com/x",
        "https://sub.fcm.googleapis.com/x",
        "https://push.apple.com/x",  # the suffix needs a label in front
        "https://.push.apple.com/x",
        "https://a..push.apple.com/x",
        "https://evilpush.apple.com/x",
        "https://fcm.googleapis.com./x",
        "https://169.254.169.254/latest/meta-data",
        "https://[::1]/x",
        "https://[::1",
        "https://fcm.googleapis.com]/x",
        "https://[fcm.googleapis.com]/x",
        "https://user@fcm.googleapis.com/x",
        "https://user:pw@fcm.googleapis.com/x",
        "https://evil.com@fcm.googleapis.com/x",
        "https://fcm.googleapis.com/x#frag",
        "https://fcm.googleapis.com/x y",
        "https://fcm.googleapis.com/x\ty",
        "https://fcm.goo\ngleapis.com/x",
        "https://fcm.googleapis.com\\@evil.com/x",
        "https://fcm.googleapis.com/ש",
        " https://fcm.googleapis.com/x",
        "HTTPS://fcm.googleapis.com/x",
        "ftp://fcm.googleapis.com/x",
        "fcm.googleapis.com/x",
        "https:///x",
        "",
        "https://fcm.googleapis.com/" + "a" * 2048,
    ],
)
def test_anything_else_is_rejected(url: str) -> None:
    assert check_push_endpoint(url) == PUSH_ENDPOINT_INVALID == "push_endpoint_invalid"


def test_the_length_limit_is_2048() -> None:
    base = "https://fcm.googleapis.com/"
    assert check_push_endpoint(base + "a" * (2048 - len(base))) is None
    assert check_push_endpoint(base + "a" * (2049 - len(base))) == PUSH_ENDPOINT_INVALID


def b64(raw: bytes, *, pad: bool = False) -> str:
    text = base64.urlsafe_b64encode(raw).decode()
    return text if pad else text.rstrip("=")


def browser_public_key() -> bytes:
    key = ec.generate_private_key(ec.SECP256R1())
    return key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)


def test_real_browser_keys_pass() -> None:
    p256dh = browser_public_key()
    auth = b"\x01" * 16
    assert check_push_keys(b64(p256dh), b64(auth))
    # Padding is tolerated: some clients send it.
    assert check_push_keys(b64(p256dh, pad=True), b64(auth, pad=True))


def test_keys_must_be_a_p256_point_and_a_16_byte_secret() -> None:
    p256dh = browser_public_key()
    auth = b"\x01" * 16
    assert not check_push_keys(b64(p256dh[:64]), b64(auth))  # short
    assert not check_push_keys(b64(b"\x02" + p256dh[1:]), b64(auth))  # not 0x04
    assert not check_push_keys(b64(b"\x04" + b"\x00" * 64), b64(auth))  # not on the curve
    assert not check_push_keys(b64(p256dh), b64(auth[:15]))
    assert not check_push_keys(b64(p256dh), b64(auth + b"\x00"))
    # Standard base64 is not base64url.
    standard = base64.b64encode(p256dh).decode().rstrip("=")
    if "+" in standard or "/" in standard:
        assert not check_push_keys(standard, b64(auth))
    assert not check_push_keys(b64(p256dh) + "!", b64(auth))
    assert not check_push_keys(b64(p256dh), " " + b64(auth))
    assert not check_push_keys("", "")


def test_decode_base64url_is_strict() -> None:
    assert decode_base64url("AQID") == b"\x01\x02\x03"
    assert decode_base64url("AQI") == b"\x01\x02"
    assert decode_base64url("AQI=") == b"\x01\x02"
    for bad in ("AQ+D", "AQ/D", "A", "AQ==x", "AQJ", "AQ\n"):
        with pytest.raises(ValueError, match="base64url"):
            decode_base64url(bad)
