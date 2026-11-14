"""The invariants of stages 1-3 (spec 7.6), for every input the strategies produce."""

import datetime as dt
from collections import Counter, defaultdict
from collections.abc import Mapping
from itertools import pairwise
from uuid import UUID

from hypothesis import given

from app.domain.planner import (
    MIN_PART_MINUTES,
    DayAssignment,
    DayPlan,
    Task,
    TaskKind,
    TaskStatus,
    UnscheduledReason,
    assign_days,
    awake_span,
    day_fits,
    exam_cutoff,
    last_study_day,
    open_windows,
    resolve_dependencies,
    study_date,
    study_days,
)
from tests.planner.strategies import PROPERTY_SETTINGS, PlannerInputs, planner_inputs

MIN_WINDOW_MINUTES = 30  # spec 7.6: a stretch shorter than 30 minutes does not count


def _ceil_to_minute(instant: dt.datetime) -> dt.datetime:
    floored = instant.replace(second=0, microsecond=0)
    return floored if floored == instant else floored + dt.timedelta(minutes=1)


def _tasks_by_id(inputs: PlannerInputs) -> dict[UUID, Task]:
    return {task.id: task for task in inputs.tasks}


def _split(plan: DayPlan, tasks: Mapping[UUID, Task]) -> tuple[list[int], int | None]:
    """The minutes of the day's regular items, and of its simulation if it has one
    (a day never holds two)."""
    regular: list[int] = []
    simulations: list[int] = []
    for item in plan.items:
        is_simulation = tasks[item.task_id].kind is TaskKind.SIMULATION
        (simulations if is_simulation else regular).append(item.minutes)
    assert len(simulations) <= 1
    return regular, simulations[0] if simulations else None


def _goes_in_whole(plan: DayPlan, minutes: int, tasks: Mapping[UUID, Task], daily: int) -> bool:
    """Whether an item of these minutes still goes whole into the day as planned:
    within the daily budget, and with the capacity rule."""
    regular, simulation = _split(plan, tasks)
    used = sum(item.minutes for item in plan.items)
    windows = [window.minutes for window in plan.day.windows]
    return used + minutes <= daily and day_fits(windows, [*regular, minutes], simulation)


def _needs_a_later_day(task: Task, prerequisite: Task) -> bool:
    """Whether the task may go only on a day after its prerequisite's last day: a
    dependent of a simulation, and a simulation that has a prerequisite."""
    return prerequisite.kind is TaskKind.SIMULATION or task.kind is TaskKind.SIMULATION


def _places(result: DayAssignment) -> dict[UUID, list[tuple[dt.date, int, int]]]:
    """Each task on the board -> its items as (date, position in the day, minutes)."""
    places: dict[UUID, list[tuple[dt.date, int, int]]] = defaultdict(list)
    for plan in result.days:
        for position, item in enumerate(plan.items):
            places[item.task_id].append((plan.day.date, position, item.minutes))
    return places


@PROPERTY_SETTINGS
@given(planner_inputs())
def test_study_days_invariants(inputs: PlannerInputs) -> None:
    profile, exams, _, now, busy = inputs
    days = study_days(profile, exams, now, busy)
    start = _ceil_to_minute(now)

    assert all(earlier.date < later.date for earlier, later in pairwise(days))
    # Sorted and disjoint within each day and across days.
    windows = [window for day in days for window in day.windows]
    assert all(earlier.end <= later.start for earlier, later in pairwise(windows))
    for day in days:
        awake = awake_span(profile, day.date)
        cutoffs = [
            exam_cutoff(exam, profile)
            for exam in exams
            if last_study_day(exam, profile) == day.date
        ]
        for window in day.windows:
            assert window.minutes >= MIN_WINDOW_MINUTES
            for bound in (window.start, window.end):
                assert bound.tzinfo is dt.UTC
                assert bound.second == 0 and bound.microsecond == 0
            assert window.start >= start
            assert awake is not None and awake.start <= window.start and window.end <= awake.end
            # Ends by the cutoff, so it cannot cross it: the night before a rest day ends then.
            assert all(window.end <= cutoff for cutoff in cutoffs)
            assert all(window.end <= taken.start or taken.end <= window.start for taken in busy)


@PROPERTY_SETTINGS
@given(planner_inputs())
def test_every_task_is_scheduled_or_reported(inputs: PlannerInputs) -> None:
    result = assign_days(*inputs)
    placed: Counter[UUID] = Counter()
    for plan in result.days:
        on_day = [item.task_id for item in plan.items]
        assert len(on_day) == len(set(on_day))
        for item in plan.items:
            assert item.minutes > 0
            placed[item.task_id] += item.minutes
    reported = Counter(entry.task_id for entry in result.unscheduled)
    reported_minutes = {entry.task_id: entry.minutes for entry in result.unscheduled}

    for task in inputs.tasks:
        if task.status is not TaskStatus.TODO:
            assert task.id not in placed and task.id not in reported
        elif task.id in placed:
            assert placed[task.id] == task.estimated_minutes
            assert task.id not in reported
        else:
            assert reported[task.id] == 1
            assert reported_minutes[task.id] == task.estimated_minutes
    known = _tasks_by_id(inputs).keys()
    assert placed.keys() <= known and reported.keys() <= known


@PROPERTY_SETTINGS
@given(planner_inputs())
def test_days_respect_deadlines_and_capacity(inputs: PlannerInputs) -> None:
    profile, exams, _, now, busy = inputs
    result = assign_days(*inputs)
    tasks = _tasks_by_id(inputs)
    exams_by_id = {exam.id: exam for exam in exams}

    # A plan for every study day, so the windows checked below are the real ones.
    assert [plan.day for plan in result.days] == list(study_days(profile, exams, now, busy))
    for plan in result.days:
        for item in plan.items:
            exam = exams_by_id[tasks[item.task_id].exam_id]
            assert plan.day.date <= last_study_day(exam, profile)
            cutoff = exam_cutoff(exam, profile)
            assert all(window.end <= cutoff for window in plan.day.windows)
        assert sum(item.minutes for item in plan.items) <= profile.daily_study_minutes
        regular, simulation = _split(plan, tasks)
        assert day_fits([window.minutes for window in plan.day.windows], regular, simulation)


@PROPERTY_SETTINGS
@given(planner_inputs())
def test_simulations_and_parts(inputs: PlannerInputs) -> None:
    result = assign_days(*inputs)
    tasks = _tasks_by_id(inputs)
    for plan in result.days:
        on_day = [item for item in plan.items if tasks[item.task_id].kind is TaskKind.SIMULATION]
        assert len(on_day) <= 1
    study = {plan.day.date: plan.day for plan in result.days}

    for task_id, parts in _places(result).items():
        task = tasks[task_id]
        if task.kind is TaskKind.SIMULATION:
            assert len(parts) == 1
            ((date, _, minutes),) = parts
            assert minutes == task.estimated_minutes
            assert any(window.minutes >= minutes for window in study[date].windows)
        elif len(parts) > 1:
            assert all(minutes >= MIN_PART_MINUTES for _, _, minutes in parts)


@PROPERTY_SETTINGS
@given(planner_inputs())
def test_dependencies_hold(inputs: PlannerInputs) -> None:
    result = assign_days(*inputs)
    tasks = _tasks_by_id(inputs)
    prerequisites = resolve_dependencies(inputs.tasks).prerequisite
    places = _places(result)

    for task_id, parts in places.items():
        prerequisite = prerequisites.get(task_id)
        if prerequisite is None:
            continue
        assert prerequisite in places
        last_date, last_position, _ = max(places[prerequisite])
        first_date, first_position, _ = min(parts)
        if _needs_a_later_day(tasks[task_id], tasks[prerequisite]):
            assert last_date < first_date
        else:
            assert (last_date, last_position) < (first_date, first_position)


@PROPERTY_SETTINGS
@given(planner_inputs())
def test_reported_tasks_did_not_fit(inputs: PlannerInputs) -> None:
    """A task reported for lack of time went whole into none of the days it was
    ready on. Only for a task that an empty day of its exam holds whole (a longer
    one spans days), and not a simulation or a review, which have their own steps.
    Readiness comes from the board: from the prerequisite's last day, or from the
    day after it when the task needs a later day."""
    profile = inputs.profile
    result = assign_days(*inputs)
    tasks = _tasks_by_id(inputs)
    last_days = {exam.id: last_study_day(exam, profile) for exam in inputs.exams}
    prerequisites = resolve_dependencies(inputs.tasks).prerequisite
    places = _places(result)
    daily = profile.daily_study_minutes
    own_steps = (TaskKind.SIMULATION, TaskKind.SIMULATION_REVIEW)

    for entry in result.unscheduled:
        task = tasks[entry.task_id]
        if entry.reason is not UnscheduledReason.NOT_ENOUGH_TIME or task.kind in own_steps:
            continue
        minutes = task.estimated_minutes
        eligible = [
            plan
            for plan in result.days
            if plan.day.windows and plan.day.date <= last_days[task.exam_id]
        ]
        if not any(
            _goes_in_whole(DayPlan(day=plan.day, items=()), minutes, tasks, daily)
            for plan in eligible
        ):
            continue  # a multi-day task
        ready_from = dt.date.min
        prerequisite = prerequisites.get(task.id)
        if prerequisite is not None:
            assert prerequisite in places  # else the reason is dependency_not_scheduled
            ready_from = max(date for date, _, _ in places[prerequisite])
            if _needs_a_later_day(task, tasks[prerequisite]):
                ready_from += dt.timedelta(days=1)
        for plan in eligible:
            if plan.day.date >= ready_from:
                assert not _goes_in_whole(plan, minutes, tasks, daily)


@PROPERTY_SETTINGS
@given(planner_inputs())
def test_same_input_same_output(inputs: PlannerInputs) -> None:
    assert assign_days(*inputs) == assign_days(*inputs)


@PROPERTY_SETTINGS
@given(planner_inputs())
def test_every_window_belongs_to_its_study_day(inputs: PlannerInputs) -> None:
    profile, exams, _, now, busy = inputs
    one_minute = dt.timedelta(minutes=1)
    pairs = [(day.date, day.windows) for day in study_days(profile, exams, now, busy)]
    pairs += list(open_windows(profile, exams, now).items())
    for date, windows in pairs:
        for window in windows:
            assert study_date(profile, window.start) == date
            assert study_date(profile, window.end - one_minute) == date
