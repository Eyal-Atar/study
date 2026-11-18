"""Busy time: the occurrences of weekly commitments and the one-off busy events.

Busy time is never study time. day_windows takes it out of the study windows, so
everything built on the windows (the budgets, day assignment, packing, block
validity, placing a single task) sees it without knowing about it.
"""

import datetime as dt
from zoneinfo import ZoneInfo

from app.domain.planner.intervals import Interval, merge
from app.domain.planner.model import Commitment, PlannerInputError, Profile, sunday_weekday
from app.domain.time import ensure_utc, local_date, local_span

_ONE_DAY = dt.timedelta(days=1)
_WEEK = 7


def commitment_occurrences(
    commitment: Commitment, tz: ZoneInfo, first_day: dt.date, last_day: dt.date
) -> list[Interval]:
    """The occurrences that start on a local date in first_day..last_day, in time order.

    One per date whose sunday_weekday matches and that lies in the commitment's validity
    range. Each is built with local_span, so it follows the same clock-change rules as
    the study windows; an occurrence that the spring-forward gap makes empty is skipped.
    """
    start = max(first_day, commitment.valid_from)
    end = last_day if commitment.valid_until is None else min(last_day, commitment.valid_until)
    day = start + ((commitment.weekday - sunday_weekday(start)) % _WEEK) * _ONE_DAY
    found: list[Interval] = []
    while day <= end:
        span_start, span_end = local_span(day, commitment.start, commitment.end, tz)
        if span_start < span_end:
            found.append(Interval(span_start, span_end))
        day += _WEEK * _ONE_DAY
    return found


def _overlaps(interval: Interval, start: dt.datetime, end: dt.datetime) -> bool:
    return interval.start < end and start < interval.end


def busy_intervals(profile: Profile, start: dt.datetime, end: dt.datetime) -> tuple[Interval, ...]:
    """Every commitment occurrence and busy event that overlaps [start, end), merged and
    sorted. They are whole, not clipped to the range.

    An occurrence lasts less than a day of wall-clock time, so the occurrences that start
    on the local date before start's (a night shift still on after midnight) are enough.
    """
    try:
        start, end = ensure_utc(start), ensure_utc(end)
    except ValueError as error:
        raise PlannerInputError("start and end must be aware datetimes") from error
    tz = profile.timezone
    first = local_date(start, tz) - _ONE_DAY
    last = local_date(end, tz)
    found = [
        occurrence
        for commitment in profile.commitments
        for occurrence in commitment_occurrences(commitment, tz, first, last)
        if _overlaps(occurrence, start, end)
    ]
    found.extend(event for event in profile.busy if _overlaps(event, start, end))
    return tuple(merge(found))
