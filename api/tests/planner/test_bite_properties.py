"""The invariants of split tasks (Task.bite_minutes, S44), on replanning scenarios.

Some todo tasks of each scenario get a bite. Then plan, replan and place_task keep
every rule test_replan_properties checks, and on top of them the bite rules: what
the planner places for a split task on one study day, its one bite, holds at most
B + MIN_PART_MINUTES - 1 minutes. That bite is one day item, which packing may still
cut at a window edge (busy time and kept blocks break a day into several windows),
so the rule bounds the day's minutes, not its number of blocks. The one exception
is the task's last usable day, which takes the rest of the task so that it can
finish: no later study day of its exam has a budget and holds none of its blocks.

Placing one bite again keeps one bite a day: when some other day could take the
whole bite, it does not join another block of the task on its day.
"""

import datetime as dt
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Sequence
from dataclasses import replace
from uuid import UUID

from hypothesis import given
from hypothesis import strategies as st

from app.domain.planner import (
    BREAK_MINUTES,
    LONG_BREAK_MINUTES,
    MIN_PART_MINUTES,
    BlockRole,
    BlockStatus,
    Exam,
    ExistingBlock,
    Interval,
    PlanResult,
    Profile,
    Task,
    TaskKind,
    TaskStatus,
    block_role,
    day_fits,
    fixed_state,
    last_study_day,
    place_task,
    plan,
    replan,
    resolve_dependencies,
    start_minute,
    study_date,
    study_days,
)
from app.domain.planner.split import bite_for
from tests.planner.strategies import PROPERTY_SETTINGS, ReplanScenario, replan_scenarios
from tests.planner.test_replan_properties import (
    _apart,
    _applied,
    _check_invariants,
    _free,
    _roles,
    _window_date,
)

# Bites a user gets from the split rule, and any the database accepts.
_BITES = st.one_of(st.sampled_from((30, 35, 40, 45, 60, 90)), st.integers(30, 300))


@st.composite
def _bitten(draw: st.DrawFn) -> ReplanScenario:
    """A replanning scenario where about half of the todo tasks were split. A bite
    comes from the split rule for the task's estimate, or is any valid one; some
    simulations get one too, which the planner must ignore."""
    scenario = draw(replan_scenarios())
    tasks: list[Task] = []
    for task in scenario.tasks:
        if task.status is TaskStatus.TODO and draw(st.booleans()):
            rule = bite_for(task.estimated_minutes)
            bite = draw(_BITES if rule is None else st.one_of(st.just(rule), _BITES))
            task = replace(task, bite_minutes=bite)
        tasks.append(task)
    return scenario._replace(tasks=tuple(tasks))


def _bites(tasks: Iterable[Task]) -> dict[UUID, int]:
    """Split task -> its bite; a simulation never splits."""
    return {
        task.id: task.bite_minutes
        for task in tasks
        if task.bite_minutes is not None and task.kind is not TaskKind.SIMULATION
    }


# place_task pads every live block with a long break instead of a short one.
_LONG_BREAK_EXTRA = dt.timedelta(minutes=LONG_BREAK_MINUTES - BREAK_MINUTES)

LastDay = Callable[[UUID, dt.date], bool]


def _last_day(
    profile: Profile,
    exams: Sequence[Exam],
    tasks: Sequence[Task],
    stays: Sequence[ExistingBlock],
    now: dt.datetime,
    *,
    long_breaks: bool = False,
) -> LastDay:
    """Whether a day is a task's last usable one, around the blocks that stay: no
    later study day of its exam has windows, some budget left and none of its
    blocks. long_breaks pads the blocks as place_task does."""
    start = start_minute(now)
    state = fixed_state(profile, tasks, stays, start)
    busy = state.busy
    if long_breaks:
        busy = tuple(Interval(i.start - _LONG_BREAK_EXTRA, i.end + _LONG_BREAK_EXTRA) for i in busy)
    days = study_days(profile, exams, start if long_breaks else now, busy)
    last = {exam.id: last_study_day(exam, profile) for exam in exams}
    exam_of = {task.id: task.exam_id for task in tasks}
    holding: dict[UUID, set[dt.date]] = defaultdict(set)
    for block in stays:
        holding[block.task_id].add(study_date(profile, block.interval.start))

    def is_last(task_id: UUID, day: dt.date) -> bool:
        return not any(
            day < study.date <= last[exam_of[task_id]]
            and study.windows
            and profile.daily_study_minutes - state.used.get(study.date, 0) > 0
            and study.date not in holding[task_id]
            for study in days
        )

    return is_last


def _check_bite_rules(
    profile: Profile,
    bites: dict[UUID, int],
    placed: Iterable[tuple[UUID, Interval]],
    is_last: LastDay,
) -> None:
    """What a study day holds of a split task, among these blocks, is one bite:
    shorter than a bite and a part, but on the task's last usable day."""
    per_day: Counter[tuple[UUID, dt.date]] = Counter()
    for task_id, interval in placed:
        if task_id in bites:
            per_day[task_id, study_date(profile, interval.start)] += interval.minutes
    for (task_id, day), minutes in per_day.items():
        bite = bites[task_id]
        assert minutes <= bite + MIN_PART_MINUTES - 1 or is_last(task_id, day), (
            f"task {task_id} has {minutes} minutes on {day} with a bite of {bite}"
        )


def _new(result: PlanResult) -> list[tuple[UUID, Interval]]:
    return [(block.task_id, block.interval) for block in result.blocks if block.block_id is None]


def _stays(scenario: ReplanScenario, result: PlanResult) -> list[ExistingBlock]:
    """The blocks the planner worked around: the fixed ones and the kept candidates."""
    roles = _roles(scenario)
    kept = {block.block_id for block in result.blocks if block.block_id is not None}
    return [*roles.fixed, *(block for block in roles.candidates if block.id in kept)]


def _last_day_of(scenario: ReplanScenario, result: PlanResult) -> LastDay:
    profile, exams, tasks, _, now = scenario
    return _last_day(profile, exams, tasks, _stays(scenario, result), now)


def _moved(scenario: ReplanScenario, result: PlanResult) -> list[tuple[UUID, Interval]]:
    """The new blocks and the kept candidates: every block the planner placed."""
    candidates = {block.id for block in _roles(scenario).candidates}
    return [
        (block.task_id, block.interval)
        for block in result.blocks
        if block.block_id is None or block.block_id in candidates
    ]


@PROPERTY_SETTINGS
@given(_bitten())
def test_split_tasks_keep_their_bites_through_plan_and_replan(scenario: ReplanScenario) -> None:
    bites = _bites(scenario.tasks)
    profile = scenario.profile

    # A fresh plan removes every candidate, so all it places follows the bites.
    first = plan(*scenario)
    _check_invariants(scenario, first)
    _check_bite_rules(profile, bites, _new(first), _last_day_of(scenario, first))

    # Stored and replanned: the blocks it keeps and the ones it adds follow them too.
    stored = _applied(scenario, first, "planned")
    second = replan(*stored)
    _check_invariants(stored, second)
    # The kept candidates were placed by the first plan, around the fixed blocks
    # alone; the new blocks around those and the kept ones.
    before, after = _last_day_of(scenario, first), _last_day_of(stored, second)
    _check_bite_rules(
        profile,
        bites,
        _moved(stored, second),
        lambda task_id, day: before(task_id, day) or after(task_id, day),
    )

    # Replanning the scenario itself may keep candidates from before the split;
    # what it adds follows the bites.
    third = replan(*scenario)
    _check_invariants(scenario, third)
    _check_bite_rules(profile, bites, _new(third), _last_day_of(scenario, third))


@PROPERTY_SETTINGS
@given(_bitten(), st.data())
def test_placing_a_split_task_touches_nothing_else(
    scenario: ReplanScenario, data: st.DataObject
) -> None:
    tasks = scenario.tasks
    bites = _bites(tasks)
    split = [task for task in tasks if task.id in bites and task.status is TaskStatus.TODO]
    if not split:
        return
    task = data.draw(st.sampled_from(split))
    roles = _roles(scenario)
    # As the split does: every planned block of the task that has not started yet.
    release = [
        block
        for block in [*roles.fixed, *roles.candidates]
        if block.task_id == task.id
        and block.status is BlockStatus.PLANNED
        and block.interval.start >= roles.start
    ]
    _check_placement(scenario, task, release)


@PROPERTY_SETTINGS
@given(_bitten(), st.data())
def test_placing_one_bite_again_keeps_one_bite_a_day(
    scenario: ReplanScenario, data: st.DataObject
) -> None:
    # A board that follows the bites, as after the split.
    board = _applied(scenario, plan(*scenario), "planned")
    profile, exams, tasks, _, _ = board
    bites = _bites(tasks)
    roles = _roles(board)
    live = [*roles.fixed, *roles.candidates]
    # As a defer or the morning review does: one live planned block of a split task
    # that has other live blocks.
    choices = [
        block
        for block in live
        if block.task_id in bites
        and block.status is BlockStatus.PLANNED
        and sum(other.task_id == block.task_id for other in live) >= 2
    ]
    if not choices:
        return
    released = data.draw(st.sampled_from(choices))
    task = next(t for t in tasks if t.id == released.task_id)
    result = _check_placement(board, task, [released])

    # Some other day could take the whole bite when its windows hold it (the
    # capacity rule), it has a budget for it, and no block of the task.
    # Dependencies decide days of their own, so a task in one is left out.
    if task.depends_on is not None or any(t.depends_on == task.id for t in tasks):
        return
    staying = [block for block in live if block.id != released.id]
    left = fixed_state(profile, [task], staying, roles.start).tasks
    if not left or left[0].estimated_minutes >= bites[task.id] + MIN_PART_MINUTES:
        return
    remainder = left[0].estimated_minutes
    state = fixed_state(profile, tasks, staying, roles.start)
    busy = tuple(
        Interval(i.start - _LONG_BREAK_EXTRA, i.end + _LONG_BREAK_EXTRA) for i in state.busy
    )
    exam = next(e for e in exams if e.id == task.exam_id)
    own_days = {study_date(profile, b.interval.start) for b in staying if b.task_id == task.id}
    free = [
        day.date
        for day in study_days(profile, exams, roles.start, busy)
        if day.date <= last_study_day(exam, profile)
        and day.date not in own_days
        and profile.daily_study_minutes - state.used.get(day.date, 0) >= remainder
        and day_fits([window.minutes for window in day.windows], [remainder])
    ]
    if not free:
        return
    assert result.unscheduled == ()
    new_days = [study_date(profile, b.interval.start) for b in result.blocks if b.block_id is None]
    assert new_days, "a released bite comes back"
    assert not own_days.intersection(new_days), (
        f"a bite of {task.id} joined another on {sorted(own_days.intersection(new_days))}"
        f" though {free} could take it"
    )


def _check_placement(
    scenario: ReplanScenario, task: Task, release: Sequence[ExistingBlock]
) -> PlanResult:
    """Place the task again with these blocks released, and check what comes back."""
    profile, exams, tasks, existing, now = scenario
    bites = _bites(tasks)
    roles = _roles(scenario)
    start = roles.start
    live = [*roles.fixed, *roles.candidates]
    released = {block.id for block in release}
    result = place_task(
        profile, exams, tasks, existing, task.id, now, release=[block.id for block in release]
    )

    if result.unscheduled:
        assert result.blocks == ()
        assert result.removed == ()
        assert [item.task_id for item in result.unscheduled] == [task.id]
        return result

    assert set(result.removed) == released
    assert len(result.removed) == len(released)
    assert all(block.task_id == task.id for block in result.blocks)
    staying = [block for block in live if block.id not in released]
    placed = {block.block_id: block for block in result.blocks if block.block_id is not None}
    # The task's live blocks that were not released come back in place; no other
    # block is in the result, so none moves.
    for stays in staying:
        if stays.task_id == task.id:
            assert placed[stays.id].interval == stays.interval
    assert placed.keys() == {block.id for block in staying if block.task_id == task.id}

    new = [block for block in result.blocks if block.block_id is None]
    # Every minute of the task is planned.
    minutes = sum(block.interval.minutes for block in result.blocks)
    assert minutes >= task.estimated_minutes
    if not new:
        return result
    is_last = _last_day(profile, exams, tasks, staying, now, long_breaks=True)
    _check_bite_rules(profile, bites, [(block.task_id, block.interval) for block in new], is_last)

    # In one window of what the staying blocks leave, a break from each, free of busy
    # time, and within the budget of each day it uses.
    state = fixed_state(profile, tasks, staying, start)
    days = study_days(profile, exams, now, state.busy)
    standing = [block.interval for block in staying if block.interval.end > start]
    for block in new:
        assert _window_date(block.interval, days) == study_date(profile, block.interval.start)
        assert all(_apart(block.interval, other) for other in standing)
        assert _free(profile, block.interval)
    day_minutes: Counter[dt.date] = Counter()
    for interval in [*(b.interval for b in staying), *(b.interval for b in new)]:
        day_minutes[study_date(profile, interval.start)] += interval.minutes
    for block in new:
        assert day_minutes[study_date(profile, block.interval.start)] <= (
            profile.daily_study_minutes
        )
    # Dependencies: the new bites come after the prerequisite's live blocks and
    # before the first live block of a task that waits for this one.
    by_task: dict[UUID, list[Interval]] = defaultdict(list)
    for stays in staying:
        if block_role(stays, start) is not BlockRole.HISTORY:
            by_task[stays.task_id].append(stays.interval)
    first_new = min(block.interval.start for block in new)
    last_new = max(block.interval.end for block in new)
    prerequisites = resolve_dependencies(tasks).prerequisite
    prerequisite = prerequisites.get(task.id)
    if prerequisite is not None:
        assert all(interval.end <= first_new for interval in by_task.get(prerequisite, []))
    for other_id, waited in prerequisites.items():
        if waited == task.id:
            assert all(last_new <= interval.start for interval in by_task.get(other_id, []))
    return result
