"""Hypothesis strategies for the planner's input, shared by the property tests.

Every strategy produces only input the planner accepts: profiles inside the
database ranges, unique ids, tasks whose exam is in the input, and busy time as
UTC whole-minute intervals in the first 14 days of the horizon. The building
blocks (exams_for, tasks_for, busy_for) take what they depend on, so a later
scope can compose them into a larger input.
"""

import datetime as dt
import os
from collections.abc import Sequence
from typing import Final, NamedTuple
from uuid import UUID
from zoneinfo import ZoneInfo

from hypothesis import settings
from hypothesis import strategies as st

from app.domain.planner import (
    Exam,
    Interval,
    Profile,
    StudyWindow,
    Task,
    TaskKind,
    TaskStatus,
    clip,
)
from app.domain.time import local_date, local_day_bounds, local_span

# A fixed seed on CI, so a red build fails the same way on every run.
PROPERTY_SETTINGS: Final = settings(max_examples=200, deadline=None, derandomize="CI" in os.environ)

TIMEZONES: Final = (
    "Asia/Jerusalem",
    "America/New_York",
    "Asia/Kolkata",  # UTC+05:30 all year
    "Australia/Lord_Howe",  # the clock moves by half an hour
    "America/Santiago",  # the clock moves at midnight
    "UTC",
)
# Noon UTC near the clock changes of the zones above. A horizon runs up to 40 days
# past now, so it also reaches the changes that come after the anchor.
NOW_ANCHORS: Final = (
    dt.datetime(2026, 10, 24, 12, tzinfo=dt.UTC),  # Jerusalem falls back on October 25
    dt.datetime(2026, 10, 31, 12, tzinfo=dt.UTC),  # New York falls back on November 1
    dt.datetime(2027, 3, 12, 12, tzinfo=dt.UTC),  # New York springs forward on March 14
    dt.datetime(2027, 3, 25, 12, tzinfo=dt.UTC),  # Jerusalem springs forward on March 26
    dt.datetime(2027, 4, 3, 12, tzinfo=dt.UTC),  # Lord Howe and Santiago fall back on April 4
    # Santiago has no midnight on September 6, which reaches the overlap guard of study_days.
    dt.datetime(2026, 9, 5, 12, tzinfo=dt.UTC),
)
NOW_SPREAD: Final = dt.timedelta(hours=48)

QUARTERS_PER_DAY: Final = 24 * 4
DAILY_MINUTES_STEP: Final = 30
START_DELAY_MINUTES: Final = (0, 30, 60, 90)
MAX_REST_DAYS: Final = 3

MAX_EXAMS: Final = 4
MAX_DAYS_TO_EXAM: Final = 40

MAX_TASKS: Final = 20
TASK_MINUTES: Final = (5, 15, 30, 45, 60, 90, 120, 180, 240, 300, 600)
# Most tasks are still to do. sampled_from shrinks towards the first entry.
TASK_STATUSES: Final = (TaskStatus.TODO,) * 6 + (TaskStatus.DONE, TaskStatus.SKIPPED)

MAX_BUSY: Final = 3
BUSY_DAYS: Final = 14
MAX_BUSY_QUARTERS: Final = 8 * 4

_MINUTE: Final = dt.timedelta(minutes=1)
_ONE_DAY: Final = dt.timedelta(days=1)


class PlannerInputs(NamedTuple):
    """The arguments of assign_days, in its order: assign_days(*inputs)."""

    profile: Profile
    exams: tuple[Exam, ...]
    tasks: tuple[Task, ...]
    now: dt.datetime
    busy: tuple[Interval, ...]


def _quarter(index: int) -> dt.time:
    """The wall time of quarter hour `index` of the day (0 is 00:00, 95 is 23:45)."""
    return dt.time(index // 4, index % 4 * 15)


@st.composite
def profiles(draw: st.DrawFn) -> Profile:
    """A valid profile in one of TIMEZONES.

    The awake span is 15 minutes to 23:45 hours from wake_time, half the time a
    usual 14 to 18 hours, so sleep_time differs from wake_time and often falls
    after midnight.
    """
    wake = draw(st.integers(0, QUARTERS_PER_DAY - 1))
    awake = draw(st.one_of(st.integers(14 * 4, 18 * 4), st.integers(1, QUARTERS_PER_DAY - 1)))
    return Profile(
        timezone=ZoneInfo(draw(st.sampled_from(TIMEZONES))),
        wake_time=_quarter(wake),
        sleep_time=_quarter((wake + awake) % QUARTERS_PER_DAY),
        daily_study_minutes=draw(st.integers(1, 960 // DAILY_MINUTES_STEP)) * DAILY_MINUTES_STEP,
        study_windows=draw(st.frozensets(st.sampled_from(StudyWindow), min_size=1)),
        rest_days_before_exam=draw(st.integers(0, MAX_REST_DAYS)),
        study_start_delay=draw(st.sampled_from(START_DELAY_MINUTES)) * _MINUTE,
    )


@st.composite
def nows(draw: st.DrawFn) -> dt.datetime:
    """A UTC instant on a whole minute, up to NOW_SPREAD before or after an anchor."""
    anchor = draw(st.sampled_from(NOW_ANCHORS))
    spread = NOW_SPREAD // _MINUTE
    return anchor + draw(st.integers(-spread, spread)) * _MINUTE


@st.composite
def exams_for(draw: st.DrawFn, today: dt.date) -> tuple[Exam, ...]:
    """1 to MAX_EXAMS exams, each 0 to MAX_DAYS_TO_EXAM days after today."""
    ids = draw(st.lists(st.uuids(), min_size=1, max_size=MAX_EXAMS, unique=True))
    return tuple(
        Exam(
            id=exam_id,
            exam_date=today + draw(st.integers(0, MAX_DAYS_TO_EXAM)) * _ONE_DAY,
            difficulty=draw(st.integers(1, 5)),
        )
        for exam_id in ids
    )


def _usually(draw: st.DrawFn) -> bool:
    """True three times in four; it shrinks to False."""
    return draw(st.integers(0, 3)) > 0


def _waits_for(
    start: int, target: UUID, ids: Sequence[UUID], chosen: Sequence[UUID | None]
) -> bool:
    """Whether task `start` waits for `target`, directly or through other tasks,
    following only the prerequisites chosen so far."""
    position = {task_id: index for index, task_id in enumerate(ids)}
    seen: set[int] = set()
    node = start
    while node < len(chosen) and node not in seen:
        seen.add(node)
        prerequisite = chosen[node]
        if prerequisite == target:
            return True
        if prerequisite not in position:
            return False
        node = position[prerequisite]
    return False


@st.composite
def _prerequisite(
    draw: st.DrawFn,
    index: int,
    ids: Sequence[UUID],
    kinds: Sequence[TaskKind],
    chosen: Sequence[UUID | None],
) -> UUID | None:
    """What task `index` waits for, given what the tasks before it wait for.

    Half the tasks wait for nothing. A simulation review usually waits for a
    simulation, as in real plans. Otherwise a task usually closes a cycle when
    an earlier task already waits for it, else usually waits for another task
    of the input, and otherwise for an id that is not in the input (a deleted
    task).
    """
    if not draw(st.booleans()):
        return None
    simulations = [
        task_id for task_id, kind in zip(ids, kinds, strict=True) if kind is TaskKind.SIMULATION
    ]
    if kinds[index] is TaskKind.SIMULATION_REVIEW and simulations and _usually(draw):
        return draw(st.sampled_from(simulations))
    closing = [ids[j] for j in range(index) if _waits_for(j, ids[index], ids, chosen)]
    if closing and _usually(draw):
        return draw(st.sampled_from(closing))
    others = [task_id for position, task_id in enumerate(ids) if position != index]
    if others and _usually(draw):
        return draw(st.sampled_from(others))
    known = frozenset(ids)
    return draw(st.uuids().filter(lambda candidate: candidate not in known))


@st.composite
def tasks_for(draw: st.DrawFn, exams: Sequence[Exam]) -> tuple[Task, ...]:
    """0 to MAX_TASKS tasks of these exams, of every kind, mostly to do."""
    exam_ids = frozenset(exam.id for exam in exams)
    count = draw(st.integers(0, MAX_TASKS))
    ids = draw(
        st.lists(
            st.uuids().filter(lambda candidate: candidate not in exam_ids),
            min_size=count,
            max_size=count,
            unique=True,
        )
    )
    kinds = [draw(st.sampled_from(TaskKind)) for _ in ids]
    prerequisites: list[UUID | None] = []
    for index in range(count):
        prerequisites.append(draw(_prerequisite(index, ids, kinds, prerequisites)))
    return tuple(
        Task(
            id=task_id,
            exam_id=draw(st.sampled_from(exams)).id,
            kind=kind,
            estimated_minutes=draw(st.sampled_from(TASK_MINUTES)),
            focus=draw(st.integers(1, 10)),
            depends_on=prerequisite,
            status=draw(st.sampled_from(TASK_STATUSES)),
        )
        for task_id, kind, prerequisite in zip(ids, kinds, prerequisites, strict=True)
    )


@st.composite
def busy_for(draw: st.DrawFn, profile: Profile, now: dt.datetime) -> tuple[Interval, ...]:
    """0 to MAX_BUSY busy ranges between local quarter hours, up to 8 hours long,
    in the first BUSY_DAYS days of the horizon (which starts the local day before
    now's). They may overlap each other, cross midnight and fall before now."""
    tz = profile.timezone
    first = local_date(now, tz) - _ONE_DAY
    horizon_end = local_day_bounds(first + BUSY_DAYS * _ONE_DAY, tz)[0]
    busy: list[Interval] = []
    for _ in range(draw(st.integers(0, MAX_BUSY))):
        day = first + draw(st.integers(0, BUSY_DAYS - 1)) * _ONE_DAY
        start = draw(st.integers(0, QUARTERS_PER_DAY - 1))
        length = draw(st.integers(1, MAX_BUSY_QUARTERS))
        span_start, span_end = local_span(
            day, _quarter(start), _quarter((start + length) % QUARTERS_PER_DAY), tz
        )
        # A span inside a spring-forward gap is empty: then there is no busy time.
        if span_start < span_end:
            busy.extend(clip([Interval(span_start, span_end)], end=horizon_end))
    return tuple(busy)


@st.composite
def planner_inputs(draw: st.DrawFn) -> PlannerInputs:
    """A whole planner input; the exams count from the local day of now."""
    profile = draw(profiles())
    now = draw(nows())
    exams = draw(exams_for(local_date(now, profile.timezone)))
    return PlannerInputs(
        profile=profile,
        exams=exams,
        tasks=draw(tasks_for(exams)),
        now=now,
        busy=draw(busy_for(profile, now)),
    )
