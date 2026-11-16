"""Moving a block by hand (PATCH /blocks/{id} with starts_at), and where it can move to.

A move keeps the block's length and its study day. The new place must be inside that day's
waking hours (wake_time to sleep_time, without the planner's start delay), not before now,
and free of every other planned or done block. Touching a neighbour is allowed: the user,
not the planner, chose it, and the planner still pads around a pinned block.

The move and the slots share one check (_refusal), so a listed slot is always a move that
succeeds. The 15-minute grid is only for the slots: a move may go anywhere on a whole minute,
so undo can put a block back where the planner placed it.
"""

import datetime as dt
from dataclasses import dataclass
from typing import Final
from uuid import UUID

from app.domain.planner import BlockStatus, Interval, Profile, start_minute, study_date
from app.errors import ApiError
from app.services.blocks import _find
from app.services.board import BlockRow
from app.services.plan_views import BlockView, blocks_by_id, waking_span
from app.services.plan_writes import renumber
from app.services.profiles import Conn, ensure_profile, lock_user, to_planner_profile

SLOT_MINUTES: Final = 15
_MINUTE: Final = dt.timedelta(minutes=1)


@dataclass(frozen=True)
class SlotsView:
    study_date: dt.date
    day: Interval | None
    slots: tuple[dt.datetime, ...]


@dataclass(frozen=True)
class _Context:
    profile: Profile
    block: BlockRow
    day: dt.date
    span: Interval | None
    earliest: dt.datetime
    # Every other planned or done block of the user in the day's span, by start.
    taken: tuple[tuple[UUID, Interval], ...]


def _context(
    conn: Conn, user_id: UUID, block_id: UUID, profile: Profile, now: dt.datetime
) -> _Context:
    """The block, if it can still move, with what bounds its new place; else 404 or 409."""
    block = _find(conn, user_id, block_id).block
    # A block that has started (or is over) is not moved: it is in progress or history.
    if block.status is not BlockStatus.PLANNED or block.interval.start <= now:
        raise ApiError("invalid_state")
    day = study_date(profile, block.interval.start)
    span = waking_span(profile, day)
    taken: tuple[tuple[UUID, Interval], ...] = ()
    if span is not None:
        # Straight from app.blocks, deleted tasks included: the exclusion constraint counts
        # every planned or done block, whatever its task.
        rows = conn.execute(
            "SELECT id, starts_at, ends_at FROM app.blocks "
            "WHERE user_id = %s AND id <> %s AND status IN ('planned', 'done') "
            "AND starts_at < %s AND ends_at > %s ORDER BY starts_at, id",
            (user_id, block_id, span.end, span.start),
        ).fetchall()
        taken = tuple(
            (
                row["id"],
                Interval(row["starts_at"].astimezone(dt.UTC), row["ends_at"].astimezone(dt.UTC)),
            )
            for row in rows
        )
    return _Context(profile, block, day, span, start_minute(now), taken)


def _refusal(context: _Context, start: dt.datetime) -> ApiError | None:
    """Why the block cannot start at start (a UTC instant), or None if it can."""
    length = context.block.interval.end - context.block.interval.start
    end = start + length
    span = context.span
    if (
        start.second
        or start.microsecond
        or start < context.earliest
        or span is None
        or start < span.start
        or end > span.end
        # On a clock-change night two days' waking hours can overlap; the block stays on its day.
        or study_date(context.profile, start) != context.day
    ):
        return ApiError("outside_day")
    for other, interval in context.taken:
        if interval.start < end and start < interval.end:
            return ApiError("slot_taken", extra={"blocked_by": str(other)})
    return None


def move_block(
    conn: Conn,
    user_id: UUID,
    block_id: UUID,
    starts_at: dt.datetime,
    pinned: bool | None,
    now: dt.datetime,
) -> BlockView:
    """Move the block to starts_at and pin it (or set pinned as given); no plan version."""
    profile = to_planner_profile(lock_user(conn, user_id))
    context = _context(conn, user_id, block_id, profile, now)
    start = starts_at.astimezone(dt.UTC)
    if start != context.block.interval.start:
        refusal = _refusal(context, start)
        if refusal is not None:
            raise refusal
    length = context.block.interval.end - context.block.interval.start
    conn.execute(
        "UPDATE app.blocks SET starts_at = %s, ends_at = %s, pinned = %s "
        "WHERE user_id = %s AND id = %s",
        (start, start + length, True if pinned is None else pinned, user_id, block_id),
    )
    renumber(conn, user_id, now)
    return blocks_by_id(conn, user_id, [block_id], profile, now)[0]


def _on_grid(instant: dt.datetime, profile: Profile) -> bool:
    return instant.astimezone(profile.timezone).minute % SLOT_MINUTES == 0


def block_slots(conn: Conn, user_id: UUID, block_id: UUID, now: dt.datetime) -> SlotsView:
    """Every start on the local 15-minute grid the block could move to, but its own, by time.

    The candidates are walked minute by minute in UTC and kept where the local clock shows a
    quarter hour, so a clock change or an offset like +05:45 keeps the grid local.
    """
    profile = to_planner_profile(ensure_profile(conn, user_id))
    context = _context(conn, user_id, block_id, profile, now)
    span = context.span
    slots: list[dt.datetime] = []
    if span is not None:
        current = context.block.interval.start
        candidate = max(span.start, context.earliest)
        while candidate < span.end:
            if (
                candidate != current
                and _on_grid(candidate, profile)
                and _refusal(context, candidate) is None
            ):
                slots.append(candidate)
            candidate += _MINUTE
    return SlotsView(study_date=context.day, day=span, slots=tuple(slots))
