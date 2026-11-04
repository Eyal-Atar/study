"""The planner's entry point: assign days, pack them into blocks, report shortfalls."""

import datetime as dt
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import replace
from typing import Final
from uuid import UUID

from app.domain.planner.assign import assign_days
from app.domain.planner.dependencies import resolve_dependencies
from app.domain.planner.intervals import Interval
from app.domain.planner.model import (
    BlockStatus,
    DayAssignment,
    Exam,
    ExamShortfall,
    ExistingBlock,
    PlannedBlock,
    PlannerInputError,
    PlanResult,
    Profile,
    Task,
    UnscheduledReason,
)
from app.domain.planner.pack import pack_day

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
) -> PlanResult:
    """Plan timed blocks for every todo task, and report what did not fit.

    Done and pinned existing blocks only take time: they are busy, and they do not
    shorten their task (S08 does that). Other existing blocks are ignored.
    """
    busy = _busy(existing_blocks)
    assignment = assign_days(profile, exams, tasks, now, busy)
    tasks_by_id = {task.id: task for task in tasks}
    prerequisite = resolve_dependencies(tasks).prerequisite
    placed = [
        (task_id, interval)
        for day_plan in assignment.days
        if day_plan.items
        for task_id, interval in pack_day(day_plan.day, day_plan.items, tasks_by_id, prerequisite)
    ]
    return PlanResult(
        blocks=_number_parts(placed),
        unscheduled=assignment.unscheduled,
        warnings=assignment.warnings,
        shortfalls=_shortfalls(profile, exams, tasks, now, busy, assignment),
    )


def _busy(existing_blocks: Sequence[ExistingBlock]) -> list[Interval]:
    busy: list[Interval] = []
    for block in existing_blocks:
        if not isinstance(block, ExistingBlock):
            raise PlannerInputError("existing_blocks must hold ExistingBlock items")
        if block.pinned or block.status is BlockStatus.DONE:
            busy.append(block.interval)
    return busy


def _number_parts(placed: Sequence[tuple[UUID, Interval]]) -> tuple[PlannedBlock, ...]:
    """Blocks in start order; each task's blocks are numbered 1..n in time order."""
    ordered = sorted(placed, key=lambda block: block[1].start)
    counts: dict[UUID, int] = defaultdict(int)
    for task_id, _ in ordered:
        counts[task_id] += 1
    seen: dict[UUID, int] = defaultdict(int)
    blocks: list[PlannedBlock] = []
    for task_id, interval in ordered:
        seen[task_id] += 1
        blocks.append(
            PlannedBlock(
                task_id=task_id,
                interval=interval,
                part_index=seen[task_id],
                part_count=counts[task_id],
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
    tasks: Sequence[Task],
    now: dt.datetime,
    busy: Sequence[Interval],
    assignment: DayAssignment,
) -> tuple[ExamShortfall, ...]:
    """Per exam with missing minutes: the smallest larger daily budget that fits them."""
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
        trial = assign_days(replace(profile, daily_study_minutes=budget), exams, tasks, now, busy)
        still = _missing_minutes(exams, tasks, trial, stuck)
        fixed.update({id_: budget for id_ in sweep if id_ not in fixed and still[id_] == 0})
    return tuple(
        ExamShortfall(exam_id=id_, minutes=missing[id_], daily_minutes=fixed.get(id_))
        for id_ in short
    )
