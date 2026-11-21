"""The exam closure push: one reminder on the evening of the exam day (S45).

Runs inside `NotificationTicker`, on its autocommit owner connection, and follows the block
reminders' design (see `app.jobs.notifications`): claim first, in ONE UPDATE that sets
`exams.closure_notified_at`, then send. At most once; a missed push is better than a
duplicate.

Due window: from 19:00 local time on the exam date (`closure_opens_at`) until local midnight
of that day. A worker that was down all evening never sends the push the next day.

The query bounds `exam_date` to one day either side of the UTC date, which covers every
time zone, so the partial index `exams_closure_due_idx` is a range scan; the local clock is
then checked in Python. Logging: counts only, never names or endpoints.
"""

import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Final
from uuid import UUID

from app.domain.closure import closure_opens_at
from app.domain.closure_text import closure_payload, closure_text
from app.domain.time import InvalidTimezoneError, ensure_utc, local_day_bounds, parse_timezone
from app.jobs.notifications import (
    DEFAULT_LIMIT,
    MIN_TTL_SECONDS,
    Conn,
    NotifyStats,
    _send,
    _subscriptions,
    _write_back,
)
from app.jobs.webpush import PushSender, SendKind

logger = logging.getLogger(__name__)

_CANDIDATES: Final = """
    SELECT e.id, e.user_id, e.exam_date, p.timezone
    FROM app.exams e
    JOIN app.profiles p ON p.id = e.user_id
    WHERE e.closure IS NULL
      AND e.closure_notified_at IS NULL
      AND e.deleted_at IS NULL
      AND e.exam_date BETWEEN %(lo)s AND %(hi)s
      AND EXISTS (SELECT 1 FROM app.push_subscriptions s WHERE s.user_id = e.user_id)
    ORDER BY e.exam_date, e.id
    LIMIT %(limit)s
"""

_CLAIM: Final = """
    UPDATE app.exams
    SET closure_notified_at = %(now)s
    WHERE id = ANY(%(ids)s)
      AND closure_notified_at IS NULL
      AND closure IS NULL
      AND deleted_at IS NULL
    RETURNING id, user_id, name
"""


@dataclass(frozen=True, slots=True)
class _Due:
    id: UUID
    user_id: UUID
    name: str
    ttl: int


def send_closure_notifications(
    conn: Conn, sender: PushSender, *, now: datetime, limit: int = DEFAULT_LIMIT
) -> NotifyStats:
    """Push "you made it through <exam>" to every subscription of each exam that just closed in.

    `conn` is the schema owner on an autocommit connection. Writes only
    `exams.closure_notified_at`, and the same subscription columns as the block reminders.
    """
    now = ensure_utc(now)
    if not conn.autocommit:
        raise RuntimeError("send_closure_notifications needs an autocommit connection")
    today: date = now.date()
    candidates = conn.execute(
        _CANDIDATES,
        {"lo": today - timedelta(days=1), "hi": today + timedelta(days=1), "limit": limit},
    ).fetchall()

    ttls: dict[UUID, int] = {}
    for row in candidates:
        try:
            tz = parse_timezone(row["timezone"])
        except InvalidTimezoneError:
            logger.warning("closure push skipped: the profile's timezone is unknown")
            continue
        exam_date: date = row["exam_date"]
        if now.astimezone(tz).date() == exam_date and now >= closure_opens_at(exam_date, tz):
            midnight = local_day_bounds(exam_date, tz)[1]
            ttls[row["id"]] = max(MIN_TTL_SECONDS, int((midnight - now).total_seconds()))
    if not ttls:
        return NotifyStats(0, 0, 0, 0)

    claimed = conn.execute(_CLAIM, {"now": now, "ids": list(ttls)}).fetchall()
    due = [_Due(r["id"], r["user_id"], r["name"], ttls[r["id"]]) for r in claimed]
    if not due:
        return NotifyStats(0, 0, 0, 0)

    by_user = _subscriptions(conn, {item.user_id for item in due})
    outcomes: dict[UUID, set[SendKind]] = {}
    sent = gone = failed = 0
    for item in due:
        payload = closure_payload(item.id, closure_text(item.name))
        for subscription in by_user.get(item.user_id, []):
            kinds = outcomes.setdefault(subscription.id, set())
            if SendKind.GONE in kinds:
                continue
            outcome = _send(sender, subscription.target, payload, ttl=item.ttl, now=now)
            kinds.add(outcome.kind)
            sent += outcome.kind is SendKind.SENT
            gone += outcome.kind is SendKind.GONE
            failed += outcome.kind is SendKind.FAILED

    for subscriptions in by_user.values():
        for subscription in subscriptions:
            sub_kinds = outcomes.get(subscription.id)
            if sub_kinds:
                _write_back(conn, subscription, sub_kinds, now)

    stats = NotifyStats(claimed=len(due), sent=sent, gone=gone, failed=failed)
    logger.info(
        "closure pushes: %d claimed, %d sent, %d gone, %d failed",
        stats.claimed,
        stats.sent,
        stats.gone,
        stats.failed,
    )
    return stats
