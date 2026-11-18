"""The invariants of clearing a busy event and of "I have time now" (S35, plan decisions
9 and 10), on the calendars of the replanning scenarios."""

import datetime as dt
from collections import Counter
from dataclasses import replace
from itertools import pairwise
from uuid import UUID

from hypothesis import given
from hypothesis import strategies as st

from app.domain.planner import (
    MAX_FREE_TIME_MINUTES,
    MIN_FREE_TIME_MINUTES,
    BlockRole,
    BlockStatus,
    ExistingBlock,
    Interval,
    PlannedBlock,
    Profile,
    TaskKind,
    TaskStatus,
    block_role,
    busy_intervals,
    clear_interval,
    exam_cutoff,
    free_time,
    last_study_day,
    start_minute,
    study_date,
)
from tests.planner.strategies import PROPERTY_SETTINGS, ReplanScenario, replan_scenarios

_MINUTE = dt.timedelta(minutes=1)
# Where a busy event may start, from now: a little in the past to three days ahead.
EVENT_START_MINUTES = (-120, 3 * 24 * 60)
EVENT_MINUTES = (15, 8 * 60)


def _overlaps(a: Interval, b: Interval) -> bool:
    return a.start < b.end and b.start < a.end


def _free(profile: Profile, interval: Interval) -> bool:
    return busy_intervals(profile, interval.start, interval.end) == ()


def _live(block: ExistingBlock, start: dt.datetime) -> bool:
    return block_role(block, start) in (BlockRole.FIXED, BlockRole.CANDIDATE)


def _staying(
    scenario: ReplanScenario, removed: tuple[UUID, ...], start: dt.datetime
) -> list[ExistingBlock]:
    """The live blocks of the scenario that are not removed."""
    gone = set(removed)
    return [b for b in scenario.existing_blocks if b.id not in gone and _live(b, start)]


def _new(blocks: tuple[PlannedBlock, ...]) -> list[PlannedBlock]:
    return sorted((b for b in blocks if b.block_id is None), key=lambda b: b.interval.start)


def _check_numbering(blocks: tuple[PlannedBlock, ...]) -> None:
    by_task: dict[UUID, list[PlannedBlock]] = {}
    for block in blocks:
        by_task.setdefault(block.task_id, []).append(block)
    for own in by_task.values():
        ordered = sorted(own, key=lambda b: (b.interval.start, b.interval.end))
        assert [b.part_index for b in ordered] == list(range(1, len(own) + 1))
        assert all(b.part_count == len(own) for b in own)


@st.composite
def _events(draw: st.DrawFn, now: dt.datetime) -> Interval:
    start = start_minute(now) + draw(st.integers(*EVENT_START_MINUTES)) * _MINUTE
    return Interval(start, start + draw(st.integers(*EVENT_MINUTES)) * _MINUTE)


@PROPERTY_SETTINGS
@given(replan_scenarios(), st.data())
def test_clearing_an_event_keeps_the_invariants(
    scenario: ReplanScenario, data: st.DataObject
) -> None:
    event = data.draw(_events(scenario.now))
    profile = replace(scenario.profile, busy=(*scenario.profile.busy, event))
    _, exams, tasks, existing, now = scenario
    result = clear_interval(profile, exams, tasks, existing, now, event)
    start = start_minute(now)
    todo = {task.id for task in tasks if task.status is TaskStatus.TODO}

    # Released are exactly the planned blocks that are not over and overlap the event.
    released = [
        b
        for b in existing
        if b.status is BlockStatus.PLANNED
        and b.interval.end > start
        and _overlaps(b.interval, event)
    ]
    released_ids = {b.id for b in released}
    # Besides those, only candidate blocks of a todo dependent that was in a re-placed
    # prerequisite's way are released (it follows its prerequisite again).
    extra = [b for b in existing if b.id in set(result.removed) - released_ids]
    depends_on = {task.id: task.depends_on for task in tasks}
    for moved in extra:
        assert moved.task_id in todo
        assert block_role(moved, start) is BlockRole.CANDIDATE
        assert depends_on[moved.task_id] is not None
    assert released_ids <= set(result.removed)
    assert len(set(result.removed)) == len(result.removed)
    affected = ({b.task_id for b in released} & todo) | {b.task_id for b in extra}

    # Only the affected tasks come back, each placed or reported, never both.
    by_task = Counter(b.task_id for b in result.blocks)
    reported = Counter(item.task_id for item in result.unscheduled)
    assert by_task.keys() <= affected
    assert reported.keys() <= affected
    assert all(count == 1 for count in reported.values())
    for task_id in affected:
        if task_id in reported:
            assert not [b for b in result.blocks if b.task_id == task_id and b.block_id is None]
        else:
            assert task_id in by_task
    _check_numbering(result.blocks)

    # The blocks that come back with an id are live blocks of their task, in place.
    staying = _staying(scenario, result.removed, start)
    by_id = {b.id: b for b in staying}
    for block in result.blocks:
        if block.block_id is not None:
            original = by_id[block.block_id]
            assert (original.task_id, original.interval) == (block.task_id, block.interval)

    # After the change, no live block overlaps the event except a DONE one.
    new = _new(result.blocks)
    for kept in staying:
        if kept.status is not BlockStatus.DONE:
            assert not _overlaps(kept.interval, event)
    for block in new:
        assert not _overlaps(block.interval, event)
        assert _free(profile, block.interval)
        assert block.interval.start >= start
        assert not block.pinned
        assert not any(_overlaps(block.interval, other.interval) for other in staying)
    for earlier, later in pairwise(new):
        assert earlier.interval.end <= later.interval.start


@PROPERTY_SETTINGS
@given(replan_scenarios(), st.data())
def test_free_time_keeps_the_invariants(scenario: ReplanScenario, data: st.DataObject) -> None:
    minutes = data.draw(st.integers(MIN_FREE_TIME_MINUTES, MAX_FREE_TIME_MINUTES))
    profile, exams, tasks, existing, now = scenario
    result = free_time(profile, exams, tasks, existing, now, minutes)
    start = start_minute(now)
    session = Interval(start, start + minutes * _MINUTE)
    assert result.session == session
    assert (result.failure is None) == bool(result.placed)
    tasks_by_id = {task.id: task for task in tasks}
    exams_by_id = {exam.id: exam for exam in exams}

    # Only the placed tasks change: their candidates leave, nothing else does.
    placed = set(result.placed)
    assert len(placed) == len(result.placed)
    assert {b.task_id for b in result.blocks} == placed
    by_id = {b.id: b for b in existing}
    for block_id in result.removed:
        gone = by_id[block_id]
        assert gone.task_id in placed
        assert block_role(gone, start) is BlockRole.CANDIDATE
    for stored in existing:
        if stored.task_id in placed and block_role(stored, start) is BlockRole.CANDIDATE:
            assert stored.id in result.removed
    _check_numbering(result.blocks)

    staying = _staying(scenario, result.removed, start)
    others = [b for b in staying if b.task_id not in placed]
    new = _new(result.blocks)
    for block in new:
        interval = block.interval
        task = tasks_by_id[block.task_id]
        exam = exams_by_id[task.exam_id]
        # The session's blocks lie in it and are pinned; the rest come after it.
        if block.pinned:
            assert session.start <= interval.start and interval.end <= session.end
        else:
            assert interval.start >= session.end
        # Never on busy time, never on another live block, never past the exam.
        assert _free(profile, interval)
        assert not any(_overlaps(interval, other.interval) for other in staying)
        assert interval.end <= exam_cutoff(exam, profile)
        assert study_date(profile, interval.start) <= last_study_day(exam, profile)
    for earlier, later in pairwise(new):
        assert earlier.interval.end <= later.interval.start

    # Each placed task waits for its prerequisite; a simulation is one whole block, on a
    # study day without another simulation.
    final = [
        *((b.task_id, b.interval) for b in others),
        *((b.task_id, b.interval) for b in result.blocks),
    ]
    for task_id in result.placed:
        task = tasks_by_id[task_id]
        own_new = [b for b in new if b.task_id == task_id]
        assert own_new
        first = own_new[0].interval
        prerequisite = None if task.depends_on is None else tasks_by_id.get(task.depends_on)
        if prerequisite is not None and prerequisite.status is TaskStatus.TODO:
            pair = TaskKind.SIMULATION in (task.kind, prerequisite.kind)
            for other_id, interval in final:
                if other_id == prerequisite.id:
                    assert interval.end <= first.start
                    if pair:
                        assert study_date(profile, interval.start) < study_date(
                            profile, first.start
                        )
        if task.kind is TaskKind.SIMULATION:
            assert len(own_new) == 1 and own_new[0].pinned
            day = study_date(profile, first.start)
            for other_id, interval in final:
                other = tasks_by_id.get(other_id)
                if other_id != task_id and other is not None and other.kind is TaskKind.SIMULATION:
                    assert study_date(profile, interval.start) != day
