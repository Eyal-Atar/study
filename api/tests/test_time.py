from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.domain.time import (
    InvalidTimezoneError,
    at_local_time,
    ensure_utc,
    local_date,
    local_day_bounds,
    local_span,
    parse_timezone,
)

JLM = ZoneInfo("Asia/Jerusalem")
NY = ZoneInfo("America/New_York")
SANTIAGO = ZoneInfo("America/Santiago")


@pytest.mark.parametrize("name", ["Asia/Jerusalem", "America/New_York", "UTC"])
def test_parse_timezone_accepts_iana_names(name: str) -> None:
    assert parse_timezone(name).key == name


@pytest.mark.parametrize(
    "name",
    ["", "asia/jerusalem", "Asia/Jerusalem ", "Mars/Olympus", "../etc/passwd", "+03:00"],
)
def test_parse_timezone_rejects_invalid_names(name: str) -> None:
    with pytest.raises(InvalidTimezoneError):
        parse_timezone(name)


def test_ensure_utc_rejects_naive() -> None:
    with pytest.raises(ValueError):
        ensure_utc(datetime(2026, 10, 25, 1, 30))


def test_ensure_utc_keeps_the_instant() -> None:
    result = ensure_utc(datetime(2026, 10, 25, 1, 30, tzinfo=JLM))
    assert result == datetime(2026, 10, 24, 22, 30, tzinfo=UTC)
    assert result.tzinfo is UTC


def test_regular_day_is_24_hours() -> None:
    assert local_day_bounds(date(2026, 10, 26), JLM) == (
        datetime(2026, 10, 25, 22, tzinfo=UTC),
        datetime(2026, 10, 26, 22, tzinfo=UTC),
    )


def test_fall_back_day_is_25_hours() -> None:
    assert local_day_bounds(date(2026, 10, 25), JLM) == (
        datetime(2026, 10, 24, 21, tzinfo=UTC),
        datetime(2026, 10, 25, 22, tzinfo=UTC),
    )


def test_spring_forward_day_is_23_hours() -> None:
    assert local_day_bounds(date(2027, 3, 26), JLM) == (
        datetime(2027, 3, 25, 22, tzinfo=UTC),
        datetime(2027, 3, 26, 21, tzinfo=UTC),
    )


def test_day_whose_midnight_does_not_exist() -> None:
    assert local_day_bounds(date(2026, 9, 6), SANTIAGO) == (
        datetime(2026, 9, 6, 4, tzinfo=UTC),
        datetime(2026, 9, 7, 3, tzinfo=UTC),
    )


def test_wall_time_in_the_spring_gap_moves_forward() -> None:
    result = at_local_time(date(2027, 3, 26), time(2, 30), JLM)
    assert result == datetime(2027, 3, 26, 0, 30, tzinfo=UTC)
    assert result.astimezone(JLM).time() == time(3, 30)


def test_repeated_wall_time_is_the_first_occurrence() -> None:
    expected = datetime(2026, 10, 24, 22, 30, tzinfo=UTC)
    assert at_local_time(date(2026, 10, 25), time(1, 30), JLM) == expected
    assert at_local_time(date(2026, 10, 25), time(1, 30, fold=1), JLM) == expected


def test_at_local_time_rejects_an_aware_wall_time() -> None:
    with pytest.raises(ValueError):
        at_local_time(date(2026, 10, 25), time(8, 0, tzinfo=UTC), JLM)


def test_span_crossing_midnight() -> None:
    assert local_span(date(2026, 11, 2), time(22), time(1), JLM) == (
        datetime(2026, 11, 2, 20, tzinfo=UTC),
        datetime(2026, 11, 2, 23, tzinfo=UTC),
    )


def test_span_across_the_fall_back_night_is_5_hours() -> None:
    start, end = local_span(date(2026, 10, 24), time(23), time(3), JLM)
    assert (start, end) == (
        datetime(2026, 10, 24, 20, tzinfo=UTC),
        datetime(2026, 10, 25, 1, tzinfo=UTC),
    )
    assert end - start == timedelta(hours=5)


def test_span_across_the_spring_forward_night_is_4_hours() -> None:
    start, end = local_span(date(2027, 3, 25), time(23), time(4), JLM)
    assert (start, end) == (
        datetime(2027, 3, 25, 21, tzinfo=UTC),
        datetime(2027, 3, 26, 1, tzinfo=UTC),
    )
    assert end - start == timedelta(hours=4)


def test_span_rejects_equal_start_and_end() -> None:
    with pytest.raises(ValueError):
        local_span(date(2026, 10, 26), time(8), time(8), JLM)


def test_local_date_depends_on_the_timezone() -> None:
    instant = datetime(2026, 10, 30, 22, 30, tzinfo=UTC)
    assert local_date(instant, JLM) == date(2026, 10, 31)
    assert local_date(instant, NY) == date(2026, 10, 30)


def test_traveling_user_gets_days_of_the_new_timezone() -> None:
    instant = datetime(2026, 10, 30, 22, 30, tzinfo=UTC)
    assert local_date(instant, NY) == date(2026, 10, 30)
    start, end = local_day_bounds(date(2026, 11, 1), NY)
    assert (start, end) == (
        datetime(2026, 11, 1, 4, tzinfo=UTC),
        datetime(2026, 11, 2, 5, tzinfo=UTC),
    )
    assert end - start == timedelta(hours=25)


def test_helpers_reject_naive_instants() -> None:
    with pytest.raises(ValueError):
        local_date(datetime(2026, 10, 30, 12), JLM)


@pytest.mark.parametrize("tz", [JLM, NY, SANTIAGO], ids=lambda tz: tz.key)
def test_days_tile_the_timeline(tz: ZoneInfo) -> None:
    lengths: list[timedelta] = []
    day = date(2026, 1, 1)
    while day <= date(2027, 12, 31):
        start, end = local_day_bounds(day, tz)
        next_start, _ = local_day_bounds(day + timedelta(days=1), tz)
        assert start < end
        assert end == next_start
        assert local_date(start, tz) == day
        assert local_date(end - timedelta(microseconds=1), tz) == day
        assert end - start in {timedelta(hours=h) for h in (23, 24, 25)}
        lengths.append(end - start)
        day += timedelta(days=1)
    if tz is JLM:
        for year in (2026, 2027):
            offset = (date(year, 1, 1) - date(2026, 1, 1)).days
            days = 365
            year_lengths = lengths[offset : offset + days]
            assert year_lengths.count(timedelta(hours=23)) == 1
            assert year_lengths.count(timedelta(hours=25)) == 1
