"""Planner input and output types.

Profile, Exam and Task mirror the CHECK constraints of the database tables, so the
planner only ever sees valid input. They also check the types the planner relies
on: a plain str where an enum belongs fails the planner's identity checks (`is`),
and one where a UUID belongs compares unequal to it, so the task would silently
drop out of the plan. Every violation raises PlannerInputError.
"""

import datetime as dt
from dataclasses import dataclass
from enum import StrEnum
from itertools import pairwise
from uuid import UUID
from zoneinfo import ZoneInfo

from app.domain.planner.intervals import Interval


class StudyWindow(StrEnum):
    MORNING = "morning"
    AFTERNOON = "afternoon"
    EVENING = "evening"
    NIGHT = "night"


class TaskKind(StrEnum):
    LEARN = "learn"
    PRACTICE = "practice"
    REVIEW = "review"
    SIMULATION = "simulation"
    SIMULATION_REVIEW = "simulation_review"
    CUSTOM = "custom"


class TaskStatus(StrEnum):
    TODO = "todo"
    DONE = "done"
    SKIPPED = "skipped"


class UnscheduledReason(StrEnum):
    NO_STUDY_DAYS = "no_study_days"
    NOT_ENOUGH_TIME = "not_enough_time"
    NO_CONTIGUOUS_WINDOW = "no_contiguous_window"
    DEPENDENCY_CYCLE = "dependency_cycle"
    DEPENDENCY_NOT_SCHEDULED = "dependency_not_scheduled"
    DEPENDENCY_TOO_LATE = "dependency_too_late"
    LONGER_THAN_DAILY_MINUTES = "longer_than_daily_minutes"
    DEPENDENT_TOO_EARLY = "dependent_too_early"


class BlockStatus(StrEnum):
    PLANNED = "planned"
    DONE = "done"
    MISSED = "missed"
    SKIPPED = "skipped"


class WarningCode(StrEnum):
    NO_STUDY_TIME = "no_study_time"


class PlannerInputError(ValueError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise PlannerInputError(message)


def _check_wall_time(name: str, value: dt.time) -> None:
    _require(value.tzinfo is None, f"{name} must not have a tzinfo")
    _require(value.second == 0 and value.microsecond == 0, f"{name} must be a whole minute")


@dataclass(frozen=True, slots=True, kw_only=True)
class Profile:
    timezone: ZoneInfo
    wake_time: dt.time
    sleep_time: dt.time
    daily_study_minutes: int
    study_windows: frozenset[StudyWindow]
    rest_days_before_exam: int
    # Not in the database: how long after "now" studying may start.
    study_start_delay: dt.timedelta = dt.timedelta(hours=1)

    def __post_init__(self) -> None:
        _require(isinstance(self.timezone, ZoneInfo), "timezone must be a ZoneInfo")
        _require(
            all(isinstance(window, StudyWindow) for window in self.study_windows),
            "study_windows must hold StudyWindow members",
        )
        _check_wall_time("wake_time", self.wake_time)
        _check_wall_time("sleep_time", self.sleep_time)
        _require(self.wake_time != self.sleep_time, "wake_time must differ from sleep_time")
        _require(30 <= self.daily_study_minutes <= 960, "daily_study_minutes must be 30-960")
        _require(1 <= len(self.study_windows) <= 4, "study_windows must hold 1-4 windows")
        _require(0 <= self.rest_days_before_exam <= 14, "rest_days_before_exam must be 0-14")
        _require(
            dt.timedelta(0) <= self.study_start_delay <= dt.timedelta(hours=6),
            "study_start_delay must be between 0 and 6 hours",
        )
        _require(
            self.study_start_delay % dt.timedelta(minutes=1) == dt.timedelta(0),
            "study_start_delay must be a whole number of minutes",
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class Exam:
    id: UUID
    exam_date: dt.date
    difficulty: int

    def __post_init__(self) -> None:
        _require(isinstance(self.id, UUID), "id must be a UUID")
        _require(1 <= self.difficulty <= 5, "difficulty must be 1-5")


@dataclass(frozen=True, slots=True, kw_only=True)
class Task:
    id: UUID
    exam_id: UUID
    kind: TaskKind
    estimated_minutes: int
    focus: int = 5
    depends_on: UUID | None = None
    status: TaskStatus = TaskStatus.TODO

    def __post_init__(self) -> None:
        _require(isinstance(self.id, UUID), "id must be a UUID")
        _require(isinstance(self.exam_id, UUID), "exam_id must be a UUID")
        _require(isinstance(self.kind, TaskKind), "kind must be a TaskKind")
        _require(isinstance(self.status, TaskStatus), "status must be a TaskStatus")
        _require(
            self.depends_on is None or isinstance(self.depends_on, UUID),
            "depends_on must be a UUID or None",
        )
        _require(5 <= self.estimated_minutes <= 600, "estimated_minutes must be 5-600")
        _require(1 <= self.focus <= 10, "focus must be 1-10")
        _require(self.depends_on != self.id, "a task cannot depend on itself")


@dataclass(frozen=True, slots=True, kw_only=True)
class StudyDay:
    date: dt.date
    windows: tuple[Interval, ...]

    def __post_init__(self) -> None:
        for window in self.windows:
            _require(window.minutes >= 30, "a study window must be at least 30 minutes")
        for earlier, later in pairwise(self.windows):
            _require(earlier.end <= later.start, "study windows must be sorted and disjoint")


@dataclass(frozen=True, slots=True, kw_only=True)
class DayItem:
    task_id: UUID
    minutes: int


@dataclass(frozen=True, slots=True, kw_only=True)
class DayPlan:
    day: StudyDay
    items: tuple[DayItem, ...]


@dataclass(frozen=True, slots=True, kw_only=True)
class Unscheduled:
    task_id: UUID
    minutes: int
    reason: UnscheduledReason
    blocked_by: UUID | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class PlanWarning:
    code: WarningCode


@dataclass(frozen=True, slots=True, kw_only=True)
class DayAssignment:
    days: tuple[DayPlan, ...]
    unscheduled: tuple[Unscheduled, ...]
    warnings: tuple[PlanWarning, ...]


@dataclass(frozen=True, slots=True, kw_only=True)
class ExistingBlock:
    """A block already in the calendar, as the planner is given it."""

    id: UUID
    task_id: UUID
    interval: Interval
    status: BlockStatus
    pinned: bool

    def __post_init__(self) -> None:
        _require(isinstance(self.id, UUID), "id must be a UUID")
        _require(isinstance(self.task_id, UUID), "task_id must be a UUID")
        _require(isinstance(self.interval, Interval), "interval must be an Interval")
        _require(isinstance(self.status, BlockStatus), "status must be a BlockStatus")
        _require(isinstance(self.pinned, bool), "pinned must be a bool")


@dataclass(frozen=True, slots=True, kw_only=True)
class PlannedBlock:
    """One timed part of a task: part part_index of part_count."""

    task_id: UUID
    interval: Interval
    part_index: int
    part_count: int
    # None is a new block; otherwise the existing block that stays where it is.
    block_id: UUID | None = None

    def __post_init__(self) -> None:
        _require(isinstance(self.task_id, UUID), "task_id must be a UUID")
        _require(
            self.block_id is None or isinstance(self.block_id, UUID),
            "block_id must be a UUID or None",
        )
        _require(isinstance(self.interval, Interval), "interval must be an Interval")
        _require(self.part_count >= 1, "part_count must be at least 1")
        _require(1 <= self.part_index <= self.part_count, "part_index must be 1-part_count")


@dataclass(frozen=True, slots=True, kw_only=True)
class ExamShortfall:
    exam_id: UUID
    minutes: int
    daily_minutes: int | None

    def __post_init__(self) -> None:
        _require(self.minutes > 0, "minutes must be positive")


@dataclass(frozen=True, slots=True, kw_only=True)
class PlanResult:
    blocks: tuple[PlannedBlock, ...]
    # Ids of existing blocks that leave the calendar.
    removed: tuple[UUID, ...]
    unscheduled: tuple[Unscheduled, ...]
    warnings: tuple[PlanWarning, ...]
    shortfalls: tuple[ExamShortfall, ...]
