"""Which candidate blocks stay where they are when the plan is made again.

A future block that is still valid stays; only what must move moves. A block is
"live" when it is fixed or a candidate that stays. Three passes, each of which
only drops candidates:

1. Each candidate by itself: its task and exam are still there, it lies in one
   open window of a study day of its exam, and it does not overlap a fixed block.
2. In time order: it overlaps no candidate kept before it, and it keeps its
   task within its estimate, its day within the budget and its day to one
   simulation.
3. In dependency order: a dependent keeps its candidates only after a complete
   prerequisite, and no task is left with a remainder too short to plan.

Validity is legal, not comfortable: the 10-minute break around a fixed block is
not required of a block that is already there.
"""

import datetime as dt
from collections.abc import Mapping, Sequence
from uuid import UUID

from app.domain.planner.availability import last_study_day, open_windows, start_minute, study_date
from app.domain.planner.capacity import MIN_PART_MINUTES
from app.domain.planner.dependencies import Dependencies, resolve_dependencies
from app.domain.planner.fixed import BlockRole, block_role, fixed_state
from app.domain.planner.intervals import Interval
from app.domain.planner.model import (
    Exam,
    ExistingBlock,
    Profile,
    Task,
    TaskKind,
    TaskStatus,
)


def is_complete(task: Task, live_minutes: int, *, has_live_block: bool) -> bool:
    """Whether a task's live blocks cover it: all its minutes, or any block of a simulation."""
    if task.kind is TaskKind.SIMULATION and has_live_block:
        return True
    return live_minutes >= task.estimated_minutes


def valid_blocks(
    profile: Profile,
    exams: Sequence[Exam],
    tasks: Sequence[Task],
    existing_blocks: Sequence[ExistingBlock],
    now: dt.datetime,
) -> tuple[ExistingBlock, ...]:
    """The candidate blocks that stay where they are, by (interval.start, id)."""
    start = start_minute(now)
    roles = [(block, block_role(block, start)) for block in existing_blocks]
    fixed = [block for block, role in roles if role is BlockRole.FIXED]
    candidates = sorted(
        (block for block, role in roles if role is BlockRole.CANDIDATE),
        key=lambda block: (block.interval.start, block.id),
    )
    dependencies = resolve_dependencies(tasks)
    alone = _valid_alone(profile, exams, tasks, fixed, candidates, now, dependencies)
    in_time = _valid_in_time(profile, tasks, fixed, alone, start)
    return _valid_in_order(profile, tasks, fixed, in_time, dependencies)


def _overlaps(a: Interval, b: Interval) -> bool:
    return a.start < b.end and b.start < a.end


def _valid_alone(
    profile: Profile,
    exams: Sequence[Exam],
    tasks: Sequence[Task],
    fixed: Sequence[ExistingBlock],
    candidates: Sequence[ExistingBlock],
    now: dt.datetime,
    dependencies: Dependencies,
) -> list[ExistingBlock]:
    """Pass 1: the candidates that are valid each by itself, in the given order."""
    tasks_by_id = {task.id: task for task in tasks}
    exams_by_id = {exam.id: exam for exam in exams}
    windows = open_windows(profile, exams, now)
    with_fixed = {block.task_id for block in fixed}
    kept: list[ExistingBlock] = []
    for block in candidates:
        task = tasks_by_id.get(block.task_id)
        if task is None or task.status is not TaskStatus.TODO:
            continue
        if task.id in dependencies.in_cycle:
            continue
        exam = exams_by_id.get(task.exam_id)
        if exam is None:
            continue
        interval = block.interval
        day = study_date(profile, interval.start)
        if day > last_study_day(exam, profile):
            continue
        if not any(
            window.start <= interval.start and interval.end <= window.end
            for window in windows.get(day, ())
        ):
            continue
        if any(_overlaps(interval, other.interval) for other in fixed):
            continue
        if task.kind is TaskKind.SIMULATION and (
            task.id in with_fixed or interval.minutes != task.estimated_minutes
        ):
            continue
        kept.append(block)
    return kept


def _valid_in_time(
    profile: Profile,
    tasks: Sequence[Task],
    fixed: Sequence[ExistingBlock],
    candidates: Sequence[ExistingBlock],
    start: dt.datetime,
) -> list[ExistingBlock]:
    """Pass 2: in (start, id) order, the candidates that still fit next to those kept."""
    tasks_by_id = {task.id: task for task in tasks}
    state = fixed_state(profile, tasks, fixed, start)
    task_minutes: dict[UUID, int] = {}
    for block in fixed:
        task_minutes[block.task_id] = task_minutes.get(block.task_id, 0) + block.interval.minutes
    day_minutes = dict(state.used)
    simulation_days = set(state.simulation_days)  # only tested for membership
    kept: list[ExistingBlock] = []
    for block in candidates:
        task = tasks_by_id[block.task_id]
        interval = block.interval
        day = study_date(profile, interval.start)
        minutes = interval.minutes
        simulation = task.kind is TaskKind.SIMULATION
        if (
            any(_overlaps(interval, other.interval) for other in kept)
            or task_minutes.get(task.id, 0) + minutes > task.estimated_minutes
            or day_minutes.get(day, 0) + minutes > profile.daily_study_minutes
            or (simulation and day in simulation_days)
        ):
            continue
        kept.append(block)
        task_minutes[task.id] = task_minutes.get(task.id, 0) + minutes
        day_minutes[day] = day_minutes.get(day, 0) + minutes
        if simulation:
            simulation_days.add(day)
    return kept


def _ranks(tasks: Sequence[Task], prerequisite: Mapping[UUID, UUID]) -> dict[UUID, int]:
    """Task -> the length of its chain of prerequisites; a cycle member is 0."""
    ranks: dict[UUID, int] = {}
    for task in tasks:
        chain: list[UUID] = []
        node: UUID | None = task.id
        while node is not None and node not in ranks and node not in chain:
            chain.append(node)
            node = prerequisite.get(node)
        # The walk stops at a known rank, at the chain's end, or where it loops.
        if node is not None and node in chain:
            loop = chain[chain.index(node) :]
            ranks.update(dict.fromkeys(loop, 0))
            chain = chain[: chain.index(node)]
            base = 0
        else:
            base = -1 if node is None else ranks[node]
        for offset, member in enumerate(reversed(chain), start=1):
            ranks[member] = base + offset
    return ranks


def _valid_in_order(
    profile: Profile,
    tasks: Sequence[Task],
    fixed: Sequence[ExistingBlock],
    candidates: Sequence[ExistingBlock],
    dependencies: Dependencies,
) -> tuple[ExistingBlock, ...]:
    """Pass 3: prerequisites before their dependents, each task's candidates judged
    against its prerequisite's live blocks, then trimmed of a short remainder."""
    live: dict[UUID, list[ExistingBlock]] = {}
    for block in fixed:
        live.setdefault(block.task_id, []).append(block)
    kept: dict[UUID, list[ExistingBlock]] = {}
    for block in candidates:
        kept.setdefault(block.task_id, []).append(block)  # stays in (start, id) order

    prerequisite = dependencies.prerequisite
    ranks = _ranks(tasks, prerequisite)
    todo = [task for task in tasks if task.status is TaskStatus.TODO]
    order = sorted(enumerate(todo), key=lambda pair: (ranks[pair[1].id], pair[0]))
    tasks_by_id = {task.id: task for task in tasks}

    def live_blocks(task_id: UUID) -> list[ExistingBlock]:
        return [*live.get(task_id, []), *kept.get(task_id, [])]

    for _, task in order:
        own = kept.get(task.id, [])
        before = prerequisite.get(task.id)
        if own and before is not None:
            required = tasks_by_id[before]
            required_live = live_blocks(before)
            minutes = sum(block.interval.minutes for block in required_live)
            if not is_complete(required, minutes, has_live_block=bool(required_live)):
                own = []
            else:
                simulation = TaskKind.SIMULATION in (task.kind, required.kind)
                own = [
                    block
                    for block in own
                    if not _too_early(profile, block, required_live, simulation=simulation)
                ]
        # A remainder shorter than a part cannot be planned: free the latest kept block.
        fixed_minutes = sum(block.interval.minutes for block in live.get(task.id, []))
        while own:
            left = task.estimated_minutes - fixed_minutes - sum(b.interval.minutes for b in own)
            if not 0 < left < MIN_PART_MINUTES:
                break
            own = own[:-1]
        kept[task.id] = own

    stays = [block for blocks in kept.values() for block in blocks]
    return tuple(sorted(stays, key=lambda block: (block.interval.start, block.id)))


def _too_early(
    profile: Profile,
    block: ExistingBlock,
    required_live: Sequence[ExistingBlock],
    *,
    simulation: bool,
) -> bool:
    """Whether a dependent's block starts before its prerequisite's live blocks allow."""
    start = block.interval.start
    day = study_date(profile, start)
    return any(
        other.interval.end > start
        or (simulation and study_date(profile, other.interval.start) >= day)
        for other in required_live
    )
