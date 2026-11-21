import datetime as dt
from zoneinfo import ZoneInfo

import pytest

from app.domain.closure import (
    CLOSURE_HOUR,
    ExamState,
    Outcome,
    closure_opens_at,
    closure_options,
    completion_percent,
    exam_state,
)

UTC = dt.UTC
JERUSALEM = ZoneInfo("Asia/Jerusalem")
NEW_YORK = ZoneInfo("America/New_York")


def test_the_hour_is_seven_in_the_evening() -> None:
    assert CLOSURE_HOUR == 19


@pytest.mark.parametrize(
    ("exam_date", "tz", "expected"),
    [
        # Winter in Israel: UTC+2.
        (dt.date(2027, 1, 20), JERUSALEM, dt.datetime(2027, 1, 20, 17, 0, tzinfo=UTC)),
        # Summer in Israel: UTC+3.
        (dt.date(2027, 7, 1), JERUSALEM, dt.datetime(2027, 7, 1, 16, 0, tzinfo=UTC)),
        # New York in winter: UTC-5, so 19:00 there is midnight UTC the next day.
        (dt.date(2027, 1, 20), NEW_YORK, dt.datetime(2027, 1, 21, 0, 0, tzinfo=UTC)),
        # New York in summer: UTC-4.
        (dt.date(2027, 7, 1), NEW_YORK, dt.datetime(2027, 7, 1, 23, 0, tzinfo=UTC)),
        # The days the clocks change: 19:00 is well past the change.
        (dt.date(2027, 3, 26), JERUSALEM, dt.datetime(2027, 3, 26, 16, 0, tzinfo=UTC)),
        (dt.date(2027, 10, 31), JERUSALEM, dt.datetime(2027, 10, 31, 17, 0, tzinfo=UTC)),
    ],
)
def test_closure_opens_at_local_seven_pm(
    exam_date: dt.date, tz: ZoneInfo, expected: dt.datetime
) -> None:
    opens = closure_opens_at(exam_date, tz)
    assert opens == expected
    assert opens.tzinfo is UTC


DATE = dt.date(2027, 1, 20)  # 19:00 in Jerusalem is 17:00 UTC


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        (dt.datetime(2027, 1, 19, 20, 0, tzinfo=UTC), ExamState.ACTIVE),
        (dt.datetime(2027, 1, 20, 16, 59, tzinfo=UTC), ExamState.ACTIVE),
        (dt.datetime(2027, 1, 20, 17, 0, tzinfo=UTC), ExamState.PENDING),
        (dt.datetime(2027, 1, 20, 21, 0, tzinfo=UTC), ExamState.PENDING),
        (dt.datetime(2027, 2, 3, 8, 0, tzinfo=UTC), ExamState.PENDING),
    ],
)
def test_an_open_exam_becomes_pending_at_seven(now: dt.datetime, expected: ExamState) -> None:
    assert exam_state(DATE, None, now, JERUSALEM) == expected


def test_the_users_time_zone_decides() -> None:
    # 20:00 UTC is 22:00 in Jerusalem but 15:00 in New York.
    now = dt.datetime(2027, 1, 20, 20, 0, tzinfo=UTC)
    assert exam_state(DATE, None, now, JERUSALEM) == ExamState.PENDING
    assert exam_state(DATE, None, now, NEW_YORK) == ExamState.ACTIVE
    assert exam_state(DATE, None, dt.datetime(2027, 1, 21, 0, 0, tzinfo=UTC), NEW_YORK) == (
        ExamState.PENDING
    )


def test_an_aware_now_in_another_zone_is_the_same_instant() -> None:
    now = dt.datetime(2027, 1, 20, 19, 0, tzinfo=JERUSALEM)
    assert exam_state(DATE, None, now, JERUSALEM) == ExamState.PENDING


def test_a_naive_now_is_rejected() -> None:
    with pytest.raises(ValueError, match="aware"):
        exam_state(DATE, None, dt.datetime(2027, 1, 20, 20, 0), JERUSALEM)


@pytest.mark.parametrize(
    "now",
    [dt.datetime(2027, 1, 1, tzinfo=UTC), dt.datetime(2027, 3, 1, tzinfo=UTC)],
)
def test_a_decision_is_kept_whatever_the_time(now: dt.datetime) -> None:
    assert exam_state(DATE, "done", now, JERUSALEM) == ExamState.DONE
    assert exam_state(DATE, "moed_b", now, JERUSALEM) == ExamState.WAITING_MOED_B


def test_an_unknown_closure_is_rejected() -> None:
    with pytest.raises(ValueError, match="closure"):
        exam_state(DATE, "failed", dt.datetime(2027, 3, 1, tzinfo=UTC), JERUSALEM)


@pytest.mark.parametrize(
    ("state", "sitting", "expected"),
    [
        (ExamState.PENDING, 1, (Outcome.DONE, Outcome.MOED_B)),
        (ExamState.PENDING, 2, (Outcome.DONE,)),
        (ExamState.WAITING_MOED_B, 1, (Outcome.DONE,)),
        (ExamState.ACTIVE, 1, ()),
        (ExamState.ACTIVE, 2, ()),
        (ExamState.DONE, 1, ()),
        (ExamState.DONE, 2, ()),
    ],
)
def test_closure_options(state: ExamState, sitting: int, expected: tuple[Outcome, ...]) -> None:
    assert closure_options(state, sitting) == expected


def test_the_enums_serialise_as_their_values() -> None:
    assert [state.value for state in ExamState] == ["active", "pending", "waiting_moed_b", "done"]
    assert [outcome.value for outcome in Outcome] == ["done", "moed_b"]


@pytest.mark.parametrize(
    ("done", "total", "expected"),
    [
        (0, 0, 0),
        (30, 0, 0),
        (0, 120, 0),
        (60, 120, 50),
        (120, 120, 100),
        (1, 3, 33),
        (2, 3, 67),
        (1, 8, 13),  # 12.5 rounds half up
        (1, 200, 1),  # 0.5 rounds half up
        (1, 201, 0),
        (199, 200, 100),  # 99.5 rounds half up
        (150, 120, 100),
        (-10, 120, 0),
    ],
)
def test_completion_percent(done: int, total: int, expected: int) -> None:
    assert completion_percent(done, total) == expected
