"""Half-open UTC intervals on whole minutes, and the set operations the planner needs."""

import datetime as dt
from collections.abc import Iterable
from dataclasses import dataclass

_MINUTE = dt.timedelta(minutes=1)


def _check_instant(instant: dt.datetime) -> None:
    if instant.tzinfo is not dt.UTC:
        raise ValueError("Interval bounds must have tzinfo=datetime.UTC")
    if instant.second or instant.microsecond:
        raise ValueError("Interval bounds must fall on a whole minute")


@dataclass(frozen=True, slots=True, order=True)
class Interval:
    """The half-open range [start, end), in UTC, on whole minutes."""

    start: dt.datetime
    end: dt.datetime

    def __post_init__(self) -> None:
        _check_instant(self.start)
        _check_instant(self.end)
        if self.start >= self.end:
            raise ValueError("Interval start must be before its end")

    @property
    def minutes(self) -> int:
        return (self.end - self.start) // _MINUTE


def merge(intervals: Iterable[Interval]) -> list[Interval]:
    """Sorted intervals where overlapping and touching ones are joined."""
    merged: list[Interval] = []
    for interval in sorted(intervals):
        if merged and interval.start <= merged[-1].end:
            if interval.end > merged[-1].end:
                merged[-1] = Interval(merged[-1].start, interval.end)
        else:
            merged.append(interval)
    return merged


def subtract(intervals: Iterable[Interval], cut: Interval) -> list[Interval]:
    """The intervals with cut removed, in input order; empty pieces are dropped."""
    result: list[Interval] = []
    for interval in intervals:
        if cut.start < interval.end and cut.end > interval.start:
            if cut.start > interval.start:
                result.append(Interval(interval.start, cut.start))
            if cut.end < interval.end:
                result.append(Interval(cut.end, interval.end))
        else:
            result.append(interval)
    return result


def clip(
    intervals: Iterable[Interval],
    start: dt.datetime | None = None,
    end: dt.datetime | None = None,
) -> list[Interval]:
    """Only the parts inside [start, end); None means no bound on that side."""
    result: list[Interval] = []
    for interval in intervals:
        lo = interval.start if start is None else max(interval.start, start)
        hi = interval.end if end is None else min(interval.end, end)
        if lo < hi:
            result.append(Interval(lo, hi))
    return result
