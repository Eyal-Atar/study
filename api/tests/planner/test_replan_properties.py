"""The invariants of replanning (spec 7.6), on calendars a few days into their life.

"Fixed", "candidate" and "history" are the block roles at the scenario's now. A
candidate is "kept" when its id is in the result's blocks; a block is "new" when
it has no block_id. "Live" blocks are the fixed, the kept and the new ones. The
helpers compute all of these from the scenario and the result, with block_role,
fixed_state, study_days and study_date only, not with the planner's own passes.
"""

import datetime as dt
import json
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Sequence
from dataclasses import replace
from itertools import pairwise
from typing import NamedTuple
from uuid import NAMESPACE_OID, UUID, uuid5
from zoneinfo import ZoneInfo

from hypothesis import example, given
from hypothesis import strategies as st

from app.domain.planner import (
    BREAK_MINUTES,
    MIN_PART_MINUTES,
    BlockRole,
    BlockStatus,
    Exam,
    ExistingBlock,
    Interval,
    PlannedBlock,
    PlanResult,
    Profile,
    SnapshotBlock,
    StudyDay,
    StudyWindow,
    Task,
    TaskKind,
    TaskStatus,
    block_role,
    exam_cutoff,
    fixed_state,
    last_study_day,
    parse_snapshot,
    place_task,
    plan,
    replan,
    resolve_dependencies,
    snapshot,
    start_minute,
    study_date,
    study_days,
    undo,
    valid_blocks,
)
from tests.planner.strategies import PROPERTY_SETTINGS, ReplanScenario, replan_scenarios

_BREAK = dt.timedelta(minutes=BREAK_MINUTES)
# The smallest task the model accepts: what a partly done task keeps at least.
_MIN_REMAINDER = 5
# A new block may top a task up past its estimate to that smallest remainder.
_MAX_OVERSHOOT = _MIN_REMAINDER - 1


# The minimal reproductions of the findings of S08 Task 7, kept as explicit examples
# so that every run checks them first.
def _id(number: int) -> UUID:
    return UUID(int=number)


def _at(month: int, day: int, hour: int, minute: int = 0) -> dt.datetime:
    return dt.datetime(2026, month, day, hour, minute, tzinfo=dt.UTC)


def _scenario(
    profile: Profile, tasks: Sequence[Task], blocks: Sequence[ExistingBlock], now: dt.datetime
) -> ReplanScenario:
    exams = tuple({task.exam_id: None for task in tasks})
    return ReplanScenario(
        profile=profile,
        exams=tuple(Exam(id=exam_id, exam_date=_EXAM_DATE, difficulty=3) for exam_id in exams),
        tasks=tuple(tasks),
        existing_blocks=tuple(blocks),
        now=now,
    )


_EXAM_DATE = dt.date(2026, 11, 20)
_PROFILE = Profile(
    timezone=ZoneInfo("UTC"),
    wake_time=dt.time(7),
    sleep_time=dt.time(23),
    daily_study_minutes=240,
    study_windows=frozenset({StudyWindow.MORNING, StudyWindow.AFTERNOON}),
    rest_days_before_exam=0,
    study_start_delay=dt.timedelta(0),
)


def _block(
    number: int,
    task: int,
    start: dt.datetime,
    minutes: int,
    status: BlockStatus = BlockStatus.PLANNED,
    *,
    pinned: bool = False,
) -> ExistingBlock:
    return ExistingBlock(
        id=_id(number),
        task_id=_id(task),
        interval=Interval(start, start + dt.timedelta(minutes=minutes)),
        status=status,
        pinned=pinned,
    )


# Finding 2: tasks 2 and 4 wait for each other, and a pinned block covers task 2.
FINDING_2 = _scenario(
    _PROFILE,
    [
        Task(
            id=_id(2), exam_id=_id(1), kind=TaskKind.LEARN, estimated_minutes=30, depends_on=_id(4)
        ),
        Task(
            id=_id(4), exam_id=_id(1), kind=TaskKind.LEARN, estimated_minutes=30, depends_on=_id(2)
        ),
    ],
    [_block(101, 2, _at(11, 14, 10), 30, pinned=True)],
    _at(11, 14, 9),
)
# Finding 4: 30 minutes of a task done, then its estimate raised to 32.
FINDING_4 = _scenario(
    _PROFILE,
    [Task(id=_id(2), exam_id=_id(1), kind=TaskKind.LEARN, estimated_minutes=32)],
    [_block(101, 2, _at(11, 14, 8), 30, BlockStatus.DONE)],
    _at(11, 14, 9),
)
# Finding 3: a planned block that overlaps a done block of the same task, both later
# today. The database forbids that overlap, so the undo property drops the done block
# from its board (see _as_in_the_database).
FINDING_3 = _scenario(
    _PROFILE,
    [Task(id=_id(2), exam_id=_id(1), kind=TaskKind.LEARN, estimated_minutes=30)],
    [
        _block(101, 2, _at(11, 14, 13), 30),
        _block(102, 2, _at(11, 14, 13), 15, BlockStatus.DONE, pinned=True),
    ],
    _at(11, 14, 9),
)


class _Roles(NamedTuple):
    start: dt.datetime
    fixed: list[ExistingBlock]
    candidates: list[ExistingBlock]
    history: list[ExistingBlock]


def _roles(scenario: ReplanScenario) -> _Roles:
    start = start_minute(scenario.now)
    roles = _Roles(start, [], [], [])
    for block in scenario.existing_blocks:
        match block_role(block, start):
            case BlockRole.FIXED:
                roles.fixed.append(block)
            case BlockRole.CANDIDATE:
                roles.candidates.append(block)
            case BlockRole.HISTORY:
                roles.history.append(block)
    return roles


def _overlaps(a: Interval, b: Interval) -> bool:
    return a.start < b.end and b.start < a.end


def _apart(a: Interval, b: Interval) -> bool:
    """Whether a break of BREAK_MINUTES fits between the two."""
    return a.end + _BREAK <= b.start or b.end + _BREAK <= a.start


def _window_date(interval: Interval, days: Sequence[StudyDay]) -> dt.date:
    """The study day of the one window that holds the whole interval; fails if none does."""
    holders = [
        day.date
        for day in days
        for window in day.windows
        if window.start <= interval.start and interval.end <= window.end
    ]
    assert len(holders) == 1, f"no single window holds {interval}"
    return holders[0]


def _unscheduled_minutes(result: PlanResult) -> int:
    return sum(item.minutes for item in result.unscheduled)


def _new_id(block: PlannedBlock, generation: str) -> UUID:
    """A deterministic id for a new block, as as_existing makes one. The generation
    keeps it apart from the ids of the scenario's own blocks: a history block of the
    same task at the same time has the id as_existing gives."""
    return uuid5(NAMESPACE_OID, f"{generation}:{block.task_id}:{block.interval.start.isoformat()}")


def _check_invariants(scenario: ReplanScenario, result: PlanResult) -> None:
    """Rules 1-11 of the brief, with rule 7 as the user decided it: a simulation
    that has a fixed or kept block is covered by it, whatever its length."""
    profile, exams, tasks, _, now = scenario
    roles = _roles(scenario)
    start = roles.start
    tasks_by_id = {task.id: task for task in tasks}
    exams_by_id = {exam.id: exam for exam in exams}
    todo = {task.id for task in tasks if task.status is TaskStatus.TODO}
    fixed_by_id = {block.id: block for block in roles.fixed}
    candidates_by_id = {block.id: block for block in roles.candidates}

    def date_of(interval: Interval) -> dt.date:
        return study_date(profile, interval.start)

    def is_simulation(task_id: UUID) -> bool:
        task = tasks_by_id.get(task_id)
        return task is not None and task.kind is TaskKind.SIMULATION

    # 1. Fixed blocks of todo tasks come back in place; a fixed id is never removed;
    # every block_id is an existing fixed or candidate block, in its place.
    ids = [block.block_id for block in result.blocks if block.block_id is not None]
    assert len(ids) == len(set(ids))
    placed = {block.block_id: block for block in result.blocks if block.block_id is not None}
    for existing in roles.fixed:
        if existing.task_id in todo:
            assert existing.id in placed, f"fixed block {existing.id} is missing"
            assert placed[existing.id].interval == existing.interval
        assert existing.id not in result.removed
    for block_id, block in placed.items():
        original = fixed_by_id.get(block_id) or candidates_by_id.get(block_id)
        assert original is not None, f"block_id {block_id} is no fixed or candidate block"
        assert block.interval == original.interval
        assert block.task_id == original.task_id

    # 2. Each candidate is either kept or removed; removed holds only candidates;
    # history is in neither.
    removed = Counter(result.removed)
    assert all(count == 1 for count in removed.values())
    assert removed.keys() <= candidates_by_id.keys()
    for existing in roles.candidates:
        assert (existing.id in placed) != (existing.id in removed)
    for existing in roles.history:
        assert existing.id not in placed
        assert existing.id not in removed

    kept = [block for block in roles.candidates if block.id in placed]
    new = sorted(
        (block for block in result.blocks if block.block_id is None),
        key=lambda block: block.interval.start,
    )

    # 3. Each new block lies in one window of what the fixed and kept blocks leave,
    # so it overlaps no live block and keeps a break from the fixed and kept ones.
    state = fixed_state(profile, tasks, [*roles.fixed, *kept], start)
    days = study_days(profile, exams, now, state.busy)
    window_date = {id(block): _window_date(block.interval, days) for block in new}
    standing = [block.interval for block in [*roles.fixed, *kept] if block.interval.end > start]
    for block in new:
        assert all(_apart(block.interval, other) for other in standing)
    for a, b in pairwise(new):
        assert a.interval.end <= b.interval.start

    # 4. Kept blocks overlap neither each other nor a fixed block.
    for index, existing in enumerate(kept):
        interval = existing.interval
        assert not any(_overlaps(interval, other.interval) for other in kept[index + 1 :])
        assert not any(_overlaps(interval, other.interval) for other in roles.fixed)

    # 5. A day with a new or kept block stays within the daily budget.
    live = [
        *((block.task_id, block.interval) for block in [*roles.fixed, *kept]),
        *((block.task_id, block.interval) for block in new),
    ]
    day_minutes: Counter[dt.date] = Counter()
    for _, interval in live:
        day_minutes[date_of(interval)] += interval.minutes
    movable = [
        *((block.task_id, block.interval) for block in new),
        *((existing.task_id, existing.interval) for existing in kept),
    ]
    for _, interval in movable:
        day = date_of(interval)
        assert day_minutes[day] <= profile.daily_study_minutes, f"day {day} is over budget"

    # 6. At most one movable simulation a day, and none on a day with a fixed one.
    fixed_simulation_days = {
        date_of(block.interval) for block in roles.fixed if is_simulation(block.task_id)
    }
    movable_simulations = Counter(
        date_of(interval) for task_id, interval in movable if is_simulation(task_id)
    )
    for day, count in movable_simulations.items():
        assert count == 1, f"day {day} holds {count} simulations"
        assert day not in fixed_simulation_days

    # 7. A todo task is reported once, with what is left of it, or is covered.
    by_task: dict[UUID, list[PlannedBlock]] = defaultdict(list)
    for block in sorted(result.blocks, key=lambda b: (b.interval.start, b.interval.end)):
        by_task[block.task_id].append(block)
    new_by_task: dict[UUID, list[PlannedBlock]] = defaultdict(list)
    for block in new:
        new_by_task[block.task_id].append(block)
    settled: Counter[UUID] = Counter()
    for existing in [*roles.fixed, *kept]:
        settled[existing.task_id] += existing.interval.minutes
    reported = Counter(item.task_id for item in result.unscheduled)
    unscheduled = {item.task_id: item for item in result.unscheduled}
    assert by_task.keys() <= todo
    assert reported.keys() <= todo
    for task in tasks:
        if task.id not in todo:
            continue
        estimate = task.estimated_minutes
        live_minutes = sum(block.interval.minutes for block in by_task.get(task.id, []))
        if task.kind is TaskKind.SIMULATION and settled[task.id]:
            # A simulation never splits: any fixed or kept block of it covers it.
            assert task.id not in reported, f"covered simulation {task.id} is reported"
            assert not new_by_task.get(task.id), f"covered simulation {task.id} got a block"
        elif task.id in reported:
            assert reported[task.id] == 1
            assert not new_by_task.get(task.id)
            if task.kind is TaskKind.SIMULATION:
                assert settled[task.id] == 0
                assert unscheduled[task.id].minutes == estimate
            else:
                assert unscheduled[task.id].minutes == max(
                    _MIN_REMAINDER, estimate - settled[task.id]
                )
        else:
            assert live_minutes >= estimate, f"task {task.id} has {live_minutes} of {estimate}"
            if new_by_task.get(task.id):
                assert live_minutes - estimate <= _MAX_OVERSHOOT

    # 8. Each task's blocks are numbered 1..n in time order.
    for own in by_task.values():
        ordered = sorted(own, key=lambda b: (b.interval.start, b.interval.end, b.part_index))
        assert [block.part_index for block in ordered] == list(range(1, len(own) + 1))
        assert all(block.part_count == len(own) for block in own)

    # 9. A new simulation is one block of its estimate; split parts are long enough.
    for task_id, own_new in new_by_task.items():
        task = tasks_by_id[task_id]
        if task.kind is TaskKind.SIMULATION:
            assert len(own_new) == 1
            assert own_new[0].interval.minutes == task.estimated_minutes
        elif len(own_new) > 1:
            assert all(block.interval.minutes >= MIN_PART_MINUTES for block in own_new)

    # 10. A task with new or kept blocks starts them after all of its prerequisite.
    prerequisites = resolve_dependencies(tasks).prerequisite
    moving: dict[UUID, list[Interval]] = defaultdict(list)
    for block in new:
        moving[block.task_id].append(block.interval)
    for existing in kept:
        moving[existing.task_id].append(existing.interval)
    for task_id, intervals in moving.items():
        prerequisite = prerequisites.get(task_id)
        if prerequisite is None:
            continue
        assert prerequisite not in reported
        first = min(intervals, key=lambda interval: interval.start)
        simulation = is_simulation(task_id) or is_simulation(prerequisite)
        for block in by_task.get(prerequisite, []):
            assert block.interval.end <= first.start, f"{task_id} starts before {prerequisite}"
            if simulation:
                assert date_of(block.interval) < date_of(first)

    # 11. Each new block ends by its exam's cutoff, on a day the exam may use.
    for block in new:
        exam = exams_by_id[tasks_by_id[block.task_id].exam_id]
        assert block.interval.end <= exam_cutoff(exam, profile)
        assert date_of(block.interval) <= last_study_day(exam, profile)
        assert window_date[id(block)] == date_of(block.interval)


_PLANNERS: dict[str, Callable[[ReplanScenario], PlanResult]] = {
    "replan": lambda s: replan(*s),
    "plan": lambda s: plan(*s),
    "plan_keep_valid": lambda s: plan(*s, keep_valid=True),
}


@PROPERTY_SETTINGS
@given(replan_scenarios())
def test_replanning_keeps_the_invariants(scenario: ReplanScenario) -> None:
    for name, planner in _PLANNERS.items():
        try:
            _check_invariants(scenario, planner(scenario))
        except AssertionError as error:
            raise AssertionError(f"{name}: {error}") from error


@PROPERTY_SETTINGS
@given(replan_scenarios())
def test_replan_is_never_worse_than_a_fresh_plan(scenario: ReplanScenario) -> None:
    result = replan(*scenario)
    fresh = plan(*scenario)
    stable = plan(*scenario, keep_valid=True)
    assert _unscheduled_minutes(result) <= _unscheduled_minutes(fresh)
    assert _unscheduled_minutes(result) <= _unscheduled_minutes(stable)
    if _unscheduled_minutes(stable) <= _unscheduled_minutes(fresh):
        assert result == stable


def _applied(scenario: ReplanScenario, result: PlanResult, generation: str) -> ReplanScenario:
    """The scenario with the result stored: fixed and history blocks as they were,
    the kept candidates, and the new blocks as planned and not pinned."""
    roles = _roles(scenario)
    placed = {block.block_id for block in result.blocks if block.block_id is not None}
    stays = [
        block
        for block in scenario.existing_blocks
        if block_role(block, roles.start) is not BlockRole.CANDIDATE or block.id in placed
    ]
    new = [
        ExistingBlock(
            id=_new_id(block, generation),
            task_id=block.task_id,
            interval=block.interval,
            status=BlockStatus.PLANNED,
            pinned=False,
        )
        for block in result.blocks
        if block.block_id is None
    ]
    return scenario._replace(existing_blocks=(*stays, *new))


@PROPERTY_SETTINGS
@given(replan_scenarios())
@example(FINDING_2)
@example(FINDING_4)
def test_replanning_twice_moves_nothing(scenario: ReplanScenario) -> None:
    first = replan(*scenario)
    second = replan(*_applied(scenario, first, "replanned"))
    assert second.removed == ()
    assert _unscheduled_minutes(second) <= _unscheduled_minutes(first)


@PROPERTY_SETTINGS
@given(replan_scenarios())
def test_valid_blocks_are_candidates(scenario: ReplanScenario) -> None:
    candidates = {block.id: block for block in _roles(scenario).candidates}
    valid = valid_blocks(*scenario)
    assert all(candidates.get(block.id) == block for block in valid)
    keys = [(block.interval.start, block.id) for block in valid]
    assert keys == sorted(keys)
    assert len({block.id for block in valid}) == len(valid)


@PROPERTY_SETTINGS
@given(replan_scenarios(), st.data())
def test_placing_one_task_touches_nothing_else(
    scenario: ReplanScenario, data: st.DataObject
) -> None:
    profile, exams, tasks, _, now = scenario
    todo = [task for task in tasks if task.status is TaskStatus.TODO]
    if not todo:
        return
    task = data.draw(st.sampled_from(todo))
    result = place_task(profile, exams, tasks, scenario.existing_blocks, task.id, now)
    roles = _roles(scenario)
    start = roles.start
    tasks_by_id = {t.id: t for t in tasks}

    if result.unscheduled:
        assert result.blocks == ()
        assert result.removed == ()
        assert [item.task_id for item in result.unscheduled] == [task.id]
        return

    # Every live block (fixed or candidate) stays; the task's own ones come back.
    live = [*roles.fixed, *roles.candidates]
    assert result.removed == ()
    assert all(block.task_id == task.id for block in result.blocks)
    placed = {block.block_id: block for block in result.blocks if block.block_id is not None}
    for existing in live:
        if existing.task_id == task.id:
            assert existing.id in placed
            assert placed[existing.id].interval == existing.interval
    assert placed.keys() <= {block.id for block in live if block.task_id == task.id}
    new = sorted(
        (block for block in result.blocks if block.block_id is None),
        key=lambda block: block.interval.start,
    )
    if not new:
        return

    def date_of(interval: Interval) -> dt.date:
        return study_date(profile, interval.start)

    def is_simulation(task_id: UUID) -> bool:
        other = tasks_by_id.get(task_id)
        return other is not None and other.kind is TaskKind.SIMULATION

    # 3. In one window of what every live block leaves, a break from each.
    state = fixed_state(profile, tasks, live, start)
    days = study_days(profile, exams, now, state.busy)
    standing = [block.interval for block in live if block.interval.end > start]
    for block in new:
        assert _window_date(block.interval, days) == date_of(block.interval)
        assert all(_apart(block.interval, other) for other in standing)
    # 5. Within the budget of each day it uses, with every live block.
    day_minutes: Counter[dt.date] = Counter()
    for interval in [*(b.interval for b in live), *(b.interval for b in new)]:
        day_minutes[date_of(interval)] += interval.minutes
    for block in new:
        assert day_minutes[date_of(block.interval)] <= profile.daily_study_minutes
    # 6. A new simulation goes on a day that holds no other live simulation.
    if task.kind is TaskKind.SIMULATION:
        simulation_days = {date_of(b.interval) for b in live if is_simulation(b.task_id)}
        assert all(date_of(block.interval) not in simulation_days for block in new)
    # 9. A simulation is one block of its estimate; split parts are long enough.
    if task.kind is TaskKind.SIMULATION:
        assert len(new) == 1
        assert new[0].interval.minutes == task.estimated_minutes
    elif len(new) > 1:
        assert all(block.interval.minutes >= MIN_PART_MINUTES for block in new)
    # 11. Before the exam's cutoff, on a day the exam may use.
    exam = next(e for e in exams if e.id == task.exam_id)
    assert all(block.interval.end <= exam_cutoff(exam, profile) for block in new)
    assert all(date_of(block.interval) <= last_study_day(exam, profile) for block in new)
    # The prerequisite's live blocks all end before the first new block, and the new
    # blocks all end before the first live block of a task that waits for this one.
    prerequisites = resolve_dependencies(tasks).prerequisite
    prerequisite = prerequisites.get(task.id)
    if prerequisite is not None:
        first = new[0].interval
        for existing in live:
            if existing.task_id == prerequisite:
                assert existing.interval.end <= first.start
    last_end = max(block.interval.end for block in new)
    for existing in live:
        if prerequisites.get(existing.task_id) == task.id:
            assert last_end <= existing.interval.start


def _numbered(blocks: Iterable[ExistingBlock]) -> list[SnapshotBlock]:
    """The blocks as a snapshot holds them, each task's numbered 1..n in time order."""
    by_task: dict[UUID, list[ExistingBlock]] = defaultdict(list)
    for block in sorted(blocks, key=lambda b: (b.interval.start, b.interval.end, b.id)):
        by_task[block.task_id].append(block)
    return [
        SnapshotBlock(
            id=block.id,
            task_id=block.task_id,
            interval=block.interval,
            part_index=index,
            part_count=len(own),
            pinned=block.pinned,
            status=block.status,
        )
        for own in by_task.values()
        for index, block in enumerate(own, start=1)
    ]


def _open(blocks: Iterable[SnapshotBlock], start: dt.datetime) -> set[SnapshotBlock]:
    return {b for b in blocks if b.status is BlockStatus.PLANNED and b.interval.start >= start}


_TAKES_TIME = (BlockStatus.PLANNED, BlockStatus.DONE)


def _as_in_the_database(scenario: ReplanScenario) -> ReplanScenario:
    """The scenario's board as the database could hold it: its exclusion constraint
    forbids two planned or done blocks that overlap. The blocks are walked in the
    scenario's input order; a planned or done block that overlaps a planned or done
    block already kept is left out. Missed and skipped blocks always stay."""
    kept: list[ExistingBlock] = []
    for block in scenario.existing_blocks:
        if block.status in _TAKES_TIME and any(
            other.status in _TAKES_TIME and _overlaps(block.interval, other.interval)
            for other in kept
        ):
            continue
        kept.append(block)
    return scenario._replace(existing_blocks=tuple(kept))


@PROPERTY_SETTINGS
@given(replan_scenarios())
@example(FINDING_3)
def test_undo_returns_the_plan_before_the_change(scenario: ReplanScenario) -> None:
    board = _as_in_the_database(scenario)
    now = board.now
    start = start_minute(now)
    before = _numbered(board.existing_blocks)
    saved = parse_snapshot(json.loads(json.dumps(snapshot(before, now))))

    result = replan(*board)
    numbering = {block.block_id: block for block in result.blocks if block.block_id is not None}
    after: list[SnapshotBlock] = []
    for block in before:
        if block.id in result.removed:
            continue
        stored = numbering.get(block.id)
        if stored is not None:
            block = replace(block, part_index=stored.part_index, part_count=stored.part_count)
        after.append(block)
    after.extend(
        SnapshotBlock(
            id=_new_id(block, "replanned"),
            task_id=block.task_id,
            interval=block.interval,
            part_index=block.part_index,
            part_count=block.part_count,
            pinned=False,
            status=BlockStatus.PLANNED,
        )
        for block in result.blocks
        if block.block_id is None
    )

    undone = undo(saved, after, now)
    deleted = set(undone.delete)
    back = [block for block in after if block.id not in deleted] + list(undone.restore)

    assert _open(back, start) == _open(before, start)
    others = [block for block in after if block not in _open(after, start)]
    assert all(block in back for block in others)
    assert all(block.interval.start < start for block in undone.dropped)


@PROPERTY_SETTINGS
@given(replan_scenarios())
def test_same_scenario_same_output(scenario: ReplanScenario) -> None:
    assert replan(*scenario) == replan(*scenario)
