"""The study-day streak (plan decision 6).

Works on calendar dates the caller already resolved (each block's stored
`study_date`), so time zones and DST never reach this module: consecutive
means date + 1 day, whether that day had 23, 24 or 25 hours.
"""

import datetime as dt
from collections.abc import Iterable
from dataclasses import dataclass

_ONE_DAY = dt.timedelta(days=1)


@dataclass(frozen=True)
class Streak:
    """`current` ends today, or yesterday while today is not over yet.

    `longest` is the longest run ever, `studied_today` whether today is a
    study day.
    """

    current: int
    longest: int
    studied_today: bool


def _run(day: dt.date, days: set[dt.date], step: dt.timedelta) -> int:
    """How many consecutive study days run from `day` in the direction of `step`.

    0 when `day` is not a study day.
    """
    length = 0
    while day in days:
        length += 1
        day += step
    return length


def streak(days: Iterable[dt.date], today: dt.date) -> Streak:
    """The streak of the study `days` (any order, repeats allowed) as of `today`.

    A day after `today` cannot be part of the current streak or of today, but
    it still counts for `longest`, since it is a study day the caller recorded.
    """
    unique = set(days)
    studied_today = today in unique
    current = _run(today if studied_today else today - _ONE_DAY, unique, -_ONE_DAY)
    # Each run is walked once, from its first day (a day whose previous day is
    # not a study day), so this is linear in the number of distinct days.
    longest = max(
        (_run(day, unique, _ONE_DAY) for day in unique if day - _ONE_DAY not in unique),
        default=0,
    )
    return Streak(current=current, longest=longest, studied_today=studied_today)
