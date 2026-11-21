"""The planner's entry point: assign days, pack them into blocks, report shortfalls."""

import datetime as dt
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import replace
from typing import Final
from uuid import UUID

from app.domain.planner.assign import assign_days
from app.domain.planner.availability import start_minute, study_date
from app.domain.planner.dependencies import resolve_dependencies
from app.domain.planner.fixed import BlockRole, FixedState, block_role, check_blocks, fixed_state
from app.domain.planner.intervals import Interval
from app.domain.planner.model import (
    DayAssignment,
    Exam,
    ExamShortfall,
    ExistingBlock,
    PlannedBlock,
    PlanResult,
    Profile,
    Task,
    TaskStatus,
    UnscheduledReason,
)
from app.domain.planner.pack import pack_day
from app.domain.planner.stability import valid_blocks

# Suggested daily budgets go up in steps of half an hour.
_BUDGET_STEP: Final = 30
# The largest daily budget: the limit of Profile and of the database.
_MAX_DAILY_MINUTES: Final = 960


def plan(
    profile: Profile,
    exams: Sequence[Exam],
    tasks: Sequence[Task],
    existing_blocks: Sequence[ExistingBlock],
    now: dt.datetime,
    *,
    keep_valid: bool = False,
) -> PlanResult:
    """Plan timed blocks for every todo task, and report what did not fit.

    Fixed blocks (done, pinned or running) stay where they are and come back in
    the blocks; only what they leave of each task is planned anew. Candidate
    blocks (planned for later, not pinned) are all removed and planned again;
    with keep_valid, the valid ones (see `valid_blocks`) stay as if they were
    fixed, and only the others are removed. Blocks in the past do nothing.

    A split task skips the days that hold one of the blocks that stay (one bite
    a day, see `assign_days`), unless that leaves more minutes unscheduled.
    """
    check_blocks(existing_blocks)
    start = start_minute(now)
    roles = [(block, block_role(block, start)) for block in existing_blocks]
    stays: set[UUID] = set()  # only tested for membership
    if keep_valid:
        stays = {block.id for block in valid_blocks(profile, exams, tasks, existing_blocks, now)}
    fixed = [block for block, role in roles if role is BlockRole.FIXED or block.id in stays]
    state = fixed_state(profile, tasks, fixed, start)
    held = _held(profile, tasks, fixed)
    assignment = _assign(profile, exams, state, now, held)
    placed = pack_assignment(state.tasks, assignment)
    return PlanResult(
        blocks=number_parts(tasks, fixed, placed),
        removed=tuple(
            block.id
            for block, role in roles
            if role is BlockRole.CANDIDATE and block.id not in stays
        ),
        unscheduled=assignment.unscheduled,
        warnings=assignment.warnings,
        shortfalls=_shortfalls(profile, exams, state, now, assignment, held),
    )


def replan(
    profile: Profile,
    exams: Sequence[Exam],
    tasks: Sequence[Task],
    existing_blocks: Sequence[ExistingBlock],
    now: dt.datetime,
) -> PlanResult:
    """The plan that keeps valid blocks in place, unless that leaves more minutes
    unscheduled than planning everything afresh."""
    stable = plan(profile, exams, tasks, existing_blocks, now, keep_valid=True)
    if not stable.unscheduled:
        return stable
    fresh = plan(profile, exams, tasks, existing_blocks, now)
    if _unscheduled_minutes(stable) <= _unscheduled_minutes(fresh):
        return stable
    return fresh


def _unscheduled_minutes(result: PlanResult) -> int:
    return sum(item.minutes for item in result.unscheduled)


def _held(
    profile: Profile, tasks: Sequence[Task], fixed: Sequence[ExistingBlock]
) -> dict[UUID, frozenset[dt.date]]:
    """Split task -> the study days of its blocks that stay, which it then skips."""
    split = {task.id for task in tasks if task.bite_minutes is not None}
    days: dict[UUID, set[dt.date]] = defaultdict(set)
    for block in fixed:
        if block.task_id in split:
            days[block.task_id].add(study_date(profile, block.interval.start))
    return {task_id: frozenset(dates) for task_id, dates in days.items()}


def _assign(
    profile: Profile,
    exams: Sequence[Exam],
    state: FixedState,
    now: dt.datetime,
    held: Mapping[UUID, frozenset[dt.date]],
) -> DayAssignment:
    """Assign what the fixed blocks leave, around them.

    The split tasks skip their held days. When that leaves one of them
    unscheduled, the whole assignment runs again without held, and the run with
    fewer unscheduled minutes wins (the held one on a tie): the rule may cost a
    bite its own day, never its place.
    """

    def run(held_days: Mapping[UUID, frozenset[dt.date]] | None) -> DayAssignment:
        return assign_days(
            profile,
            exams,
            state.tasks,
            now,
            state.busy,
            used=state.used,
            simulation_days=state.simulation_days,
            after=state.after,
            held=held_days,
        )

    first = run(held)
    if not any(item.task_id in held for item in first.unscheduled):
        return first
    free = run(None)
    if _minutes(free) < _minutes(first):
        return free
    return first


def _minutes(assignment: DayAssignment) -> int:
    return sum(item.minutes for item in assignment.unscheduled)


def pack_assignment(
    tasks: Sequence[Task], assignment: DayAssignment
) -> list[tuple[UUID, Interval]]:
    """The assigned days packed into timed intervals, as (task_id, interval) in day order.

    tasks are the tasks that were assigned (what the fixed blocks leave of them).
    """
    tasks_by_id = {task.id: task for task in tasks}
    prerequisite = resolve_dependencies(tasks).prerequisite
    return [
        (task_id, interval)
        for day_plan in assignment.days
        if day_plan.items
        for task_id, interval in pack_day(day_plan.day, day_plan.items, tasks_by_id, prerequisite)
    ]


def number_parts(
    tasks: Sequence[Task],
    fixed: Sequence[ExistingBlock],
    placed: Sequence[tuple[UUID, Interval]],
) -> tuple[PlannedBlock, ...]:
    """The fixed blocks of the todo tasks and the new blocks, by (start, end); each
    task's blocks are numbered 1..n in that order. A fixed block keeps its id and its
    pinned flag; a new block is not pinned."""
    todo = {task.id for task in tasks if task.status is TaskStatus.TODO}
    entries: list[tuple[UUID, Interval, UUID | None, bool]] = [
        (block.task_id, block.interval, block.id, block.pinned)
        for block in fixed
        if block.task_id in todo
    ]
    entries.extend((task_id, interval, None, False) for task_id, interval in placed)
    # sorted() is stable, so equal intervals keep the order above.
    ordered = sorted(entries, key=lambda entry: (entry[1].start, entry[1].end))
    counts: dict[UUID, int] = defaultdict(int)
    for task_id, _, _, _ in ordered:
        counts[task_id] += 1
    seen: dict[UUID, int] = defaultdict(int)
    blocks: list[PlannedBlock] = []
    for task_id, interval, block_id, pinned in ordered:
        seen[task_id] += 1
        blocks.append(
            PlannedBlock(
                task_id=task_id,
                interval=interval,
                part_index=seen[task_id],
                part_count=counts[task_id],
                block_id=block_id,
                pinned=pinned,
            )
        )
    return tuple(blocks)


def _stuck_on_cycle(tasks: Sequence[Task]) -> frozenset[UUID]:
    """Tasks on a dependency cycle, or waiting (through any chain) on one: time cannot fix them."""
    dependencies = resolve_dependencies(tasks)
    stuck: set[UUID] = set()
    for task in tasks:
        node: UUID | None = task.id
        seen: set[UUID] = set()
        while node is not None and node not in seen:
            if node in dependencies.in_cycle:
                stuck.add(task.id)
                break
            seen.add(node)
            node = dependencies.prerequisite.get(node)
    return frozenset(stuck)


def _missing_minutes(
    exams: Sequence[Exam],
    tasks: Sequence[Task],
    assignment: DayAssignment,
    stuck: frozenset[UUID],
) -> dict[UUID, int]:
    """Exam -> minutes left unscheduled, tasks stuck on a cycle excepted."""
    exam_of = {task.id: task.exam_id for task in tasks}
    missing = dict.fromkeys((exam.id for exam in exams), 0)
    for item in assignment.unscheduled:
        if item.task_id not in stuck:
            missing[exam_of[item.task_id]] += item.minutes
    return missing


def _shortfalls(
    profile: Profile,
    exams: Sequence[Exam],
    state: FixedState,
    now: dt.datetime,
    assignment: DayAssignment,
    held: Mapping[UUID, frozenset[dt.date]],
) -> tuple[ExamShortfall, ...]:
    """Per exam with missing minutes: the smallest larger daily budget that fits them.

    The trial runs plan the same remaining tasks around the same fixed blocks.
    """
    tasks = state.tasks
    stuck = _stuck_on_cycle(tasks)
    missing = _missing_minutes(exams, tasks, assignment, stuck)
    short = [exam.id for exam in exams if missing[exam.id] > 0]
    # Study days do not depend on the budget, so no budget fixes an exam that has none.
    hopeless = {
        item.task_id
        for item in assignment.unscheduled
        if item.reason is UnscheduledReason.NO_STUDY_DAYS and item.task_id not in stuck
    }
    exam_of = {task.id: task.exam_id for task in tasks}
    hopeless_exams = {exam_of[task_id] for task_id in hopeless}
    sweep = [id_ for id_ in short if id_ not in hopeless_exams]
    fixed: dict[UUID, int] = {}
    first = _BUDGET_STEP * (profile.daily_study_minutes // _BUDGET_STEP + 1)
    for budget in range(first, _MAX_DAILY_MINUTES + 1, _BUDGET_STEP):
        if len(fixed) == len(sweep):
            break
        trial = _assign(replace(profile, daily_study_minutes=budget), exams, state, now, held)
        still = _missing_minutes(exams, tasks, trial, stuck)
        fixed.update({id_: budget for id_ in sweep if id_ not in fixed and still[id_] == 0})
    return tuple(
        ExamShortfall(exam_id=id_, minutes=missing[id_], daily_minutes=fixed.get(id_))
        for id_ in short
    )
