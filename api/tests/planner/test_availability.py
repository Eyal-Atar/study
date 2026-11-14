from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.domain.planner import (
    Interval,
    PlannerInputError,
    StudyWindow,
    day_windows,
    exam_cutoff,
    last_study_day,
    open_windows,
    start_minute,
    study_date,
    study_days,
)
from tests.planner.factories import NOW, NY, make_exam, make_profile

M, A, E, N = (
    StudyWindow.MORNING,
    StudyWindow.AFTERNOON,
    StudyWindow.EVENING,
    StudyWindow.NIGHT,
)


def Z(y: int, mo: int, d: int, h: int, mi: int = 0) -> datetime:
    return datetime(y, mo, d, h, mi, tzinfo=UTC)


def iv(start: datetime, end: datetime) -> Interval:
    return Interval(start, end)


EXAM = make_exam(date(2026, 11, 5))


def test_default_windows_on_a_regular_day() -> None:
    assert day_windows(make_profile(), date(2026, 11, 2)) == (
        iv(Z(2026, 11, 2, 7), Z(2026, 11, 2, 15)),
    )


def test_adjacent_windows_merge() -> None:
    profile = make_profile(study_windows=frozenset({A, E}))
    assert day_windows(profile, date(2026, 11, 2)) == (iv(Z(2026, 11, 2, 10), Z(2026, 11, 2, 19)),)


def test_separate_windows_stay_apart() -> None:
    profile = make_profile(study_windows=frozenset({M, E}))
    assert day_windows(profile, date(2026, 11, 2)) == (
        iv(Z(2026, 11, 2, 7), Z(2026, 11, 2, 10)),
        iv(Z(2026, 11, 2, 15), Z(2026, 11, 2, 19)),
    )


@pytest.mark.parametrize(
    ("delay", "expected"),
    [
        (60, (iv(Z(2026, 11, 2, 9), Z(2026, 11, 2, 10)),)),
        (90, (iv(Z(2026, 11, 2, 9, 30), Z(2026, 11, 2, 10)),)),
        (100, ()),
    ],
)
def test_study_starts_after_the_delay(delay: int, expected: tuple[Interval, ...]) -> None:
    profile = make_profile(
        wake_time=time(10),
        study_windows=frozenset({M}),
        study_start_delay=timedelta(minutes=delay),
    )
    assert day_windows(profile, date(2026, 11, 2)) == expected


def test_night_window_crosses_midnight() -> None:
    profile = make_profile(sleep_time=time(1), study_windows=frozenset({E, N}))
    assert day_windows(profile, date(2026, 11, 2)) == (iv(Z(2026, 11, 2, 15), Z(2026, 11, 2, 23)),)


def test_fall_back_night_is_an_hour_longer() -> None:
    profile = make_profile(sleep_time=time(3), study_windows=frozenset({N}))
    (window,) = day_windows(profile, date(2026, 10, 24))
    assert window == iv(Z(2026, 10, 24, 18), Z(2026, 10, 25, 0))
    assert window.minutes == 360


def test_spring_forward_night() -> None:
    profile = make_profile(sleep_time=time(3), study_windows=frozenset({N}))
    (window,) = day_windows(profile, date(2027, 3, 25))
    assert window == iv(Z(2027, 3, 25, 19), Z(2027, 3, 26, 0))
    assert window.minutes == 300


def test_windows_outside_waking_hours_give_nothing() -> None:
    profile = make_profile(sleep_time=time(11), study_windows=frozenset({E}))
    assert day_windows(profile, date(2026, 11, 2)) == ()


def test_late_riser_keeps_the_night() -> None:
    profile = make_profile(wake_time=time(12), sleep_time=time(3), study_windows=frozenset({M, N}))
    assert day_windows(profile, date(2026, 11, 2)) == (iv(Z(2026, 11, 2, 19), Z(2026, 11, 3, 0)),)


def test_night_shift_gets_the_morning_after_midnight() -> None:
    profile = make_profile(wake_time=time(23), sleep_time=time(7), study_windows=frozenset({M, N}))
    assert day_windows(profile, date(2026, 11, 2)) == (
        iv(Z(2026, 11, 2, 22), Z(2026, 11, 3, 0)),
        iv(Z(2026, 11, 3, 4), Z(2026, 11, 3, 5)),
    )


@pytest.mark.parametrize(
    ("rest", "last", "cutoff"),
    [
        (1, date(2026, 11, 3), Z(2026, 11, 3, 22)),
        (0, date(2026, 11, 4), Z(2026, 11, 4, 22)),
    ],
)
def test_last_study_day_and_cutoff(rest: int, last: date, cutoff: datetime) -> None:
    profile = make_profile(rest_days_before_exam=rest)
    assert last_study_day(EXAM, profile) == last
    assert exam_cutoff(EXAM, profile) == cutoff


def test_horizon_runs_from_today_to_the_last_study_day() -> None:
    days = study_days(make_profile(), [EXAM], NOW)
    assert [d.date for d in days] == [date(2026, 11, 1), date(2026, 11, 2), date(2026, 11, 3)]


def test_today_starts_at_now() -> None:
    days = study_days(make_profile(), [EXAM], Z(2026, 11, 1, 12, 0).replace(second=30))
    assert days[0].windows == (iv(Z(2026, 11, 1, 12, 1), Z(2026, 11, 1, 15)),)


def test_today_after_all_windows_is_empty() -> None:
    days = study_days(make_profile(), [EXAM], Z(2026, 11, 1, 16))
    assert days[0].date == date(2026, 11, 1)
    assert days[0].windows == ()


def test_still_awake_after_midnight_belongs_to_yesterday() -> None:
    profile = make_profile(sleep_time=time(1), study_windows=frozenset({E, N}))
    days = study_days(profile, [EXAM], Z(2026, 11, 1, 22, 30))
    assert days[0].date == date(2026, 11, 1)
    assert days[0].windows == (iv(Z(2026, 11, 1, 22, 30), Z(2026, 11, 1, 23)),)


def test_night_before_a_rest_day_ends_at_midnight() -> None:
    profile = make_profile(sleep_time=time(1), study_windows=frozenset({E, N}))
    days = {d.date: d for d in study_days(profile, [EXAM], NOW)}
    assert days[date(2026, 11, 2)].windows[-1].end == Z(2026, 11, 2, 23)
    assert days[date(2026, 11, 3)].windows[-1].end == Z(2026, 11, 3, 22)


def test_overlapping_waking_hours_do_not_share_a_window() -> None:
    # Santiago has no midnight on September 6, 2026: 00:00 jumps to 01:00 (03:00Z).
    # Sleep at 00:30 falls in the gap and moves to 01:30 (04:30Z), after the next
    # wake-up at 01:00 (04:00Z), so the waking hours of September 5 and 6 overlap.
    profile = make_profile(
        timezone=ZoneInfo("America/Santiago"),
        wake_time=time(1),
        sleep_time=time(0, 30),
        study_windows=frozenset({N}),
        rest_days_before_exam=0,
        study_start_delay=timedelta(0),
    )
    sep5, sep6 = date(2026, 9, 5), date(2026, 9, 6)
    assert day_windows(profile, sep6)[0].start < day_windows(profile, sep5)[-1].end
    exam = make_exam(date(2026, 9, 8))
    days = {d.date: d for d in study_days(profile, [exam], Z(2026, 9, 5, 12))}
    assert days[sep5].windows == (iv(Z(2026, 9, 6, 1), Z(2026, 9, 6, 4, 30)),)
    assert days[sep6].windows == (
        iv(Z(2026, 9, 6, 4, 30), Z(2026, 9, 6, 5)),
        iv(Z(2026, 9, 7, 0), Z(2026, 9, 7, 3, 30)),
    )
    assert days[sep5].windows[-1].end <= days[sep6].windows[0].start


def test_busy_time_is_removed() -> None:
    busy = [iv(Z(2026, 11, 2, 8), Z(2026, 11, 2, 9))]
    days = {d.date: d for d in study_days(make_profile(), [EXAM], NOW, busy)}
    assert days[date(2026, 11, 2)].windows == (
        iv(Z(2026, 11, 2, 7), Z(2026, 11, 2, 8)),
        iv(Z(2026, 11, 2, 9), Z(2026, 11, 2, 15)),
    )


def test_busy_leftover_shorter_than_30_minutes_is_dropped() -> None:
    busy = [iv(Z(2026, 11, 2, 7, 20), Z(2026, 11, 2, 9))]
    days = {d.date: d for d in study_days(make_profile(), [EXAM], NOW, busy)}
    assert days[date(2026, 11, 2)].windows == (iv(Z(2026, 11, 2, 9), Z(2026, 11, 2, 15)),)


def test_user_in_another_timezone() -> None:
    exam = make_exam(date(2026, 11, 4))
    days = study_days(make_profile(timezone=NY), [exam], Z(2026, 11, 2, 3))
    assert [d.date for d in days] == [date(2026, 11, 1), date(2026, 11, 2)]
    assert days[0].windows == ()
    assert days[1].windows == (iv(Z(2026, 11, 2, 14), Z(2026, 11, 2, 22)),)


def test_no_exams_means_no_days() -> None:
    assert study_days(make_profile(), [], NOW) == ()


def test_naive_now_is_rejected() -> None:
    with pytest.raises(PlannerInputError, match="aware"):
        study_days(make_profile(), [EXAM], datetime(2026, 11, 1, 7))


@pytest.mark.parametrize(
    ("instant", "expected"),
    [
        (Z(2026, 11, 2, 8), date(2026, 11, 2)),  # 10:00 local on Nov 2
        (Z(2026, 11, 2, 22, 30), date(2026, 11, 2)),  # 00:30 local on Nov 3
        (Z(2026, 11, 3, 1), date(2026, 11, 2)),  # 03:00 local on Nov 3, asleep
        (Z(2026, 11, 3, 6), date(2026, 11, 3)),  # 08:00 local on Nov 3
    ],
)
def test_study_date_follows_waking_hours(instant: datetime, expected: date) -> None:
    profile = make_profile(wake_time=time(8), sleep_time=time(1))
    assert study_date(profile, instant) == expected


def test_study_date_in_overlapping_waking_hours() -> None:
    profile = make_profile(
        timezone=ZoneInfo("America/Santiago"),
        wake_time=time(1),
        sleep_time=time(0, 30),
        study_windows=frozenset({N}),
        rest_days_before_exam=0,
        study_start_delay=timedelta(0),
    )
    assert study_date(profile, Z(2026, 9, 6, 4, 15)) == date(2026, 9, 5)


def test_open_windows_keep_short_pieces() -> None:
    profile = make_profile()
    exam = make_exam(date(2026, 11, 5))
    now = Z(2026, 11, 2, 14, 40)  # 20 minutes before the 15:00Z end of the window
    assert study_days(profile, [exam], now)[0].windows == ()
    first = open_windows(profile, [exam], now)[date(2026, 11, 2)]
    assert first == (iv(now, Z(2026, 11, 2, 15)),)


def test_start_minute() -> None:
    assert start_minute(Z(2026, 11, 2, 7) + timedelta(seconds=1)) == Z(2026, 11, 2, 7, 1)
    assert start_minute(Z(2026, 11, 2, 7)) == Z(2026, 11, 2, 7)
    with pytest.raises(PlannerInputError):
        start_minute(datetime(2026, 11, 2, 7))
