"""Placing one task in the next free slot, with every other live block where it is."""

from dataclasses import replace
from datetime import datetime
from uuid import UUID, uuid4

import pytest

from app.domain.planner import (
    BlockStatus,
    PlannerInputError,
    PlanResult,
    Task,
    TaskKind,
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


SIMULATION_PAIRS = [
    pytest.param(TaskKind.SIMULATION, TaskKind.REVIEW, id="simulation-prerequisite"),
    pytest.param(TaskKind.LEARN, TaskKind.SIMULATION, id="simulation-dependent"),
]


@pytest.mark.parametrize(("p_kind", "t_kind"), SIMULATION_PAIRS)
def test_a_simulation_pair_waits_a_day_after_a_prerequisite_done_earlier_today(
    p_kind: TaskKind, t_kind: TaskKind
) -> None:
    profile = make_profile()
    exam = make_exam(nov(4))  # study days November 1 and 2
    p = make_task(exam, 60, p_kind)
    t = make_task(exam, 60, t_kind, depends_on=p.id)
    done = make_block(p, Z(2026, 11, 1, 6), Z(2026, 11, 1, 7), status=BlockStatus.DONE)
    result = place_task(profile, [exam], [p, t], [done], t.id, Z(2026, 11, 1, 7, 30))
    assert intervals(result, t) == [(1, 1, span(7, 8, 2))]
    assert result.unscheduled == ()


@pytest.mark.parametrize(("p_kind", "t_kind"), SIMULATION_PAIRS)
def test_a_simulation_pair_with_no_later_day_after_a_prerequisite_done_today(
    p_kind: TaskKind, t_kind: TaskKind
) -> None:
    profile = make_profile()
    exam = make_exam(nov(3))  # one study day, November 1
    p = make_task(exam, 60, p_kind)
    t = make_task(exam, 60, t_kind, depends_on=p.id)
    done = make_block(p, Z(2026, 11, 1, 6), Z(2026, 11, 1, 7), status=BlockStatus.DONE)
    result = place_task(profile, [exam], [p, t], [done], t.id, Z(2026, 11, 1, 7, 30))
    assert result.blocks == ()
    assert [(u.task_id, u.minutes, u.reason, u.blocked_by) for u in result.unscheduled] == [
        (t.id, 60, UnscheduledReason.DEPENDENCY_TOO_LATE, p.id)
    ]


@pytest.mark.parametrize("pinned", [False, True], ids=["candidate", "pinned"])
def test_a_simulation_does_not_go_on_a_day_with_another_simulation(pinned: bool) -> None:
    profile = make_profile()
    exam = make_exam(nov(3))  # one study day, November 1
    s1 = make_task(exam, 60, TaskKind.SIMULATION)
    s2 = make_task(exam, 60, TaskKind.SIMULATION)
    existing = as_existing(plan(profile, [exam], [s1], [], NOW))
    assert [block.interval for block in existing] == [span(7, 8)]
    if pinned:
        existing = [replace(block, pinned=True) for block in existing]
    result = place_task(profile, [exam], [s1, s2], existing, s2.id, NOW)
    assert result.blocks == ()
    assert result.removed == ()
    assert [(u.task_id, u.minutes, u.reason) for u in result.unscheduled] == [
        (s2.id, 60, UnscheduledReason.NO_CONTIGUOUS_WINDOW)
    ]


def test_a_task_spans_the_days_after_its_prerequisite() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    p = make_task(exam, 30)
    t = make_task(exam, 200, depends_on=p.id)
    x = make_task(exam, 200)
    blocks = [
        make_block(p, Z(2026, 11, 1, 13), Z(2026, 11, 1, 13, 30), pinned=True),
        make_block(x, Z(2026, 11, 2, 7), Z(2026, 11, 2, 8, 40), pinned=True),
        make_block(x, Z(2026, 11, 3, 7), Z(2026, 11, 3, 8, 40), pinned=True),
    ]
    result = place_task(profile, [exam], [p, t, x], blocks, t.id, NOW)
    assert result.unscheduled == ()
    assert intervals(result, t) == [(1, 2, at(8, 50, 11, 10, 2)), (2, 2, at(8, 50, 9, 50, 3))]


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


@pytest.mark.parametrize("running", [False, True], ids=["pinned-future", "running"])
def test_deferring_a_fixed_block_moves_it(running: bool) -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    a = make_task(exam, 60)
    if running:
        old = make_block(a, Z(2026, 11, 1, 7), Z(2026, 11, 1, 8))
        now = Z(2026, 11, 1, 7, 30)
    else:
        old = make_block(a, Z(2026, 11, 1, 9), Z(2026, 11, 1, 10), pinned=True)
        now = NOW
    result = place_task(
        profile, [exam], [a], [old], a.id, now, release=[old.id], not_before=Z(2026, 11, 2, 0)
    )
    assert result.removed == (old.id,)
    assert intervals(result, a) == [(1, 1, span(7, 8, 2))]


@pytest.mark.parametrize(
    "case",
    [
        "unknown task",
        "done task",
        "other task's block",
        "done block",
        "past planned block",
        "naive not_before",
    ],
)
def test_bad_requests_are_rejected(case: str) -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    a, b = make_task(exam, 60), make_task(exam, 60)
    done_task = make_task(exam, 60, status=TaskStatus.DONE)
    planned_a = make_block(a, Z(2026, 11, 1, 7), Z(2026, 11, 1, 8))
    planned_b = make_block(b, Z(2026, 11, 1, 9), Z(2026, 11, 1, 10))
    done_a = make_block(a, Z(2026, 11, 2, 7), Z(2026, 11, 2, 8), status=BlockStatus.DONE)
    past_a = make_block(a, Z(2026, 10, 31, 7), Z(2026, 10, 31, 8))  # history at NOW
    existing = [planned_a, planned_b, done_a, past_a]
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
    elif case == "past planned block":
        release = [past_a.id]
    else:
        not_before = datetime(2026, 11, 2, 0, 0)
    with pytest.raises(PlannerInputError):
        place_task(
            profile, [exam], tasks, existing, task_id, NOW, release=release, not_before=not_before
        )


def test_a_task_already_covered_gets_no_new_block() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    a = make_task(exam, 60)
    existing = board(profile, [exam], [a])
    result = place_task(profile, [exam], [a], existing, a.id, NOW)
    assert [(b.block_id, b.interval, b.part_index, b.part_count) for b in result.blocks] == [
        (existing[0].id, existing[0].interval, 1, 1)
    ]
    assert result.removed == ()
    assert result.unscheduled == ()


@pytest.mark.parametrize(("t_kind", "d_kind"), SIMULATION_PAIRS)
def test_a_simulation_pair_dependent_on_the_same_day_fails_the_placement(
    t_kind: TaskKind, d_kind: TaskKind
) -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    t = make_task(exam, 60, t_kind)
    d = make_task(exam, 60, d_kind, depends_on=t.id)
    later = make_block(d, Z(2026, 11, 2, 12), Z(2026, 11, 2, 13))
    result = place_task(profile, [exam], [t, d], [later], t.id, NOW, not_before=Z(2026, 11, 2, 0))
    assert result.blocks == ()
    assert [(u.task_id, u.reason, u.blocked_by) for u in result.unscheduled] == [
        (t.id, UnscheduledReason.DEPENDENT_TOO_EARLY, d.id)
    ]


def test_a_plain_dependent_later_on_the_same_day_lets_the_placement_succeed() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    t = make_task(exam, 60)
    d = make_task(exam, 60, TaskKind.REVIEW, depends_on=t.id)
    later = make_block(d, Z(2026, 11, 2, 12), Z(2026, 11, 2, 13))
    result = place_task(profile, [exam], [t, d], [later], t.id, NOW, not_before=Z(2026, 11, 2, 0))
    assert intervals(result, t) == [(1, 1, span(7, 8, 2))]
    assert result.unscheduled == ()


def test_the_first_dependent_in_input_order_is_reported() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    t = make_task(exam, 60)
    d1 = make_task(exam, 60, depends_on=t.id)
    d2 = make_task(exam, 60, depends_on=t.id)
    early = make_block(d1, Z(2026, 11, 1, 7), Z(2026, 11, 1, 8))
    late = make_block(d2, Z(2026, 11, 1, 9), Z(2026, 11, 1, 10))
    result = place_task(profile, [exam], [t, d2, d1], [early, late], t.id, NOW)
    assert [(u.task_id, u.reason, u.blocked_by) for u in result.unscheduled] == [
        (t.id, UnscheduledReason.DEPENDENT_TOO_EARLY, d2.id)
    ]
