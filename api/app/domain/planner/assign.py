"""Study tasks assigned to local study days (stage 3 of the planner).

Every todo task either has all of its minutes on days or is reported with a
reason: no task silently disappears. A day never holds more than the daily
budget, and only what `day_fits` accepts, so hour packing can fit all of it.

A simulation never splits. Before the first day, each one is given a day of
its own, spread over its exam's study days, and it goes first on that day. The
rest of a day goes by deadline: exam by exam in rank order, each exam's ready
simulation reviews first, then its started multi-day tasks, then its other
tasks. So on every day, a later exam takes time only after an earlier exam's
ready work had its turn.
"""

import datetime as dt
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Final
from uuid import UUID

from app.domain.planner.availability import day_windows, last_study_day, study_days
from app.domain.planner.capacity import MIN_PART_MINUTES, day_fits, room, simulation_window
from app.domain.planner.dependencies import Dependencies, resolve_dependencies
from app.domain.planner.intervals import Interval
from app.domain.planner.model import (
    DayAssignment,
    DayItem,
    DayPlan,
    Exam,
    PlannerInputError,
    PlanWarning,
    Profile,
    StudyDay,
    Task,
    TaskKind,
    TaskStatus,
    Unscheduled,
    UnscheduledReason,
    WarningCode,
)

# Kinds outside an exam's list of other tasks: a simulation goes first in its day,
# and a simulation review first among its exam's tasks.
_OWN_STEPS: Final = (TaskKind.SIMULATION, TaskKind.SIMULATION_REVIEW)


@dataclass(slots=True)
class _Day:
    """The state of one study day while it is being filled."""

    index: int
    date: dt.date
    windows: tuple[int, ...]  # the window lengths in minutes, in time order
    budget: int  # what is left of daily_study_minutes
    items: list[DayItem] = field(default_factory=list)
    # The capacity rule takes the simulation apart from the other items.
    simulation: int | None = None  # the minutes of the day's simulation, if it has one
    regular: list[int] = field(default_factory=list)  # the minutes of the other items

    def add(self, item: DayItem, *, simulation: bool) -> None:
        self.items.append(item)
        self.budget -= item.minutes
        if simulation:
            self.simulation = item.minutes
        else:
            self.regular.append(item.minutes)

    def holds(self, task_id: UUID) -> bool:
        """Whether the task already has an item on this day."""
        return any(item.task_id == task_id for item in self.items)

    def fits(self, minutes: int) -> bool:
        """Whether a whole item of these minutes still goes in."""
        return minutes <= self.budget and day_fits(
            self.windows, [*self.regular, minutes], self.simulation
        )

    def fits_simulation(self, minutes: int) -> bool:
        """Whether a simulation of these minutes still goes in, whole and in one window."""
        return (
            self.simulation is None
            and minutes <= self.budget
            and day_fits(self.windows, self.regular, minutes)
        )

    def part(self, remainder: int) -> int:
        """How much of a multi-day task's remainder goes in today; 0 for nothing."""
        part = min(self.budget, room(self.windows, self.regular, self.simulation))
        if part >= remainder:
            return remainder
        if remainder - part < MIN_PART_MINUTES:
            part = remainder - MIN_PART_MINUTES  # so the last part is long enough
        return part if part >= MIN_PART_MINUTES else 0


@dataclass(frozen=True, slots=True)
class _ExamTasks:
    """The todo tasks of one exam that the day loop places after the simulation."""

    exam_id: UUID
    reviews: tuple[Task, ...]  # its simulation reviews, in input order
    others: tuple[Task, ...]  # the rest but simulations, by (phase, input position)


@dataclass(frozen=True, slots=True)
class _Context:
    """What the day loop needs, fixed before the first day."""

    todo: tuple[Task, ...]  # in input order
    # The simulations that were kept a day, as (day index, simulation), by day. No
    # two share a day, so the day alone orders them.
    simulations: tuple[tuple[int, Task], ...]
    exams: tuple[_ExamTasks, ...]  # by exam rank
    rank: Mapping[UUID, int]  # exam -> its position in the rank order
    last_day: Mapping[UUID, dt.date]  # exam -> its last study day
    eligible: Mapping[UUID, tuple[int, ...]]  # exam -> indices of the days it may use
    dependencies: Dependencies
    multi_day: frozenset[UUID]
    # Ready only on a day after the prerequisite's last day (see _waits_a_day).
    day_after: frozenset[UUID]
    # Simulations that no eligible day can hold: within the budget and in one window.
    no_window: frozenset[UUID]
    # Simulations longer than the daily budget: no day can ever hold them.
    over_budget: frozenset[UUID]


@dataclass(slots=True)
class _Progress:
    """The state of one pass of the day loop."""

    # Multi-day tasks that did not finish in an earlier pass; this pass never places them.
    excluded: frozenset[UUID] = frozenset()
    placed: dict[UUID, int] = field(default_factory=dict)  # task -> minutes on days so far
    finished: dict[UUID, int] = field(default_factory=dict)  # task -> day it was completed on
    started: dict[UUID, Task] = field(default_factory=dict)  # unfinished, in start order


def assign_days(
    profile: Profile,
    exams: Sequence[Exam],
    tasks: Sequence[Task],
    now: dt.datetime,
    busy: Sequence[Interval] = (),
) -> DayAssignment:
    """Assign every todo task to study days, or report why it does not fit."""
    _check_input(exams, tasks)
    # study_days rejects a naive now, even when there is nothing to plan.
    study = study_days(profile, exams, now, busy)
    context = _prepare(profile, exams, tasks, _new_days(study, profile))
    # A multi-day task that never finishes is placed whole or not at all. Its parts
    # took time that other tasks could have used, so the loop runs again without
    # it. Each run drops one: the unfinished task of the earliest exam, and of that
    # exam the one that started first. Its failure is real, and not caused by the
    # other unfinished tasks: after the day's simulation, every day tries it, to
    # start or to go on, before any task of a later exam, and goes on with it
    # before the tasks of its own exam that started after it. (One gap: its exam's
    # reviews go first, so the first part of a review long enough to span days
    # goes before it.) The others may have failed only because of it. Every rerun
    # excludes one more task, so this ends. A simulation is never multi-day, and
    # keeps the day it was given in every run.
    excluded: frozenset[UUID] = frozenset()
    while True:
        days, progress = _run_days(context, study, profile, excluded)
        if not progress.started:
            break
        # min() keeps the first of equal keys, so of one exam the earliest started.
        dropped = min(progress.started.values(), key=lambda task: context.rank[task.exam_id])
        excluded = excluded.union((dropped.id,))
    return DayAssignment(
        days=_day_plans(study, days),
        unscheduled=tuple(
            _unscheduled(context, progress, task)
            for task in context.todo
            if task.id not in progress.finished
        ),
        warnings=_warnings(profile, study),
    )


def _new_days(study: Sequence[StudyDay], profile: Profile) -> list[_Day]:
    return [
        _Day(
            index=index,
            date=day.date,
            windows=tuple(window.minutes for window in day.windows),
            budget=profile.daily_study_minutes,
        )
        for index, day in enumerate(study)
    ]


def _run_days(
    context: _Context, study: Sequence[StudyDay], profile: Profile, excluded: frozenset[UUID]
) -> tuple[list[_Day], _Progress]:
    """One pass of the day loop, from the first day, never placing the excluded tasks."""
    days = _new_days(study, profile)
    progress = _Progress(excluded=excluded)
    for day in days:
        if day.windows:
            _fill_day(context, progress, day)
    return days, progress


def _check_input(exams: Sequence[Exam], tasks: Sequence[Task]) -> None:
    _check_unique("exam", [exam.id for exam in exams])
    _check_unique("task", [task.id for task in tasks])
    known = {exam.id for exam in exams}
    for task in tasks:
        if task.exam_id not in known:
            raise PlannerInputError(f"task {task.id} belongs to an exam that is not in the input")


def _check_unique(kind: str, ids: Sequence[UUID]) -> None:
    seen: set[UUID] = set()
    for id_ in ids:
        if id_ in seen:
            raise PlannerInputError(f"duplicate {kind} id {id_}")
        seen.add(id_)


def _prepare(
    profile: Profile, exams: Sequence[Exam], tasks: Sequence[Task], days: Sequence[_Day]
) -> _Context:
    # sorted() is stable, so the input order breaks the remaining ties.
    ranked = sorted(exams, key=lambda e: (e.exam_date, -e.difficulty))
    rank = {exam.id: position for position, exam in enumerate(ranked)}
    last_day = {exam.id: last_study_day(exam, profile) for exam in exams}
    eligible = {
        exam_id: tuple(day.index for day in days if _is_eligible(day, last))
        for exam_id, last in last_day.items()
    }
    todo = tuple(task for task in tasks if task.status is TaskStatus.TODO)
    dependencies = resolve_dependencies(tasks)
    multi_day = frozenset(
        task.id
        for task in todo
        if _is_multi_day(task, [days[index] for index in eligible[task.exam_id]], profile)
    )
    simulations = [task for task in todo if task.kind is TaskKind.SIMULATION]
    simulation_ids = frozenset(task.id for task in simulations)
    reserved = _reserve_simulations(
        ranked, todo, days, eligible, dependencies, profile.daily_study_minutes
    )
    return _Context(
        todo=todo,
        simulations=tuple(
            sorted(
                ((reserved[task.id], task) for task in simulations if task.id in reserved),
                key=lambda kept: kept[0],
            )
        ),
        exams=tuple(_exam_tasks(exam.id, todo) for exam in ranked),
        rank=rank,
        last_day=last_day,
        eligible=eligible,
        dependencies=dependencies,
        multi_day=multi_day,
        day_after=frozenset(
            task.id for task in todo if _waits_a_day(task, dependencies, simulation_ids)
        ),
        no_window=frozenset(
            task.id
            for task in simulations
            if not any(
                _holds_simulation(days[index], task, profile.daily_study_minutes)
                for index in eligible[task.exam_id]
            )
        ),
        over_budget=frozenset(
            task.id for task in simulations if task.estimated_minutes > profile.daily_study_minutes
        ),
    )


def _exam_tasks(exam_id: UUID, todo: Sequence[Task]) -> _ExamTasks:
    tasks = [task for task in todo if task.exam_id == exam_id]
    return _ExamTasks(
        exam_id=exam_id,
        reviews=tuple(task for task in tasks if task.kind is TaskKind.SIMULATION_REVIEW),
        # sorted() is stable, so the input order breaks ties within a phase.
        others=tuple(sorted((task for task in tasks if task.kind not in _OWN_STEPS), key=_phase)),
    )


def _waits_a_day(task: Task, dependencies: Dependencies, simulations: frozenset[UUID]) -> bool:
    """Whether the task is ready only on a day after its prerequisite's last day.

    So is a task that waits for a simulation: packing puts the simulation at the
    start of the smallest window that holds it, which may come after every window
    the task could use that day. And so is a simulation that waits for a task: it
    goes first in its day, before a prerequisite that finishes that day.
    """
    prerequisite = dependencies.prerequisite.get(task.id)
    if prerequisite is None:
        return False
    return prerequisite in simulations or task.kind is TaskKind.SIMULATION


def _reserve_simulations(
    ranked: Sequence[Exam],
    todo: Sequence[Task],
    days: Sequence[_Day],
    eligible: Mapping[UUID, tuple[int, ...]],
    dependencies: Dependencies,
    daily_minutes: int,
) -> dict[UUID, int]:
    """A day of its own for each simulation that can have one: simulation -> day index.

    The simulations of an exam spread evenly over its eligible days, in input order.
    The last one aims at the last of them, or at the one before when a task waits
    for it (its review, say), so that task gets a later day too. When the aimed day
    is already kept or cannot hold the simulation, the search goes forward, then
    back, then to the last day. Earlier exams choose first.
    """
    reserved: dict[UUID, int] = {}
    kept: set[int] = set()  # only tested for membership
    for exam in ranked:
        simulations = [
            task
            for task in todo
            if task.exam_id == exam.id
            and task.kind is TaskKind.SIMULATION
            and task.id not in dependencies.in_cycle
        ]
        candidates = eligible[exam.id]
        if not simulations or not candidates:
            continue
        awaited = simulations[-1].id in dependencies.prerequisite.values()
        end = len(candidates) - (2 if awaited and len(candidates) >= 2 else 1)
        count = len(simulations)
        for number, simulation in enumerate(simulations, start=1):
            target = (number * (end + 1) + count - 1) // count - 1  # ceil(n * (end + 1) / k) - 1
            for position in _search_order(target, end, len(candidates)):
                index = candidates[position]
                if index not in kept and _holds_simulation(days[index], simulation, daily_minutes):
                    reserved[simulation.id] = index
                    kept.add(index)
                    break
    return reserved


def _search_order(target: int, end: int, count: int) -> list[int]:
    """Positions to try: from target forward to end, from target back to the first,
    and the last position if it was not tried yet."""
    order = [*range(target, end + 1), *range(target - 1, -1, -1)]
    if end < count - 1:
        order.append(count - 1)
    return order


def _holds_simulation(day: _Day, simulation: Task, daily_minutes: int) -> bool:
    """Whether a day can hold the whole simulation: within the budget, in one window."""
    minutes = simulation.estimated_minutes
    return minutes <= daily_minutes and simulation_window(day.windows, minutes) is not None


def _is_eligible(day: _Day, last_day: dt.date) -> bool:
    """Whether an exam whose last study day is last_day may use this day."""
    return bool(day.windows) and day.date <= last_day


def _phase(task: Task) -> int:
    """Review and learning come before practice and the rest."""
    return 0 if task.kind in (TaskKind.REVIEW, TaskKind.LEARN) else 1


def _is_multi_day(task: Task, eligible: Sequence[_Day], profile: Profile) -> bool:
    """Only a task that no empty day of its exam holds whole is split over days."""
    if task.kind is TaskKind.SIMULATION:
        return False
    return not any(
        min(profile.daily_study_minutes, room(day.windows, [])) >= task.estimated_minutes
        for day in eligible
    )


def _fill_day(context: _Context, progress: _Progress, day: _Day) -> None:
    """The day's simulation first, then the rest by deadline. After each task it
    places, the search starts over: that task may make others ready."""
    _place_simulation(context, progress, day)
    while (choice := _next_task(context, progress, day)) is not None:
        task, minutes = choice
        _place(progress, day, task, minutes)


def _place_simulation(context: _Context, progress: _Progress, day: _Day) -> None:
    """At most one simulation a day, before anything else: the one kept for today,
    or else the first whose day passed before it was ready."""
    today = [task for index, task in context.simulations if index == day.index]
    waiting = [task for index, task in context.simulations if index < day.index]
    for task in (*today, *waiting):
        if _is_candidate(context, progress, day, task) and day.fits_simulation(
            task.estimated_minutes
        ):
            _place(progress, day, task, task.estimated_minutes)
            return


def _next_task(context: _Context, progress: _Progress, day: _Day) -> tuple[Task, int] | None:
    """The first task that has minutes to place today, exam by exam in rank order:
    the exam's ready reviews, then its started multi-day tasks, then its other tasks."""
    for exam in context.exams:
        choice = (
            _first_fitting(context, progress, day, exam.reviews)
            or _next_part(context, progress, day, exam.exam_id)
            or _first_fitting(context, progress, day, exam.others)
        )
        if choice is not None:
            return choice
    return None


def _next_part(
    context: _Context, progress: _Progress, day: _Day, exam_id: UUID
) -> tuple[Task, int] | None:
    """The exam's first started multi-day task, in start order, that has a part to
    place today. A task gets at most one part a day."""
    if not _is_eligible(day, context.last_day[exam_id]):
        return None
    for task in progress.started.values():
        if task.exam_id == exam_id and not day.holds(task.id):
            minutes = day.part(task.estimated_minutes - progress.placed[task.id])
            if minutes:
                return task, minutes
    return None


def _first_fitting(
    context: _Context, progress: _Progress, day: _Day, tasks: Sequence[Task]
) -> tuple[Task, int] | None:
    """The first of these tasks that is ready and goes in today, with its minutes."""
    for task in tasks:
        if _is_candidate(context, progress, day, task):
            minutes = _fitting_minutes(context, day, task)
            if minutes:
                return task, minutes
    return None


def _is_candidate(context: _Context, progress: _Progress, day: _Day, task: Task) -> bool:
    return (
        task.id not in progress.placed
        and task.id not in progress.excluded
        and task.id not in context.dependencies.in_cycle
        and _is_eligible(day, context.last_day[task.exam_id])
        and _is_ready(context, progress, task, day.index)
    )


def _fitting_minutes(context: _Context, day: _Day, task: Task) -> int:
    """All of a task that fits whole, the first part of a multi-day task, or 0."""
    if task.id in context.multi_day:
        return day.part(task.estimated_minutes)
    return task.estimated_minutes if day.fits(task.estimated_minutes) else 0


def _is_ready(context: _Context, progress: _Progress, task: Task, index: int) -> bool:
    """Whether the task's prerequisite, if it has one, was completed by day index,
    or before it for a task that waits a day."""
    prerequisite = context.dependencies.prerequisite.get(task.id)
    if prerequisite is None:
        return True
    finished = progress.finished.get(prerequisite)
    if finished is None:
        return False
    return finished < index if task.id in context.day_after else finished <= index


def _place(progress: _Progress, day: _Day, task: Task, minutes: int) -> None:
    day.add(
        DayItem(task_id=task.id, minutes=minutes),
        simulation=task.kind is TaskKind.SIMULATION,
    )
    placed = progress.placed.get(task.id, 0) + minutes
    progress.placed[task.id] = placed
    if placed == task.estimated_minutes:
        progress.finished[task.id] = day.index
        progress.started.pop(task.id, None)
    else:
        progress.started.setdefault(task.id, task)


def _day_plans(study: Sequence[StudyDay], days: Sequence[_Day]) -> tuple[DayPlan, ...]:
    """A plan for every day, empty ones included."""
    return tuple(
        DayPlan(day=study_day, items=tuple(day.items))
        for study_day, day in zip(study, days, strict=True)
    )


def _unscheduled(context: _Context, progress: _Progress, task: Task) -> Unscheduled:
    reason, blocked_by = _reason(context, progress, task)
    return Unscheduled(
        task_id=task.id,
        minutes=task.estimated_minutes,
        reason=reason,
        blocked_by=blocked_by,
    )


def _reason(
    context: _Context, progress: _Progress, task: Task
) -> tuple[UnscheduledReason, UUID | None]:
    """The first reason that applies, and the prerequisite that blocked the task."""
    if task.id in context.dependencies.in_cycle:
        return UnscheduledReason.DEPENDENCY_CYCLE, None
    eligible = context.eligible[task.exam_id]
    if not eligible:
        return UnscheduledReason.NO_STUDY_DAYS, None
    prerequisite = context.dependencies.prerequisite.get(task.id)
    if prerequisite is not None:
        if prerequisite not in progress.finished:
            return UnscheduledReason.DEPENDENCY_NOT_SCHEDULED, prerequisite
        if not any(_is_ready(context, progress, task, index) for index in eligible):
            return UnscheduledReason.DEPENDENCY_TOO_LATE, prerequisite
    if task.id in context.over_budget:
        return UnscheduledReason.LONGER_THAN_DAILY_MINUTES, None
    if task.id in context.no_window:
        return UnscheduledReason.NO_CONTIGUOUS_WINDOW, None
    return UnscheduledReason.NOT_ENOUGH_TIME, None


def _warnings(profile: Profile, study: Sequence[StudyDay]) -> tuple[PlanWarning, ...]:
    """NO_STUDY_TIME when the chosen windows miss the waking hours on every day,
    before now, busy time and the exam cutoffs are taken out."""
    if study and not any(day_windows(profile, day.date) for day in study):
        return (PlanWarning(code=WarningCode.NO_STUDY_TIME),)
    return ()
