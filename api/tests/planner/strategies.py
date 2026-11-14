"""Hypothesis strategies for the planner's input, shared by the property tests.

Every strategy produces only input the planner accepts: profiles inside the
database ranges, unique ids, tasks whose exam is in the input, and busy time as
UTC whole-minute intervals in the first 14 days of the horizon. The building
blocks (exams_for, tasks_for, busy_for) take what they depend on, so a later
scope can compose them into a larger input.

The whole inputs come in three kinds, a third of the time each. A wide input
spreads up to MAX_EXAMS exams over MAX_DAYS_TO_EXAM days, so most of its tasks
fit. A dense one crowds 10 to 30 tasks of an hour or so into the few days before
one or two exams with a small daily budget, so days fill up to their capacity
and tasks are reported for lack of time: that is where packing and the report
are tested. A tight-budget one is dense, but with a usual waking day, three or
four study windows, a daily budget of 30 to 90 minutes and up to MAX_EXAMS exams
4 to 10 days away, so the budget, not the windows or the days, is what runs out:
that is where a suggested larger budget is tested. The building blocks take
the ranges as parameters, and the defaults are the wide ones.

`replan_scenarios` builds on these a calendar a few days into its life: the
core input is planned at now0, the plan's blocks are stored (some pinned,
some done, missed or skipped), a few blocks are pinned at random times, the
clock moves forward up to three days, and up to three changes happen (a task
added, deleted, finished or re-estimated, sometimes to a little more than it
has done, an exam moved or added, the budget or the study windows changed).
The changes come after the first plan, so its blocks may no longer fit them,
which is what replanning is for.
"""

import datetime as dt
import os
from collections.abc import Sequence
from collections.abc import Set as AbstractSet
from dataclasses import replace
from enum import Enum
from typing import Final, NamedTuple
from uuid import UUID
from zoneinfo import ZoneInfo

from hypothesis import settings
from hypothesis import strategies as st

from app.domain.planner import (
    BlockStatus,
    Exam,
    ExistingBlock,
    Interval,
    Profile,
    StudyWindow,
    Task,
    TaskKind,
    TaskStatus,
    clip,
    plan,
)
from app.domain.time import local_date, local_day_bounds, local_span
from tests.planner.factories import as_existing

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

# The dense input: one or two exams soon after today, many tasks of about an hour,
# and a small daily budget.
DENSE_MAX_EXAMS: Final = 2
DENSE_DAYS_TO_EXAM: Final = (1, 10)
DENSE_TASK_COUNT: Final = (10, 30)
DENSE_TASK_MINUTES: Final = (30, 45, 60, 90, 120)
DENSE_DAILY_MINUTES: Final = (60, 240)

# The tight-budget input: dense, with three or four windows and a small budget. Its
# exams are a few days further and there may be as many as in a wide input: an exam
# with fewer study days is often short even at the largest budget, and every exam
# is one more shortfall, so the suggestion is tested more often.
TIGHT_DAILY_MINUTES: Final = (30, 90)
TIGHT_MIN_WINDOWS: Final = 3
TIGHT_MAX_EXAMS: Final = MAX_EXAMS
TIGHT_DAYS_TO_EXAM: Final = (4, 10)

# The replanning scenario.
# Most stored blocks are still planned. sampled_from shrinks towards the first entry.
BLOCK_STATUSES: Final = (BlockStatus.PLANNED,) * 5 + (
    BlockStatus.DONE,
    BlockStatus.MISSED,
    BlockStatus.SKIPPED,
)
MAX_ELAPSED_MINUTES: Final = 72 * 60
MAX_CHANGES: Final = 3
MAX_EXAM_SHIFT_DAYS: Final = 3
NEW_EXAM_DAYS: Final = (0, 14)
NEW_EXAM_TASKS: Final = (1, 3)
# How far a re-estimate moves a task besides a jump to any of TASK_MINUTES: small
# changes leave remainders shorter than a part.
MAX_ESTIMATE_NUDGE: Final = 30
# A re-estimate may also leave a task this much more than its done and pinned blocks.
ALMOST_DONE_MINUTES: Final = 10

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


class PlanInputs(NamedTuple):
    """The arguments of plan, in its order: plan(*inputs)."""

    profile: Profile
    exams: tuple[Exam, ...]
    tasks: tuple[Task, ...]
    existing_blocks: tuple[ExistingBlock, ...]
    now: dt.datetime


class ReplanScenario(NamedTuple):
    """The arguments of replan, in its order: replan(*scenario)."""

    profile: Profile
    exams: tuple[Exam, ...]
    tasks: tuple[Task, ...]
    existing_blocks: tuple[ExistingBlock, ...]
    now: dt.datetime


def _quarter(index: int) -> dt.time:
    """The wall time of quarter hour `index` of the day (0 is 00:00, 95 is 23:45)."""
    return dt.time(index // 4, index % 4 * 15)


@st.composite
def profiles(
    draw: st.DrawFn,
    min_daily_minutes: int = DAILY_MINUTES_STEP,
    max_daily_minutes: int = 960,
    *,
    min_windows: int = 1,
    usual_day: bool = False,
) -> Profile:
    """A valid profile in one of TIMEZONES, with a daily budget in steps of half an
    hour between the two bounds and at least min_windows study windows.

    The awake span is 15 minutes to 23:45 hours from wake_time, half the time (or
    always, with usual_day) a usual 14 to 18 hours, so sleep_time differs from
    wake_time and often falls after midnight.
    """
    wake = draw(st.integers(0, QUARTERS_PER_DAY - 1))
    usual = st.integers(14 * 4, 18 * 4)
    awake = draw(usual if usual_day else st.one_of(usual, st.integers(1, QUARTERS_PER_DAY - 1)))
    return Profile(
        timezone=ZoneInfo(draw(st.sampled_from(TIMEZONES))),
        wake_time=_quarter(wake),
        sleep_time=_quarter((wake + awake) % QUARTERS_PER_DAY),
        daily_study_minutes=draw(
            st.integers(
                min_daily_minutes // DAILY_MINUTES_STEP, max_daily_minutes // DAILY_MINUTES_STEP
            )
        )
        * DAILY_MINUTES_STEP,
        study_windows=draw(st.frozensets(st.sampled_from(StudyWindow), min_size=min_windows)),
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
def exams_for(
    draw: st.DrawFn,
    today: dt.date,
    max_exams: int = MAX_EXAMS,
    days_to_exam: tuple[int, int] = (0, MAX_DAYS_TO_EXAM),
) -> tuple[Exam, ...]:
    """1 to max_exams exams, each a number of days after today in days_to_exam."""
    ids = draw(st.lists(st.uuids(), min_size=1, max_size=max_exams, unique=True))
    return tuple(
        Exam(
            id=exam_id,
            exam_date=today + draw(st.integers(*days_to_exam)) * _ONE_DAY,
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
def tasks_for(
    draw: st.DrawFn,
    exams: Sequence[Exam],
    count_range: tuple[int, int] = (0, MAX_TASKS),
    minutes: Sequence[int] = TASK_MINUTES,
) -> tuple[Task, ...]:
    """A number of tasks in count_range for these exams, of every kind, mostly to
    do, each of one of these minutes."""
    exam_ids = frozenset(exam.id for exam in exams)
    count = draw(st.integers(*count_range))
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
            estimated_minutes=draw(st.sampled_from(minutes)),
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
def existing_blocks_for(
    draw: st.DrawFn, profile: Profile, now: dt.datetime, tasks: Sequence[Task]
) -> tuple[ExistingBlock, ...]:
    """Blocks already in the calendar, at the times busy_for draws, of any status,
    pinned or not. Each belongs to a task of the input, or to a deleted task when
    there are none."""
    task_ids = st.sampled_from([task.id for task in tasks]) if tasks else st.uuids()
    intervals = draw(busy_for(profile, now))
    ids = draw(st.lists(st.uuids(), min_size=len(intervals), max_size=len(intervals), unique=True))
    return tuple(
        ExistingBlock(
            id=block_id,
            task_id=draw(task_ids),
            interval=interval,
            status=draw(st.sampled_from(BlockStatus)),
            pinned=draw(st.booleans()),
        )
        for block_id, interval in zip(ids, intervals, strict=True)
    )


class _Core(NamedTuple):
    profile: Profile
    now: dt.datetime
    exams: tuple[Exam, ...]
    tasks: tuple[Task, ...]


class _Kind(Enum):
    WIDE = "wide"
    DENSE = "dense"
    TIGHT = "tight"  # dense, with a small budget and wide windows


@st.composite
def _core(draw: st.DrawFn, kind: _Kind) -> _Core:
    """Everything but the busy time; the exams count from the local day of now."""
    match kind:
        case _Kind.WIDE:
            profile = draw(profiles())
        case _Kind.DENSE:
            profile = draw(profiles(*DENSE_DAILY_MINUTES))
        case _Kind.TIGHT:
            profile = draw(
                profiles(*TIGHT_DAILY_MINUTES, min_windows=TIGHT_MIN_WINDOWS, usual_day=True)
            )
    now = draw(nows())
    today = local_date(now, profile.timezone)
    if kind is _Kind.WIDE:
        exams = draw(exams_for(today))
        tasks = draw(tasks_for(exams))
    else:
        tight = kind is _Kind.TIGHT
        exams = draw(
            exams_for(
                today,
                max_exams=TIGHT_MAX_EXAMS if tight else DENSE_MAX_EXAMS,
                days_to_exam=TIGHT_DAYS_TO_EXAM if tight else DENSE_DAYS_TO_EXAM,
            )
        )
        tasks = draw(tasks_for(exams, count_range=DENSE_TASK_COUNT, minutes=DENSE_TASK_MINUTES))
    return _Core(profile, now, exams, tasks)


def _cores() -> st.SearchStrategy[_Core]:
    """A wide, a dense or a tight-budget input, a third of the time each."""
    return st.one_of(_core(_Kind.WIDE), _core(_Kind.DENSE), _core(_Kind.TIGHT))


@st.composite
def planner_inputs(draw: st.DrawFn) -> PlannerInputs:
    """A whole input of assign_days."""
    profile, now, exams, tasks = draw(_cores())
    return PlannerInputs(
        profile=profile, exams=exams, tasks=tasks, now=now, busy=draw(busy_for(profile, now))
    )


@st.composite
def plan_inputs(draw: st.DrawFn) -> PlanInputs:
    """A whole input of plan: the busy time comes as existing blocks."""
    profile, now, exams, tasks = draw(_cores())
    return PlanInputs(
        profile=profile,
        exams=exams,
        tasks=tasks,
        existing_blocks=draw(existing_blocks_for(profile, now, tasks)),
        now=now,
    )


def _rarely(draw: st.DrawFn) -> bool:
    """True one time in four; it shrinks to False."""
    return draw(st.integers(0, 3)) == 3


def _fresh_ids(draw: st.DrawFn, taken: AbstractSet[UUID], count: int) -> list[UUID]:
    """count distinct ids that are not in taken."""
    return draw(
        st.lists(
            st.uuids().filter(lambda candidate: candidate not in taken),
            min_size=count,
            max_size=count,
            unique=True,
        )
    )


class _Change(Enum):
    NEW_TASK = "new_task"
    DELETE_TASK = "delete_task"
    ESTIMATE = "estimate"
    FINISH_TASK = "finish_task"
    BUDGET = "budget"
    MOVE_EXAM = "move_exam"
    NEW_EXAM = "new_exam"
    WINDOWS = "windows"


class _Plans(NamedTuple):
    profile: Profile
    exams: tuple[Exam, ...]
    tasks: tuple[Task, ...]


@st.composite
def _new_exam(draw: st.DrawFn, plans: _Plans, now: dt.datetime) -> _Plans:
    """plans with one more exam, NEW_EXAM_DAYS after today, and its tasks."""
    taken = {exam.id for exam in plans.exams} | {task.id for task in plans.tasks}
    [exam_id] = _fresh_ids(draw, taken, 1)
    today = local_date(now, plans.profile.timezone)
    exam = Exam(
        id=exam_id,
        exam_date=today + draw(st.integers(*NEW_EXAM_DAYS)) * _ONE_DAY,
        difficulty=draw(st.integers(1, 5)),
    )
    drawn = draw(tasks_for([exam], count_range=NEW_EXAM_TASKS))
    # tasks_for keeps its ids apart from the exam's only: rename them apart from
    # every id of the input, and from the deleted tasks they wait for.
    waited = {task.depends_on for task in drawn if task.depends_on is not None}
    ids = _fresh_ids(draw, taken | waited | {exam_id}, len(drawn))
    renamed = {task.id: new_id for task, new_id in zip(drawn, ids, strict=True)}
    added = tuple(
        replace(
            task,
            id=renamed[task.id],
            depends_on=(
                None if task.depends_on is None else renamed.get(task.depends_on, task.depends_on)
            ),
        )
        for task in drawn
    )
    return plans._replace(exams=(*plans.exams, exam), tasks=(*plans.tasks, *added))


@st.composite
def _changed(
    draw: st.DrawFn, plans: _Plans, now: dt.datetime, blocks: Sequence[ExistingBlock]
) -> _Plans:
    """plans after 0 to MAX_CHANGES changes; one that has nothing to act on does nothing."""
    for change in draw(st.lists(st.sampled_from(_Change), max_size=MAX_CHANGES)):
        profile, exams, tasks = plans
        match change:
            case _Change.NEW_TASK:
                taken = {exam.id for exam in exams} | {task.id for task in tasks}
                [task_id] = _fresh_ids(draw, taken, 1)
                prerequisites = [None, *(task.id for task in tasks)]
                task = Task(
                    id=task_id,
                    exam_id=draw(st.sampled_from(exams)).id,
                    kind=draw(st.sampled_from(TaskKind)),
                    estimated_minutes=draw(st.sampled_from(TASK_MINUTES)),
                    focus=draw(st.integers(1, 10)),
                    depends_on=draw(st.sampled_from(prerequisites)),
                )
                plans = plans._replace(tasks=(*tasks, task))
            case _Change.DELETE_TASK if tasks:
                index = draw(st.integers(0, len(tasks) - 1))
                plans = plans._replace(tasks=tasks[:index] + tasks[index + 1 :])
            case _Change.ESTIMATE if tasks:
                index = draw(st.integers(0, len(tasks) - 1))
                old = tasks[index].estimated_minutes
                nudged = st.integers(old - MAX_ESTIMATE_NUDGE, old + MAX_ESTIMATE_NUDGE)
                # "Almost done": a little more than its done and pinned blocks hold.
                settled = sum(
                    block.interval.minutes
                    for block in blocks
                    if block.task_id == tasks[index].id
                    and (block.status is BlockStatus.DONE or block.pinned)
                )
                almost = st.integers(settled + 1, settled + ALMOST_DONE_MINUTES)
                minutes = draw(st.one_of(st.sampled_from(TASK_MINUTES), nudged, almost))
                task = replace(tasks[index], estimated_minutes=min(600, max(5, minutes)))
                plans = plans._replace(tasks=(*tasks[:index], task, *tasks[index + 1 :]))
            case _Change.FINISH_TASK:
                todo = [i for i, task in enumerate(tasks) if task.status is TaskStatus.TODO]
                if todo:
                    index = draw(st.sampled_from(todo))
                    task = replace(tasks[index], status=TaskStatus.DONE)
                    plans = plans._replace(tasks=(*tasks[:index], task, *tasks[index + 1 :]))
            case _Change.BUDGET:
                steps = draw(st.integers(1, 960 // DAILY_MINUTES_STEP))
                profile = replace(profile, daily_study_minutes=steps * DAILY_MINUTES_STEP)
                plans = plans._replace(profile=profile)
            case _Change.MOVE_EXAM:
                index = draw(st.integers(0, len(exams) - 1))
                shift = draw(st.integers(-MAX_EXAM_SHIFT_DAYS, MAX_EXAM_SHIFT_DAYS))
                exam = replace(exams[index], exam_date=exams[index].exam_date + shift * _ONE_DAY)
                plans = plans._replace(exams=(*exams[:index], exam, *exams[index + 1 :]))
            case _Change.NEW_EXAM:
                plans = draw(_new_exam(plans, now))
            case _Change.WINDOWS:
                windows = draw(st.frozensets(st.sampled_from(StudyWindow), min_size=1))
                plans = plans._replace(profile=replace(profile, study_windows=windows))
    return plans


@st.composite
def replan_scenarios(draw: st.DrawFn) -> ReplanScenario:
    """A calendar a few days after its first plan, with changes since (see the module)."""
    profile, now0, exams, tasks = draw(_cores())
    first = plan(profile, exams, tasks, (), now0)
    stored = [
        replace(block, status=draw(st.sampled_from(BLOCK_STATUSES)), pinned=_rarely(draw))
        for block in as_existing(first)
    ]
    pinned = [
        replace(block, status=draw(st.sampled_from(BLOCK_STATUSES)), pinned=True)
        for block in draw(existing_blocks_for(profile, now0, tasks))
    ]
    blocks = draw(st.permutations([*stored, *pinned]))
    now = now0 + draw(st.integers(0, MAX_ELAPSED_MINUTES)) * _MINUTE
    profile, exams, tasks = draw(_changed(_Plans(profile, exams, tasks), now, blocks))
    return ReplanScenario(
        profile=profile, exams=exams, tasks=tasks, existing_blocks=tuple(blocks), now=now
    )
