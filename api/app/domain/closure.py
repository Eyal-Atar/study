"""When an exam's closure opens, and what state an exam is in (S45). Pure: no database.

Only the decision (`exams.closure`) is stored. "Pending closure" depends on the clock and the
user's time zone, so it is derived here rather than kept in a column that a background job
would have to update and that would break when the user changes time zone.
"""

import datetime as dt
from enum import StrEnum
from typing import Final
from zoneinfo import ZoneInfo

from app.domain.time import at_local_time, ensure_utc

# 19:00 local on the exam date. Most university exams in Israel end by 16:00 and the evening
# session ends around 19:00, so by then the exam is almost always behind the student and the
# evening still ahead. The same hour opens the closure sheet and sends the push, so the push
# never arrives before there is something to open.
CLOSURE_HOUR: Final = 19


class ExamState(StrEnum):
    ACTIVE = "active"
    PENDING = "pending"
    WAITING_MOED_B = "waiting_moed_b"
    DONE = "done"


class Outcome(StrEnum):
    DONE = "done"
    MOED_B = "moed_b"


def closure_opens_at(exam_date: dt.date, tz: ZoneInfo) -> dt.datetime:
    """The instant (UTC) at which the clock in tz shows CLOSURE_HOUR:00 on exam_date."""
    return at_local_time(exam_date, dt.time(CLOSURE_HOUR), tz)


def exam_state(
    exam_date: dt.date, closure: str | None, now: dt.datetime, tz: ZoneInfo
) -> ExamState:
    """The exam's state: its stored decision, or (when open) whether closure has opened."""
    instant = ensure_utc(now)
    if closure is None:
        if instant >= closure_opens_at(exam_date, tz):
            return ExamState.PENDING
        return ExamState.ACTIVE
    if closure == Outcome.DONE:
        return ExamState.DONE
    if closure == Outcome.MOED_B:
        return ExamState.WAITING_MOED_B
    raise ValueError(f"Unknown closure: {closure!r}")


def closure_options(state: ExamState, sitting: int) -> tuple[Outcome, ...]:
    """What the user may decide now. There is no Moed C, so a second sitting only closes."""
    if state is ExamState.PENDING:
        return (Outcome.DONE, Outcome.MOED_B) if sitting == 1 else (Outcome.DONE,)
    if state is ExamState.WAITING_MOED_B:
        return (Outcome.DONE,)
    return ()


def completion_percent(done_minutes: int, total_minutes: int) -> int:
    """100 * done / total, rounded half up and clamped to 0-100; 0 when there is nothing."""
    if total_minutes <= 0:
        return 0
    # Integer arithmetic, so 12.5 rounds to 13 (round() would give 12).
    percent = (200 * done_minutes + total_minutes) // (2 * total_minutes)
    return max(0, min(100, percent))
