"""Block reminders: which blocks are claimed, when, how often, and what each outcome does."""

import json
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import psycopg
import pytest
from psycopg.rows import DictRow, dict_row

from app.auth import CurrentUser
from app.config import Settings
from app.jobs import notifications
from app.jobs.notifications import NotificationTicker, NotifyStats, send_due_notifications
from app.jobs.webpush import PushTarget, SendKind, SendOutcome
from tests.api.factories import insert_block, insert_exam, insert_task, set_profile

type Conn = psycopg.Connection[DictRow]
MakeUser = Callable[[], CurrentUser]

GRACE = timedelta(minutes=10)
START = datetime(2026, 11, 20, 9, 0, tzinfo=UTC)
_P256DH = "B" + "A" * 86
_AUTH = "A" * 22

SENT = SendOutcome(SendKind.SENT, 201)
# The en dash reminder_text puts between the hours.
DASH = "\u2013"


def endpoint(name: str) -> str:
    return f"https://fcm.googleapis.com/fcm/send/{name}"


@dataclass(frozen=True)
class Call:
    endpoint: str
    payload: dict[str, Any]
    ttl: int
    now: datetime


class FakeSender:
    """Records every send; answers per endpoint (SENT unless told otherwise)."""

    def __init__(
        self,
        outcomes: dict[str, SendOutcome | Exception] | None = None,
        *,
        on_send: Callable[[], None] | None = None,
    ) -> None:
        self.outcomes = outcomes or {}
        self.calls: list[Call] = []
        self._on_send = on_send
        self._lock = threading.Lock()

    def send(self, target: PushTarget, payload: bytes, *, ttl: int, now: datetime) -> SendOutcome:
        if self._on_send is not None:
            self._on_send()
        with self._lock:
            self.calls.append(Call(target.endpoint, json.loads(payload), ttl, now))
        outcome = self.outcomes.get(target.endpoint, SENT)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    def block_ids(self) -> list[str]:
        return [call.payload["tag"].removeprefix("block:") for call in self.calls]


@dataclass
class Student:
    user: CurrentUser
    exam_id: UUID
    task_id: UUID


@pytest.fixture
def student(db: psycopg.Connection, make_user: MakeUser) -> Callable[..., Student]:
    def make(
        *,
        lead: int = 0,
        timezone: str = "UTC",
        subscriptions: tuple[str, ...] = ("default",),
        title: str = "פרק 3",
        exam_name: str = "הסתברות",
    ) -> Student:
        user = make_user()
        set_profile(db, user.id, notify_lead_minutes=lead, timezone=timezone)
        exam_id = insert_exam(db, user.id, name=exam_name, exam_date="2026-12-20")
        task_id = insert_task(db, user.id, exam_id, title=title)
        for name in subscriptions:
            subscribe(db, user.id, endpoint(f"{user.id}-{name}"))
        return Student(user, exam_id, task_id)

    return make


def subscribe(db: psycopg.Connection, user_id: UUID, url: str) -> UUID:
    """Written as the owner, past the API's checks (as a row from elsewhere would be)."""
    row = db.execute(
        "INSERT INTO app.push_subscriptions (user_id, endpoint, p256dh, auth) "
        "VALUES (%s, %s, %s, %s) RETURNING id",
        (user_id, url, _P256DH, _AUTH),
    ).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def block(
    db: psycopg.Connection,
    s: Student,
    starts_at: datetime = START,
    minutes: int = 60,
    **kwargs: Any,
) -> UUID:
    return insert_block(
        db, s.user.id, s.task_id, starts_at, starts_at + timedelta(minutes=minutes), **kwargs
    )


def notified_at(db: psycopg.Connection, block_id: UUID) -> datetime | None:
    row = db.execute("SELECT notified_at FROM app.blocks WHERE id = %s", (block_id,)).fetchone()
    assert row is not None
    value: datetime | None = row[0]
    return value


def subscription_row(db: psycopg.Connection, url: str) -> tuple[int, datetime | None] | None:
    row = db.execute(
        "SELECT failure_count, last_success_at FROM app.push_subscriptions WHERE endpoint = %s",
        (url,),
    ).fetchone()
    return None if row is None else (row[0], row[1])


def run(conn: Conn, sender: FakeSender, now: datetime, **kwargs: Any) -> NotifyStats:
    return send_due_notifications(conn, sender, now=now, grace=GRACE, **kwargs)


@pytest.fixture
def second_owner(migrated_database_url: str, owner_db: Conn) -> Iterator[Conn]:
    with psycopg.connect(migrated_database_url, row_factory=dict_row, autocommit=True) as conn:
        yield conn


# --- when a block is due ---


def test_lead_zero_is_sent_at_the_start_minute_not_before(
    db: psycopg.Connection, owner_db: Conn, student: Callable[..., Student]
) -> None:
    s = student(lead=0)
    block_id = block(db, s)
    sender = FakeSender()

    assert run(owner_db, sender, START - timedelta(minutes=1)) == NotifyStats(0, 0, 0, 0)
    assert sender.calls == []
    assert notified_at(db, block_id) is None

    # The ticker wakes a moment after the whole minute.
    now = START + timedelta(milliseconds=200)
    assert run(owner_db, sender, now) == NotifyStats(1, 1, 0, 0)
    assert sender.block_ids() == [str(block_id)]
    assert notified_at(db, block_id) == now


def test_lead_fifteen_is_read_from_the_profile(
    db: psycopg.Connection, owner_db: Conn, student: Callable[..., Student]
) -> None:
    s = student(lead=15)
    block_id = block(db, s)
    sender = FakeSender()

    assert run(owner_db, sender, START - timedelta(minutes=16)).claimed == 0
    assert run(owner_db, sender, START - timedelta(minutes=15)).sent == 1
    assert sender.block_ids() == [str(block_id)]


def test_the_payload_is_the_reminder_text_and_ttl_runs_to_the_end(
    db: psycopg.Connection, owner_db: Conn, student: Callable[..., Student]
) -> None:
    s = student(lead=10, timezone="Asia/Jerusalem", title="פרק 3", exam_name="הסתברות")
    block_id = block(db, s, minutes=90)
    sender = FakeSender()

    now = START - timedelta(minutes=10)
    run(owner_db, sender, now)

    [call] = sender.calls
    # 09:00Z is 11:00 in Israel in November (UTC+2).
    assert call.payload == {
        "title": "פרק 3",
        "body": f"בעוד 10 דקות · 11:00{DASH}12:30 · הסתברות",
        "url": "/today",
        "tag": f"block:{block_id}",
    }
    assert call.ttl == 100 * 60
    assert call.now == now


def test_ttl_is_at_least_sixty_seconds(
    db: psycopg.Connection, owner_db: Conn, student: Callable[..., Student]
) -> None:
    s = student(lead=0)
    block(db, s, minutes=1)
    sender = FakeSender()

    run(owner_db, sender, START + timedelta(seconds=30))

    assert [call.ttl for call in sender.calls] == [60]


@pytest.mark.parametrize("status", ["done", "skipped", "missed"])
def test_a_block_that_is_not_planned_is_not_sent(
    db: psycopg.Connection, owner_db: Conn, student: Callable[..., Student], status: str
) -> None:
    s = student()
    block_id = block(db, s, status=status)
    sender = FakeSender()

    assert run(owner_db, sender, START).claimed == 0
    assert notified_at(db, block_id) is None


@pytest.mark.parametrize(
    "change",
    [
        "UPDATE app.tasks SET deleted_at = now() WHERE id = %(task)s",
        "UPDATE app.tasks SET status = 'done' WHERE id = %(task)s",
        "UPDATE app.tasks SET status = 'skipped' WHERE id = %(task)s",
        "UPDATE app.exams SET deleted_at = now() WHERE id = %(exam)s",
    ],
    ids=["task-deleted", "task-done", "task-skipped", "exam-deleted"],
)
def test_a_block_of_a_finished_or_deleted_task_or_exam_is_not_sent(
    db: psycopg.Connection, owner_db: Conn, student: Callable[..., Student], change: str
) -> None:
    s = student()
    block_id = block(db, s)
    db.execute(change, {"task": s.task_id, "exam": s.exam_id})
    sender = FakeSender()

    assert run(owner_db, sender, START).claimed == 0
    assert notified_at(db, block_id) is None


def test_a_deferred_block_is_reminded_at_its_new_time_only(
    db: psycopg.Connection, owner_db: Conn, student: Callable[..., Student]
) -> None:
    s = student()
    old = block(db, s)
    # A defer, the way write_changes writes it: the old block goes and a new one comes.
    later = START + timedelta(hours=3)
    with db.transaction():
        db.execute("DELETE FROM app.blocks WHERE id = %s", (old,))
        new = block(db, s, later)
    sender = FakeSender()

    assert run(owner_db, sender, START).claimed == 0
    assert run(owner_db, sender, later).claimed == 1
    assert sender.block_ids() == [str(new)]


def test_a_block_moved_in_place_is_reminded_again(
    db: psycopg.Connection, owner_db: Conn, student: Callable[..., Student]
) -> None:
    s = student()
    block_id = block(db, s)
    sender = FakeSender()
    run(owner_db, sender, START)
    later = START + timedelta(hours=1)
    db.execute(
        "UPDATE app.blocks SET starts_at = %s, ends_at = %s WHERE id = %s",
        (later, later + timedelta(hours=1), block_id),
    )

    assert run(owner_db, sender, later).sent == 1
    assert sender.block_ids() == [str(block_id), str(block_id)]


def test_a_late_reminder_goes_within_the_grace_but_not_after(
    db: psycopg.Connection, owner_db: Conn, student: Callable[..., Student]
) -> None:
    s = student()
    stale = block(db, s, START - timedelta(minutes=11), minutes=1)
    late = block(db, s, START - timedelta(minutes=9), minutes=1)
    sender = FakeSender()

    stats = run(owner_db, sender, START)

    assert stats.claimed == 1
    assert sender.block_ids() == [str(late)]
    assert notified_at(db, stale) is None
    # The text tells the truth: it already started.
    assert sender.calls[0].payload["body"].startswith("מתחיל עכשיו")


def test_a_user_without_a_subscription_is_not_claimed_until_subscribing(
    db: psycopg.Connection, owner_db: Conn, student: Callable[..., Student]
) -> None:
    s = student(subscriptions=())
    block_id = block(db, s)
    sender = FakeSender()

    assert run(owner_db, sender, START).claimed == 0
    assert notified_at(db, block_id) is None

    subscribe(db, s.user.id, endpoint("late"))
    assert run(owner_db, sender, START + timedelta(minutes=1)).sent == 1
    assert notified_at(db, block_id) is not None


def test_a_second_run_in_the_same_minute_sends_nothing(
    db: psycopg.Connection, owner_db: Conn, student: Callable[..., Student]
) -> None:
    s = student()
    block(db, s)
    sender = FakeSender()

    assert run(owner_db, sender, START).sent == 1
    assert run(owner_db, sender, START + timedelta(seconds=30)) == NotifyStats(0, 0, 0, 0)
    assert len(sender.calls) == 1


def test_the_limit_caps_one_round_and_the_rest_follow(
    db: psycopg.Connection, owner_db: Conn, student: Callable[..., Student]
) -> None:
    s = student()
    ids = [block(db, s, START + timedelta(minutes=i), minutes=1) for i in range(3)]
    sender = FakeSender()
    now = START + timedelta(minutes=3)

    assert run(owner_db, sender, now, limit=2).claimed == 2
    assert run(owner_db, sender, now, limit=2).claimed == 1
    # Oldest first.
    assert sender.block_ids() == [str(i) for i in ids]


# --- at most once ---


def test_two_concurrent_runs_send_each_block_once(
    db: psycopg.Connection,
    owner_db: Conn,
    second_owner: Conn,
    student: Callable[..., Student],
) -> None:
    expected: set[str] = set()
    for _ in range(4):
        s = student(lead=15)
        for i in range(10):
            starts = START - timedelta(minutes=5) + timedelta(minutes=i)
            expected.add(str(block(db, s, starts, minutes=1)))
    barrier = threading.Barrier(2, timeout=10)
    senders = [FakeSender(), FakeSender()]
    errors: list[BaseException] = []

    def ticker(conn: Conn, sender: FakeSender) -> None:
        try:
            barrier.wait()
            # Small rounds, so the two claims interleave many times.
            while run(conn, sender, START, limit=3).claimed:
                pass
        except BaseException as exc:  # pragma: no cover - reported below
            errors.append(exc)

    threads = [
        threading.Thread(target=ticker, args=(conn, sender))
        for conn, sender in zip((owner_db, second_owner), senders, strict=True)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert errors == []
    sent = senders[0].block_ids() + senders[1].block_ids()
    assert sorted(sent) == sorted(expected)


def test_a_block_locked_by_another_claim_is_skipped(
    db: psycopg.Connection,
    owner_db: Conn,
    second_owner: Conn,
    student: Callable[..., Student],
) -> None:
    s = student()
    locked = block(db, s, START, minutes=1)
    free = block(db, s, START + timedelta(minutes=1), minutes=1)
    sender = FakeSender()
    now = START + timedelta(minutes=1)

    # Another ticker's claim, still in its transaction, holds the first row.
    with second_owner.transaction():
        second_owner.execute("SELECT 1 FROM app.blocks WHERE id = %s FOR UPDATE", (locked,))
        assert run(owner_db, sender, now).claimed == 1
    assert sender.block_ids() == [str(free)]
    assert notified_at(db, locked) is None


# --- outcomes and subscriptions ---


@pytest.mark.parametrize("status", [404, 410])
def test_gone_deletes_the_subscription(
    db: psycopg.Connection, owner_db: Conn, student: Callable[..., Student], status: int
) -> None:
    s = student(subscriptions=("a", "b"))
    gone = endpoint(f"{s.user.id}-a")
    kept = endpoint(f"{s.user.id}-b")
    block(db, s)
    sender = FakeSender({gone: SendOutcome(SendKind.GONE, status)})

    assert run(owner_db, sender, START) == NotifyStats(1, 1, 1, 0)

    assert subscription_row(db, gone) is None
    assert subscription_row(db, kept) == (0, START)


@pytest.mark.parametrize("status", [403, 500, None])
def test_failed_counts_and_keeps_the_subscription(
    db: psycopg.Connection, owner_db: Conn, student: Callable[..., Student], status: int | None
) -> None:
    s = student()
    url = endpoint(f"{s.user.id}-default")
    db.execute("UPDATE app.push_subscriptions SET failure_count = 2 WHERE endpoint = %s", (url,))
    block(db, s)
    sender = FakeSender({url: SendOutcome(SendKind.FAILED, status)})

    assert run(owner_db, sender, START) == NotifyStats(1, 0, 0, 1)

    assert subscription_row(db, url) == (3, None)


def test_sent_resets_the_failures_and_records_the_success(
    db: psycopg.Connection, owner_db: Conn, student: Callable[..., Student]
) -> None:
    s = student()
    url = endpoint(f"{s.user.id}-default")
    db.execute("UPDATE app.push_subscriptions SET failure_count = 4 WHERE endpoint = %s", (url,))
    block(db, s)
    now = START + timedelta(seconds=1)

    run(owner_db, FakeSender(), now)

    assert subscription_row(db, url) == (0, now)


def test_a_sender_exception_counts_as_failed_and_the_others_still_go(
    db: psycopg.Connection, owner_db: Conn, student: Callable[..., Student]
) -> None:
    s = student(subscriptions=("a", "b"))
    broken = endpoint(f"{s.user.id}-a")
    other = endpoint(f"{s.user.id}-b")
    block(db, s)
    sender = FakeSender({broken: RuntimeError("secret detail")})

    assert run(owner_db, sender, START) == NotifyStats(1, 1, 0, 1)
    assert subscription_row(db, broken) == (1, None)
    assert subscription_row(db, other) == (0, START)


def test_an_endpoint_off_the_allowlist_gets_no_send(
    db: psycopg.Connection, owner_db: Conn, student: Callable[..., Student]
) -> None:
    s = student(subscriptions=())
    # Passes the table's CHECK (https://), not the push service list.
    internal = "https://169.254.169.254/latest/meta-data"
    subscribe(db, s.user.id, internal)
    block(db, s)
    sender = FakeSender()

    assert run(owner_db, sender, START) == NotifyStats(1, 0, 0, 1)
    assert sender.calls == []
    assert subscription_row(db, internal) == (1, None)


def test_every_subscription_of_the_user_gets_it(
    db: psycopg.Connection, owner_db: Conn, student: Callable[..., Student]
) -> None:
    s = student(subscriptions=("phone", "laptop"))
    other = student()
    block(db, s)
    block(db, other)
    sender = FakeSender()

    assert run(owner_db, sender, START) == NotifyStats(2, 3, 0, 0)
    assert sorted(call.endpoint for call in sender.calls) == sorted(
        [
            endpoint(f"{s.user.id}-phone"),
            endpoint(f"{s.user.id}-laptop"),
            endpoint(f"{other.user.id}-default"),
        ]
    )


def test_several_outcomes_of_one_subscription_in_a_round(
    db: psycopg.Connection, owner_db: Conn, student: Callable[..., Student]
) -> None:
    s = student()
    url = endpoint(f"{s.user.id}-default")
    block(db, s, START, minutes=1)
    block(db, s, START + timedelta(minutes=1), minutes=1)
    answers = iter([SendOutcome(SendKind.FAILED, 503), SENT])

    class Flaky(FakeSender):
        def send(
            self, target: PushTarget, payload: bytes, *, ttl: int, now: datetime
        ) -> SendOutcome:
            super().send(target, payload, ttl=ttl, now=now)
            return next(answers)

    now = START + timedelta(minutes=1)
    assert run(owner_db, Flaky(), now) == NotifyStats(2, 1, 0, 1)
    # One success in the round: the subscription works.
    assert subscription_row(db, url) == (0, now)


def test_a_gone_subscription_is_not_sent_to_again_in_the_round(
    db: psycopg.Connection, owner_db: Conn, student: Callable[..., Student]
) -> None:
    s = student()
    url = endpoint(f"{s.user.id}-default")
    block(db, s, START, minutes=1)
    block(db, s, START + timedelta(minutes=1), minutes=1)
    sender = FakeSender({url: SendOutcome(SendKind.GONE, 410)})

    stats = run(owner_db, sender, START + timedelta(minutes=1))

    assert stats == NotifyStats(2, 0, 1, 0)
    assert len(sender.calls) == 1
    assert subscription_row(db, url) is None


def test_dst_fall_back_night_uses_real_minutes_and_local_hours(
    db: psycopg.Connection, owner_db: Conn, student: Callable[..., Student]
) -> None:
    # 2026-10-25 02:00 IDT goes back to 01:00 IST, so 01:30 happens twice; 22:30Z is the
    # first one (UTC+3), and the reminder must leave 15 real minutes before it.
    s = student(lead=15, timezone="Asia/Jerusalem")
    starts = datetime(2026, 10, 24, 22, 30, tzinfo=UTC)
    block(db, s, starts, minutes=29)
    sender = FakeSender()

    assert run(owner_db, sender, datetime(2026, 10, 24, 22, 14, tzinfo=UTC)).claimed == 0
    assert run(owner_db, sender, datetime(2026, 10, 24, 22, 15, tzinfo=UTC)).sent == 1
    assert sender.calls[0].payload["body"].startswith(f"בעוד 15 דקות · 01:30{DASH}01:59")


# --- the ticker ---


def test_ticker_runs_a_round_and_stops(
    db: psycopg.Connection,
    migrated_database_url: str,
    settings: Settings,
    student: Callable[..., Student],
) -> None:
    s = student()
    block_id = block(db, s)
    stop = threading.Event()
    rounds: list[datetime] = []

    def clock() -> datetime:
        rounds.append(START)
        stop.set()
        return START

    sender = FakeSender()
    ticker = NotificationTicker(
        migrated_database_url, sender, settings, clock=clock, stop=stop, wait_seconds=lambda: 0
    )
    thread = threading.Thread(target=ticker.run)
    thread.start()
    thread.join(timeout=10)

    assert not thread.is_alive()
    assert len(rounds) == 1
    assert sender.block_ids() == [str(block_id)]


def test_ticker_survives_a_failing_round(
    db: psycopg.Connection,
    migrated_database_url: str,
    settings: Settings,
    student: Callable[..., Student],
    caplog: pytest.LogCaptureFixture,
) -> None:
    s = student()
    block_id = block(db, s)
    stop = threading.Event()
    calls = 0

    def clock() -> datetime:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("row data that must not be logged")
        stop.set()
        return START

    sender = FakeSender()
    ticker = NotificationTicker(
        migrated_database_url, sender, settings, clock=clock, stop=stop, wait_seconds=lambda: 0
    )
    ticker.run()

    assert calls == 2
    assert sender.block_ids() == [str(block_id)]
    assert "RuntimeError" in caplog.text
    assert "must not be logged" not in caplog.text


def test_ticker_reconnects_after_losing_the_database(
    db: psycopg.Connection,
    migrated_database_url: str,
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stop = threading.Event()
    seen: list[Conn] = []

    def fake_round(conn: Conn, sender: Any, **kwargs: Any) -> NotifyStats:
        seen.append(conn)
        if len(seen) == 1:
            raise psycopg.OperationalError("server closed the connection")
        stop.set()
        return NotifyStats(0, 0, 0, 0)

    monkeypatch.setattr(notifications, "send_due_notifications", fake_round)
    ticker = NotificationTicker(
        migrated_database_url,
        FakeSender(),
        settings,
        clock=lambda: START,
        stop=stop,
        wait_seconds=lambda: 0,
    )
    ticker.run()

    assert len(seen) == 2
    assert seen[0] is not seen[1]
    assert seen[0].closed
    assert seen[1].closed


def test_seconds_until_next_minute_aims_just_past_the_minute() -> None:
    at = datetime(2026, 11, 20, 8, 59, 30, tzinfo=UTC).timestamp()
    wait = notifications.seconds_until_next_minute(at)
    assert 30 < wait < 31
    exact = datetime(2026, 11, 20, 9, 0, tzinfo=UTC).timestamp()
    assert 60 < notifications.seconds_until_next_minute(exact) < 61
