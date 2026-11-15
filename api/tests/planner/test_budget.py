from datetime import UTC, date, datetime, time
from typing import Any
from zoneinfo import ZoneInfo

from hypothesis import given

from app.domain.planner import Profile, StudyWindow, exam_budgets, study_days
from tests.planner.factories import make_exam, make_profile
from tests.planner.strategies import PROPERTY_SETTINGS, PlannerInputs, planner_inputs

# Monday 2026-11-16 05:00 UTC, like tests/api/factories.py:NOW.
MONDAY_NOW = datetime(2026, 11, 16, 5, 0, tzinfo=UTC)
MON, TUE, WED, THU, FRI = (date(2026, 11, d) for d in (16, 17, 18, 19, 20))


def profile(**overrides: Any) -> Profile:
    fields: dict[str, Any] = {
        "timezone": ZoneInfo("UTC"),
        "wake_time": time(6, 0),
        "sleep_time": time(23, 0),
        "study_windows": frozenset({StudyWindow.MORNING, StudyWindow.AFTERNOON}),
        "rest_days_before_exam": 0,
    }
    return make_profile(**(fields | overrides))


def test_one_exam_gets_every_study_day() -> None:
    # Exam on Thursday, no rest days: Monday, Tuesday and Wednesday are study days.
    # Each has 07:00-17:00 (600 minutes of windows), so the cap is the daily 240.
    exam = make_exam(THU)
    assert exam_budgets(profile(daily_study_minutes=240), [exam], MONDAY_NOW) == {exam.id: 720}


def test_two_exams_split_shared_days_by_difficulty() -> None:
    first, second = make_exam(THU, 2), make_exam(THU, 3)
    budgets = exam_budgets(profile(daily_study_minutes=240), [first, second], MONDAY_NOW)
    assert budgets == {first.id: 288, second.id: 432}  # 720 * 2/5 and 720 * 3/5


def test_days_after_the_first_exam_go_to_the_later_one() -> None:
    # A on Wednesday: study days Monday and Tuesday. B on Friday: Monday to Thursday.
    first, second = make_exam(WED), make_exam(FRI)
    budgets = exam_budgets(profile(daily_study_minutes=240), [first, second], MONDAY_NOW)
    # A: half of Monday and Tuesday = 2 * 120. B: that half plus Wednesday and Thursday.
    assert budgets == {first.id: 240, second.id: 720}


def test_windows_shorter_than_the_daily_minutes_cap_the_day() -> None:
    # The morning window is 06:00-12:00, but the study start delay (1 hour after
    # waking) applies on every day, not only the first, so each day has 07:00-12:00
    # = 300 minutes.
    exam = make_exam(THU)
    budgets = exam_budgets(
        profile(daily_study_minutes=600, study_windows=frozenset({StudyWindow.MORNING})),
        [exam],
        MONDAY_NOW,
    )
    assert budgets == {exam.id: 3 * 300}  # not 600 * 3


def test_exam_without_study_days_gets_zero() -> None:
    # Exam tomorrow with one rest day: the last study day is yesterday, already over.
    exam = make_exam(TUE)
    budgets = exam_budgets(profile(rest_days_before_exam=1), [exam], MONDAY_NOW)
    assert budgets == {exam.id: 0}


def test_rounding_keeps_the_day_total() -> None:
    exams = [make_exam(TUE, 1) for _ in range(3)]
    budgets = exam_budgets(profile(daily_study_minutes=100), exams, MONDAY_NOW)
    assert [budgets[exam.id] for exam in exams] == [34, 33, 33]
    assert sum(budgets.values()) == 100


@PROPERTY_SETTINGS
@given(planner_inputs())
def test_property_total_never_exceeds_daily_minutes_times_days(inputs: PlannerInputs) -> None:
    prof, exams, _, now, _ = inputs
    budgets = exam_budgets(prof, exams, now)
    days = study_days(prof, exams, now)
    assert set(budgets) == {exam.id for exam in exams}
    assert all(value >= 0 for value in budgets.values())
    assert sum(budgets.values()) <= prof.daily_study_minutes * len(days)
