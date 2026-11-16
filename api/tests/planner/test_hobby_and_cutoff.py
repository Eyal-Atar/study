"""The daily hobby is taken out of the study windows, and the night before a rest day
is not cut at midnight (S15, plan decisions 2 and 3)."""

from datetime import UTC, date, datetime, time, timedelta
from typing import Any

import pytest

from app.domain.planner import (
    BlockStatus,
    Interval,
    PlannerInputError,
    StudyWindow,
    day_windows,
    exam_cutoff,
    plan,
    replan,
    study_days,
)
from tests.planner.factories import (
    JLM,
    NOW,
    as_existing,
    make_block,
    make_exam,
    make_profile,
    make_task,
)

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


def overlaps(a: Interval, b: Interval) -> bool:
    return a.start < b.end and b.start < a.end


def hobby_on(day: date, start: time, minutes: int) -> Interval:
    begin = datetime.combine(day, start, JLM).astimezone(UTC)
    return Interval(begin, begin + timedelta(minutes=minutes))


# make_profile(): Jerusalem (UTC+2 in November), 09:00-17:00 local = 07:00Z-15:00Z.


def test_no_hobby_by_default() -> None:
    assert make_profile().hobby is None


def test_hobby_is_taken_out_of_the_day() -> None:
    profile = make_profile(hobby=(time(12), 60))
    assert day_windows(profile, date(2026, 11, 2)) == (
        iv(Z(2026, 11, 2, 7), Z(2026, 11, 2, 10)),
        iv(Z(2026, 11, 2, 11), Z(2026, 11, 2, 15)),
    )


def test_hobby_every_day() -> None:
    profile = make_profile(hobby=(time(12), 60))
    for day in (date(2026, 11, 3), date(2026, 11, 4)):
        assert all(
            not overlaps(window, hobby_on(day, time(12), 60))
            for window in day_windows(profile, day)
        )


def test_a_remnant_shorter_than_half_an_hour_is_dropped() -> None:
    # 09:00-09:20 is left before the hobby: too short to study in.
    profile = make_profile(hobby=(time(9, 20), 60))
    assert day_windows(profile, date(2026, 11, 2)) == (
        iv(Z(2026, 11, 2, 8, 20), Z(2026, 11, 2, 15)),
    )


def _night_owl(**overrides: Any) -> Any:
    # 17:00-02:00 local = 15:00Z-00:00Z.
    return make_profile(sleep_time=time(2), study_windows=frozenset({E, N}), **overrides)


def test_hobby_crossing_midnight() -> None:
    profile = _night_owl(hobby=(time(23, 30), 60))
    assert day_windows(profile, date(2026, 11, 2)) == (
        iv(Z(2026, 11, 2, 15), Z(2026, 11, 2, 21, 30)),
        iv(Z(2026, 11, 2, 22, 30), Z(2026, 11, 3, 0)),
    )


def test_hobby_after_midnight_belongs_to_the_next_date() -> None:
    # 00:30 on November 3 is still the night of November 2.
    profile = _night_owl(hobby=(time(0, 30), 60))
    assert day_windows(profile, date(2026, 11, 2)) == (
        iv(Z(2026, 11, 2, 15), Z(2026, 11, 2, 22, 30)),
        iv(Z(2026, 11, 2, 23, 30), Z(2026, 11, 3, 0)),
    )


def test_hobby_on_the_fall_back_night() -> None:
    # Jerusalem falls back at 02:00 on October 25. The night window of October 24 is
    # 21:00 (18:00Z) to 02:00 (00:00Z); the hobby from 23:30 (20:30Z) to 01:30, the first
    # one (22:30Z), follows the wall clock like the windows do.
    profile = make_profile(
        sleep_time=time(3), study_windows=frozenset({N}), hobby=(time(23, 30), 120)
    )
    assert day_windows(profile, date(2026, 10, 24)) == (
        iv(Z(2026, 10, 24, 18), Z(2026, 10, 24, 20, 30)),
        iv(Z(2026, 10, 24, 22, 30), Z(2026, 10, 25, 0)),
    )


def test_hobby_on_the_spring_forward_night() -> None:
    # Jerusalem springs forward at 02:00 on March 26: the hobby from 01:30 (23:30Z) to
    # 02:30, which is in the gap and moves to 03:30 (00:30Z), past the window's end.
    profile = make_profile(
        sleep_time=time(3), study_windows=frozenset({N}), hobby=(time(1, 30), 60)
    )
    assert day_windows(profile, date(2027, 3, 25)) == (
        iv(Z(2027, 3, 25, 19), Z(2027, 3, 25, 23, 30)),
    )


@pytest.mark.parametrize(
    "hobby",
    [
        (time(12, tzinfo=UTC), 60),
        (time(12, 0, 30), 60),
        (time(12), 14),
        (time(12), 241),
        (time(12), True),
        (time(12), 60.0),
        ("12:00", 60),
        [time(12), 60],
        (time(12),),
    ],
)
def test_invalid_hobby(hobby: object) -> None:
    with pytest.raises(PlannerInputError):
        make_profile(hobby=hobby)


def test_hobby_bounds_are_valid() -> None:
    assert make_profile(hobby=(time(0), 15)).hobby == (time(0), 15)
    assert make_profile(hobby=(time(23, 59), 240)).hobby == (time(23, 59), 240)


def test_replan_moves_planned_blocks_out_of_the_hobby() -> None:
    exam = make_exam(date(2026, 11, 5))
    tasks = [make_task(exam, 240), make_task(exam, 240), make_task(exam, 120)]
    existing = as_existing(plan(make_profile(), [exam], tasks, [], NOW))
    hobby = (time(10), 60)  # 08:00Z-09:00Z, inside the first blocks
    assert any(
        overlaps(block.interval, hobby_on(block.interval.start.date(), *hobby))
        for block in existing
    )
    result = replan(make_profile(hobby=hobby), [exam], tasks, existing, NOW)
    for block in result.blocks:
        assert not overlaps(block.interval, hobby_on(block.interval.start.date(), *hobby))


def test_a_pinned_block_inside_the_hobby_stays() -> None:
    exam = make_exam(date(2026, 11, 5))
    a = make_task(exam, 120)
    b = make_task(exam, 60)
    pinned = make_block(a, Z(2026, 11, 2, 10), Z(2026, 11, 2, 11), pinned=True)
    done = make_block(b, Z(2026, 11, 3, 10), Z(2026, 11, 3, 10, 30), status=BlockStatus.DONE)
    hobby = (time(12), 60)  # 10:00Z-11:00Z
    result = replan(make_profile(hobby=hobby), [exam], [a, b], [pinned, done], NOW)
    kept = {b.block_id: b.interval for b in result.blocks if b.block_id is not None}
    assert kept[pinned.id] == pinned.interval
    assert kept[done.id] == done.interval
    assert result.removed == ()
    for block in result.blocks:
        if block.block_id is None:
            assert not overlaps(block.interval, hobby_on(block.interval.start.date(), *hobby))


# The night before a rest day.


def _night_shift(rest: int) -> Any:
    # Awake 20:00 to 12:00 the next day; studying from 21:00 (the one-hour delay).
    return make_profile(
        wake_time=time(20),
        sleep_time=time(12),
        study_windows=frozenset({E, N, M}),
        rest_days_before_exam=rest,
    )


def test_night_shift_keeps_the_whole_last_study_day_before_a_rest_day() -> None:
    profile = _night_shift(rest=1)
    exam = make_exam(date(2026, 11, 5))  # last study day November 3, rest day November 4
    days = {d.date: d for d in study_days(profile, [exam], NOW)}
    assert max(days) == date(2026, 11, 3)
    # 21:00-02:00 and 06:00-12:00 local, after midnight too.
    assert days[date(2026, 11, 3)].windows == (
        iv(Z(2026, 11, 3, 19), Z(2026, 11, 4, 0)),
        iv(Z(2026, 11, 4, 4), Z(2026, 11, 4, 10)),
    )
    assert exam_cutoff(exam, profile) == Z(2026, 11, 4, 10)


def test_night_shift_without_rest_days_still_stops_at_midnight() -> None:
    profile = _night_shift(rest=0)
    exam = make_exam(date(2026, 11, 4))  # last study day November 3, exam on November 4
    days = {d.date: d for d in study_days(profile, [exam], NOW)}
    assert days[date(2026, 11, 3)].windows == (iv(Z(2026, 11, 3, 19), Z(2026, 11, 3, 22)),)
    assert exam_cutoff(exam, profile) == Z(2026, 11, 3, 22)


def test_a_usual_day_before_a_rest_day_is_unchanged() -> None:
    profile = make_profile(study_windows=frozenset({M, A, E, N}))  # 08:00-23:00
    exam = make_exam(date(2026, 11, 5))
    days = {d.date: d for d in study_days(profile, [exam], NOW)}
    assert days[date(2026, 11, 3)].windows == (iv(Z(2026, 11, 3, 7), Z(2026, 11, 3, 21)),)
    assert exam_cutoff(exam, profile) == Z(2026, 11, 3, 21)
