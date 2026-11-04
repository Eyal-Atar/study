from datetime import UTC, date, datetime
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
        ExistingBlock(task_id=other, interval=span(7, 9), status=BlockStatus.DONE, pinned=False),
        ExistingBlock(
            task_id=other, interval=span(13, 15), status=BlockStatus.PLANNED, pinned=True
        ),
        ExistingBlock(
            task_id=other, interval=span(9, 10), status=BlockStatus.PLANNED, pinned=False
        ),
        ExistingBlock(
            task_id=other, interval=span(10, 11), status=BlockStatus.MISSED, pinned=False
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
