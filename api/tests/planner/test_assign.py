from collections.abc import Callable, Sequence
from datetime import UTC, date, datetime, time
from uuid import uuid4

import pytest

from app.domain.planner import (
    DayAssignment,
    Exam,
    PlannerInputError,
    PlanWarning,
    Profile,
    StudyWindow,
    Task,
    TaskKind,
    TaskStatus,
    Unscheduled,
    UnscheduledReason,
    WarningCode,
    assign_days,
    resolve_dependencies,
)
from tests.planner.factories import NOW, NY, by_day, make_exam, make_profile, make_task

# make_profile(): one window, 07:00Z-15:00Z (480 minutes), and a budget of 240.
# An exam on November 5 has study days November 1-3 (one rest day).


def Z(y: int, mo: int, d: int, h: int, mi: int = 0) -> datetime:
    return datetime(y, mo, d, h, mi, tzinfo=UTC)


def nov(day: int) -> date:
    return date(2026, 11, day)


def assign(
    exams: Sequence[Exam],
    tasks: Sequence[Task],
    now: datetime = NOW,
    profile: Profile | None = None,
) -> DayAssignment:
    return assign_days(profile or make_profile(), exams, tasks, now)


def unscheduled(
    task: Task, reason: UnscheduledReason, blocked_by: Task | None = None
) -> Unscheduled:
    return Unscheduled(
        task_id=task.id,
        minutes=task.estimated_minutes,
        reason=reason,
        blocked_by=None if blocked_by is None else blocked_by.id,
    )


def test_tasks_fill_days_within_the_budget() -> None:
    exam = make_exam(nov(5))
    t1, t2, t3 = (make_task(exam, 120) for _ in range(3))
    result = assign([exam], [t1, t2, t3])
    assert by_day(result) == {
        nov(1): [(t1.id, 120), (t2.id, 120)],
        nov(2): [(t3.id, 120)],
    }
    assert result.unscheduled == ()


def test_learning_and_review_before_practice() -> None:
    exam = make_exam(nov(5))
    practice = make_task(exam, 60, TaskKind.PRACTICE)
    learn = make_task(exam, 60)
    review = make_task(exam, 60, TaskKind.REVIEW)
    result = assign([exam], [practice, learn, review])
    assert by_day(result) == {nov(1): [(learn.id, 60), (review.id, 60), (practice.id, 60)]}


def test_earliest_exam_first() -> None:
    a = make_exam(nov(10), difficulty=1)
    b = make_exam(nov(5), difficulty=5)
    ta, tb = make_task(a, 240), make_task(b, 240)
    result = assign([a, b], [ta, tb])
    assert by_day(result) == {nov(1): [(tb.id, 240)], nov(2): [(ta.id, 240)]}


def test_difficulty_breaks_ties() -> None:
    a = make_exam(nov(5), difficulty=2)
    b = make_exam(nov(5), difficulty=4)
    ta, tb = make_task(a, 240), make_task(b, 240)
    result = assign([a, b], [ta, tb])
    assert by_day(result) == {nov(1): [(tb.id, 240)], nov(2): [(ta.id, 240)]}


def _two_exams() -> tuple[list[Exam], list[Task], list[Task], list[Task]]:
    """Exam A on November 5 and B on November 8, four 120-minute tasks each, interleaved."""
    a, b = make_exam(nov(5)), make_exam(nov(8))
    a_tasks = [make_task(a, 120) for _ in range(4)]
    b_tasks = [make_task(b, 120) for _ in range(4)]
    tasks = [task for pair in zip(b_tasks, a_tasks, strict=True) for task in pair]
    return [b, a], tasks, a_tasks, b_tasks


def test_a_day_belongs_to_one_exam() -> None:
    exams, tasks, (a1, a2, a3, a4), (b1, b2, b3, b4) = _two_exams()
    result = assign(exams, tasks)
    assert by_day(result) == {
        nov(1): [(a1.id, 120), (a2.id, 120)],
        nov(2): [(a3.id, 120), (a4.id, 120)],
        nov(3): [(b1.id, 120), (b2.id, 120)],
        nov(4): [(b3.id, 120), (b4.id, 120)],
    }
    assert result.unscheduled == ()


def test_smaller_task_fills_the_rest_of_the_day() -> None:
    a, b = make_exam(nov(5)), make_exam(nov(8))
    a1, a2, small = make_task(a, 180), make_task(a, 180), make_task(b, 60)
    result = assign([a, b], [a1, a2, small])
    assert by_day(result) == {
        nov(1): [(a1.id, 180), (small.id, 60)],
        nov(2): [(a2.id, 180)],
    }


def test_task_longer_than_a_day_spans_days() -> None:
    exam = make_exam(nov(5))
    task = make_task(exam, 600, TaskKind.CUSTOM)
    result = assign([exam], [task])
    assert by_day(result) == {
        nov(1): [(task.id, 240)],
        nov(2): [(task.id, 240)],
        nov(3): [(task.id, 120)],
    }
    assert result.unscheduled == ()


def test_last_part_is_at_least_30_minutes() -> None:
    exam = make_exam(nov(5))
    task = make_task(exam, 500, TaskKind.CUSTOM)
    result = assign([exam], [task])
    assert by_day(result) == {
        nov(1): [(task.id, 240)],
        nov(2): [(task.id, 230)],
        nov(3): [(task.id, 30)],
    }


def test_long_task_is_all_or_nothing() -> None:
    exam = make_exam(nov(4))
    task = make_task(exam, 600, TaskKind.CUSTOM)
    result = assign([exam], [task])
    assert [plan.day.date for plan in result.days] == [nov(1), nov(2)]
    assert by_day(result) == {}
    assert result.unscheduled == (unscheduled(task, UnscheduledReason.NOT_ENOUGH_TIME),)


def test_failed_long_task_frees_its_days() -> None:
    exam = make_exam(nov(4))  # study days November 1-2
    long = make_task(exam, 600, TaskKind.CUSTOM)
    practice = make_task(exam, 60, TaskKind.PRACTICE)
    after = make_task(exam, 60, depends_on=long.id)
    result = assign([exam], [long, practice, after])
    assert by_day(result) == {nov(1): [(practice.id, 60)]}
    assert result.unscheduled == (
        unscheduled(long, UnscheduledReason.NOT_ENOUGH_TIME),
        unscheduled(after, UnscheduledReason.DEPENDENCY_NOT_SCHEDULED, blocked_by=long),
    )


def test_only_the_first_failed_long_task_is_dropped() -> None:
    a = make_exam(nov(4))  # study days November 1-2
    b = make_exam(nov(6))  # study days November 1-4
    long_a = make_task(a, 600, TaskKind.CUSTOM)
    long_b = make_task(b, 600, TaskKind.CUSTOM)
    # First run: A takes November 1-2 and fails, so B starts on November 3 and fails too.
    result = assign([a, b], [long_a, long_b])
    assert by_day(result) == {
        nov(1): [(long_b.id, 240)],
        nov(2): [(long_b.id, 240)],
        nov(3): [(long_b.id, 120)],
    }
    assert result.unscheduled == (unscheduled(long_a, UnscheduledReason.NOT_ENOUGH_TIME),)


def test_a_later_exams_long_task_does_not_take_an_earlier_exams_day() -> None:
    a = make_exam(nov(4))  # study days November 1-2
    b = make_exam(nov(10))  # study days November 1-8
    a1, a2 = make_task(a, 200), make_task(a, 240)
    long_b = make_task(b, 600, TaskKind.CUSTOM)
    result = assign([a, b], [a1, a2, long_b])
    # B's long task starts in what is left of November 1, but on November 2 A's
    # task goes first, and B goes on after A's last day.
    assert by_day(result) == {
        nov(1): [(a1.id, 200), (long_b.id, 40)],
        nov(2): [(a2.id, 240)],
        nov(3): [(long_b.id, 240)],
        nov(4): [(long_b.id, 240)],
        nov(5): [(long_b.id, 80)],
    }
    assert result.unscheduled == ()


def test_the_failed_long_task_of_the_earliest_exam_is_dropped() -> None:
    a = make_exam(nov(4))  # study days November 1-2
    b = make_exam(nov(5))  # study days November 1-3
    simulation = make_task(a, 60, TaskKind.SIMULATION)
    long_a = make_task(a, 600, TaskKind.CUSTOM, depends_on=simulation.id)
    long_b = make_task(b, 600, TaskKind.CUSTOM)
    result = assign([a, b], [simulation, long_a, long_b])
    # First run: B's long task starts first, on November 1, since A's waits for the
    # simulation. On November 2 A's goes first, and both fail. A's is dropped, as
    # it is of the earlier exam, and B's then fits.
    assert by_day(result) == {
        nov(1): [(simulation.id, 60), (long_b.id, 180)],
        nov(2): [(long_b.id, 240)],
        nov(3): [(long_b.id, 180)],
    }
    assert result.unscheduled == (unscheduled(long_a, UnscheduledReason.NOT_ENOUGH_TIME),)


def test_dependent_comes_after_its_prerequisite() -> None:
    exam = make_exam(nov(5))
    a = make_task(exam, 60)
    b = make_task(exam, 60, depends_on=a.id)
    result = assign([exam], [b, a])
    assert by_day(result) == {nov(1): [(a.id, 60), (b.id, 60)]}


@pytest.mark.parametrize(
    "status",
    [
        pytest.param(TaskStatus.DONE, id="done"),
        pytest.param(TaskStatus.SKIPPED, id="skipped"),
        pytest.param(None, id="missing"),
    ],
)
def test_done_skipped_or_missing_prerequisite_does_not_block(status: TaskStatus | None) -> None:
    exam = make_exam(nov(5))
    others = [] if status is None else [make_task(exam, 60, status=status)]
    prerequisite = others[0].id if others else uuid4()
    b = make_task(exam, 60, depends_on=prerequisite)
    result = assign([exam], [*others, b])
    assert by_day(result) == {nov(1): [(b.id, 60)]}
    assert result.unscheduled == ()


def test_dependency_cycle() -> None:
    exam = make_exam(nov(5))
    a_id, b_id = uuid4(), uuid4()
    a = make_task(exam, 60, id=a_id, depends_on=b_id)
    b = make_task(exam, 60, id=b_id, depends_on=a_id)
    c = make_task(exam, 60, depends_on=a_id)
    result = assign([exam], [a, b, c])
    assert by_day(result) == {}
    assert result.unscheduled == (
        unscheduled(a, UnscheduledReason.DEPENDENCY_CYCLE),
        unscheduled(b, UnscheduledReason.DEPENDENCY_CYCLE),
        unscheduled(c, UnscheduledReason.DEPENDENCY_NOT_SCHEDULED, blocked_by=a),
    )


def test_prerequisite_finished_too_late() -> None:
    y = make_exam(nov(3))  # one study day, November 1
    x = make_exam(nov(10))
    q = make_task(y, 240)
    p = make_task(x, 60)
    t = make_task(y, 60, depends_on=p.id)
    result = assign([y, x], [q, t, p])
    assert by_day(result) == {nov(1): [(q.id, 240)], nov(2): [(p.id, 60)]}
    assert result.unscheduled == (
        unscheduled(t, UnscheduledReason.DEPENDENCY_TOO_LATE, blocked_by=p),
    )


def test_exam_without_study_days() -> None:
    exam = make_exam(nov(2))  # tomorrow, and the rest day is today
    task = make_task(exam, 60)
    result = assign([exam], [task])
    assert result.days == ()
    assert result.unscheduled == (unscheduled(task, UnscheduledReason.NO_STUDY_DAYS),)
    assert result.warnings == ()


def test_more_work_than_time() -> None:
    exam = make_exam(nov(3))  # one study day
    t1, t2, t3, t4 = (make_task(exam, 120) for _ in range(4))
    result = assign([exam], [t1, t2, t3, t4])
    assert by_day(result) == {nov(1): [(t1.id, 120), (t2.id, 120)]}
    assert result.unscheduled == (
        unscheduled(t3, UnscheduledReason.NOT_ENOUGH_TIME),
        unscheduled(t4, UnscheduledReason.NOT_ENOUGH_TIME),
    )


def test_today_after_all_windows_starts_tomorrow() -> None:
    exam = make_exam(nov(5))
    t1, t2 = make_task(exam, 240), make_task(exam, 240)
    result = assign([exam], [t1, t2], now=Z(2026, 11, 1, 16))
    assert by_day(result) == {nov(2): [(t1.id, 240)], nov(3): [(t2.id, 240)]}
    today = result.days[0]
    assert today.day.date == nov(1)
    assert today.day.windows == ()
    assert today.items == ()


def test_today_starts_at_now() -> None:
    exam = make_exam(nov(5))
    t1, t2 = make_task(exam, 120), make_task(exam, 120)
    result = assign([exam], [t1, t2], now=Z(2026, 11, 1, 12))  # 180 minutes left today
    assert by_day(result) == {nov(1): [(t1.id, 120)], nov(2): [(t2.id, 120)]}


def test_user_in_another_timezone() -> None:
    exam = make_exam(nov(4))
    task = make_task(exam, 120)
    # 22:00 on November 1 in New York, after that day's windows.
    result = assign([exam], [task], now=Z(2026, 11, 2, 3), profile=make_profile(timezone=NY))
    assert by_day(result) == {nov(2): [(task.id, 120)]}


def test_windows_outside_waking_hours() -> None:
    profile = make_profile(sleep_time=time(11), study_windows=frozenset({StudyWindow.EVENING}))
    exam = make_exam(nov(5))
    task = make_task(exam, 60)
    result = assign([exam], [task], profile=profile)
    assert result.unscheduled == (unscheduled(task, UnscheduledReason.NO_STUDY_DAYS),)
    assert result.warnings == (PlanWarning(code=WarningCode.NO_STUDY_TIME),)


def test_done_and_skipped_tasks_are_ignored() -> None:
    exam = make_exam(nov(5))
    done = make_task(exam, 60, status=TaskStatus.DONE)
    skipped = make_task(exam, 60, status=TaskStatus.SKIPPED)
    result = assign([exam], [done, skipped])
    assert by_day(result) == {}
    assert result.unscheduled == ()
    assert result.warnings == ()


def _duplicate_task_id() -> tuple[list[Exam], list[Task], datetime]:
    exam = make_exam(nov(5))
    task = make_task(exam, 60)
    return [exam], [task, make_task(exam, 30, id=task.id)], NOW


def _duplicate_exam_id() -> tuple[list[Exam], list[Task], datetime]:
    exam = make_exam(nov(5))
    twin = Exam(id=exam.id, exam_date=nov(8), difficulty=3)
    return [exam, twin], [make_task(exam, 60)], NOW


def _unknown_exam() -> tuple[list[Exam], list[Task], datetime]:
    return [make_exam(nov(5))], [make_task(make_exam(nov(8)), 60)], NOW


def _naive_now() -> tuple[list[Exam], list[Task], datetime]:
    return [], [], datetime(2026, 11, 1, 5)


@pytest.mark.parametrize(
    ("build", "error"),
    [
        pytest.param(_duplicate_task_id, PlannerInputError, id="duplicate-task-id"),
        pytest.param(_duplicate_exam_id, PlannerInputError, id="duplicate-exam-id"),
        pytest.param(_unknown_exam, PlannerInputError, id="unknown-exam"),
        pytest.param(_naive_now, PlannerInputError, id="naive-now"),
    ],
)
def test_invalid_input(
    build: Callable[[], tuple[list[Exam], list[Task], datetime]], error: type[ValueError]
) -> None:
    exams, tasks, now = build()
    with pytest.raises(error):
        assign(exams, tasks, now=now)


def test_same_input_same_output() -> None:
    exams, tasks, _, _ = _two_exams()
    assert assign(exams, tasks) == assign(exams, tasks)


def test_resolve_dependencies() -> None:
    exam = make_exam(nov(5))

    # A chain: B depends on A, C depends on B.
    a = make_task(exam, 60)
    b = make_task(exam, 60, depends_on=a.id)
    c = make_task(exam, 60, depends_on=b.id)
    chain = resolve_dependencies([a, b, c])
    assert chain.prerequisite == {b.id: a.id, c.id: b.id}
    assert chain.in_cycle == frozenset()

    # B depends on A, which is done.
    done = make_task(exam, 60, status=TaskStatus.DONE)
    after_done = make_task(exam, 60, depends_on=done.id)
    finished = resolve_dependencies([done, after_done])
    assert finished.prerequisite == {}
    assert finished.in_cycle == frozenset()

    # X -> Y -> Z -> X is a cycle; W depends on X, so it leads into the cycle.
    x_id, y_id, z_id = uuid4(), uuid4(), uuid4()
    x = make_task(exam, 60, id=x_id, depends_on=y_id)
    y = make_task(exam, 60, id=y_id, depends_on=z_id)
    z = make_task(exam, 60, id=z_id, depends_on=x_id)
    w = make_task(exam, 60, depends_on=x_id)
    cycle = resolve_dependencies([w, x, y, z])
    assert cycle.prerequisite == {w.id: x_id, x_id: y_id, y_id: z_id, z_id: x_id}
    assert cycle.in_cycle == frozenset({x_id, y_id, z_id})
