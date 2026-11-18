import importlib
from datetime import UTC, date, datetime, time
from typing import Any
from uuid import uuid4

import pytest

from app.domain.planner import (
    BlockStatus,
    ExamShortfall,
    ExistingBlock,
    Interval,
    PlannedBlock,
    PlannerInputError,
    StudyWindow,
    TaskKind,
    TaskStatus,
    UnscheduledReason,
    plan,
)
from tests.planner.factories import NOW, make_block, make_exam, make_profile, make_task

# make_profile(): one window, 07:00Z-15:00Z (480 minutes), and a budget of 240.
# An exam on November 5 has study days November 1-3 (one rest day).


def Z(y: int, mo: int, d: int, h: int, mi: int = 0) -> datetime:
    return datetime(y, mo, d, h, mi, tzinfo=UTC)


def nov(day: int) -> date:
    return date(2026, 11, day)


def span(start_hour: int, end_hour: int, day: int = 1) -> Interval:
    return Interval(Z(2026, 11, day, start_hour), Z(2026, 11, day, end_hour))


def at(
    start_hour: int, start_minute: int, end_hour: int, end_minute: int, day: int = 1
) -> Interval:
    return Interval(
        Z(2026, 11, day, start_hour, start_minute), Z(2026, 11, day, end_hour, end_minute)
    )


def test_a_long_task_spans_days_with_numbered_parts() -> None:
    exam = make_exam(nov(5))
    a = make_task(exam, 300)
    result = plan(make_profile(), [exam], [a], [], NOW)
    assert result.blocks == (
        PlannedBlock(task_id=a.id, interval=span(7, 11, 1), part_index=1, part_count=2),
        PlannedBlock(task_id=a.id, interval=span(7, 8, 2), part_index=2, part_count=2),
    )
    assert result.unscheduled == ()
    assert result.shortfalls == ()


def test_done_and_pinned_blocks_are_busy() -> None:
    exam = make_exam(nov(5))
    a = make_task(exam, 120)
    other = uuid4()
    candidate = uuid4()
    missed = uuid4()
    existing = [
        ExistingBlock(
            id=uuid4(),
            task_id=other,
            interval=span(7, 9),
            status=BlockStatus.DONE,
            pinned=False,
        ),
        ExistingBlock(
            id=uuid4(),
            task_id=other,
            interval=span(13, 15),
            status=BlockStatus.PLANNED,
            pinned=True,
        ),
        ExistingBlock(
            id=candidate,
            task_id=other,
            interval=span(9, 10),
            status=BlockStatus.PLANNED,
            pinned=False,
        ),
        ExistingBlock(
            id=missed,
            task_id=other,
            interval=span(10, 11),
            status=BlockStatus.MISSED,
            pinned=False,
        ),
    ]
    # A budget of 480, so the 240 fixed minutes leave A room on November 1.
    result = plan(make_profile(daily_study_minutes=480), [exam], [a], existing, NOW)
    assert result.blocks == (
        PlannedBlock(task_id=a.id, interval=at(9, 10, 11, 10), part_index=1, part_count=1),
    )
    assert result.removed == (candidate,)


def test_a_done_block_shortens_its_task() -> None:
    exam = make_exam(nov(5))
    a = make_task(exam, 120)
    b1 = make_block(a, Z(2026, 11, 1, 7), Z(2026, 11, 1, 8), status=BlockStatus.DONE)
    result = plan(make_profile(), [exam], [a], [b1], NOW)
    assert result.blocks == (
        PlannedBlock(task_id=a.id, interval=span(7, 8), part_index=1, part_count=2, block_id=b1.id),
        PlannedBlock(task_id=a.id, interval=at(8, 10, 9, 10), part_index=2, part_count=2),
    )
    assert result.removed == ()
    assert result.unscheduled == ()


def test_a_covered_task_gets_no_new_block() -> None:
    exam = make_exam(nov(5))
    a = make_task(exam, 60)
    pinned = make_block(a, Z(2026, 11, 1, 13), Z(2026, 11, 1, 14), pinned=True)
    result = plan(make_profile(), [exam], [a], [pinned], NOW)
    assert result.blocks == (
        PlannedBlock(
            task_id=a.id,
            interval=span(13, 14),
            part_index=1,
            part_count=1,
            block_id=pinned.id,
            pinned=True,
        ),
    )
    assert result.unscheduled == ()


def test_fixed_minutes_count_against_the_day() -> None:
    exam = make_exam(nov(5))
    x = make_task(exam, 180, status=TaskStatus.DONE)
    a = make_task(exam, 120)
    done = make_block(x, Z(2026, 11, 1, 7), Z(2026, 11, 1, 10), status=BlockStatus.DONE)
    result = plan(make_profile(), [exam], [x, a], [done], NOW)
    # November 1 has 60 minutes of its budget left.
    assert result.blocks == (
        PlannedBlock(task_id=a.id, interval=span(7, 9, 2), part_index=1, part_count=1),
    )


def test_a_simulation_with_a_fixed_block_is_covered() -> None:
    exam = make_exam(nov(5))
    simulation = make_task(exam, 180, TaskKind.SIMULATION)
    pinned = make_block(simulation, Z(2026, 11, 1, 7), Z(2026, 11, 1, 9), pinned=True)
    result = plan(make_profile(), [exam], [simulation], [pinned], NOW)
    assert [block.block_id for block in result.blocks] == [pinned.id]
    assert result.unscheduled == ()


def test_a_day_with_a_fixed_simulation_takes_no_other() -> None:
    exam = make_exam(nov(3))  # one study day, November 1
    s1 = make_task(exam, 60, TaskKind.SIMULATION)
    s2 = make_task(exam, 60, TaskKind.SIMULATION)
    pinned = make_block(s1, Z(2026, 11, 1, 13), Z(2026, 11, 1, 14), pinned=True)
    result = plan(make_profile(), [exam], [s1, s2], [pinned], NOW)
    assert [(u.task_id, u.reason) for u in result.unscheduled] == [
        (s2.id, UnscheduledReason.NO_CONTIGUOUS_WINDOW)
    ]
    assert s2.id not in {block.task_id for block in result.blocks}


def test_a_dependent_waits_a_day_after_a_fixed_block() -> None:
    exam = make_exam(nov(5))
    p = make_task(exam, 60)
    t = make_task(exam, 60, depends_on=p.id)
    pinned = make_block(p, Z(2026, 11, 2, 7), Z(2026, 11, 2, 8), pinned=True)
    result = plan(make_profile(), [exam], [p, t], [pinned], NOW)
    assert [(block.task_id, block.interval) for block in result.blocks] == [
        (p.id, span(7, 8, 2)),
        (t.id, span(7, 8, 3)),
    ]


def test_a_dependent_with_no_later_day_reports_its_prerequisite() -> None:
    exam = make_exam(nov(5))
    p = make_task(exam, 60)
    t = make_task(exam, 60, depends_on=p.id)
    pinned = make_block(p, Z(2026, 11, 3, 7), Z(2026, 11, 3, 8), pinned=True)
    result = plan(make_profile(), [exam], [p, t], [pinned], NOW)
    assert [(u.task_id, u.reason, u.blocked_by) for u in result.unscheduled] == [
        (t.id, UnscheduledReason.DEPENDENCY_TOO_LATE, p.id)
    ]


SIMULATION_PAIRS = [
    pytest.param(TaskKind.SIMULATION, TaskKind.REVIEW, id="simulation-prerequisite"),
    pytest.param(TaskKind.LEARN, TaskKind.SIMULATION, id="simulation-dependent"),
]


@pytest.mark.parametrize(("p_kind", "t_kind"), SIMULATION_PAIRS)
def test_a_simulation_pair_waits_a_day_after_a_prerequisite_done_earlier_today(
    p_kind: TaskKind, t_kind: TaskKind
) -> None:
    exam = make_exam(nov(4))  # study days November 1 and 2
    p = make_task(exam, 60, p_kind)
    t = make_task(exam, 60, t_kind, depends_on=p.id)
    done = make_block(p, Z(2026, 11, 1, 6), Z(2026, 11, 1, 7), status=BlockStatus.DONE)
    result = plan(make_profile(), [exam], [p, t], [done], Z(2026, 11, 1, 7, 30))
    assert [(block.task_id, block.interval) for block in result.blocks] == [
        (p.id, span(6, 7)),
        (t.id, span(7, 8, 2)),
    ]
    assert result.unscheduled == ()


@pytest.mark.parametrize(("p_kind", "t_kind"), SIMULATION_PAIRS)
def test_a_simulation_pair_with_no_later_day_after_a_prerequisite_done_today(
    p_kind: TaskKind, t_kind: TaskKind
) -> None:
    exam = make_exam(nov(3))  # one study day, November 1
    p = make_task(exam, 60, p_kind)
    t = make_task(exam, 60, t_kind, depends_on=p.id)
    done = make_block(p, Z(2026, 11, 1, 6), Z(2026, 11, 1, 7), status=BlockStatus.DONE)
    result = plan(make_profile(), [exam], [p, t], [done], Z(2026, 11, 1, 7, 30))
    assert [block.block_id for block in result.blocks] == [done.id]
    assert [(u.task_id, u.reason, u.blocked_by) for u in result.unscheduled] == [
        (t.id, UnscheduledReason.DEPENDENCY_TOO_LATE, p.id)
    ]


def test_a_dependent_spans_the_days_after_its_prerequisite() -> None:
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
    result = plan(profile, [exam], [p, t, x], blocks, NOW)
    assert result.unscheduled == ()
    assert [b.interval for b in result.blocks if b.task_id == t.id] == [
        at(8, 50, 11, 10, 2),
        at(8, 50, 9, 50, 3),
    ]


def test_a_plain_pair_may_share_the_day_of_a_prerequisite_done_earlier_today() -> None:
    exam = make_exam(nov(3))
    p = make_task(exam, 60)
    t = make_task(exam, 60, TaskKind.REVIEW, depends_on=p.id)
    done = make_block(p, Z(2026, 11, 1, 6), Z(2026, 11, 1, 7), status=BlockStatus.DONE)
    result = plan(make_profile(), [exam], [p, t], [done], Z(2026, 11, 1, 7, 30))
    assert [(block.task_id, block.interval) for block in result.blocks] == [
        (p.id, span(6, 7)),
        (t.id, at(7, 30, 8, 30)),
    ]


def test_a_small_remainder_is_five_minutes() -> None:
    exam = make_exam(nov(5))
    a = make_task(exam, 60)
    done = make_block(a, Z(2026, 11, 1, 7), Z(2026, 11, 1, 7, 58), status=BlockStatus.DONE)
    result = plan(make_profile(), [exam], [a], [done], NOW)
    assert [block.interval for block in result.blocks if block.block_id is None] == [
        at(8, 8, 8, 13)
    ]


def test_a_fresh_plan_removes_the_candidates() -> None:
    exam = make_exam(nov(5))
    a = make_task(exam, 60)
    c1 = make_block(a, Z(2026, 11, 1, 10), Z(2026, 11, 1, 11))
    result = plan(make_profile(), [exam], [a], [c1], NOW)
    assert result.removed == (c1.id,)
    assert result.blocks == (
        PlannedBlock(task_id=a.id, interval=span(7, 8), part_index=1, part_count=1),
    )


def test_history_blocks_do_nothing() -> None:
    exam = make_exam(nov(5))
    a = make_task(exam, 60)
    missed = make_block(a, Z(2026, 11, 1, 7), Z(2026, 11, 1, 8), status=BlockStatus.MISSED)
    past = make_block(a, Z(2026, 11, 1, 9), Z(2026, 11, 1, 10))
    result = plan(make_profile(), [exam], [a], [missed, past], Z(2026, 11, 2, 6))
    assert result.removed == ()
    assert result.blocks == (
        PlannedBlock(task_id=a.id, interval=span(7, 8, 2), part_index=1, part_count=1),
    )


def test_a_block_in_progress_stays() -> None:
    exam = make_exam(nov(5))
    a = make_task(exam, 120)
    running = make_block(a, Z(2026, 11, 1, 7), Z(2026, 11, 1, 8))
    result = plan(make_profile(), [exam], [a], [running], Z(2026, 11, 1, 7, 30))
    assert result.blocks == (
        PlannedBlock(
            task_id=a.id, interval=span(7, 8), part_index=1, part_count=2, block_id=running.id
        ),
        PlannedBlock(task_id=a.id, interval=at(8, 10, 9, 10), part_index=2, part_count=2),
    )
    assert result.removed == ()


def test_duplicate_block_ids_are_rejected() -> None:
    exam = make_exam(nov(5))
    a = make_task(exam, 120)
    block_id = uuid4()
    blocks = [
        make_block(a, Z(2026, 11, 1, 7), Z(2026, 11, 1, 8), id=block_id),
        make_block(a, Z(2026, 11, 1, 9), Z(2026, 11, 1, 10), id=block_id),
    ]
    with pytest.raises(PlannerInputError):
        plan(make_profile(), [exam], [a], blocks, NOW)


def test_an_over_budget_simulation_suggests_its_minutes() -> None:
    exam = make_exam(nov(5))
    simulation = make_task(exam, 300, TaskKind.SIMULATION)
    result = plan(make_profile(), [exam], [simulation], [], NOW)
    assert [u.reason for u in result.unscheduled] == [UnscheduledReason.LONGER_THAN_DAILY_MINUTES]
    assert result.shortfalls == (ExamShortfall(exam_id=exam.id, minutes=300, daily_minutes=300),)


def test_a_shortfall_that_more_minutes_cannot_fix() -> None:
    profile = make_profile(study_windows=frozenset({StudyWindow.EVENING}))
    exam = make_exam(nov(3))
    a = make_task(exam, 240)
    b = make_task(exam, 240)
    result = plan(profile, [exam], [a, b], [], NOW)
    assert [(u.task_id, u.reason) for u in result.unscheduled] == [
        (b.id, UnscheduledReason.NOT_ENOUGH_TIME)
    ]
    assert [block.task_id for block in result.blocks] == [a.id]
    assert result.shortfalls == (ExamShortfall(exam_id=exam.id, minutes=240, daily_minutes=None),)


def test_more_minutes_fix_a_shortfall() -> None:
    exam = make_exam(nov(3))
    a = make_task(exam, 150)
    b = make_task(exam, 150)
    result = plan(make_profile(), [exam], [a, b], [], NOW)
    assert [(u.task_id, u.reason) for u in result.unscheduled] == [
        (b.id, UnscheduledReason.NOT_ENOUGH_TIME)
    ]
    assert result.shortfalls == (ExamShortfall(exam_id=exam.id, minutes=150, daily_minutes=300),)


def test_a_cycle_is_not_a_shortfall() -> None:
    exam = make_exam(nov(5))
    a_id, b_id = uuid4(), uuid4()
    a = make_task(exam, 60, id=a_id, depends_on=b_id)
    b = make_task(exam, 60, id=b_id, depends_on=a_id)
    result = plan(make_profile(), [exam], [a, b], [], NOW)
    assert [u.reason for u in result.unscheduled] == [UnscheduledReason.DEPENDENCY_CYCLE] * 2
    assert result.shortfalls == ()


def test_tasks_that_wait_on_a_cycle_are_not_a_shortfall() -> None:
    exam = make_exam(nov(3))
    a_id, b_id = uuid4(), uuid4()
    a = make_task(exam, 30, id=a_id, depends_on=b_id)
    b = make_task(exam, 30, id=b_id, depends_on=a_id)
    c = make_task(exam, 30, depends_on=a_id)
    d = make_task(exam, 150)
    e = make_task(exam, 150)
    result = plan(make_profile(), [exam], [a, b, c, d, e], [], NOW)
    assert [(u.task_id, u.reason) for u in result.unscheduled] == [
        (a.id, UnscheduledReason.DEPENDENCY_CYCLE),
        (b.id, UnscheduledReason.DEPENDENCY_CYCLE),
        (c.id, UnscheduledReason.DEPENDENCY_NOT_SCHEDULED),
        (e.id, UnscheduledReason.NOT_ENOUGH_TIME),
    ]
    assert result.shortfalls == (ExamShortfall(exam_id=exam.id, minutes=150, daily_minutes=300),)


def test_an_exam_without_study_days_has_no_suggestion() -> None:
    exam = make_exam(nov(1))  # its last study day is before now
    task = make_task(exam, 90)
    result = plan(make_profile(), [exam], [task], [], NOW)
    assert result.shortfalls == (ExamShortfall(exam_id=exam.id, minutes=90, daily_minutes=None),)


def test_an_exam_no_budget_can_fix_costs_no_trial_runs(monkeypatch: pytest.MonkeyPatch) -> None:
    module = importlib.import_module("app.domain.planner.plan")
    real = module.assign_days
    calls: list[int] = []

    def counting(*args: Any, **kwargs: Any) -> Any:
        calls.append(1)
        return real(*args, **kwargs)

    monkeypatch.setattr(module, "assign_days", counting)
    exam = make_exam(nov(1))
    result = plan(make_profile(), [exam], [make_task(exam, 90)], [], NOW)
    assert result.shortfalls == (ExamShortfall(exam_id=exam.id, minutes=90, daily_minutes=None),)
    assert len(calls) == 1


def test_shortfalls_follow_the_exam_order() -> None:
    fixable = make_exam(nov(3))
    hopeless = make_exam(nov(3))
    tasks = [
        make_task(hopeless, 480),
        make_task(hopeless, 480),
        make_task(fixable, 150),
        make_task(fixable, 150),
    ]
    result = plan(make_profile(), [hopeless, fixable], tasks, [], NOW)
    assert [(s.exam_id, s.daily_minutes) for s in result.shortfalls] == [
        (hopeless.id, None),
        (fixable.id, 300),
    ]
    reverse = plan(make_profile(), [fixable, hopeless], tasks, [], NOW)
    assert [s.exam_id for s in reverse.shortfalls] == [fixable.id, hopeless.id]


def test_the_largest_suggestion_is_960() -> None:
    profile = make_profile(
        wake_time=time(6, 0), sleep_time=time(2, 0), study_windows=frozenset(StudyWindow)
    )
    exam = make_exam(nov(3))
    a = make_task(exam, 480)
    b = make_task(exam, 480)
    result = plan(profile, [exam], [a, b], [], NOW)
    assert result.shortfalls == (ExamShortfall(exam_id=exam.id, minutes=960, daily_minutes=960),)


def test_a_budget_off_the_step_starts_the_sweep_at_the_next_step() -> None:
    exam = make_exam(nov(3))
    a = make_task(exam, 60)
    b = make_task(exam, 60)
    result = plan(make_profile(daily_study_minutes=100), [exam], [a, b], [], NOW)
    assert [u.task_id for u in result.unscheduled] == [b.id]
    assert result.shortfalls == (ExamShortfall(exam_id=exam.id, minutes=60, daily_minutes=120),)


def test_rejects_what_is_not_an_existing_block() -> None:
    exam = make_exam(nov(5))
    with pytest.raises(PlannerInputError):
        plan(make_profile(), [exam], [], [span(7, 8)], NOW)  # type: ignore[list-item]


def test_same_input_same_output() -> None:
    exam = make_exam(nov(5))
    tasks = [make_task(exam, 300)]
    assert plan(make_profile(), [exam], tasks, [], NOW) == plan(
        make_profile(), [exam], tasks, [], NOW
    )
