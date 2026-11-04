"""The invariants of plan() (spec 7.6): hour packing keeps what the days hold."""

import datetime as dt
from collections import Counter, defaultdict
from collections.abc import Sequence
from dataclasses import replace
from itertools import pairwise
from uuid import UUID

from hypothesis import given

from app.domain.planner import (
    BREAK_MINUTES,
    MIN_PART_MINUTES,
    BlockStatus,
    DayAssignment,
    ExistingBlock,
    Interval,
    PlannedBlock,
    PlanResult,
    Profile,
    StudyDay,
    TaskKind,
    TaskStatus,
    assign_days,
    exam_cutoff,
    last_study_day,
    pack_day,
    plan,
    resolve_dependencies,
    study_days,
)
from tests.planner.strategies import PROPERTY_SETTINGS, PlanInputs, plan_inputs

BUDGET_STEP = 30
MAX_DAILY_MINUTES = 960


def _busy(existing_blocks: Sequence[ExistingBlock]) -> list[Interval]:
    """The same rule as plan(): done or pinned blocks take time."""
    return [
        block.interval
        for block in existing_blocks
        if block.pinned or block.status is BlockStatus.DONE
    ]


def _overlaps(a: Interval, b: Interval) -> bool:
    return a.start < b.end and b.start < a.end


def _window_of(block: PlannedBlock, days: Sequence[StudyDay]) -> tuple[dt.date, int]:
    """The study day and window index that hold the whole block; it fails if none does."""
    holders = [
        (day.date, index)
        for day in days
        for index, window in enumerate(day.windows)
        if window.start <= block.interval.start and block.interval.end <= window.end
    ]
    assert len(holders) == 1, f"no single window holds {block}"
    return holders[0]


def _by_task(result: PlanResult) -> dict[UUID, list[PlannedBlock]]:
    """Task -> its blocks in time order."""
    blocks: dict[UUID, list[PlannedBlock]] = defaultdict(list)
    for block in sorted(result.blocks, key=lambda block: block.interval.start):
        blocks[block.task_id].append(block)
    return blocks


def _missing_minutes(inputs: PlanInputs, result: DayAssignment | PlanResult) -> Counter[UUID]:
    """Exam -> the unscheduled minutes of a result, except for tasks that time cannot fix:
    those on a dependency cycle or waiting, through any chain, on one."""
    in_cycle = resolve_dependencies(inputs.tasks).in_cycle
    prerequisite = resolve_dependencies(inputs.tasks).prerequisite
    exam_of = {task.id: task.exam_id for task in inputs.tasks}

    def stuck(task_id: UUID) -> bool:
        seen: set[UUID] = set()
        node: UUID | None = task_id
        while node is not None and node not in seen:
            if node in in_cycle:
                return True
            seen.add(node)
            node = prerequisite.get(node)
        return False

    missing: Counter[UUID] = Counter()
    for entry in result.unscheduled:
        if not stuck(entry.task_id):
            missing[exam_of[entry.task_id]] += entry.minutes
    return missing


def _with_budget(profile: Profile, minutes: int) -> Profile:
    return replace(profile, daily_study_minutes=minutes)


@PROPERTY_SETTINGS
@given(plan_inputs())
def test_blocks_pack_what_the_days_hold(inputs: PlanInputs) -> None:
    profile, exams, tasks, existing_blocks, now = inputs
    busy = _busy(existing_blocks)
    result = plan(*inputs)
    days = study_days(profile, exams, now, busy)
    assignment = assign_days(profile, exams, tasks, now, busy)
    tasks_by_id = {task.id: task for task in tasks}
    exams_by_id = {exam.id: exam for exam in exams}
    blocks = sorted(result.blocks, key=lambda block: block.interval.start)

    # 1. Each block lies whole in one study window.
    places = [_window_of(block, days) for block in blocks]
    # 2. No two blocks overlap, and no block overlaps busy time.
    assert all(a.interval.end <= b.interval.start for a, b in pairwise(blocks))
    assert not any(_overlaps(block.interval, taken) for block in blocks for taken in busy)
    # 3. Two blocks in a row in the same window have a break between them.
    for (a, place_a), (b, place_b) in pairwise(zip(blocks, places, strict=True)):
        if place_a == place_b:
            assert b.interval.start - a.interval.end >= dt.timedelta(minutes=BREAK_MINUTES)
    # 4. Each day's blocks hold exactly the minutes its items have, and they are
    # what pack_day makes of those items, so plan() packed the same days.
    prerequisite = resolve_dependencies(tasks).prerequisite
    on_day: dict[dt.date, list[PlannedBlock]] = defaultdict(list)
    for block, (date, _) in zip(blocks, places, strict=True):
        on_day[date].append(block)
    assert on_day.keys() <= {day_plan.day.date for day_plan in assignment.days}
    for day_plan in assignment.days:
        packed = on_day.get(day_plan.day.date, [])
        minutes: Counter[UUID] = Counter()
        for block in packed:
            minutes[block.task_id] += block.interval.minutes
        items: Counter[UUID] = Counter()
        for item in day_plan.items:
            items[item.task_id] += item.minutes
        assert minutes == items
        # This pins the busy rule (only done or pinned blocks take time) and the call into
        # pack_day, not the packing rules; test_pack.py and the checks above pin those.
        expected = pack_day(day_plan.day, day_plan.items, tasks_by_id, prerequisite)
        assert [(block.task_id, block.interval) for block in packed] == list(expected)

    date_of = {block: date for block, (date, _) in zip(blocks, places, strict=True)}
    by_task = _by_task(result)
    reported = Counter(entry.task_id for entry in result.unscheduled)
    assert by_task.keys() <= tasks_by_id.keys()
    for task in tasks:
        own = by_task.get(task.id, [])
        # 5. A todo task is planned whole or reported once; any other task has no blocks.
        if task.status is not TaskStatus.TODO:
            assert not own
        elif own:
            assert sum(block.interval.minutes for block in own) == task.estimated_minutes
            assert task.id not in reported
        else:
            assert reported[task.id] == 1
        if not own:
            continue
        # 6. The parts are numbered 1..n in time order.
        assert [block.part_index for block in own] == list(range(1, len(own) + 1))
        assert all(block.part_count == len(own) for block in own)
        # 7. A simulation is one block; the parts of a split task are long enough.
        if task.kind is TaskKind.SIMULATION:
            assert len(own) == 1
            assert own[0].interval.minutes == task.estimated_minutes
        elif len(own) > 1:
            assert all(block.interval.minutes >= MIN_PART_MINUTES for block in own)
        # 8. Every block is before its exam's cutoff, on a day the exam may use.
        exam = exams_by_id[task.exam_id]
        cutoff = exam_cutoff(exam, profile)
        assert all(block.interval.end <= cutoff for block in own)
        assert all(date_of[block] <= last_study_day(exam, profile) for block in own)


@PROPERTY_SETTINGS
@given(plan_inputs())
def test_dependencies_hold_in_time(inputs: PlanInputs) -> None:
    profile, exams, tasks, existing_blocks, now = inputs
    result = plan(*inputs)
    days = study_days(profile, exams, now, _busy(existing_blocks))
    tasks_by_id = {task.id: task for task in tasks}
    prerequisites = resolve_dependencies(tasks).prerequisite
    by_task = _by_task(result)

    for task_id, own in by_task.items():
        prerequisite = prerequisites.get(task_id)
        if prerequisite is None:
            continue
        assert prerequisite in by_task
        last = by_task[prerequisite][-1]
        first = own[0]
        assert last.interval.end <= first.interval.start
        kinds = (tasks_by_id[task_id].kind, tasks_by_id[prerequisite].kind)
        if TaskKind.SIMULATION in kinds:
            assert _window_of(last, days)[0] < _window_of(first, days)[0]


@PROPERTY_SETTINGS
@given(plan_inputs())
def test_shortfalls_match_the_report(inputs: PlanInputs) -> None:
    """Each shortfall has the exam's missing minutes, and its suggested budget is
    the smallest step of 30 that leaves the exam nothing missing."""
    profile = inputs.profile
    busy = _busy(inputs.existing_blocks)
    result = plan(*inputs)
    missing = _missing_minutes(inputs, result)

    shortfalls = {shortfall.exam_id: shortfall for shortfall in result.shortfalls}
    assert len(shortfalls) == len(result.shortfalls)
    assert shortfalls.keys() == {exam_id for exam_id, minutes in missing.items() if minutes > 0}
    budget = profile.daily_study_minutes
    trials: dict[int, Counter[UUID]] = {}

    def missing_with(minutes: int) -> Counter[UUID]:
        if minutes not in trials:
            trial = assign_days(
                _with_budget(profile, minutes), inputs.exams, inputs.tasks, inputs.now, busy
            )
            trials[minutes] = _missing_minutes(inputs, trial)
        return trials[minutes]

    for exam_id, shortfall in shortfalls.items():
        assert shortfall.minutes == missing[exam_id]
        suggested = shortfall.daily_minutes
        if suggested is None:
            if budget < MAX_DAILY_MINUTES:
                assert missing_with(MAX_DAILY_MINUTES)[exam_id] > 0
            continue
        assert suggested % BUDGET_STEP == 0
        assert budget < suggested <= MAX_DAILY_MINUTES
        assert missing_with(suggested)[exam_id] == 0
        if suggested - BUDGET_STEP > budget:
            assert missing_with(suggested - BUDGET_STEP)[exam_id] > 0


@PROPERTY_SETTINGS
@given(plan_inputs())
def test_same_input_same_output(inputs: PlanInputs) -> None:
    assert plan(*inputs) == plan(*inputs)
