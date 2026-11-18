"""Putting a block at a time the user chose, and the times it can go to.

Two actions choose a time: a move (PATCH /blocks/{id} with starts_at, S18), which keeps the
block on its study day, and a defer to a chosen time (POST /blocks/{id}/defer with to=at,
S35), which may go to any study day from today to the exam's last one. Both keep the block's
length, and both pin it: the user, not the planner, chose the place.

The new place must be inside the waking hours of its study day (wake_time to sleep_time,
without the planner's start delay), not before now, on or before the exam's last study day
and ending by its cutoff, free of every other planned or done block, and free of busy time
(the commitments and busy events, S35 decision 6). Touching a neighbour is allowed: the
planner still pads around a pinned block. The busy time is not padded (decision 4).

The actions and the slots share one check (_refusal), so a listed slot is always an action
that succeeds. The 15-minute grid is only for the slots: a move may go anywhere on a whole
minute, so undo can put a block back where the planner placed it.
"""

import datetime as dt
from dataclasses import dataclass
from typing import Final
from uuid import UUID

from app.domain.planner import (
    BlockRole,
    BlockStatus,
    Interval,
    PlannedBlock,
    PlanResult,
    Profile,
    block_role,
    busy_intervals,
    exam_cutoff,
    last_study_day,
    start_minute,
    study_date,
)
from app.errors import ApiError
from app.services.availability import planner_profile
from app.services.blocks import (
    DeferOutcome,
    _find,
    _Target,
    require_deferrable,
    task_live_blocks,
)
from app.services.board import load_board
from app.services.plan_views import BlockView, blocks_by_id, waking_span
from app.services.plan_writes import VersionReason, apply_result, renumber
from app.services.profiles import Conn, ensure_profile, lock_user

SLOT_MINUTES: Final = 15
_MINUTE: Final = dt.timedelta(minutes=1)


@dataclass(frozen=True)
class SlotsView:
    study_date: dt.date
    day: Interval | None
    slots: tuple[dt.datetime, ...]


@dataclass(frozen=True)
class _Context:
    """What bounds a new place for the block on one study day."""

    profile: Profile
    target: _Target
    day: dt.date
    span: Interval | None
    earliest: dt.datetime
    last_day: dt.date
    cutoff: dt.datetime
    # Every other planned or done block of the user in the day's span, by start.
    taken: tuple[tuple[UUID, Interval], ...]
    # The commitment occurrences and busy events that overlap the day's span, merged.
    busy: tuple[Interval, ...]

    @property
    def length(self) -> dt.timedelta:
        interval = self.target.block.interval
        return interval.end - interval.start


def _context(
    conn: Conn,
    user_id: UUID,
    target: _Target,
    profile: Profile,
    now: dt.datetime,
    day: dt.date,
) -> _Context:
    span = waking_span(profile, day)
    taken: tuple[tuple[UUID, Interval], ...] = ()
    busy: tuple[Interval, ...] = ()
    if span is not None:
        # Straight from app.blocks, deleted tasks included: the exclusion constraint counts
        # every planned or done block, whatever its task.
        rows = conn.execute(
            "SELECT id, starts_at, ends_at FROM app.blocks "
            "WHERE user_id = %s AND id <> %s AND status IN ('planned', 'done') "
            "AND starts_at < %s AND ends_at > %s ORDER BY starts_at, id",
            (user_id, target.block.id, span.end, span.start),
        ).fetchall()
        taken = tuple(
            (
                row["id"],
                Interval(row["starts_at"].astimezone(dt.UTC), row["ends_at"].astimezone(dt.UTC)),
            )
            for row in rows
        )
        busy = busy_intervals(profile, span.start, span.end)
    return _Context(
        profile=profile,
        target=target,
        day=day,
        span=span,
        earliest=start_minute(now),
        last_day=last_study_day(target.exam, profile),
        cutoff=exam_cutoff(target.exam, profile),
        taken=taken,
        busy=busy,
    )


def _overlaps(interval: Interval, start: dt.datetime, end: dt.datetime) -> bool:
    return interval.start < end and start < interval.end


def _refusal(context: _Context, start: dt.datetime) -> ApiError | None:
    """Why the block cannot start at start (a UTC instant) on the context's day, or None."""
    end = start + context.length
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
        or context.day > context.last_day
        or end > context.cutoff
    ):
        return ApiError("outside_day")
    for other, interval in context.taken:
        if _overlaps(interval, start, end):
            return ApiError("slot_taken", extra={"blocked_by": str(other)})
    if any(_overlaps(interval, start, end) for interval in context.busy):
        return ApiError("slot_busy")
    return None


def _movable(target: _Target, now: dt.datetime) -> None:
    """A block that has started (or is over) is not moved: it is in progress or history."""
    block = target.block
    if block.status is not BlockStatus.PLANNED or block.interval.start <= now:
        raise ApiError("invalid_state")


def move_block(
    conn: Conn,
    user_id: UUID,
    block_id: UUID,
    starts_at: dt.datetime,
    pinned: bool | None,
    now: dt.datetime,
) -> BlockView:
    """Move the block to starts_at on its study day and pin it (or set pinned as given).

    No plan version: the undo of a move is the reverse PATCH.
    """
    profile = planner_profile(conn, user_id, lock_user(conn, user_id), now)
    target = _find(conn, user_id, block_id)
    _movable(target, now)
    start = starts_at.astimezone(dt.UTC)
    block = target.block
    if start != block.interval.start:
        day = study_date(profile, block.interval.start)
        refusal = _refusal(_context(conn, user_id, target, profile, now, day), start)
        if refusal is not None:
            raise refusal
    length = block.interval.end - block.interval.start
    conn.execute(
        "UPDATE app.blocks SET starts_at = %s, ends_at = %s, pinned = %s "
        "WHERE user_id = %s AND id = %s",
        (start, start + length, True if pinned is None else pinned, user_id, block_id),
    )
    renumber(conn, user_id, now)
    return blocks_by_id(conn, user_id, [block_id], profile, now)[0]


def defer_block_at(
    conn: Conn, user_id: UUID, block_id: UUID, starts_at: dt.datetime, now: dt.datetime
) -> DeferOutcome:
    """Delete the block and write one of the same length at starts_at, pinned (S35).

    One defer_at version: its undo brings the old block back and deletes the new one, which
    the version itself created. The task's other live blocks stay and are renumbered.
    """
    board = load_board(conn, user_id, now, lock=True)
    target = _find(conn, user_id, block_id)
    profile = board.profile
    require_deferrable(target, profile, now)
    start = starts_at.astimezone(dt.UTC)
    context = _context(conn, user_id, target, profile, now, study_date(profile, start))
    refusal = _refusal(context, start)
    if refusal is not None:
        raise refusal

    task_id = target.task.id
    first = start_minute(now)
    entries: list[tuple[Interval, UUID | None, bool]] = [
        (block.interval, block.id, block.pinned)
        for block in board.existing
        if block.task_id == task_id
        and block.id != block_id
        and block_role(block, first) is not BlockRole.HISTORY
    ]
    entries.append((Interval(start, start + context.length), None, True))
    # sorted() is stable: equal intervals keep the order above, like number_parts.
    entries.sort(key=lambda entry: (entry[0].start, entry[0].end))
    result = PlanResult(
        blocks=tuple(
            PlannedBlock(
                task_id=task_id,
                interval=interval,
                part_index=index,
                part_count=len(entries),
                block_id=existing_id,
                pinned=pinned,
            )
            for index, (interval, existing_id, pinned) in enumerate(entries, start=1)
        ),
        removed=(block_id,),
        unscheduled=(),
        warnings=(),
        shortfalls=(),
    )
    version_id = apply_result(conn, user_id, board, result, VersionReason.DEFER_AT, task_id=task_id)
    return DeferOutcome(task_live_blocks(conn, user_id, task_id, profile, now), version_id)


def _on_grid(instant: dt.datetime, profile: Profile) -> bool:
    return instant.astimezone(profile.timezone).minute % SLOT_MINUTES == 0


def _invalid_date() -> ApiError:
    return ApiError(
        "validation_error",
        extra={"errors": [{"loc": ["query", "date"], "type": "out_of_range"}]},
    )


def block_slots(
    conn: Conn, user_id: UUID, block_id: UUID, now: dt.datetime, date: dt.date | None = None
) -> SlotsView:
    """Every start on the local 15-minute grid the block could go to, but its own, by time.

    Without a date: the move slots, on the block's own study day (the block must not have
    started). With a date: the defer-at slots of that study day, from the current study day
    to the exam's last one (else 422 on the query's date); a started block may be deferred.

    The candidates are walked minute by minute in UTC and kept where the local clock shows a
    quarter hour, so a clock change or an offset like +05:45 keeps the grid local.
    """
    profile = planner_profile(conn, user_id, ensure_profile(conn, user_id), now)
    target = _find(conn, user_id, block_id)
    if date is None:
        _movable(target, now)
        day = study_date(profile, target.block.interval.start)
    else:
        require_deferrable(target, profile, now)
        if not study_date(profile, now) <= date <= last_study_day(target.exam, profile):
            raise _invalid_date()
        day = date
    context = _context(conn, user_id, target, profile, now, day)
    span = context.span
    slots: list[dt.datetime] = []
    if span is not None:
        current = target.block.interval.start
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
