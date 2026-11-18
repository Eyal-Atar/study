"""Adding a busy event releases the planned blocks it overlaps and places their tasks
again, one after another (S35, plan decision 9)."""

from dataclasses import replace
from datetime import datetime
from itertools import pairwise
from uuid import uuid4

import pytest

from app.domain.planner import (
    BlockStatus,
    ClearResult,
    Interval,
    PlannerInputError,
    Profile,
    TaskStatus,
    UnscheduledReason,
    busy_intervals,
    clear_interval,
)
from tests.planner.factories import NOW, make_block, make_exam, make_profile, make_task
from tests.planner.test_replan import Z, at, board, nov, of, span

# make_profile(): one window, 07:00Z-15:00Z (480 minutes), and a budget of 240.
# An exam on November 5 has study days November 1-3 (one rest day).


def busy(profile: Profile, interval: Interval) -> Profile:
    """The profile with the new event, as the API passes it in."""
    return replace(profile, busy=(*profile.busy, interval))


def is_free(profile: Profile, interval: Interval) -> bool:
    return busy_intervals(profile, interval.start, interval.end) == ()


def test_an_event_moves_the_block_it_covers() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    a, b = make_task(exam, 120), make_task(exam, 60)
    existing = board(profile, [exam], [a, b])
    [old] = of(existing, b)
    assert old.interval == at(9, 30, 10, 30)
    event = at(9, 0, 11, 0)
    result = clear_interval(busy(profile, event), [exam], [a, b], existing, NOW, event)
    assert result.removed == (old.id,)
    assert result.unscheduled == ()
    [moved] = result.blocks
    assert (moved.task_id, moved.block_id, moved.part_index, moved.part_count) == (b.id, None, 1, 1)
    assert moved.interval.minutes == 60
    assert moved.pinned is False
    assert is_free(busy(profile, event), moved.interval)
    # The other task's block is not touched and not in the result.
    assert all(block.task_id == b.id for block in result.blocks)


def test_pinned_and_running_blocks_are_released_too() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    a, b = make_task(exam, 60), make_task(exam, 60)
    running = make_block(a, Z(2026, 11, 1, 4, 30), Z(2026, 11, 1, 5, 30))  # NOW is 05:00Z
    pinned = make_block(b, Z(2026, 11, 1, 6), Z(2026, 11, 1, 7), pinned=True)
    event = Interval(Z(2026, 11, 1, 5), Z(2026, 11, 1, 7))
    result = clear_interval(busy(profile, event), [exam], [a, b], [running, pinned], NOW, event)
    assert result.removed == (running.id, pinned.id)
    assert {block.task_id for block in result.blocks} == {a.id, b.id}
    assert all(block.block_id is None and not block.pinned for block in result.blocks)
    assert all(is_free(busy(profile, event), block.interval) for block in result.blocks)


def test_done_and_past_blocks_stay() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    a, b = make_task(exam, 60), make_task(exam, 60)
    done = make_block(a, Z(2026, 11, 1, 8), Z(2026, 11, 1, 9), status=BlockStatus.DONE)
    past = make_block(b, Z(2026, 11, 1, 3), Z(2026, 11, 1, 4))
    event = Interval(Z(2026, 11, 1, 3), Z(2026, 11, 1, 10))
    result = clear_interval(busy(profile, event), [exam], [a, b], [done, past], NOW, event)
    assert result == ClearResult(blocks=(), removed=(), unscheduled=())


def test_tasks_are_placed_again_in_the_order_of_their_released_blocks() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    a, b, c = make_task(exam, 60), make_task(exam, 60), make_task(exam, 60)
    existing = board(profile, [exam], [a, b, c])
    # The event covers all of November 1: every block is released.
    event = Interval(Z(2026, 11, 1, 5), Z(2026, 11, 1, 21))
    result = clear_interval(busy(profile, event), [exam], [a, b, c], existing, NOW, event)
    assert set(result.removed) == {block.id for block in existing}
    assert result.unscheduled == ()
    starts = {block.task_id: block.interval.start for block in result.blocks}
    assert starts[a.id] < starts[b.id] < starts[c.id]
    intervals = sorted(block.interval for block in result.blocks)
    # Each task's new blocks were fed back to the next one: none overlaps another.
    assert all(x.end <= y.start for x, y in pairwise(intervals))
    assert all(block.interval.start >= Z(2026, 11, 2, 7) for block in result.blocks)


def test_the_blocks_of_a_task_outside_the_event_stay_and_are_numbered() -> None:
    profile = make_profile(daily_study_minutes=480)
    exam = make_exam(nov(5))
    a = make_task(exam, 90)
    first = make_block(a, Z(2026, 11, 1, 7), Z(2026, 11, 1, 8))
    second = make_block(a, Z(2026, 11, 1, 9), Z(2026, 11, 1, 9, 30))
    event = at(9, 0, 10, 0)
    result = clear_interval(busy(profile, event), [exam], [a], [first, second], NOW, event)
    assert result.removed == (second.id,)
    assert [(b.block_id, b.part_index, b.part_count) for b in result.blocks] == [
        (first.id, 1, 2),
        (None, 2, 2),
    ]
    assert result.blocks[0].interval == first.interval
    assert result.blocks[1].interval.minutes == 30


def test_a_task_with_no_room_left_is_unscheduled_and_its_blocks_removed() -> None:
    profile = make_profile()
    exam = make_exam(nov(3))  # study day November 1 only (one rest day)
    a, b = make_task(exam, 60), make_task(exam, 60)
    existing = board(profile, [exam], [a, b])
    [old_b] = of(existing, b)
    event = Interval(old_b.interval.start, Z(2026, 11, 1, 21))
    result = clear_interval(busy(profile, event), [exam], [a, b], existing, NOW, event)
    assert result.removed == (old_b.id,)
    assert result.blocks == ()
    [missing] = result.unscheduled
    assert (missing.task_id, missing.minutes) == (b.id, 60)
    assert missing.reason in tuple(UnscheduledReason)


def test_a_failed_task_keeps_its_blocks_outside_the_event() -> None:
    profile = make_profile()
    exam = make_exam(nov(3))
    a = make_task(exam, 120)
    first = make_block(a, Z(2026, 11, 1, 7), Z(2026, 11, 1, 8))
    second = make_block(a, Z(2026, 11, 1, 13), Z(2026, 11, 1, 14))
    event = Interval(Z(2026, 11, 1, 8), Z(2026, 11, 1, 21))
    result = clear_interval(busy(profile, event), [exam], [a], [first, second], NOW, event)
    assert result.removed == (second.id,)
    assert [(b.block_id, b.part_index, b.part_count) for b in result.blocks] == [(first.id, 1, 1)]
    [missing] = result.unscheduled
    assert (missing.task_id, missing.minutes) == (a.id, 60)


def test_a_dependent_follows_its_prerequisite_when_both_move() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    p = make_task(exam, 60)
    t = make_task(exam, 60, depends_on=p.id)
    existing = board(profile, [exam], [p, t])
    event = Interval(Z(2026, 11, 1, 5), Z(2026, 11, 1, 21))
    result = clear_interval(busy(profile, event), [exam], [p, t], existing, NOW, event)
    assert result.unscheduled == ()
    by_task = {block.task_id: block.interval for block in result.blocks}
    assert by_task[p.id].end <= by_task[t.id].start


def test_a_block_of_a_task_not_in_the_input_is_only_removed() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    gone = make_task(exam, 60)
    finished = make_task(exam, 60, status=TaskStatus.DONE)
    first = make_block(gone, Z(2026, 11, 1, 8), Z(2026, 11, 1, 9))
    second = make_block(finished, Z(2026, 11, 1, 10), Z(2026, 11, 1, 11))
    event = span(7, 12)
    result = clear_interval(busy(profile, event), [exam], [finished], [first, second], NOW, event)
    assert result == ClearResult(blocks=(), removed=(first.id, second.id), unscheduled=())


def test_the_same_input_gives_the_same_output() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    tasks = [make_task(exam, 90), make_task(exam, 120), make_task(exam, 30)]
    existing = board(profile, [exam], tasks)
    event = span(7, 12)
    first = clear_interval(busy(profile, event), [exam], tasks, existing, NOW, event)
    second = clear_interval(busy(profile, event), [exam], tasks, existing, NOW, event)
    assert first == second


def test_an_interval_must_be_an_interval() -> None:
    with pytest.raises(PlannerInputError):
        clear_interval(make_profile(), [], [], [], NOW, (NOW, NOW))  # type: ignore[arg-type]


def test_now_must_be_aware() -> None:
    with pytest.raises(PlannerInputError):
        clear_interval(make_profile(), [], [], [], datetime(2026, 11, 1), span(7, 8))


def test_duplicate_block_ids_are_rejected() -> None:
    exam = make_exam(nov(5))
    a = make_task(exam, 60)
    block = make_block(a, Z(2026, 11, 1, 7), Z(2026, 11, 1, 8), id=uuid4())
    with pytest.raises(PlannerInputError):
        clear_interval(make_profile(), [exam], [a], [block, block], NOW, span(7, 8))
