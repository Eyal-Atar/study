"""The exam closure push: when it is due, that it goes once, and what each outcome does."""

import threading
from collections.abc import Callable
from datetime import UTC, datetime
from uuid import UUID

import psycopg
import pytest

from app.auth import CurrentUser
from app.config import Settings
from app.jobs.closure_notifications import send_closure_notifications
from app.jobs.notifications import NotificationTicker, NotifyStats
from app.jobs.webpush import SendKind, SendOutcome
from tests.api.factories import insert_exam, set_profile
from tests.jobs.test_notifications import Conn, FakeSender, endpoint, subscribe, subscription_row

MakeUser = Callable[[], CurrentUser]
DAY = "2026-11-20"
ONE = NotifyStats(1, 1, 0, 0)
NONE = NotifyStats(0, 0, 0, 0)


def utc(hour: int, minute: int = 0, day: int = 20) -> datetime:
    return datetime(2026, 11, day, hour, minute, tzinfo=UTC)


def make_exam(
    db: psycopg.Connection,
    make_user: MakeUser,
    *,
    timezone: str = "UTC",
    exam_date: str = DAY,
    subscribed: bool = True,
    name: str = "הסתברות",
    deleted: bool = False,
) -> tuple[UUID, UUID]:
    user = make_user()
    set_profile(db, user.id, timezone=timezone)
    exam_id = insert_exam(db, user.id, name=name, exam_date=exam_date, deleted=deleted)
    if subscribed:
        subscribe(db, user.id, endpoint(f"{user.id}-x"))
    return user.id, exam_id


def notified(db: psycopg.Connection, exam_id: UUID) -> datetime | None:
    row = db.execute(
        "SELECT closure_notified_at FROM app.exams WHERE id = %s", (exam_id,)
    ).fetchone()
    assert row is not None
    value: datetime | None = row[0]
    return value


def test_nothing_before_19_then_one_send_then_never_again(
    db: psycopg.Connection, owner_db: Conn, make_user: MakeUser
) -> None:
    _, exam_id = make_exam(db, make_user)
    sender = FakeSender()

    assert send_closure_notifications(owner_db, sender, now=utc(18, 59)) == NONE
    assert sender.calls == [] and notified(db, exam_id) is None

    assert send_closure_notifications(owner_db, sender, now=utc(19)) == ONE
    assert notified(db, exam_id) == utc(19)
    (call,) = sender.calls
    assert call.payload == {
        "title": "You made it through הסתברות.",
        "body": "How did it feel? Tell me, and I'll sort out what comes next.",
        "url": "/today",
        "tag": f"exam-closure:{exam_id}",
    }
    assert call.ttl == 5 * 3600

    assert send_closure_notifications(owner_db, sender, now=utc(19, 1)) == NONE
    assert len(sender.calls) == 1


@pytest.mark.parametrize(
    ("timezone", "before", "at"),
    [
        # Jerusalem is UTC+2 in November: 19:00 local is 17:00 UTC.
        ("Asia/Jerusalem", utc(16, 59), utc(17)),
        # New York is UTC-5: 19:00 local is 00:00 UTC the next day, still the exam day there.
        ("America/New_York", utc(23, 59), utc(0, 0, day=21)),
    ],
)
def test_the_hour_is_local(
    db: psycopg.Connection,
    owner_db: Conn,
    make_user: MakeUser,
    timezone: str,
    before: datetime,
    at: datetime,
) -> None:
    make_exam(db, make_user, timezone=timezone)
    sender = FakeSender()

    assert send_closure_notifications(owner_db, sender, now=before) == NONE
    assert send_closure_notifications(owner_db, sender, now=at) == ONE


def test_after_local_midnight_a_missed_evening_is_never_sent(
    db: psycopg.Connection, owner_db: Conn, make_user: MakeUser
) -> None:
    _, exam_id = make_exam(db, make_user)
    sender = FakeSender()

    assert send_closure_notifications(owner_db, sender, now=utc(0, 0, day=21)) == NONE
    assert send_closure_notifications(owner_db, sender, now=utc(23, 0, day=21)) == NONE
    assert sender.calls == [] and notified(db, exam_id) is None


def test_the_ttl_is_at_least_sixty_seconds(
    db: psycopg.Connection, owner_db: Conn, make_user: MakeUser
) -> None:
    make_exam(db, make_user)
    sender = FakeSender()
    send_closure_notifications(owner_db, sender, now=datetime(2026, 11, 20, 23, 59, 30, tzinfo=UTC))
    assert sender.calls[0].ttl == 60


def test_a_future_exam_is_not_sent(
    db: psycopg.Connection, owner_db: Conn, make_user: MakeUser
) -> None:
    make_exam(db, make_user, exam_date="2026-11-21")
    sender = FakeSender()
    assert send_closure_notifications(owner_db, sender, now=utc(23)) == NONE


def test_without_a_subscription_the_exam_is_not_claimed(
    db: psycopg.Connection, owner_db: Conn, make_user: MakeUser
) -> None:
    user_id, exam_id = make_exam(db, make_user, subscribed=False)
    sender = FakeSender()

    assert send_closure_notifications(owner_db, sender, now=utc(20)) == NONE
    assert notified(db, exam_id) is None

    subscribe(db, user_id, endpoint(f"{user_id}-late"))
    assert send_closure_notifications(owner_db, sender, now=utc(21)) == ONE


def test_a_closed_or_deleted_exam_is_not_sent(
    db: psycopg.Connection, owner_db: Conn, make_user: MakeUser
) -> None:
    _, closed = make_exam(db, make_user)
    db.execute(
        "UPDATE app.exams SET closure = 'done', closed_at = %s WHERE id = %s", (utc(18), closed)
    )
    make_exam(db, make_user, deleted=True)
    sender = FakeSender()

    assert send_closure_notifications(owner_db, sender, now=utc(20)) == NONE
    assert sender.calls == []


def test_a_gone_subscription_is_deleted_and_a_sent_one_records_success(
    db: psycopg.Connection, owner_db: Conn, make_user: MakeUser
) -> None:
    user_id, _ = make_exam(db, make_user)
    gone = endpoint(f"{user_id}-x")
    kept = endpoint(f"{user_id}-kept")
    subscribe(db, user_id, kept)
    sender = FakeSender({gone: SendOutcome(SendKind.GONE, 410)})

    assert send_closure_notifications(owner_db, sender, now=utc(20)) == NotifyStats(1, 1, 1, 0)

    assert subscription_row(db, gone) is None
    assert subscription_row(db, kept) == (0, utc(20))


def test_the_ticker_runs_both_jobs(
    db: psycopg.Connection,
    migrated_database_url: str,
    settings: Settings,
    make_user: MakeUser,
) -> None:
    _, exam_id = make_exam(db, make_user)
    stop = threading.Event()

    def clock() -> datetime:
        stop.set()
        return utc(19, 0)

    sender = FakeSender()
    ticker = NotificationTicker(
        migrated_database_url, sender, settings, clock=clock, stop=stop, wait_seconds=lambda: 0
    )
    ticker.run()

    assert [call.payload["tag"] for call in sender.calls] == [f"exam-closure:{exam_id}"]
    assert notified(db, exam_id) == utc(19)
