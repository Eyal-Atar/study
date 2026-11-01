"""Study tasks assigned to local study days (stage 3 of the planner).

Every todo task either has all of its minutes on days or is reported with a
reason: no task silently disappears. A day never holds more than the daily
budget, and only what `day_fits` accepts, so hour packing can fit all of it.
"""

import datetime as dt
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from uuid import UUID

from app.domain.planner.availability import day_windows, last_study_day, study_days
from app.domain.planner.capacity import MIN_PART_MINUTES, day_fits, room
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
from app.domain.time import ensure_utc


@dataclass(slots=True)
class _Day:
    """The state of one study day while it is being filled."""

    index: int
    date: dt.date
    windows: tuple[int, ...]  # the window lengths in minutes, in time order
    budget: int  # what is left of daily_study_minutes
    items: list[DayItem] = field(default_factory=list)

    def _minutes(self) -> list[int]:
        return [item.minutes for item in self.items]

    def fits(self, minutes: int) -> bool:
        """Whether a whole item of these minutes still goes in."""
        return minutes <= self.budget and day_fits(self.windows, [*self._minutes(), minutes])

    def part(self, remainder: int) -> int:
        """How much of a multi-day task's remainder goes in today; 0 for nothing."""
        part = min(self.budget, room(self.windows, self._minutes()))
        if part >= remainder:
            return remainder
        if remainder - part < MIN_PART_MINUTES:
            part = remainder - MIN_PART_MINUTES  # so the last part is long enough
        return part if part >= MIN_PART_MINUTES else 0


@dataclass(frozen=True, slots=True)
class _Context:
    """What the day loop needs, fixed before the first day."""

    todo: tuple[Task, ...]  # in input order
    order: tuple[Task, ...]  # todo, by (exam rank, phase, input position)
    last_day: Mapping[UUID, dt.date]  # exam -> its last study day
    eligible: Mapping[UUID, tuple[int, ...]]  # exam -> indices of the days it may use
    dependencies: Dependencies
    multi_day: frozenset[UUID]


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
    ensure_utc(now)  # a naive now is rejected even when there is nothing to plan
    study = study_days(profile, exams, now, busy)
    context = _prepare(profile, exams, tasks, _new_days(study, profile))
    # A multi-day task that never finishes is placed whole or not at all. Its parts
    # took time that other tasks could have used, so the loop runs again without
    # it. Only the earliest started one is dropped: its parts go on first every day,
    # so its failure is real, while later ones may have failed only because of it.
    # Every rerun excludes one more task, so this ends.
    excluded: frozenset[UUID] = frozenset()
    while True:
        days, progress = _run_days(context, study, profile, excluded)
        if not progress.started:
            break
        excluded = excluded.union((next(iter(progress.started)),))
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
    rank = {
        exam.id: position
        for position, exam in enumerate(sorted(exams, key=lambda e: (e.exam_date, -e.difficulty)))
    }
    last_day = {exam.id: last_study_day(exam, profile) for exam in exams}
    eligible = {
        exam_id: tuple(day.index for day in days if _is_eligible(day, last))
        for exam_id, last in last_day.items()
    }
    todo = tuple(task for task in tasks if task.status is TaskStatus.TODO)
    multi_day = frozenset(
        task.id
        for task in todo
        if _is_multi_day(task, [days[index] for index in eligible[task.exam_id]], profile)
    )
    return _Context(
        todo=todo,
        order=tuple(sorted(todo, key=lambda task: (rank[task.exam_id], _phase(task)))),
        last_day=last_day,
        eligible=eligible,
        dependencies=resolve_dependencies(tasks),
        multi_day=multi_day,
    )


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
    _continue_started(context, progress, day)
    _first_fit(context, progress, day)


def _continue_started(context: _Context, progress: _Progress, day: _Day) -> None:
    """Multi-day tasks that already started go on first, in the order they started."""
    for task in list(progress.started.values()):
        if _is_eligible(day, context.last_day[task.exam_id]):
            minutes = day.part(task.estimated_minutes - progress.placed[task.id])
            if minutes:
                _place(progress, day, task, minutes)


def _first_fit(context: _Context, progress: _Progress, day: _Day) -> None:
    """Place the first candidate that fits, then look again: it may make others ready."""
    while (choice := _first_fitting(context, progress, day)) is not None:
        task, minutes = choice
        _place(progress, day, task, minutes)


def _first_fitting(context: _Context, progress: _Progress, day: _Day) -> tuple[Task, int] | None:
    for task in context.order:
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
    """Whether the task's prerequisite, if it has one, was completed by day index."""
    prerequisite = context.dependencies.prerequisite.get(task.id)
    if prerequisite is None:
        return True
    finished = progress.finished.get(prerequisite)
    return finished is not None and finished <= index


def _place(progress: _Progress, day: _Day, task: Task, minutes: int) -> None:
    day.items.append(DayItem(task_id=task.id, minutes=minutes))
    day.budget -= minutes
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
    return UnscheduledReason.NOT_ENOUGH_TIME, None


def _warnings(profile: Profile, study: Sequence[StudyDay]) -> tuple[PlanWarning, ...]:
    """NO_STUDY_TIME when the chosen windows miss the waking hours on every day,
    before now, busy time and the exam cutoffs are taken out."""
    if study and not any(day_windows(profile, day.date) for day in study):
        return (PlanWarning(code=WarningCode.NO_STUDY_TIME),)
    return ()
