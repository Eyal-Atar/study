"""Builders shared by the planner tests."""

from datetime import UTC, date, datetime, time
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from app.domain.planner import (
    DayAssignment,
    Exam,
    Profile,
    StudyWindow,
    Task,
    TaskKind,
)

JLM = ZoneInfo("Asia/Jerusalem")
NY = ZoneInfo("America/New_York")
NOW = datetime(2026, 11, 1, 5, 0, tzinfo=UTC)  # 07:00 in Israel


def make_profile(**overrides: Any) -> Profile:
    """A profile with the database defaults, unless overridden."""
    fields: dict[str, Any] = {
        "timezone": JLM,
        "wake_time": time(8, 0),
        "sleep_time": time(23, 0),
        "daily_study_minutes": 240,
        "study_windows": frozenset({StudyWindow.MORNING, StudyWindow.AFTERNOON}),
        "rest_days_before_exam": 1,
    }
    return Profile(**(fields | overrides))


def make_exam(exam_date: date, difficulty: int = 3) -> Exam:
    return Exam(id=uuid4(), exam_date=exam_date, difficulty=difficulty)


def make_task(exam: Exam, minutes: int, kind: TaskKind = TaskKind.LEARN, **overrides: Any) -> Task:
    fields: dict[str, Any] = {
        "id": uuid4(),
        "exam_id": exam.id,
        "kind": kind,
        "estimated_minutes": minutes,
    }
    return Task(**(fields | overrides))


def by_day(result: DayAssignment) -> dict[date, list[tuple[UUID, int]]]:
    """Only days that have items, each as (task_id, minutes) in order."""
    return {
        plan.day.date: [(item.task_id, item.minutes) for item in plan.items]
        for plan in result.days
        if plan.items
    }
