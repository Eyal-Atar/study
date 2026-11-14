"""Existing blocks that never move, and what they leave for the planner.

A block that is done, pinned or already running is fixed: it stays where it is.
It takes its time (with a break on each side), its minutes out of its task and
out of its study day's budget, and a fixed simulation keeps its day from taking
another. The planner then plans only what is left.
"""

import datetime as dt
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from enum import Enum
from types import MappingProxyType
from typing import Final
from uuid import UUID

from app.domain.planner.availability import study_date
from app.domain.planner.capacity import BREAK_MINUTES
from app.domain.planner.intervals import Interval
from app.domain.planner.model import (
    BlockStatus,
    ExistingBlock,
    PlannerInputError,
    Profile,
    Task,
    TaskKind,
    TaskStatus,
)

_BREAK: Final = dt.timedelta(minutes=BREAK_MINUTES)
# The shortest remainder a partly done task keeps: the smallest task the model accepts.
# A task can so end up to MIN_REMAINDER_MINUTES - 1 minutes over its estimate.
MIN_REMAINDER_MINUTES: Final = 5


class BlockRole(Enum):
    FIXED = "fixed"  # never moves: done, pinned, or running at the start
    CANDIDATE = "candidate"  # planned for later and free to move
    HISTORY = "history"  # in the past or missed or skipped: it plays no part


def check_blocks(existing_blocks: Sequence[ExistingBlock]) -> None:
    """Raises PlannerInputError unless every item is an ExistingBlock with its own id."""
    seen: set[UUID] = set()  # only tested for membership
    for block in existing_blocks:
        if not isinstance(block, ExistingBlock):
            raise PlannerInputError("existing_blocks must hold ExistingBlock items")
        if block.id in seen:
            raise PlannerInputError(f"duplicate block id {block.id}")
        seen.add(block.id)


def block_role(block: ExistingBlock, start: dt.datetime) -> BlockRole:
    """The block's role when planning starts at start, a whole UTC minute."""
    if block.status is BlockStatus.DONE:
        return BlockRole.FIXED
    if block.status is BlockStatus.PLANNED:
        interval = block.interval
        if interval.end > start and (block.pinned or interval.start < start):
            return BlockRole.FIXED
        if interval.start >= start and not block.pinned:
            return BlockRole.CANDIDATE
    return BlockRole.HISTORY


@dataclass(frozen=True, slots=True, kw_only=True)
class FixedState:
    """What the fixed blocks leave for the planner."""

    # The todo tasks with what is left of them, in input order; covered ones are gone.
    tasks: tuple[Task, ...]
    # The fixed blocks that end after the start, each with a break on both sides.
    busy: tuple[Interval, ...]
    # Study day -> the minutes its fixed blocks take out of the daily budget.
    used: Mapping[dt.date, int]
    # The study days that hold a fixed simulation, so they take no other.
    simulation_days: frozenset[dt.date]
    # Task -> the last study day of its prerequisite's fixed blocks: it goes on a later
    # day. Only blocks that end after the start count, unless the task or its
    # prerequisite is a simulation: then every fixed block of the prerequisite counts,
    # since a simulation pair never shares a study day.
    after: Mapping[UUID, dt.date]


def fixed_state(
    profile: Profile,
    tasks: Sequence[Task],
    fixed: Sequence[ExistingBlock],
    start: dt.datetime,
) -> FixedState:
    """The state the fixed blocks leave, given in input order, when planning starts at start."""
    tasks_by_id = {task.id: task for task in tasks}
    busy: list[Interval] = []
    used: dict[dt.date, int] = {}
    simulation_days: set[dt.date] = set()  # only tested for membership
    minutes: dict[UUID, int] = {}  # task -> the minutes of its fixed blocks
    last_day: dict[UUID, dt.date] = {}  # task -> its latest fixed block ending after start
    last_day_ever: dict[UUID, dt.date] = {}  # task -> its latest fixed block, past ones too
    for block in fixed:
        interval = block.interval
        day = study_date(profile, interval.start)
        used[day] = used.get(day, 0) + interval.minutes
        minutes[block.task_id] = minutes.get(block.task_id, 0) + interval.minutes
        task = tasks_by_id.get(block.task_id)
        if task is not None and task.kind is TaskKind.SIMULATION:
            simulation_days.add(day)
        last_day_ever[block.task_id] = max(day, last_day_ever.get(block.task_id, day))
        if interval.end > start:
            busy.append(Interval(interval.start - _BREAK, interval.end + _BREAK))
            last_day[block.task_id] = max(day, last_day.get(block.task_id, day))

    left = [_remainder(task, minutes.get(task.id)) for task in tasks]
    remaining = tuple(task for task in left if task is not None)
    todo = {task.id: task for task in tasks if task.status is TaskStatus.TODO}
    after: dict[UUID, dt.date] = {}
    for task in remaining:
        if task.status is not TaskStatus.TODO or task.depends_on is None:
            continue
        prerequisite = todo.get(task.depends_on)
        if prerequisite is None:
            continue
        # A simulation pair needs a later study day than any fixed block of the
        # prerequisite, also one that ended before the start.
        simulation = TaskKind.SIMULATION in (task.kind, prerequisite.kind)
        days = last_day_ever if simulation else last_day
        if prerequisite.id in days:
            after[task.id] = days[prerequisite.id]
    return FixedState(
        tasks=remaining,
        busy=tuple(busy),
        used=MappingProxyType(used),
        simulation_days=frozenset(simulation_days),
        after=MappingProxyType(after),
    )


def _remainder(task: Task, fixed_minutes: int | None) -> Task | None:
    """What is left of a task once its fixed minutes are done; None when nothing is."""
    if task.status is not TaskStatus.TODO or fixed_minutes is None:
        return task
    if task.kind is TaskKind.SIMULATION:
        return None  # a simulation never splits, so any fixed block covers it
    left = task.estimated_minutes - fixed_minutes
    if left <= 0:
        return None
    return replace(task, estimated_minutes=max(MIN_REMAINDER_MINUTES, left))
