from dataclasses import replace
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest

from app.domain.planner import (
    BlockStatus,
    Exam,
    ExamShortfall,
    ExistingBlock,
    Interval,
    PlannedBlock,
    PlannerInputError,
    StudyWindow,
    Task,
    TaskKind,
    clip,
    merge,
    subtract,
)
from tests.planner.factories import make_exam, make_profile, make_task


def at(h: int, m: int = 0) -> datetime:
    return datetime(2026, 11, 2, h, m, tzinfo=UTC)


def iv(a: tuple[int, ...], b: tuple[int, ...]) -> Interval:
    return Interval(at(*a), at(*b))


def test_interval_minutes() -> None:
    assert iv((7,), (15,)).minutes == 480


@pytest.mark.parametrize(
    ("start", "end"),
    [
        (at(8), at(8)),
        (at(9), at(8)),
        (datetime(2026, 11, 2, 7), at(8)),
        (datetime(2026, 11, 2, 7, tzinfo=ZoneInfo("Asia/Jerusalem")), at(8)),
        (at(7).replace(second=30), at(8)),
    ],
    ids=["equal", "inverted", "naive", "non-utc", "seconds"],
)
def test_interval_rejects_bad_bounds(start: datetime, end: datetime) -> None:
    with pytest.raises(ValueError):
        Interval(start, end)


def test_merge_joins_overlapping_and_touching() -> None:
    intervals = [iv((9,), (10,)), iv((7,), (8,)), iv((8,), (8, 30)), iv((9, 30), (11,))]
    assert merge(intervals) == [iv((7,), (8, 30)), iv((9,), (11,))]


def test_subtract_cuts_a_hole() -> None:
    assert subtract([iv((7,), (15,))], iv((8,), (9,))) == [iv((7,), (8,)), iv((9,), (15,))]


def test_subtract_keeps_what_it_does_not_touch() -> None:
    intervals = [iv((7,), (8,)), iv((10,), (11,))]
    assert subtract(intervals, iv((8,), (10,))) == intervals


def test_subtract_removes_a_covered_interval() -> None:
    assert subtract([iv((8,), (9,))], iv((7,), (10,))) == []


def test_clip_to_bounds() -> None:
    intervals = [iv((7,), (9,)), iv((10,), (12,))]
    assert clip(intervals, start=at(8), end=at(11)) == [iv((8,), (9,)), iv((10,), (11,))]
    assert clip(intervals) == intervals


def test_profile_accepts_database_defaults() -> None:
    assert make_profile().study_start_delay == timedelta(hours=1)


@pytest.mark.parametrize(
    "overrides",
    [
        {"daily_study_minutes": 29},
        {"daily_study_minutes": 961},
        {"study_windows": frozenset()},
        {"rest_days_before_exam": -1},
        {"rest_days_before_exam": 15},
        {"wake_time": time(23, 0)},
        {"wake_time": time(8, 0, 30)},
        {"sleep_time": time(23, 0, tzinfo=UTC)},
        {"study_start_delay": timedelta(minutes=-1)},
        {"study_start_delay": timedelta(hours=6, minutes=1)},
    ],
)
def test_profile_rejects_out_of_range(overrides: dict[str, Any]) -> None:
    with pytest.raises(PlannerInputError):
        make_profile(**overrides)


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"timezone": "Asia/Jerusalem"}, id="timezone-str"),
        pytest.param({"study_windows": frozenset({"dawn"})}, id="unknown-window"),
        pytest.param({"study_windows": frozenset({"morning"})}, id="window-str"),
        pytest.param(
            {"study_windows": frozenset({StudyWindow.MORNING, "evening"})}, id="one-window-str"
        ),
    ],
)
def test_profile_rejects_wrong_types(overrides: dict[str, Any]) -> None:
    with pytest.raises(PlannerInputError):
        make_profile(**overrides)


@pytest.mark.parametrize("difficulty", [0, 6])
def test_exam_rejects_difficulty_out_of_range(difficulty: int) -> None:
    with pytest.raises(PlannerInputError):
        Exam(id=uuid4(), exam_date=date(2026, 12, 1), difficulty=difficulty)


def test_exam_rejects_an_id_that_is_not_a_uuid() -> None:
    fields: dict[str, Any] = {"id": str(uuid4()), "exam_date": date(2026, 12, 1), "difficulty": 3}
    with pytest.raises(PlannerInputError):
        Exam(**fields)


@pytest.mark.parametrize(
    "overrides",
    [
        {"estimated_minutes": 4},
        {"estimated_minutes": 601},
        {"focus": 0},
        {"focus": 11},
    ],
)
def test_task_rejects_out_of_range(overrides: dict[str, Any]) -> None:
    exam = make_exam(date(2026, 12, 1))
    with pytest.raises(PlannerInputError):
        make_task(exam, 60, **overrides)


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"kind": "learn"}, id="kind-str"),
        pytest.param({"status": "todo"}, id="status-str"),
        pytest.param({"id": str(uuid4())}, id="id-str"),
        pytest.param({"exam_id": str(uuid4())}, id="exam-id-str"),
        pytest.param({"depends_on": str(uuid4())}, id="depends-on-str"),
    ],
)
def test_task_rejects_wrong_types(overrides: dict[str, Any]) -> None:
    exam = make_exam(date(2026, 12, 1))
    with pytest.raises(PlannerInputError):
        make_task(exam, 60, **overrides)


def test_task_rejects_self_dependency() -> None:
    task_id = uuid4()
    with pytest.raises(PlannerInputError):
        Task(
            id=task_id,
            exam_id=uuid4(),
            kind=TaskKind.LEARN,
            estimated_minutes=60,
            depends_on=task_id,
        )


def test_profile_is_immutable() -> None:
    with pytest.raises(AttributeError):
        make_profile().daily_study_minutes = 100  # type: ignore[misc]
    assert replace(make_profile(), daily_study_minutes=100).daily_study_minutes == 100


def test_existing_block_accepts_valid_fields() -> None:
    block = ExistingBlock(
        id=uuid4(),
        task_id=uuid4(),
        interval=iv((7,), (8,)),
        status=BlockStatus.DONE,
        pinned=False,
    )
    assert block.status is BlockStatus.DONE


@pytest.mark.parametrize(
    "overrides",
    [
        {"id": "x"},
        {"task_id": "x"},
        {"interval": (at(7), at(8))},
        {"status": "done"},
        {"pinned": 1},
    ],
)
def test_existing_block_rejects_bad_types(overrides: dict[str, Any]) -> None:
    fields: dict[str, Any] = {
        "id": uuid4(),
        "task_id": uuid4(),
        "interval": iv((7,), (8,)),
        "status": BlockStatus.PLANNED,
        "pinned": True,
    }
    with pytest.raises(PlannerInputError):
        ExistingBlock(**{**fields, **overrides})


def test_existing_block_needs_a_uuid_id() -> None:
    with pytest.raises(PlannerInputError):
        ExistingBlock(
            id="x",  # type: ignore[arg-type]
            task_id=uuid4(),
            interval=iv((7,), (8,)),
            status=BlockStatus.PLANNED,
            pinned=False,
        )


def test_planned_block_id_is_a_uuid_or_none() -> None:
    fields: dict[str, Any] = {
        "task_id": uuid4(),
        "interval": iv((7,), (8,)),
        "part_index": 1,
        "part_count": 1,
    }
    with pytest.raises(PlannerInputError):
        PlannedBlock(**fields, block_id="x")  # type: ignore[arg-type]
    assert PlannedBlock(**fields).block_id is None
    assert PlannedBlock(**fields, block_id=None).block_id is None
    assert isinstance(PlannedBlock(**fields, block_id=uuid4()).block_id, UUID)


@pytest.mark.parametrize(
    ("part_index", "part_count", "valid"),
    [(1, 1, True), (2, 3, True), (0, 1, False), (2, 1, False), (1, 0, False)],
)
def test_planned_block_part_range(part_index: int, part_count: int, valid: bool) -> None:
    def build() -> PlannedBlock:
        return PlannedBlock(
            task_id=uuid4(),
            interval=iv((7,), (8,)),
            part_index=part_index,
            part_count=part_count,
        )

    if valid:
        build()
    else:
        with pytest.raises(PlannerInputError):
            build()


@pytest.mark.parametrize("overrides", [{"task_id": "x"}, {"interval": None}])
def test_planned_block_rejects_bad_types(overrides: dict[str, Any]) -> None:
    fields: dict[str, Any] = {
        "task_id": uuid4(),
        "interval": iv((7,), (8,)),
        "part_index": 1,
        "part_count": 1,
    }
    with pytest.raises(PlannerInputError):
        PlannedBlock(**{**fields, **overrides})


def test_exam_shortfall_needs_minutes() -> None:
    with pytest.raises(PlannerInputError):
        ExamShortfall(exam_id=uuid4(), minutes=0, daily_minutes=None)
    assert ExamShortfall(exam_id=uuid4(), minutes=1, daily_minutes=None).minutes == 1
