"""Placing one task in the next free slot, with every other live block where it is."""

from datetime import datetime
from uuid import UUID, uuid4

import pytest

from app.domain.planner import (
    BlockStatus,
    PlannerInputError,
    PlanResult,
    Task,
    TaskStatus,
    UnscheduledReason,
    place_task,
    plan,
)
from tests.planner.factories import (
    NOW,
    as_existing,
    make_block,
    make_exam,
    make_profile,
    make_task,
)
from tests.planner.test_replan import Z, at, board, nov, of, span

# make_profile(): one window, 07:00Z-15:00Z (480 minutes), and a budget of 240.
# An exam on November 5 has study days November 1-3 (one rest day).


def intervals(result: PlanResult, task: Task) -> list[tuple[int, int, object]]:
    return [(b.part_index, b.part_count, b.interval) for b in result.blocks if b.task_id == task.id]


def test_a_new_task_takes_the_next_free_slot() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    a, b = make_task(exam, 120), make_task(exam, 60)
    existing = board(profile, [exam], [a, b])
    assert [block.interval for block in existing] == [span(7, 9), at(9, 30, 10, 30)]
    c = make_task(exam, 60)
    result = place_task(profile, [exam], [a, b, c], existing, c.id, NOW)
    assert [
        (blk.task_id, blk.interval, blk.part_index, blk.part_count) for blk in result.blocks
    ] == [(c.id, at(10, 40, 11, 40), 1, 1)]
    assert result.removed == ()
    assert result.unscheduled == ()
    assert result.shortfalls == ()


def test_deferring_a_block_moves_only_that_block() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    a, b = make_task(exam, 120), make_task(exam, 60)
    existing = board(profile, [exam], [a, b])
    old = of(existing, b)[0]
    result = place_task(
        profile, [exam], [a, b], existing, b.id, NOW, release=[old.id], not_before=Z(2026, 11, 2, 0)
    )
    assert result.removed == (old.id,)
    assert [blk.task_id for blk in result.blocks] == [b.id]
    assert intervals(result, b) == [(1, 1, span(7, 8, 2))]


def test_a_missed_block_is_placed_again() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    a = make_task(exam, 60)
    missed = make_block(a, Z(2026, 11, 1, 7), Z(2026, 11, 1, 8), status=BlockStatus.MISSED)
    result = place_task(profile, [exam], [a], [missed], a.id, Z(2026, 11, 2, 6))
    assert intervals(result, a) == [(1, 1, span(7, 8, 2))]
    assert result.removed == ()


def test_only_the_remainder_is_placed() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    a = make_task(exam, 120)
    done = make_block(a, Z(2026, 11, 1, 7), Z(2026, 11, 1, 8), status=BlockStatus.DONE)
    result = place_task(profile, [exam], [a], [done], a.id, NOW)
    assert len(result.blocks) == 2
    first, second = result.blocks
    assert (first.block_id, first.interval, first.part_index, first.part_count) == (
        done.id,
        done.interval,
        1,
        2,
    )
    assert second.block_id is None
    assert second.interval.minutes == 60
    assert (second.part_index, second.part_count) == (2, 2)


def test_an_unfinished_prerequisite_blocks_the_task() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    p = make_task(exam, 60)
    t = make_task(exam, 60, depends_on=p.id)
    result = place_task(profile, [exam], [p, t], [], t.id, NOW)
    assert result.blocks == ()
    assert result.removed == ()
    assert [(u.task_id, u.minutes, u.reason, u.blocked_by) for u in result.unscheduled] == [
        (t.id, 60, UnscheduledReason.DEPENDENCY_NOT_SCHEDULED, p.id)
    ]


def test_a_task_goes_after_its_prerequisite() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    p = make_task(exam, 60)
    t = make_task(exam, 60, depends_on=p.id)
    block = make_block(p, Z(2026, 11, 2, 7), Z(2026, 11, 2, 8))
    result = place_task(profile, [exam], [p, t], [block], t.id, NOW)
    assert intervals(result, t) == [(1, 1, span(7, 8, 3))]
    assert result.unscheduled == ()


def test_a_dependent_that_comes_first_fails_the_placement() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    p = make_task(exam, 60)
    d = make_task(exam, 60, depends_on=p.id)
    existing = board(profile, [exam], [p, d])
    assert {block.interval.start.date() for block in existing} == {nov(1)}
    old = of(existing, p)[0]
    result = place_task(
        profile, [exam], [p, d], existing, p.id, NOW, release=[old.id], not_before=Z(2026, 11, 2, 0)
    )
    assert result.blocks == ()
    assert result.removed == ()
    assert [(u.task_id, u.reason, u.blocked_by) for u in result.unscheduled] == [
        (p.id, UnscheduledReason.DEPENDENT_TOO_EARLY, d.id)
    ]


def test_no_room_changes_nothing() -> None:
    profile = make_profile()
    exam = make_exam(nov(3))
    a, b = make_task(exam, 240), make_task(exam, 60)
    existing = as_existing(plan(profile, [exam], [a], [], NOW))
    result = place_task(profile, [exam], [a, b], existing, b.id, NOW)
    assert result.blocks == ()
    assert result.removed == ()
    assert [(u.task_id, u.minutes, u.reason) for u in result.unscheduled] == [
        (b.id, 60, UnscheduledReason.NOT_ENOUGH_TIME)
    ]


@pytest.mark.parametrize(
    "case", ["unknown task", "done task", "other task's block", "done block", "naive not_before"]
)
def test_bad_requests_are_rejected(case: str) -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    a, b = make_task(exam, 60), make_task(exam, 60)
    done_task = make_task(exam, 60, status=TaskStatus.DONE)
    planned_a = make_block(a, Z(2026, 11, 1, 7), Z(2026, 11, 1, 8))
    planned_b = make_block(b, Z(2026, 11, 1, 9), Z(2026, 11, 1, 10))
    done_a = make_block(a, Z(2026, 11, 2, 7), Z(2026, 11, 2, 8), status=BlockStatus.DONE)
    existing = [planned_a, planned_b, done_a]
    tasks = [a, b, done_task]
    task_id: UUID = a.id
    release: list[UUID] = []
    not_before: datetime | None = None
    if case == "unknown task":
        task_id = uuid4()
    elif case == "done task":
        task_id = done_task.id
    elif case == "other task's block":
        release = [planned_b.id]
    elif case == "done block":
        release = [done_a.id]
    else:
        not_before = datetime(2026, 11, 2, 0, 0)
    with pytest.raises(PlannerInputError):
        place_task(
            profile, [exam], tasks, existing, task_id, NOW, release=release, not_before=not_before
        )
