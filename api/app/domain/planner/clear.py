"""Clearing the board under a new busy event (plan decision 9).

The user said "I am busy then", which is an explicit action like a defer: every
PLANNED block that has not ended and overlaps the event is released, pinned and
running ones too (a DONE block never). Each affected task is placed again with
place_task, one after another, on a board that already holds the earlier tasks'
new blocks, so they never collide.
"""

import datetime as dt
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final
from uuid import NAMESPACE_URL, UUID, uuid5

from app.domain.planner.availability import start_minute
from app.domain.planner.fixed import BlockRole, block_role, check_blocks
from app.domain.planner.intervals import Interval
from app.domain.planner.model import (
    BlockStatus,
    Exam,
    ExistingBlock,
    PlannedBlock,
    PlannerInputError,
    Profile,
    Task,
    TaskStatus,
    Unscheduled,
    UnscheduledReason,
)
from app.domain.planner.place import place_task
from app.domain.planner.plan import number_parts

_SYNTHETIC: Final = uuid5(NAMESPACE_URL, "studyflow:planner:new-block")


@dataclass(frozen=True, slots=True, kw_only=True)
class ClearResult:
    # The live blocks of every affected todo task after the change, each task's numbered
    # 1..n by time; an existing block has its block_id, a new one None.
    blocks: tuple[PlannedBlock, ...]
    # Every released block, in input order: they leave the calendar.
    removed: tuple[UUID, ...]
    # The affected tasks that found no room, with what they now miss.
    unscheduled: tuple[Unscheduled, ...]


def overlaps(a: Interval, b: Interval) -> bool:
    return a.start < b.end and b.start < a.end


def new_block(task_id: UUID, interval: Interval, *, pinned: bool) -> ExistingBlock:
    """A block the planner just made, as an ExistingBlock to feed back into place_task.

    Its id is derived from the task and the time, so the same input gives the same ids.
    """
    key = f"{task_id}:{interval.start.isoformat()}:{interval.end.isoformat()}"
    return ExistingBlock(
        id=uuid5(_SYNTHETIC, key),
        task_id=task_id,
        interval=interval,
        status=BlockStatus.PLANNED,
        pinned=pinned,
    )


def is_live(block: ExistingBlock, start: dt.datetime) -> bool:
    return block_role(block, start) in (BlockRole.FIXED, BlockRole.CANDIDATE)


def clear_interval(
    profile: Profile,
    exams: Sequence[Exam],
    tasks: Sequence[Task],
    existing_blocks: Sequence[ExistingBlock],
    now: dt.datetime,
    interval: Interval,
) -> ClearResult:
    """Release the planned blocks under interval and place their tasks again.

    profile already holds the interval in its busy events, so no new block lands on it.
    Released are the PLANNED blocks that end after start_minute(now) and overlap the
    interval, whatever their role. The affected todo tasks are placed in the order of
    their first released block's start (then input order), each with place_task and
    release = its own released blocks, on the board as it stands after the tasks
    before it. Every released block is left out of that board from the start, since
    it leaves the calendar whatever happens. A task that finds no room loses its
    released blocks anyway and is reported with place_task's reason and the minutes it
    now misses. When it fails only because a dependent's candidate blocks come too early,
    those are released as well and the dependent is placed right after it (a pinned or
    running dependent stays, and the task is reported). A released block of a task that is
    not a todo task of the input is only removed.
    """
    if not isinstance(interval, Interval):
        raise PlannerInputError("interval must be an Interval")
    check_blocks(existing_blocks)
    start = start_minute(now)
    released = [
        block
        for block in existing_blocks
        if block.status is BlockStatus.PLANNED
        and block.interval.end > start
        and overlaps(block.interval, interval)
    ]
    released_ids = {block.id for block in released}  # only tested for membership
    position = {task.id: index for index, task in enumerate(tasks)}
    todo = {task.id: task for task in tasks if task.status is TaskStatus.TODO}
    by_task: dict[UUID, list[ExistingBlock]] = {}
    for block in released:
        if block.task_id in todo:
            by_task.setdefault(block.task_id, []).append(block)
    order = sorted(
        by_task,
        key=lambda task_id: (
            min(block.interval.start for block in by_task[task_id]),
            position[task_id],
        ),
    )

    board = [block for block in existing_blocks if block.id not in released_ids]
    blocks: list[PlannedBlock] = []
    unscheduled: list[Unscheduled] = []
    queue = list(order)
    index = 0
    while index < len(queue):
        task_id = queue[index]
        own = by_task[task_id]
        result = place_task(
            profile,
            exams,
            tasks,
            [*board, *own],
            task_id,
            now,
            release=[block.id for block in own],
        )
        failure = result.unscheduled[0] if result.unscheduled else None
        if (
            failure is not None
            and failure.reason is UnscheduledReason.DEPENDENT_TOO_EARLY
            and failure.blocked_by is not None
        ):
            # A dependent that is still only a candidate is in the way: release it too and
            # place it after its prerequisite (review of S35), instead of dropping the
            # prerequisite and leaving the dependent ahead of it. A fixed one stays.
            dependent = failure.blocked_by
            movable = [
                block
                for block in board
                if block.task_id == dependent and block_role(block, start) is BlockRole.CANDIDATE
            ]
            # A dependent placed earlier in this loop is not moved again: its blocks are new.
            if movable and dependent in todo and dependent not in queue[:index]:
                moved = {block.id for block in movable}
                board = [block for block in board if block.id not in moved]
                released.extend(movable)
                by_task.setdefault(dependent, []).extend(movable)
                if dependent in queue[index + 1 :]:
                    queue.remove(dependent)
                queue.insert(index + 1, dependent)
                continue  # place the same task again, now without the dependent's blocks
        if failure is not None:
            unscheduled.extend(result.unscheduled)
            left = [b for b in board if b.task_id == task_id and is_live(b, start)]
            blocks.extend(number_parts([todo[task_id]], left, []))
            index += 1
            continue
        blocks.extend(result.blocks)
        board.extend(
            new_block(task_id, block.interval, pinned=False)
            for block in result.blocks
            if block.block_id is None
        )
        index += 1
    return ClearResult(
        blocks=tuple(blocks),
        removed=tuple(block.id for block in released),
        unscheduled=tuple(unscheduled),
    )
