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
    UnscheduledReason,
    plan,
)
from tests.planner.factories import NOW, make_exam, make_profile, make_task

# make_profile(): one window, 07:00Z-15:00Z (480 minutes), and a budget of 240.
# An exam on November 5 has study days November 1-3 (one rest day).


def Z(y: int, mo: int, d: int, h: int, mi: int = 0) -> datetime:
    return datetime(y, mo, d, h, mi, tzinfo=UTC)


def nov(day: int) -> date:
    return date(2026, 11, day)


def span(start_hour: int, end_hour: int, day: int = 1) -> Interval:
    return Interval(Z(2026, 11, day, start_hour), Z(2026, 11, day, end_hour))


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
            id=uuid4(),
            task_id=other,
            interval=span(9, 10),
            status=BlockStatus.PLANNED,
            pinned=False,
        ),
        ExistingBlock(
            id=uuid4(),
            task_id=other,
            interval=span(10, 11),
            status=BlockStatus.MISSED,
            pinned=False,
        ),
    ]
    result = plan(make_profile(), [exam], [a], existing, NOW)
    assert result.blocks == (
        PlannedBlock(task_id=a.id, interval=span(9, 11), part_index=1, part_count=1),
    )


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
