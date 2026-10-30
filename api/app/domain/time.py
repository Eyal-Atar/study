"""Local-day and wall-clock rules, computed once on top of zoneinfo.

Every datetime returned here is aware, with tzinfo=datetime.UTC. A naive
datetime is a bug in the caller and raises ValueError.
"""

import datetime as dt
from functools import cache
from typing import Final
from zoneinfo import ZoneInfo, available_timezones

DEFAULT_TIMEZONE: Final = "Asia/Jerusalem"


class InvalidTimezoneError(ValueError):
    pass


@cache
def _known_timezones() -> frozenset[str]:
    return frozenset(available_timezones())


def parse_timezone(name: str) -> ZoneInfo:
    # Exact match against the known names, so nothing reaches the filesystem lookup
    # that ZoneInfo(name) would do (paths, wrong case, trailing spaces).
    if name not in _known_timezones():
        raise InvalidTimezoneError(f"Unknown timezone: {name!r}")
    return ZoneInfo(name)


def _require_aware(instant: dt.datetime) -> None:
    if instant.tzinfo is None or instant.utcoffset() is None:
        raise ValueError("Expected an aware datetime")


def ensure_utc(instant: dt.datetime) -> dt.datetime:
    _require_aware(instant)
    return instant.astimezone(dt.UTC)


def local_date(instant: dt.datetime, tz: ZoneInfo) -> dt.date:
    _require_aware(instant)
    return instant.astimezone(tz).date()


def at_local_time(day: dt.date, wall: dt.time, tz: ZoneInfo) -> dt.datetime:
    """The instant at which the clock in tz shows wall on day.

    A time inside a DST gap moves forward by the length of the gap. A repeated
    time is its first occurrence, whatever wall.fold says.
    """
    if wall.tzinfo is not None:
        raise ValueError("Expected a naive wall time")
    return dt.datetime.combine(day, wall.replace(fold=0), tz).astimezone(dt.UTC)


def local_day_bounds(day: dt.date, tz: ZoneInfo) -> tuple[dt.datetime, dt.datetime]:
    """The half-open interval [start, end) of a local day. It may be 23, 24 or 25 hours."""
    midnight = dt.time()
    return (
        at_local_time(day, midnight, tz),
        at_local_time(day + dt.timedelta(days=1), midnight, tz),
    )


def local_span(
    day: dt.date, start: dt.time, end: dt.time, tz: ZoneInfo
) -> tuple[dt.datetime, dt.datetime]:
    """A window starting at start on day; it ends the next day unless end is later than start.

    Both ends follow the single-time rules of at_local_time. On the spring-forward day a
    start inside the gap moves forward past an end that is still before the gap closes, so
    the span can be empty (end == start); it is never inverted.
    """
    if start.tzinfo is not None or end.tzinfo is not None:
        raise ValueError("Expected naive wall times")
    if start == end:
        raise ValueError("A span cannot start and end at the same time")
    end_day = day if end > start else day + dt.timedelta(days=1)
    span_start = at_local_time(day, start, tz)
    span_end = at_local_time(end_day, end, tz)
    return span_start, max(span_start, span_end)
