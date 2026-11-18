"""One-off busy events (S35): "I am busy then", marked on the calendar.

Adding an event is an explicit action like a defer (plan decision 9): it is saved, then
clear_interval releases every planned block that has not ended and overlaps it (pinned and
running ones too; a done block never) and places each affected task again. A version
busy_added is always written, so undo deletes the event and brings the blocks back. A PATCH
that moves the event does the same over the new interval with busy_changed, keeping the old
time in busy_event_before; the blocks over the old interval stay where they are (the time is
simply free now). A title-only PATCH and a DELETE move nothing and write no version.

Every write takes the user lock first (load_board(lock=True)), and every query filters on
user_id explicitly, above RLS.
"""

import datetime as dt
from collections.abc import Mapping
from dataclasses import dataclass, replace
from typing import Any, Final
from uuid import UUID

from app.domain.planner import (
    Interval,
    PlanResult,
    Profile,
    Unscheduled,
    clear_interval,
    start_minute,
)
from app.domain.time import at_local_time, local_date
from app.errors import ApiError
from app.schemas.busy_events import event_errors
from app.services.board import Board, load_board
from app.services.plan_views import (
    DEFAULT_RANGE_DAYS,
    MAX_DAYS_FROM_TODAY,
    MAX_RANGE_DAYS,
    BlockView,
    blocks_by_id,
)
from app.services.plan_writes import VersionReason, apply_result, renumber
from app.services.profiles import Conn, ensure_profile, lock_user, to_planner_profile

# Live events that end after now; past ones do not count, nor do deleted ones.
MAX_FUTURE_EVENTS: Final = 500

EVENT_COLUMNS: Final = "id, title, starts_at, ends_at, created_at"

_ONE_DAY: Final = dt.timedelta(days=1)


@dataclass(frozen=True)
class EventOutcome:
    event: dict[str, Any]
    # The live blocks (done, or planned and not over) of every task the change moved.
    blocks: tuple[BlockView, ...]
    unplaced: tuple[Unscheduled, ...]
    version_id: UUID | None


def _invalid_range(field: str, kind: str) -> ApiError:
    return ApiError("validation_error", extra={"errors": [{"loc": ["query", field], "type": kind}]})


def list_events(
    conn: Conn,
    user_id: UUID,
    now: dt.datetime,
    from_date: dt.date | None,
    to_date: dt.date | None,
) -> list[dict[str, Any]]:
    """Live events overlapping the local days from_date..to_date (default: a week from today).

    The days are local dates in the profile's timezone, within the same reach and length as
    GET /plan. Ordered by (starts_at, ends_at, id).
    """
    tz = to_planner_profile(ensure_profile(conn, user_id)).timezone
    today = local_date(now, tz)
    reach = dt.timedelta(days=MAX_DAYS_FROM_TODAY)
    for field, value in (("from", from_date), ("to", to_date)):
        if value is not None and not today - reach <= value <= today + reach:
            raise _invalid_range(field, "out_of_range")
    first = from_date if from_date is not None else today
    last = to_date if to_date is not None else first + dt.timedelta(days=DEFAULT_RANGE_DAYS - 1)
    if last < first:
        raise _invalid_range("to", "before_from")
    if (last - first).days + 1 > MAX_RANGE_DAYS:
        raise _invalid_range("to", "range_too_long")
    since = at_local_time(first, dt.time(), tz)
    until = at_local_time(last + _ONE_DAY, dt.time(), tz)
    return conn.execute(
        f"SELECT {EVENT_COLUMNS} FROM app.busy_events "  # noqa: S608 - a constant column list
        "WHERE user_id = %s AND deleted_at IS NULL AND starts_at < %s AND ends_at > %s "
        "ORDER BY starts_at, ends_at, id",
        (user_id, until, since),
    ).fetchall()


def _check_time(starts_at: dt.datetime, ends_at: dt.datetime, now: dt.datetime) -> None:
    if errors := event_errors(starts_at, ends_at):
        raise ApiError("validation_error", extra={"errors": errors})
    if ends_at <= now:
        raise ApiError("event_in_past")


def _clear(
    conn: Conn,
    user_id: UUID,
    board: Board,
    profile: Profile,
    interval: Interval,
    reason: VersionReason,
    event_id: UUID,
    before: Mapping[str, Any] | None = None,
) -> tuple[tuple[BlockView, ...], tuple[Unscheduled, ...], UUID | None]:
    """Release the blocks under interval, place their tasks again, and write the version.

    `board` is the board before the change (the version's snapshot); `profile` already
    holds the event at its new time.
    """
    now = board.now
    result = clear_interval(profile, board.exams, board.tasks, board.existing, now, interval)
    version_id = apply_result(
        conn,
        user_id,
        board,
        PlanResult(
            blocks=result.blocks,
            removed=result.removed,
            unscheduled=result.unscheduled,
            warnings=(),
            shortfalls=(),
        ),
        reason,
        busy_event_id=event_id,
        busy_event_before=before,
        always_version=True,
    )
    renumber(conn, user_id, now)
    task_of = {block.id: block.task_id for block in board.blocks}
    affected = list(dict.fromkeys(task_of[block_id] for block_id in result.removed))
    blocks: tuple[BlockView, ...] = ()
    if affected:
        live = conn.execute(
            "SELECT id FROM app.blocks WHERE user_id = %s AND task_id = ANY(%s) "
            "AND (status = 'done' OR (status = 'planned' AND ends_at > %s))",
            (user_id, affected, start_minute(now)),
        ).fetchall()
        blocks = blocks_by_id(conn, user_id, [row["id"] for row in live], board.profile, now)
    return blocks, result.unscheduled, version_id


def create_event(
    conn: Conn,
    user_id: UUID,
    now: dt.datetime,
    title: str | None,
    starts_at: dt.datetime,
    ends_at: dt.datetime,
) -> EventOutcome:
    board = load_board(conn, user_id, now, lock=True)
    _check_time(starts_at, ends_at, now)
    count = conn.execute(
        "SELECT count(*) AS n FROM app.busy_events "
        "WHERE user_id = %s AND deleted_at IS NULL AND ends_at > %s",
        (user_id, now),
    ).fetchone()
    if count is None:
        raise RuntimeError("SELECT count(*) returned no row")
    if count["n"] >= MAX_FUTURE_EVENTS:
        raise ApiError("too_many_events", extra={"limit": MAX_FUTURE_EVENTS})
    row: dict[str, Any] | None = conn.execute(
        "INSERT INTO app.busy_events (user_id, title, starts_at, ends_at) "  # noqa: S608 - a constant column list
        f"VALUES (%s, %s, %s, %s) RETURNING {EVENT_COLUMNS}",
        (user_id, title, starts_at, ends_at),
    ).fetchone()
    if row is None:
        raise RuntimeError("the new busy event is not visible to this user")
    interval = Interval(starts_at, ends_at)
    profile = replace(board.profile, busy=(*board.profile.busy, interval))
    blocks, unplaced, version_id = _clear(
        conn, user_id, board, profile, interval, VersionReason.BUSY_ADDED, row["id"]
    )
    return EventOutcome(event=row, blocks=blocks, unplaced=unplaced, version_id=version_id)


def _live(conn: Conn, user_id: UUID, event_id: UUID) -> dict[str, Any]:
    row: dict[str, Any] | None = conn.execute(
        f"SELECT {EVENT_COLUMNS} FROM app.busy_events "  # noqa: S608 - a constant column list
        "WHERE user_id = %s AND id = %s AND deleted_at IS NULL",
        (user_id, event_id),
    ).fetchone()
    if row is None:
        raise ApiError("not_found")
    return row


def _interval(row: Mapping[str, Any]) -> Interval:
    return Interval(row["starts_at"].astimezone(dt.UTC), row["ends_at"].astimezone(dt.UTC))


def _without(busy: tuple[Interval, ...], interval: Interval) -> tuple[Interval, ...]:
    """busy with one occurrence of interval taken out (the event's old time)."""
    if interval not in busy:
        return busy
    index = busy.index(interval)
    return (*busy[:index], *busy[index + 1 :])


def update_event(
    conn: Conn, user_id: UUID, now: dt.datetime, event_id: UUID, changes: Mapping[str, Any]
) -> EventOutcome:
    """Change the title and/or the time of an event that has not ended (else invalid_state)."""
    board = load_board(conn, user_id, now, lock=True)
    current = _live(conn, user_id, event_id)
    old = _interval(current)
    if old.end <= now:
        raise ApiError("invalid_state")
    title = changes.get("title", current["title"])
    starts_at = changes.get("starts_at", old.start)
    ends_at = changes.get("ends_at", old.end)
    _check_time(starts_at, ends_at, now)
    row: dict[str, Any] | None = conn.execute(
        "UPDATE app.busy_events SET title = %s, starts_at = %s, ends_at = %s "  # noqa: S608 - a constant column list
        "WHERE user_id = %s AND id = %s AND deleted_at IS NULL "
        f"RETURNING {EVENT_COLUMNS}",
        (title, starts_at, ends_at, user_id, event_id),
    ).fetchone()
    if row is None:
        raise RuntimeError("the busy event vanished under the user lock")
    new = Interval(starts_at, ends_at)
    if new == old:
        return EventOutcome(event=row, blocks=(), unplaced=(), version_id=None)
    before = {
        "title": current["title"],
        "starts_at": old.start.isoformat(),
        "ends_at": old.end.isoformat(),
    }
    profile = replace(board.profile, busy=(*_without(board.profile.busy, old), new))
    blocks, unplaced, version_id = _clear(
        conn, user_id, board, profile, new, VersionReason.BUSY_CHANGED, event_id, before
    )
    return EventOutcome(event=row, blocks=blocks, unplaced=unplaced, version_id=version_id)


def delete_event(conn: Conn, user_id: UUID, now: dt.datetime, event_id: UUID) -> None:
    """Soft-delete a live event; nothing moves and no version is written."""
    lock_user(conn, user_id)
    row = conn.execute(
        "UPDATE app.busy_events SET deleted_at = %s "
        "WHERE user_id = %s AND id = %s AND deleted_at IS NULL RETURNING id",
        (now, user_id, event_id),
    ).fetchone()
    if row is None:
        raise ApiError("not_found")
