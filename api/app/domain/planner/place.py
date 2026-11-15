"""Placing one task in the next free slot, with every other live block where it is.

Deferring a block, the morning review and a newly added task each place a single
task. Every live block (fixed or candidate, except the ones released) is treated
as fixed: it keeps its time, takes its day's budget and breaks, and the task's own
live blocks count against its minutes. The task goes in the first slot the engine
finds, and the whole placement is all-or-nothing: a failure changes nothing.
"""

import datetime as dt
from collections.abc import Collection, Sequence
from typing import Final
from uuid import UUID

from app.domain.planner.assign import assign_days
from app.domain.planner.availability import start_minute, study_date
from app.domain.planner.capacity import BREAK_MINUTES, LONG_BREAK_MINUTES
from app.domain.planner.fixed import BlockRole, block_role, check_blocks, fixed_state
from app.domain.planner.intervals import Interval
from app.domain.planner.model import (
    BlockStatus,
    Exam,
    ExistingBlock,
    PlannedBlock,
    PlannerInputError,
    PlanResult,
    PlanWarning,
    Profile,
    Task,
    TaskKind,
    TaskStatus,
    Unscheduled,
    UnscheduledReason,
)
from app.domain.planner.plan import number_parts, pack_assignment
from app.domain.planner.stability import is_complete

# fixed_state pads each live block with a short break on both sides; place_task
# widens that to a long break. It packs only the new task, so a block set ten
# minutes from an existing run would lengthen the run and leave the long break
# after the wrong block (S12 measured 60-64% of such days without one).
_LONG_BREAK_EXTRA: Final = dt.timedelta(minutes=LONG_BREAK_MINUTES - BREAK_MINUTES)


def place_task(
    profile: Profile,
    exams: Sequence[Exam],
    tasks: Sequence[Task],
    existing_blocks: Sequence[ExistingBlock],
    task_id: UUID,
    now: dt.datetime,
    *,
    release: Collection[UUID] = (),
    not_before: dt.datetime | None = None,
) -> PlanResult:
    """Place what is left of one task in the next free slot, moving no other live block.

    The blocks in release leave the calendar (and are placed anew); the new blocks
    start no earlier than not_before. release takes only PLANNED blocks of the task
    that are live: candidates, and also fixed ones (pinned, or already running),
    since deferring a block is the one explicit user action that moves a fixed
    block. A released fixed block's id is in removed like any other. A planned block
    that already ended (history), a block of another task or a block that is not
    PLANNED raises PlannerInputError. On success the blocks are the task's live
    blocks and its new ones, numbered; on failure nothing changes and the task is
    reported unscheduled with the reason.
    """
    start = start_minute(now)
    task = _check_request(tasks, existing_blocks, task_id, start, release, not_before)
    released = frozenset(release)  # only tested for membership
    live = [
        block
        for block in existing_blocks
        if block.id not in released
        and block_role(block, start) in (BlockRole.FIXED, BlockRole.CANDIDATE)
    ]
    # The whole board, every task included: the busy time, the day budgets, the
    # simulation days and the day the task must wait past. Only what is left of the
    # task itself comes from the single-task state.
    board = fixed_state(profile, tasks, live, start)
    busy = tuple(
        Interval(interval.start - _LONG_BREAK_EXTRA, interval.end + _LONG_BREAK_EXTRA)
        for interval in board.busy
    )
    left = fixed_state(profile, [task], live, start).tasks
    remaining = left[0].estimated_minutes if left else task.estimated_minutes
    todo = {t.id: t for t in tasks if t.status is TaskStatus.TODO}

    def fail(reason: UnscheduledReason, blocked_by: UUID | None = None) -> PlanResult:
        return PlanResult(
            blocks=(),
            removed=(),
            unscheduled=(
                Unscheduled(
                    task_id=task_id, minutes=remaining, reason=reason, blocked_by=blocked_by
                ),
            ),
            warnings=(),
            shortfalls=(),
        )

    own = [block for block in live if block.task_id == task_id]
    prerequisite = todo.get(task.depends_on) if task.depends_on is not None else None
    if prerequisite is not None:
        required = [block for block in live if block.task_id == prerequisite.id]
        minutes = sum(block.interval.minutes for block in required)
        if not is_complete(prerequisite, minutes, has_live_block=bool(required)):
            return fail(UnscheduledReason.DEPENDENCY_NOT_SCHEDULED, prerequisite.id)
    # The last day of the prerequisite's live blocks, as fixed_state counts it (every
    # one of them for a simulation pair, else those that end after the start).
    after: dict[UUID, dt.date] = {}
    if task_id in board.after:
        after[task_id] = board.after[task_id]

    placed: list[tuple[UUID, Interval]] = []
    warnings: tuple[PlanWarning, ...] = ()
    if left:
        earliest = start if not_before is None else max(start, start_minute(not_before))
        assignment = assign_days(
            profile,
            exams,
            left,
            earliest,
            busy,
            used=board.used,
            simulation_days=board.simulation_days,
            after=after,
        )
        if assignment.unscheduled:
            item = assignment.unscheduled[0]
            return fail(item.reason, item.blocked_by)
        placed = pack_assignment(left, assignment)
        warnings = assignment.warnings

        dependent = _dependent_too_early(profile, task, tasks, live, own, placed)
        if dependent is not None:
            return fail(UnscheduledReason.DEPENDENT_TOO_EARLY, dependent)

    blocks: tuple[PlannedBlock, ...] = number_parts([task], own, placed)
    return PlanResult(
        blocks=blocks,
        removed=tuple(block.id for block in existing_blocks if block.id in released),
        unscheduled=(),
        warnings=warnings,
        shortfalls=(),
    )


def _check_request(
    tasks: Sequence[Task],
    existing_blocks: Sequence[ExistingBlock],
    task_id: UUID,
    start: dt.datetime,
    release: Collection[UUID],
    not_before: dt.datetime | None,
) -> Task:
    """The task to place; raises PlannerInputError for a request that makes no sense."""
    check_blocks(existing_blocks)
    task = next((t for t in tasks if t.id == task_id), None)
    if task is None or task.status is not TaskStatus.TODO:
        raise PlannerInputError("task_id must be a todo task of the input")
    by_id = {block.id: block for block in existing_blocks}
    for block_id in release:
        block = by_id.get(block_id)
        if (
            block is None
            or block.task_id != task_id
            or block.status is not BlockStatus.PLANNED
            or block_role(block, start) is BlockRole.HISTORY
        ):
            raise PlannerInputError("release must hold live planned blocks of the task")
    if not_before is not None and (
        not_before.tzinfo is None or not_before.tzinfo.utcoffset(not_before) is None
    ):
        raise PlannerInputError("not_before must be aware")
    return task


def _dependent_too_early(
    profile: Profile,
    task: Task,
    tasks: Sequence[Task],
    live: Sequence[ExistingBlock],
    own: Sequence[ExistingBlock],
    placed: Sequence[tuple[UUID, Interval]],
) -> UUID | None:
    """The first todo dependent (in input order) that the task's blocks would not precede."""
    intervals = [block.interval for block in own] + [interval for _, interval in placed]
    last_day = max(study_date(profile, interval.start) for interval in intervals)
    for dependent in tasks:
        if dependent.status is not TaskStatus.TODO or dependent.depends_on != task.id:
            continue
        theirs = [block.interval for block in live if block.task_id == dependent.id]
        if not theirs:
            continue
        first = min(theirs, key=lambda interval: interval.start)
        simulation = TaskKind.SIMULATION in (task.kind, dependent.kind)
        if any(interval.end > first.start for interval in intervals) or (
            simulation and last_day >= study_date(profile, first.start)
        ):
            return dependent.id
    return None
