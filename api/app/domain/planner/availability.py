"""Free study windows of each local study day (stages 1 and 2 of the planner).

Every window the planner places a task in comes from here, so this is where
midnight, daylight-saving transitions, "now", busy time (commitments and busy events)
and rest days are decided.
"""

import datetime as dt
from collections.abc import Mapping, Sequence
from types import MappingProxyType
from typing import Final

from app.domain.planner.busy import commitment_occurrences
from app.domain.planner.capacity import MIN_PART_MINUTES
from app.domain.planner.intervals import Interval, clip, merge, subtract
from app.domain.planner.model import Exam, PlannerInputError, Profile, StudyDay, StudyWindow
from app.domain.time import ensure_utc, local_date, local_day_bounds, local_span

STUDY_WINDOW_HOURS: Final[Mapping[StudyWindow, tuple[dt.time, dt.time]]] = MappingProxyType(
    {
        StudyWindow.MORNING: (dt.time(6), dt.time(12)),
        StudyWindow.AFTERNOON: (dt.time(12), dt.time(17)),
        StudyWindow.EVENING: (dt.time(17), dt.time(21)),
        StudyWindow.NIGHT: (dt.time(21), dt.time(2)),
    }
)

_ONE_DAY: Final = dt.timedelta(days=1)


def _long_enough(intervals: Sequence[Interval]) -> list[Interval]:
    return [i for i in intervals if i.minutes >= MIN_PART_MINUTES]


def _span(start: dt.datetime, end: dt.datetime) -> Interval | None:
    return Interval(start, end) if start < end else None


def awake_span(profile: Profile, day: dt.date) -> Interval | None:
    """From wake_time plus the start delay until sleep_time; None if no time is left."""
    start, end = local_span(day, profile.wake_time, profile.sleep_time, profile.timezone)
    # The delay is elapsed time, added on the UTC instant, not wall-clock time.
    return _span(start + profile.study_start_delay, end)


def day_windows(profile: Profile, day: dt.date) -> tuple[Interval, ...]:
    """The chosen study windows that fall in the awake span of day, without busy time.

    Occurrences starting on the day before, the day itself and the day after are
    considered, so a night window or a night-shift morning is found on the right day.
    The same goes for the commitments, so one that crosses midnight is taken out of
    both nights; they follow the wall clock like the windows do, so on a clock-change
    night one can be an hour longer or shorter. Every busy event is taken out too.
    Busy time is not padded (plan decision 4). A remnant shorter than a part is dropped.
    """
    awake = awake_span(profile, day)
    if awake is None:
        return ()
    tz = profile.timezone
    found: list[Interval] = []
    for window in StudyWindow:  # fixed order, never the frozenset's
        if window not in profile.study_windows:
            continue
        begin, finish = STUDY_WINDOW_HOURS[window]
        for offset in (-1, 0, 1):
            span = local_span(day + offset * _ONE_DAY, begin, finish, tz)
            occurrence = _span(*span)
            if occurrence is not None:
                found.extend(clip([occurrence], awake.start, awake.end))
    windows = merge(found)
    taken = [
        occurrence
        for commitment in profile.commitments
        for occurrence in commitment_occurrences(commitment, tz, day - _ONE_DAY, day + _ONE_DAY)
    ]
    for cut in [*taken, *profile.busy]:
        windows = subtract(windows, cut)
    return tuple(_long_enough(windows))


def last_study_day(exam: Exam, profile: Profile) -> dt.date:
    return exam.exam_date - (profile.rest_days_before_exam + 1) * _ONE_DAY


def exam_cutoff(exam: Exam, profile: Profile) -> dt.datetime:
    """When studying for the exam ends.

    With rest days, the end of the last study day's waking hours: the rest day keeps the
    rest, so the night before it is not cut at midnight (a night shift keeps its whole last
    day). Without them, the start of the exam day, because the exam time is unknown and
    may be in the morning.
    """
    tz = profile.timezone
    if profile.rest_days_before_exam >= 1:
        return local_span(last_study_day(exam, profile), profile.wake_time, profile.sleep_time, tz)[
            1
        ]
    return local_day_bounds(exam.exam_date, tz)[0]


def _utc(now: dt.datetime) -> dt.datetime:
    """now in UTC. A naive now is a bug in the caller, so it is a PlannerInputError."""
    try:
        return ensure_utc(now)
    except ValueError as error:
        raise PlannerInputError("now must be an aware datetime") from error


def _ceil_to_minute(instant: dt.datetime) -> dt.datetime:
    floored = instant.replace(second=0, microsecond=0)
    return floored if floored == instant else floored + dt.timedelta(minutes=1)


def start_minute(now: dt.datetime) -> dt.datetime:
    """now in UTC, rounded forward to a whole minute."""
    return _ceil_to_minute(_utc(now))


def study_date(profile: Profile, instant: dt.datetime) -> dt.date:
    """The study day an instant belongs to.

    The first of the local day before and the local day itself whose waking hours
    (wake_time to sleep_time, without the start delay) hold the instant. An instant
    in neither is asleep: it belongs to the local day if it is after that day's
    wake-up, otherwise to the day before.
    """
    tz = profile.timezone
    local = local_date(instant, tz)
    for day in (local - _ONE_DAY, local):
        start, end = local_span(day, profile.wake_time, profile.sleep_time, tz)
        if start <= instant < end:
            return day
    wake = local_span(local, profile.wake_time, profile.sleep_time, tz)[0]
    return local if instant >= wake else local - _ONE_DAY


def _open_windows(
    profile: Profile, exams: Sequence[Exam], now: dt.datetime
) -> list[tuple[dt.date, list[Interval]]]:
    """Per study day, its windows cut at now, at the previous day and at the cutoffs.

    Neither the fixed blocks (the `busy` of study_days) nor the 30-minute minimum is applied
    yet; commitments and events are already out (day_windows). now is a whole minute in UTC.
    """
    if not exams:
        return []
    tz = profile.timezone
    first = local_date(now, tz) - _ONE_DAY
    last = max(last_study_day(exam, profile) for exam in exams)
    # With rest days a study day never runs past its exams' cutoffs, which end its waking
    # hours; only the midnight before an exam day cuts a day short.
    cutoffs = (
        sorted(exam_cutoff(exam, profile) for exam in exams)
        if profile.rest_days_before_exam == 0
        else []
    )

    days: list[tuple[dt.date, list[Interval]]] = []
    day = first
    while day <= last:
        awake_start, awake_end = local_span(day, profile.wake_time, profile.sleep_time, tz)
        if awake_end > now:
            windows = clip(day_windows(profile, day), start=now)
            # A clock change can make the waking hours of two days overlap: a day
            # starts where the previous day's waking hours end.
            previous_end = local_span(day - _ONE_DAY, profile.wake_time, profile.sleep_time, tz)[1]
            windows = clip(windows, start=previous_end)
            for cutoff in cutoffs:
                if awake_start < cutoff < awake_end:
                    windows = clip(windows, end=cutoff)
            days.append((day, windows))
        day += _ONE_DAY
    return days


def open_windows(
    profile: Profile, exams: Sequence[Exam], now: dt.datetime
) -> dict[dt.date, tuple[Interval, ...]]:
    """The windows of each study day (commitments and events taken out) before the fixed
    blocks are, and without the 30-minute minimum."""
    return {
        day: tuple(windows) for day, windows in _open_windows(profile, exams, start_minute(now))
    }


def study_days(
    profile: Profile,
    exams: Sequence[Exam],
    now: dt.datetime,
    busy: Sequence[Interval] = (),
) -> tuple[StudyDay, ...]:
    """One StudyDay per local day from today (or last night) to the last study day."""
    days: list[StudyDay] = []
    for day, windows in _open_windows(profile, exams, start_minute(now)):
        for taken in busy:
            windows = subtract(windows, taken)
        days.append(StudyDay(date=day, windows=tuple(_long_enough(windows))))
    return tuple(days)
