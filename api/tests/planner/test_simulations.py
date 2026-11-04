from collections.abc import Sequence
from datetime import UTC, date, datetime

import pytest

from app.domain.planner import (
    DayAssignment,
    Exam,
    Interval,
    Profile,
    StudyWindow,
    Task,
    TaskKind,
    TaskStatus,
    Unscheduled,
    UnscheduledReason,
    assign_days,
)
from tests.planner.factories import NOW, by_day, make_exam, make_profile, make_task

# make_profile(): one window, 07:00Z-15:00Z (480 minutes), and a budget of 240.
# An exam on November 5 has study days November 1-3 (one rest day).


def Z(y: int, mo: int, d: int, h: int, mi: int = 0) -> datetime:
    return datetime(y, mo, d, h, mi, tzinfo=UTC)


def nov(day: int) -> date:
    return date(2026, 11, day)


def sim(exam: Exam, minutes: int) -> Task:
    return make_task(exam, minutes, TaskKind.SIMULATION)


def rev(exam: Exam, minutes: int, simulation: Task) -> Task:
    return make_task(exam, minutes, TaskKind.SIMULATION_REVIEW, depends_on=simulation.id)


def assign(
    exams: Sequence[Exam],
    tasks: Sequence[Task],
    profile: Profile | None = None,
    busy: Sequence[Interval] = (),
) -> DayAssignment:
    return assign_days(profile or make_profile(), exams, tasks, NOW, busy)


def unscheduled(
    task: Task, reason: UnscheduledReason, blocked_by: Task | None = None
) -> Unscheduled:
    return Unscheduled(
        task_id=task.id,
        minutes=task.estimated_minutes,
        reason=reason,
        blocked_by=None if blocked_by is None else blocked_by.id,
    )


def test_simulations_spread_and_the_last_is_before_rest() -> None:
    exam = make_exam(nov(21))  # study days November 1-19
    s1, s2, s3 = (sim(exam, 180) for _ in range(3))
    r1, r2, r3 = rev(exam, 60, s1), rev(exam, 60, s2), rev(exam, 60, s3)
    result = assign([exam], [s1, s2, s3, r1, r2, r3])
    assert by_day(result) == {
        nov(6): [(s1.id, 180)],
        nov(7): [(r1.id, 60)],
        nov(12): [(s2.id, 180)],
        nov(13): [(r2.id, 60)],
        nov(18): [(s3.id, 180)],
        nov(19): [(r3.id, 60)],
    }
    assert result.unscheduled == ()


def test_one_simulation_per_day() -> None:
    a, b = make_exam(nov(5)), make_exam(nov(5))
    sa, sb = sim(a, 120), sim(b, 120)
    result = assign([a, b], [sa, sb])
    # Both aim at November 3; A ranks first, so B looks back and takes November 2.
    assert by_day(result) == {nov(2): [(sb.id, 120)], nov(3): [(sa.id, 120)]}
    assert result.unscheduled == ()


def test_two_simulations_one_day() -> None:
    exam = make_exam(nov(3))  # one study day, November 1
    s1, s2 = sim(exam, 60), sim(exam, 60)
    result = assign([exam], [s1, s2])
    assert by_day(result) == {nov(1): [(s1.id, 60)]}
    assert result.unscheduled == (unscheduled(s2, UnscheduledReason.NOT_ENOUGH_TIME),)


def test_review_skips_a_day_without_time() -> None:
    exam = make_exam(nov(9))  # study days November 1-7
    simulation = sim(exam, 180)
    review = rev(exam, 60, simulation)
    busy = [Interval(Z(2026, 11, 6, 7), Z(2026, 11, 6, 15))]  # all of November 6
    result = assign([exam], [simulation, review], busy=busy)
    assert by_day(result) == {nov(5): [(simulation.id, 180)], nov(7): [(review.id, 60)]}
    assert result.unscheduled == ()


@pytest.mark.parametrize(
    ("minutes", "reason"),
    [
        pytest.param(200, None, id="the-evening-holds-it"),
        pytest.param(250, UnscheduledReason.NO_CONTIGUOUS_WINDOW, id="no-window-holds-it"),
    ],
)
def test_simulation_needs_one_long_window(minutes: int, reason: UnscheduledReason | None) -> None:
    # Morning 07:00Z-10:00Z (180 minutes) and evening 15:00Z-19:00Z (240 minutes).
    profile = make_profile(
        study_windows=frozenset({StudyWindow.MORNING, StudyWindow.EVENING}),
        daily_study_minutes=300,
    )
    exam = make_exam(nov(3))
    simulation = sim(exam, minutes)
    result = assign([exam], [simulation], profile=profile)
    if reason is None:
        assert by_day(result) == {nov(1): [(simulation.id, minutes)]}
        assert result.unscheduled == ()
    else:
        assert by_day(result) == {}
        assert result.unscheduled == (unscheduled(simulation, reason),)


def test_simulation_longer_than_the_daily_budget() -> None:
    exam = make_exam(nov(5))
    simulation = sim(exam, 300)
    result = assign([exam], [simulation])
    assert by_day(result) == {}
    assert result.unscheduled == (unscheduled(simulation, UnscheduledReason.NO_CONTIGUOUS_WINDOW),)


def test_simulation_is_never_split() -> None:
    exam = make_exam(nov(5))
    simulation = sim(exam, 300)
    result = assign([exam], [simulation], profile=make_profile(daily_study_minutes=300))
    # The only simulation, without a review, aims at the last study day.
    assert by_day(result) == {nov(3): [(simulation.id, 300)]}
    assert result.unscheduled == ()


def test_simulation_comes_first_and_shares_the_day() -> None:
    exam = make_exam(nov(3))
    l1, l2, simulation = make_task(exam, 60), make_task(exam, 60), sim(exam, 120)
    result = assign([exam], [l1, l2, simulation])
    assert by_day(result) == {nov(1): [(simulation.id, 120), (l1.id, 60), (l2.id, 60)]}
    assert result.unscheduled == ()


def test_review_of_a_done_simulation_comes_first() -> None:
    exam = make_exam(nov(5))
    learn = make_task(exam, 60)
    done = make_task(exam, 180, TaskKind.SIMULATION, status=TaskStatus.DONE)
    review = rev(exam, 60, done)
    result = assign([exam], [learn, done, review])
    assert by_day(result) == {nov(1): [(review.id, 60), (learn.id, 60)]}
    assert result.unscheduled == ()


def test_review_without_a_day_after_the_simulation() -> None:
    exam = make_exam(nov(3))  # one study day, November 1
    simulation = sim(exam, 120)
    review = rev(exam, 60, simulation)
    result = assign([exam], [simulation, review])
    assert by_day(result) == {nov(1): [(simulation.id, 120)]}
    assert result.unscheduled == (
        unscheduled(review, UnscheduledReason.DEPENDENCY_TOO_LATE, blocked_by=simulation),
    )


def test_crowded_period_falls_back_to_the_last_day() -> None:
    exam = make_exam(nov(5))  # study days November 1-3
    s1, s2, s3 = (sim(exam, 180) for _ in range(3))
    r1, r2, r3 = rev(exam, 60, s1), rev(exam, 60, s2), rev(exam, 60, s3)
    result = assign([exam], [s1, s2, s3, r1, r2, r3])
    # The targets are November 1, 2 and 2. The third finds November 2 taken, and
    # November 1 behind it too, so it takes the last day, kept for the reviews.
    assert by_day(result) == {
        nov(1): [(s1.id, 180)],
        nov(2): [(s2.id, 180), (r1.id, 60)],
        nov(3): [(s3.id, 180), (r2.id, 60)],
    }
    assert result.unscheduled == (
        unscheduled(r3, UnscheduledReason.DEPENDENCY_TOO_LATE, blocked_by=s3),
    )


def test_simulation_waits_for_its_prerequisite() -> None:
    exam = make_exam(nov(6))  # study days November 1-4
    long = make_task(exam, 400, TaskKind.CUSTOM)
    s1 = make_task(exam, 120, TaskKind.SIMULATION, depends_on=long.id)
    s2 = sim(exam, 120)
    result = assign([exam], [long, s1, s2])
    # S1 is kept for November 2, but the long task only ends that day, and a
    # simulation is ready only on a day after its prerequisite's last day. S1 waits
    # for the next day that no simulation is kept for.
    assert by_day(result) == {
        nov(1): [(long.id, 240)],
        nov(2): [(long.id, 160)],
        nov(3): [(s1.id, 120)],
        nov(4): [(s2.id, 120)],
    }
    assert result.unscheduled == ()


def _morning_and_evening() -> Profile:
    """Morning 07:00Z-10:00Z (180 minutes), evening 15:00Z-19:00Z (240), budget 300."""
    return make_profile(
        study_windows=frozenset({StudyWindow.MORNING, StudyWindow.EVENING}),
        daily_study_minutes=300,
    )


def test_dependent_of_a_simulation_goes_on_a_later_day() -> None:
    # Packing puts the simulation at the start of the evening, the smallest window
    # that holds it, so the practice could only go in the morning, before it.
    exam = make_exam(nov(5))  # study days November 1-3
    simulation = sim(exam, 200)
    practice = make_task(exam, 60, TaskKind.PRACTICE, depends_on=simulation.id)
    result = assign([exam], [simulation, practice], profile=_morning_and_evening())
    # The practice waits for the simulation, so the simulation keeps the last day free.
    assert by_day(result) == {nov(2): [(simulation.id, 200)], nov(3): [(practice.id, 60)]}
    assert result.unscheduled == ()


def test_dependent_of_a_simulation_without_a_later_day() -> None:
    exam = make_exam(nov(3))  # one study day, November 1
    simulation = sim(exam, 200)
    practice = make_task(exam, 60, TaskKind.PRACTICE, depends_on=simulation.id)
    result = assign([exam], [simulation, practice], profile=_morning_and_evening())
    assert by_day(result) == {nov(1): [(simulation.id, 200)]}
    assert result.unscheduled == (
        unscheduled(practice, UnscheduledReason.DEPENDENCY_TOO_LATE, blocked_by=simulation),
    )


def test_simulation_whose_prerequisite_ends_on_the_last_day() -> None:
    exam = make_exam(nov(3))  # one study day, November 1
    learn = make_task(exam, 60)
    simulation = make_task(exam, 120, TaskKind.SIMULATION, depends_on=learn.id)
    result = assign([exam], [learn, simulation])
    # The simulation goes first in its day, so a prerequisite on that day is too late.
    assert by_day(result) == {nov(1): [(learn.id, 60)]}
    assert result.unscheduled == (
        unscheduled(simulation, UnscheduledReason.DEPENDENCY_TOO_LATE, blocked_by=learn),
    )


def test_a_later_exams_review_waits_for_an_earlier_exam() -> None:
    a = make_exam(nov(3))  # one study day, November 1
    b = make_exam(nov(10))
    learn = make_task(a, 240)
    done = make_task(b, 180, TaskKind.SIMULATION, status=TaskStatus.DONE)
    review = rev(b, 60, done)
    result = assign([a, b], [learn, done, review])
    assert by_day(result) == {nov(1): [(learn.id, 240)], nov(2): [(review.id, 60)]}
    assert result.unscheduled == ()


def test_review_goes_before_its_exams_started_and_other_tasks() -> None:
    exam = make_exam(nov(4))  # study days November 1-2
    simulation = sim(exam, 60)
    review = rev(exam, 60, simulation)
    long = make_task(exam, 300, TaskKind.CUSTOM)
    practice = make_task(exam, 60, TaskKind.PRACTICE)
    result = assign([exam], [simulation, review, long, practice])
    assert by_day(result) == {
        nov(1): [(simulation.id, 60), (long.id, 180)],
        nov(2): [(review.id, 60), (long.id, 120), (practice.id, 60)],
    }
    assert result.unscheduled == ()


def test_reviews_of_two_exams_go_by_rank() -> None:
    a, b = make_exam(nov(5)), make_exam(nov(8))
    done_a = make_task(a, 180, TaskKind.SIMULATION, status=TaskStatus.DONE)
    done_b = make_task(b, 180, TaskKind.SIMULATION, status=TaskStatus.DONE)
    review_a, review_b = rev(a, 60, done_a), rev(b, 60, done_b)
    result = assign([b, a], [done_b, review_b, done_a, review_a])
    assert by_day(result) == {nov(1): [(review_a.id, 60), (review_b.id, 60)]}
    assert result.unscheduled == ()


def test_the_days_own_simulation_goes_before_a_waiting_one() -> None:
    exam = make_exam(nov(6))  # study days November 1-4
    long = make_task(exam, 400, TaskKind.CUSTOM)
    s1 = make_task(exam, 120, TaskKind.SIMULATION, depends_on=long.id)
    s2 = sim(exam, 120)
    r2 = rev(exam, 60, s2)
    result = assign([exam], [long, s1, s2, r2])
    # S1 is kept for November 2 and S2 for November 3. The long task ends on
    # November 2, so S1 waits, and on November 3 the day's own S2 goes first.
    assert by_day(result) == {
        nov(1): [(long.id, 240)],
        nov(2): [(long.id, 160)],
        nov(3): [(s2.id, 120)],
        nov(4): [(s1.id, 120), (r2.id, 60)],
    }
    assert result.unscheduled == ()


def test_the_next_waiting_simulation_is_tried() -> None:
    exam = make_exam(nov(9))  # study days November 1-7
    long = make_task(exam, 600, TaskKind.CUSTOM)
    w1 = make_task(exam, 120, TaskKind.SIMULATION, depends_on=long.id)
    w2 = make_task(exam, 60, TaskKind.SIMULATION, depends_on=long.id)
    s3 = sim(exam, 60)
    r3 = rev(exam, 30, s3)
    # November 5 keeps only 07:00Z-08:30Z (90 minutes): too short for W1.
    busy = [Interval(Z(2026, 11, 5, 8, 30), Z(2026, 11, 5, 15))]
    result = assign(
        [exam], [long, w1, w2, s3, r3], profile=make_profile(daily_study_minutes=150), busy=busy
    )
    # W1 is kept for November 2 and W2 for November 4, but the long task ends on
    # November 4. On November 5 W1 waits first and does not fit, so W2 goes.
    assert by_day(result) == {
        nov(1): [(long.id, 150)],
        nov(2): [(long.id, 150)],
        nov(3): [(long.id, 150)],
        nov(4): [(long.id, 150)],
        nov(5): [(w2.id, 60)],
        nov(6): [(s3.id, 60)],
        nov(7): [(w1.id, 120), (r3.id, 30)],
    }
    assert result.unscheduled == ()
