"""Block reminders: claim the blocks that are due, push to every subscription, record outcomes.

`NotificationTicker` runs `send_due_notifications` in its own thread inside the worker, at the
start of every whole minute (blocks start on whole minutes, see `blocks_whole_minutes`), on a
connection of its own: a psycopg connection is not shared between threads, and the job loop
may be inside a 60-second `generate_plan` when a reminder is due.

At most once: each round first claims its blocks in ONE autocommit UPDATE that sets
`notified_at` (FOR UPDATE SKIP LOCKED, and `notified_at IS NULL` checked again on the row
itself), and only then sends. A row another ticker is claiming is locked and skipped; one it
already claimed is no longer NULL. So two tickers, or two workers, never send the same block,
and a worker that dies between the claim and the send loses that one reminder. A missed
reminder is better than a duplicate.

The owner role: like the queue claim, this runs as the schema owner, past RLS, because the
scan covers every user. That is an exception to spec 7.8 (the worker touches only app.jobs
and app.ai_usage as the owner), and it is kept narrow: it writes only `blocks.notified_at`,
`push_subscriptions.last_success_at` and `failure_count`, and deletes a subscription the push
service called gone. Every subscription write names both its id and its user_id.

The ticker also sends the exam closure reminders (`app.jobs.closure_notifications`) in the
same round, and writes `exams.closure_notified_at` as the owner, with the same claim-first
design.

Logging: counts, statuses and exception class names only. The endpoint is a bearer secret,
and titles, keys and psycopg messages (which can quote row data) never reach the log.
"""

import logging
import threading
import time
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Final
from uuid import UUID

import psycopg
from psycopg.pq import TransactionStatus
from psycopg.rows import DictRow, dict_row

from app.config import Settings
from app.domain.notifications import check_push_endpoint, reminder_payload, reminder_text
from app.domain.time import ensure_utc
from app.jobs.webpush import PushSender, PushTarget, SendKind, SendOutcome

logger = logging.getLogger(__name__)

type Conn = psycopg.Connection[DictRow]

DEFAULT_LIMIT: Final = 200
# The largest notify_lead_minutes the profiles CHECK allows (0, 5, 10 or 15). It bounds the
# scan from above on the indexed starts_at, so blocks_due_reminder_idx is a range scan; the
# per-user lead is then checked row by row. Raise it together with that CHECK.
MAX_LEAD_MINUTES: Final = 15
MIN_TTL_SECONDS: Final = 60
# Wake this long after the whole minute, so a wait that ends a hair early (Event.wait runs
# on the monotonic clock, the minute is wall-clock) still sees the new minute.
WAKE_MARGIN_SECONDS: Final = 0.2

# The claim. A CTE because FOR UPDATE cannot sit in a subquery used as an UPDATE's FROM item
# together with the joins it needs; `OF b2` locks only the block rows, not the user's task,
# exam and profile (which the API may be updating meanwhile). The outer
# `b.notified_at IS NULL` is the at-most-once guard on the row actually updated.
_CLAIM: Final = """
    WITH due AS (
        SELECT b2.id, t.title, e.name AS exam_name, p.timezone
        FROM app.blocks b2
        JOIN app.tasks t ON t.id = b2.task_id AND t.user_id = b2.user_id
        JOIN app.exams e ON e.id = t.exam_id AND e.user_id = b2.user_id
        JOIN app.profiles p ON p.id = b2.user_id
        WHERE b2.status = 'planned'
          AND b2.notified_at IS NULL
          AND b2.starts_at > %(now)s - %(grace)s
          -- A block that already ended needs no reminder, however late the round is.
          AND b2.ends_at > %(now)s
          AND b2.starts_at <= %(now)s + %(max_lead)s
          AND b2.starts_at - make_interval(mins => p.notify_lead_minutes) <= %(now)s
          AND t.deleted_at IS NULL
          AND t.status = 'todo'
          AND e.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM app.push_subscriptions s WHERE s.user_id = b2.user_id)
        ORDER BY b2.starts_at
        LIMIT %(limit)s
        FOR UPDATE OF b2 SKIP LOCKED
    )
    UPDATE app.blocks b
    SET notified_at = %(now)s
    FROM due
    WHERE b.id = due.id AND b.notified_at IS NULL
    RETURNING b.id, b.user_id, b.starts_at, b.ends_at, due.title, due.exam_name, due.timezone
"""

_SUBSCRIPTIONS: Final = """
    SELECT id, user_id, endpoint, p256dh, auth
    FROM app.push_subscriptions
    WHERE user_id = ANY(%s)
    ORDER BY created_at, id
"""


@dataclass(frozen=True, slots=True)
class NotifyStats:
    """Blocks claimed, and the outcomes of the sends (one per block and subscription)."""

    claimed: int
    sent: int
    gone: int
    failed: int


@dataclass(frozen=True, slots=True)
class _Due:
    id: UUID
    user_id: UUID
    starts_at: datetime
    ends_at: datetime
    title: str
    exam_name: str
    timezone: str


@dataclass(frozen=True, slots=True)
class _Subscription:
    id: UUID
    user_id: UUID
    target: PushTarget


def _claim(conn: Conn, *, now: datetime, grace: timedelta, limit: int) -> list[_Due]:
    params = {
        "now": now,
        "grace": grace,
        "max_lead": timedelta(minutes=MAX_LEAD_MINUTES),
        "limit": limit,
    }
    # One statement on an autocommit connection, so the claim is committed before any send
    # begins. Inside an open transaction it would not be: a crash after a send would roll
    # the claim back and the block would be sent again.
    if not conn.autocommit or conn.info.transaction_status != TransactionStatus.IDLE:
        raise RuntimeError("send_due_notifications needs an autocommit connection")
    rows = conn.execute(_CLAIM, params).fetchall()
    due = [
        _Due(
            id=row["id"],
            user_id=row["user_id"],
            starts_at=row["starts_at"],
            ends_at=row["ends_at"],
            title=row["title"],
            exam_name=row["exam_name"],
            timezone=row["timezone"],
        )
        for row in rows
    ]
    due.sort(key=lambda item: item.starts_at)
    return due


def _subscriptions(conn: Conn, user_ids: Iterable[UUID]) -> dict[UUID, list[_Subscription]]:
    by_user: dict[UUID, list[_Subscription]] = {}
    for row in conn.execute(_SUBSCRIPTIONS, (list(user_ids),)).fetchall():
        target = PushTarget(row["endpoint"], row["p256dh"], row["auth"])
        by_user.setdefault(row["user_id"], []).append(
            _Subscription(row["id"], row["user_id"], target)
        )
    return by_user


def _send(
    sender: PushSender, target: PushTarget, payload: bytes, *, ttl: int, now: datetime
) -> SendOutcome:
    # Checked here as well as in the sender: a row written to the table some other way must
    # not get a POST, whatever sender is plugged in.
    try:
        if check_push_endpoint(target.endpoint) is not None:
            logger.warning("reminder not sent: endpoint not on the push service list")
            return SendOutcome(SendKind.FAILED, None)
        return sender.send(target, payload, ttl=ttl, now=now)
    except Exception as exc:
        # Class name only: the message may carry the URL or a key.
        logger.warning("reminder send raised %s", type(exc).__name__)
        return SendOutcome(SendKind.FAILED, None)


def _write_back(
    conn: Conn, subscription: _Subscription, kinds: set[SendKind], now: datetime
) -> None:
    # Several outcomes in one round (several blocks): gone wins, since the subscription no
    # longer exists; otherwise one success shows it works; otherwise one more failed round.
    key = (subscription.id, subscription.user_id)
    if SendKind.GONE in kinds:
        conn.execute("DELETE FROM app.push_subscriptions WHERE id = %s AND user_id = %s", key)
    elif SendKind.SENT in kinds:
        conn.execute(
            "UPDATE app.push_subscriptions SET last_success_at = %s, failure_count = 0 "
            "WHERE id = %s AND user_id = %s",
            (now, *key),
        )
    else:
        conn.execute(
            "UPDATE app.push_subscriptions SET failure_count = failure_count + 1 "
            "WHERE id = %s AND user_id = %s",
            key,
        )


def send_due_notifications(
    conn: Conn,
    sender: PushSender,
    *,
    now: datetime,
    grace: timedelta,
    limit: int = DEFAULT_LIMIT,
) -> NotifyStats:
    """Claim the due blocks, push each to every subscription of its user, record outcomes.

    `conn` is the schema owner on an autocommit connection (see the module docstring for why
    the owner, and why the claim commits before the sends). A block is due when it is
    planned and not yet notified, its task is todo and not deleted, its exam not deleted, its
    user has a subscription, and now is at or past `starts_at - notify_lead_minutes` but
    before `starts_at + grace` (a late reminder after a pause, not "starting now" an hour in).
    """
    now = ensure_utc(now)
    due = _claim(conn, now=now, grace=grace, limit=limit)
    if not due:
        return NotifyStats(0, 0, 0, 0)

    by_user = _subscriptions(conn, {item.user_id for item in due})
    outcomes: dict[UUID, set[SendKind]] = {}
    counts: Counter[SendKind] = Counter()
    statuses: Counter[int | None] = Counter()
    for item in due:
        try:
            text = reminder_text(
                task_title=item.title,
                exam_name=item.exam_name,
                starts_at=item.starts_at,
                ends_at=item.ends_at,
                now=now,
                timezone=item.timezone,
            )
        except ValueError:
            # A timezone zoneinfo does not know: nothing to send for this block.
            logger.warning("reminder skipped: the profile's timezone is unknown")
            continue
        payload = reminder_payload(item.id, text)
        # A reminder for a block that is over is worthless; the service may drop it then.
        ttl = max(MIN_TTL_SECONDS, int((item.ends_at - now).total_seconds()))
        for subscription in by_user.get(item.user_id, []):
            kinds = outcomes.setdefault(subscription.id, set())
            if SendKind.GONE in kinds:
                continue
            outcome = _send(sender, subscription.target, payload, ttl=ttl, now=now)
            kinds.add(outcome.kind)
            counts[outcome.kind] += 1
            if outcome.kind is not SendKind.SENT:
                statuses[outcome.status] += 1

    for subscriptions in by_user.values():
        for subscription in subscriptions:
            sub_kinds = outcomes.get(subscription.id)
            if sub_kinds:
                _write_back(conn, subscription, sub_kinds, now)

    stats = NotifyStats(
        claimed=len(due),
        sent=counts[SendKind.SENT],
        gone=counts[SendKind.GONE],
        failed=counts[SendKind.FAILED],
    )
    logger.info(
        "reminders: %d claimed, %d sent, %d gone, %d failed%s",
        stats.claimed,
        stats.sent,
        stats.gone,
        stats.failed,
        f" (statuses {dict(sorted(statuses.items(), key=str))})" if statuses else "",
    )
    return stats


def seconds_until_next_minute(timestamp: float | None = None) -> float:
    """Seconds from `timestamp` (default: the wall clock) to just past the next whole minute."""
    now = time.time() if timestamp is None else timestamp
    return 60 - now % 60 + WAKE_MARGIN_SECONDS


def _utc_now() -> datetime:
    return datetime.now(UTC)


class NotificationTicker:
    """Runs `send_due_notifications` at the start of every minute until `stop` is set."""

    def __init__(
        self,
        conninfo: str,
        sender: PushSender,
        settings: Settings,
        *,
        stop: threading.Event,
        clock: Callable[[], datetime] = _utc_now,
        wait_seconds: Callable[[], float] = seconds_until_next_minute,
    ) -> None:
        self._conninfo = conninfo
        self._sender = sender
        self._grace = timedelta(minutes=settings.push_grace_minutes)
        self._stop = stop
        self._clock = clock
        self._wait_seconds = wait_seconds

    def __repr__(self) -> str:
        return "NotificationTicker()"

    def run(self) -> None:
        # The connection is made here, in the ticker's own thread, and never shared.
        conn: Conn | None = None
        try:
            while not self._stop.wait(self._wait_seconds()):
                try:
                    if conn is None:
                        conn = psycopg.connect(
                            self._conninfo, row_factory=dict_row, autocommit=True
                        )
                    # Imported here: closure_notifications reuses this module's helpers.
                    from app.jobs.closure_notifications import send_closure_notifications

                    now = self._clock()
                    send_due_notifications(conn, self._sender, now=now, grace=self._grace)
                    send_closure_notifications(conn, self._sender, now=now)
                except psycopg.OperationalError as exc:
                    logger.warning("reminder ticker lost the database: %s", type(exc).__name__)
                    if conn is not None:
                        conn.close()
                    conn = None
                except psycopg.Error as exc:
                    logger.warning(
                        "reminder round failed: %s sqlstate=%s", type(exc).__name__, exc.sqlstate
                    )
                except Exception as exc:
                    logger.warning("reminder round failed: %s", type(exc).__name__)
        finally:
            if conn is not None:
                conn.close()
