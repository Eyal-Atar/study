"""Weekly commitments and one-off busy events: the model, their occurrences, and the
busy time they leave (S35, plan decisions 1-4)."""

from datetime import UTC, date, datetime, time, timedelta
from typing import Any

import pytest

from app.domain.planner import (
    Commitment,
    Interval,
    PlannerInputError,
    busy_intervals,
    commitment_occurrences,
    sunday_weekday,
)
from tests.planner.factories import JLM, make_profile

SUN, MON, TUE, WED, THU, FRI, SAT = range(7)


def Z(y: int, mo: int, d: int, h: int, mi: int = 0) -> datetime:
    return datetime(y, mo, d, h, mi, tzinfo=UTC)


def iv(start: datetime, end: datetime) -> Interval:
    return Interval(start, end)


def commitment(**overrides: Any) -> Commitment:
    fields: dict[str, Any] = {
        "weekday": MON,
        "start": time(16),
        "end": time(22),
        "valid_from": date(2026, 1, 1),
    }
    return Commitment(**(fields | overrides))


# The model.


def test_sunday_is_day_zero() -> None:
    # November 1, 2026 is a Sunday.
    assert [sunday_weekday(date(2026, 11, d)) for d in range(1, 8)] == list(range(7))


def test_a_commitment_has_no_end_date_by_default() -> None:
    assert commitment().valid_until is None


def test_a_profile_has_no_busy_time_by_default() -> None:
    profile = make_profile()
    assert profile.commitments == ()
    assert profile.busy == ()


def test_a_commitment_may_cross_midnight() -> None:
    assert commitment(start=time(22), end=time(6)).end == time(6)


@pytest.mark.parametrize(
    "overrides",
    [
        {"weekday": -1},
        {"weekday": 7},
        {"weekday": True},
        {"weekday": 1.0},
        {"start": "16:00"},
        {"start": time(16, tzinfo=UTC)},
        {"start": time(16, 0, 30)},
        {"end": time(22, 0, 0, 1)},
        {"start": time(16), "end": time(16)},
        {"start": time(16), "end": time(16, 14)},
        {"start": time(23, 50), "end": time(0, 4)},  # 14 minutes over midnight
        {"valid_from": datetime(2026, 1, 1)},
        {"valid_from": "2026-01-01"},
        {"valid_until": date(2025, 12, 31)},
        {"valid_until": datetime(2026, 2, 1)},
    ],
)
def test_invalid_commitment(overrides: dict[str, Any]) -> None:
    with pytest.raises(PlannerInputError):
        commitment(**overrides)


def test_commitment_bounds_are_valid() -> None:
    assert commitment(start=time(16), end=time(16, 15)).end == time(16, 15)
    assert commitment(start=time(23, 50), end=time(0, 5)).end == time(0, 5)
    assert commitment(start=time(0), end=time(23, 59)).start == time(0)
    assert commitment(valid_until=date(2026, 1, 1)).valid_until == date(2026, 1, 1)
    assert commitment(weekday=SAT).weekday == SAT


@pytest.mark.parametrize(
    "overrides",
    [
        {"commitments": [commitment()]},
        {"commitments": ("work",)},
        {"busy": [iv(Z(2026, 11, 2, 8), Z(2026, 11, 2, 9))]},
        {"busy": ((Z(2026, 11, 2, 8), Z(2026, 11, 2, 9)),)},
    ],
)
def test_invalid_profile_busy_time(overrides: dict[str, Any]) -> None:
    with pytest.raises(PlannerInputError):
        make_profile(**overrides)


# Occurrences.


def test_one_occurrence_per_matching_local_date() -> None:
    # Mondays in November 2026: the 2nd, 9th and 16th. Israel is UTC+2.
    found = commitment_occurrences(commitment(), JLM, date(2026, 11, 1), date(2026, 11, 16))
    assert found == [
        iv(Z(2026, 11, 2, 14), Z(2026, 11, 2, 20)),
        iv(Z(2026, 11, 9, 14), Z(2026, 11, 9, 20)),
        iv(Z(2026, 11, 16, 14), Z(2026, 11, 16, 20)),
    ]


def test_an_occurrence_crossing_midnight_ends_the_next_day() -> None:
    night = commitment(weekday=THU, start=time(22), end=time(6))
    assert commitment_occurrences(night, JLM, date(2026, 11, 5), date(2026, 11, 5)) == [
        iv(Z(2026, 11, 5, 20), Z(2026, 11, 6, 4))
    ]


def test_validity_applies_to_the_date_an_occurrence_starts() -> None:
    # The last Thursday night shift of the semester counts whole, though it ends on Friday.
    night = commitment(
        weekday=THU,
        start=time(22),
        end=time(6),
        valid_from=date(2026, 11, 5),
        valid_until=date(2026, 11, 12),
    )
    found = commitment_occurrences(night, JLM, date(2026, 10, 25), date(2026, 11, 30))
    assert found == [
        iv(Z(2026, 11, 5, 20), Z(2026, 11, 6, 4)),
        iv(Z(2026, 11, 12, 20), Z(2026, 11, 13, 4)),
    ]


def test_no_occurrence_outside_the_range() -> None:
    assert commitment_occurrences(commitment(), JLM, date(2026, 11, 3), date(2026, 11, 8)) == []
    assert commitment_occurrences(commitment(), JLM, date(2026, 11, 3), date(2026, 11, 2)) == []


def test_occurrence_on_the_fall_back_night() -> None:
    # Jerusalem falls back at 02:00 on Sunday October 25, 2026 (UTC+3 to UTC+2). A
    # Saturday night 23:00-03:00 shift follows the wall clock: 20:00Z to 01:00Z, five hours.
    night = commitment(weekday=SAT, start=time(23), end=time(3))
    assert commitment_occurrences(night, JLM, date(2026, 10, 24), date(2026, 10, 24)) == [
        iv(Z(2026, 10, 24, 20), Z(2026, 10, 25, 1))
    ]


def test_occurrence_on_the_spring_forward_night() -> None:
    # Jerusalem springs forward at 02:00 on Friday March 26, 2027 (UTC+2 to UTC+3). A
    # Thursday night 23:00-03:00 shift is 21:00Z to 00:00Z, three hours.
    night = commitment(weekday=THU, start=time(23), end=time(3))
    assert commitment_occurrences(night, JLM, date(2027, 3, 25), date(2027, 3, 25)) == [
        iv(Z(2027, 3, 25, 21), Z(2027, 3, 26, 0))
    ]


def test_an_occurrence_inside_the_gap_is_skipped() -> None:
    # 02:00-03:00 on March 26, 2027 does not exist in Jerusalem: 02:30 moves to 03:30,
    # past the end at 03:15, so the span is empty.
    gap = commitment(weekday=FRI, start=time(2, 30), end=time(3, 15))
    assert commitment_occurrences(gap, JLM, date(2027, 3, 26), date(2027, 3, 26)) == []


# The busy time of a profile.


def test_busy_intervals_merge_commitments_and_events() -> None:
    profile = make_profile(
        commitments=(commitment(), commitment(start=time(21), end=time(23))),
        busy=(iv(Z(2026, 11, 2, 9), Z(2026, 11, 2, 10)),),
    )
    assert busy_intervals(profile, Z(2026, 11, 2, 0), Z(2026, 11, 3, 0)) == (
        iv(Z(2026, 11, 2, 9), Z(2026, 11, 2, 10)),
        iv(Z(2026, 11, 2, 14), Z(2026, 11, 2, 21)),
    )


def test_busy_intervals_keep_only_what_overlaps() -> None:
    event = iv(Z(2026, 11, 4, 9), Z(2026, 11, 4, 10))
    profile = make_profile(commitments=(commitment(),), busy=(event,))
    # An occurrence and an event that only touch the range do not overlap it.
    assert busy_intervals(profile, Z(2026, 11, 2, 20), Z(2026, 11, 4, 9)) == ()
    assert busy_intervals(profile, Z(2026, 11, 2, 19, 59), Z(2026, 11, 4, 9, 1)) == (
        iv(Z(2026, 11, 2, 14), Z(2026, 11, 2, 20)),
        event,
    )


def test_busy_intervals_see_the_night_before() -> None:
    # A Sunday 22:00-06:00 shift is still on at Monday 03:00.
    night = commitment(weekday=SUN, start=time(22), end=time(6))
    profile = make_profile(commitments=(night,))
    assert busy_intervals(profile, Z(2026, 11, 2, 1), Z(2026, 11, 2, 2)) == (
        iv(Z(2026, 11, 1, 20), Z(2026, 11, 2, 4)),
    )


def test_busy_intervals_of_an_empty_profile() -> None:
    assert busy_intervals(make_profile(), Z(2026, 11, 2, 0), Z(2026, 11, 9, 0)) == ()


def test_busy_intervals_need_aware_bounds() -> None:
    with pytest.raises(PlannerInputError):
        busy_intervals(make_profile(), datetime(2026, 11, 2), Z(2026, 11, 3, 0))


def test_busy_intervals_of_a_long_range() -> None:
    profile = make_profile(commitments=(commitment(),))
    found = busy_intervals(profile, Z(2026, 11, 1, 0), Z(2026, 11, 1, 0) + timedelta(days=28))
    assert len(found) == 4
