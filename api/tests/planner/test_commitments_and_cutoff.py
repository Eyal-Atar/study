"""Commitments and busy events are taken out of the study windows (S35), as the S15
hobby was, and the night before a rest day is not cut at midnight (S15, plan decisions 2
and 3). The hobby is now a commitment on every weekday."""

from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from app.domain.planner import (
    BlockStatus,
    Commitment,
    Interval,
    StudyWindow,
    busy_intervals,
    day_windows,
    exam_budgets,
    exam_cutoff,
    place_task,
    plan,
    replan,
    study_days,
)
from tests.planner.factories import (
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
SUN, MON, TUE, WED, THU, FRI, SAT = range(7)
SINCE = date(2026, 1, 1)


def Z(y: int, mo: int, d: int, h: int, mi: int = 0) -> datetime:
    return datetime(y, mo, d, h, mi, tzinfo=UTC)


def iv(start: datetime, end: datetime) -> Interval:
    return Interval(start, end)


def overlaps(a: Interval, b: Interval) -> bool:
    return a.start < b.end and b.start < a.end


def every_day(start: time, end: time, **overrides: Any) -> tuple[Commitment, ...]:
    """The same commitment on all seven weekdays, as the S15 hobby moved into them."""
    fields: dict[str, Any] = {"start": start, "end": end, "valid_from": SINCE}
    return tuple(Commitment(weekday=day, **(fields | overrides)) for day in range(7))


def on(weekday: int, start: time, end: time, **overrides: Any) -> Commitment:
    fields: dict[str, Any] = {"valid_from": SINCE}
    return Commitment(weekday=weekday, start=start, end=end, **(fields | overrides))


def is_free(profile: Any, interval: Interval) -> bool:
    return busy_intervals(profile, interval.start, interval.end) == ()


# make_profile(): Jerusalem (UTC+2 in November), 09:00-17:00 local = 07:00Z-15:00Z.
# November 1, 2026 is a Sunday.


def test_a_commitment_is_taken_out_of_the_day() -> None:
    profile = make_profile(commitments=every_day(time(12), time(13)))
    assert day_windows(profile, date(2026, 11, 2)) == (
        iv(Z(2026, 11, 2, 7), Z(2026, 11, 2, 10)),
        iv(Z(2026, 11, 2, 11), Z(2026, 11, 2, 15)),
    )


def test_a_commitment_on_every_weekday_takes_every_day() -> None:
    profile = make_profile(commitments=every_day(time(12), time(13)))
    for day in (date(2026, 11, d) for d in range(1, 9)):
        assert all(is_free(profile, window) for window in day_windows(profile, day))
        assert len(day_windows(profile, day)) == 2


def test_a_commitment_only_takes_its_weekday() -> None:
    profile = make_profile(commitments=(on(MON, time(12), time(13)),))
    assert len(day_windows(profile, date(2026, 11, 2))) == 2  # Monday
    assert day_windows(profile, date(2026, 11, 3)) == (iv(Z(2026, 11, 3, 7), Z(2026, 11, 3, 15)),)


def test_a_busy_event_is_taken_out_of_the_day() -> None:
    event = iv(Z(2026, 11, 3, 9), Z(2026, 11, 3, 11, 30))
    profile = make_profile(busy=(event,))
    assert day_windows(profile, date(2026, 11, 3)) == (
        iv(Z(2026, 11, 3, 7), Z(2026, 11, 3, 9)),
        iv(Z(2026, 11, 3, 11, 30), Z(2026, 11, 3, 15)),
    )
    assert day_windows(profile, date(2026, 11, 2)) == (iv(Z(2026, 11, 2, 7), Z(2026, 11, 2, 15)),)


def test_a_remnant_shorter_than_half_an_hour_is_dropped() -> None:
    # 09:00-09:20 is left before the commitment: too short to study in. No padding is
    # added around busy time (decision 4): study starts right at 10:20.
    profile = make_profile(commitments=every_day(time(9, 20), time(10, 20)))
    assert day_windows(profile, date(2026, 11, 2)) == (
        iv(Z(2026, 11, 2, 8, 20), Z(2026, 11, 2, 15)),
    )


def _night_owl(**overrides: Any) -> Any:
    # 17:00-02:00 local = 15:00Z-00:00Z.
    return make_profile(sleep_time=time(2), study_windows=frozenset({E, N}), **overrides)


def test_a_commitment_crossing_midnight() -> None:
    profile = _night_owl(commitments=every_day(time(23, 30), time(0, 30)))
    assert day_windows(profile, date(2026, 11, 2)) == (
        iv(Z(2026, 11, 2, 15), Z(2026, 11, 2, 21, 30)),
        iv(Z(2026, 11, 2, 22, 30), Z(2026, 11, 3, 0)),
    )


def test_a_monday_night_shift_takes_the_night_after_midnight_too() -> None:
    # Monday 23:00 to Tuesday 01:00 takes Monday's night on both sides of midnight.
    profile = _night_owl(commitments=(on(MON, time(23), time(1)),))
    assert day_windows(profile, date(2026, 11, 2)) == (
        iv(Z(2026, 11, 2, 15), Z(2026, 11, 2, 21)),
        iv(Z(2026, 11, 2, 23), Z(2026, 11, 3, 0)),
    )
    assert day_windows(profile, date(2026, 11, 3)) == (iv(Z(2026, 11, 3, 15), Z(2026, 11, 4, 0)),)


def test_a_commitment_after_midnight_belongs_to_the_next_date() -> None:
    # 00:30 on November 3 is still the night of November 2.
    profile = _night_owl(commitments=every_day(time(0, 30), time(1, 30)))
    assert day_windows(profile, date(2026, 11, 2)) == (
        iv(Z(2026, 11, 2, 15), Z(2026, 11, 2, 22, 30)),
        iv(Z(2026, 11, 2, 23, 30), Z(2026, 11, 3, 0)),
    )


def test_a_commitment_on_the_fall_back_night() -> None:
    # Jerusalem falls back at 02:00 on Sunday October 25. The night window of Saturday
    # October 24 is 21:00 (18:00Z) to 02:00 (00:00Z); the commitment from 23:30 (20:30Z)
    # to 01:30, the first one (22:30Z), follows the wall clock like the windows do.
    profile = make_profile(
        sleep_time=time(3),
        study_windows=frozenset({N}),
        commitments=(on(SAT, time(23, 30), time(1, 30)),),
    )
    assert day_windows(profile, date(2026, 10, 24)) == (
        iv(Z(2026, 10, 24, 18), Z(2026, 10, 24, 20, 30)),
        iv(Z(2026, 10, 24, 22, 30), Z(2026, 10, 25, 0)),
    )


def test_a_commitment_across_the_whole_fall_back_hour() -> None:
    # 01:00 to 03:00 on October 25 lasts three hours (22:00Z to 01:00Z) and takes the
    # rest of the night.
    profile = make_profile(
        sleep_time=time(3),
        study_windows=frozenset({N}),
        commitments=(on(SUN, time(1), time(3)),),
    )
    assert day_windows(profile, date(2026, 10, 24)) == (
        iv(Z(2026, 10, 24, 18), Z(2026, 10, 24, 22)),
    )


def test_a_commitment_on_the_spring_forward_night() -> None:
    # Jerusalem springs forward at 02:00 on Friday March 26: the commitment from 01:30
    # (23:30Z) to 02:30, which is in the gap and moves to 03:30 (00:30Z), past the
    # window's end.
    profile = make_profile(
        sleep_time=time(3),
        study_windows=frozenset({N}),
        commitments=(on(FRI, time(1, 30), time(2, 30)),),
    )
    assert day_windows(profile, date(2027, 3, 25)) == (
        iv(Z(2027, 3, 25, 19), Z(2027, 3, 25, 23, 30)),
    )


def test_a_thursday_night_commitment_over_the_spring_forward_gap() -> None:
    # Thursday March 25, 22:00 (20:00Z) to Friday 03:00 (00:00Z): four hours of real time.
    profile = make_profile(
        sleep_time=time(3),
        study_windows=frozenset({N}),
        commitments=(on(THU, time(22), time(3)),),
    )
    assert day_windows(profile, date(2027, 3, 25)) == (iv(Z(2027, 3, 25, 19), Z(2027, 3, 25, 20)),)


def test_valid_from_and_valid_until_are_inclusive() -> None:
    only_tuesday = every_day(
        time(12), time(13), valid_from=date(2026, 11, 3), valid_until=date(2026, 11, 3)
    )
    profile = make_profile(commitments=only_tuesday)
    whole = {d: (iv(Z(2026, 11, d, 7), Z(2026, 11, d, 15)),) for d in (2, 4)}
    assert day_windows(profile, date(2026, 11, 2)) == whole[2]
    assert len(day_windows(profile, date(2026, 11, 3))) == 2
    assert day_windows(profile, date(2026, 11, 4)) == whole[4]


def test_a_night_shift_on_its_last_valid_date_counts_whole() -> None:
    # Tuesday November 3, 22:00 to Wednesday 10:00, valid until November 3: Wednesday
    # morning is still taken. Awake from 06:00, studying from 06:00 (no delay).
    profile = make_profile(
        wake_time=time(6),
        study_start_delay=timedelta(0),
        study_windows=frozenset({M}),
        commitments=(on(TUE, time(22), time(10), valid_until=date(2026, 11, 3)),),
    )
    assert day_windows(profile, date(2026, 11, 4)) == (iv(Z(2026, 11, 4, 8), Z(2026, 11, 4, 10)),)
    assert day_windows(profile, date(2026, 11, 11)) == (
        iv(Z(2026, 11, 11, 4), Z(2026, 11, 11, 10)),
    )


def test_a_night_shift_before_valid_from_does_not_count() -> None:
    profile = make_profile(
        wake_time=time(6),
        study_start_delay=timedelta(0),
        study_windows=frozenset({M}),
        commitments=(on(TUE, time(22), time(10), valid_from=date(2026, 11, 4)),),
    )
    assert day_windows(profile, date(2026, 11, 4)) == (iv(Z(2026, 11, 4, 4), Z(2026, 11, 4, 10)),)
    assert day_windows(profile, date(2026, 11, 11)) == (
        iv(Z(2026, 11, 11, 8), Z(2026, 11, 11, 10)),
    )


# What the rest of the planner sees.


def test_a_long_work_day_lowers_the_exam_budget() -> None:
    # UTC, 07:00-17:00 windows (600 minutes), a budget of 240. Exam on Thursday November
    # 19, no rest days: Monday to Wednesday are study days, 720 minutes in all.
    utc = {
        "timezone": ZoneInfo("UTC"),
        "wake_time": time(6),
        "sleep_time": time(23),
        "rest_days_before_exam": 0,
    }
    monday = datetime(2026, 11, 16, 5, tzinfo=UTC)
    exam = make_exam(date(2026, 11, 19))
    free = make_profile(**utc)
    assert exam_budgets(free, [exam], monday) == {exam.id: 720}
    # Work on Monday and Tuesday 08:00-16:00 leaves two hours on each.
    work = (on(MON, time(8), time(16)), on(TUE, time(8), time(16)))
    busy = make_profile(**utc, commitments=work)
    assert exam_budgets(busy, [exam], monday) == {exam.id: 120 + 120 + 240}


def test_plan_never_places_a_block_on_busy_time() -> None:
    exam = make_exam(date(2026, 11, 5))
    tasks = [make_task(exam, 240), make_task(exam, 240), make_task(exam, 120)]
    event = iv(Z(2026, 11, 2, 9), Z(2026, 11, 2, 12))
    profile = make_profile(commitments=every_day(time(10), time(11)), busy=(event,))
    result = plan(profile, [exam], tasks, [], NOW)
    assert result.unscheduled == ()
    assert all(is_free(profile, block.interval) for block in result.blocks)


def test_replan_moves_candidates_out_of_a_new_commitment() -> None:
    exam = make_exam(date(2026, 11, 5))
    tasks = [make_task(exam, 240), make_task(exam, 240), make_task(exam, 120)]
    existing = as_existing(plan(make_profile(), [exam], tasks, [], NOW))
    profile = make_profile(commitments=every_day(time(10), time(11)))  # 08:00Z-09:00Z
    inside = [block for block in existing if not is_free(profile, block.interval)]
    assert inside
    result = replan(profile, [exam], tasks, existing, NOW)
    assert {block.id for block in inside} <= set(result.removed)
    assert all(is_free(profile, block.interval) for block in result.blocks)


def test_replan_keeps_candidates_that_miss_the_commitment() -> None:
    exam = make_exam(date(2026, 11, 5))
    a, b = make_task(exam, 60), make_task(exam, 60)
    first, second = as_existing(plan(make_profile(), [exam], [a, b], [], NOW))
    assert (first.interval, second.interval) == (
        iv(Z(2026, 11, 1, 7), Z(2026, 11, 1, 8)),
        iv(Z(2026, 11, 1, 8, 30), Z(2026, 11, 1, 9, 30)),
    )
    profile = make_profile(commitments=(on(SUN, time(9), time(10)),))  # 07:00Z-08:00Z
    result = replan(profile, [exam], [a, b], [first, second], NOW)
    assert result.removed == (first.id,)
    assert [(block.block_id, block.interval) for block in result.blocks if block.block_id] == [
        (second.id, second.interval)
    ]
    assert all(is_free(profile, block.interval) for block in result.blocks)


def test_fixed_blocks_inside_a_commitment_stay() -> None:
    exam = make_exam(date(2026, 11, 5))
    a = make_task(exam, 120)
    b = make_task(exam, 60)
    c = make_task(exam, 90)
    pinned = make_block(a, Z(2026, 11, 2, 10), Z(2026, 11, 2, 11), pinned=True)
    done = make_block(b, Z(2026, 11, 3, 10), Z(2026, 11, 3, 10, 30), status=BlockStatus.DONE)
    running = make_block(c, Z(2026, 11, 1, 4, 30), Z(2026, 11, 1, 5, 30))  # started at NOW
    profile = make_profile(commitments=every_day(time(6), time(13)))  # 04:00Z-11:00Z
    result = replan(profile, [exam], [a, b, c], [pinned, done, running], NOW)
    kept = {block.block_id: block.interval for block in result.blocks if block.block_id}
    assert kept[pinned.id] == pinned.interval
    assert kept[done.id] == done.interval
    assert kept[running.id] == running.interval
    assert result.removed == ()
    for block in result.blocks:
        if block.block_id is None:
            assert is_free(profile, block.interval)


def test_place_task_goes_around_busy_time() -> None:
    exam = make_exam(date(2026, 11, 5))
    task = make_task(exam, 60)
    # The whole of November 1 and the morning of November 2 are taken.
    profile = make_profile(busy=(iv(Z(2026, 11, 1, 5), Z(2026, 11, 2, 12)),))
    result = place_task(profile, [exam], [task], [], task.id, NOW)
    assert [block.interval for block in result.blocks] == [
        iv(Z(2026, 11, 2, 12), Z(2026, 11, 2, 13))
    ]


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
