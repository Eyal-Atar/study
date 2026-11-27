"""Boards: a task list placed on a profile's calendar, ready for ``plan()``.

A board is a profile (Task 2) with its exams, the domain tasks of every exam and an
eval-side map from each task to its topic. Boards are built from a case (synthetic list, at
a fill) or from a saved run, for every profile; ids are deterministic.
"""

import datetime as dt
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final
from uuid import UUID

from app.domain.planner import Exam, Profile, Task, exam_budgets
from eval.bank.cases import Case
from eval.bank.clock import NOW, stable_id
from eval.bank.profiles import EvalProfile
from eval.bank.tasklists import (
    ListTopic,
    TaskList,
    moed_b_list,
    scale_saved,
    synthetic_list,
)

FILLS: Final = (0.5, 1.0)
SAVED_DAYS_TO_EXAM: Final = 35
EXAM_DIFFICULTY: Final = 3
_BOARD_ID: Final = re.compile(r"^[a-z0-9][a-z0-9_:.\-]{0,79}$")


@dataclass(frozen=True, slots=True, kw_only=True)
class TopicRef:
    id: UUID
    key: str
    weight: int
    exam_id: UUID
    has_tasks: bool


@dataclass(frozen=True, slots=True, kw_only=True)
class Board:
    id: str  # f"{list_id}:{profile_id}", privacy-regex safe
    list_id: str
    profile_id: str
    course_type: str
    source: str
    fill: float | None
    profile: Profile
    exams: tuple[Exam, ...]
    tasks: tuple[Task, ...]
    now: dt.datetime
    topics: Mapping[UUID, TopicRef]  # topic id -> ref (all exams)
    task_topic: Mapping[UUID, UUID]  # task id -> topic id (eval-side map)
    exam_minutes: int | None
    gap: str | None
    gap_value: int | None


def _exam_days(profile: EvalProfile, default_days: int) -> list[int]:
    timeline = profile.timeline
    if timeline.exam_offsets_days:
        # Sorted here: the loader does not guarantee the order.
        return sorted(timeline.exam_offsets_days)
    if timeline.days_to_exam is not None:
        return [timeline.days_to_exam]
    return [default_days]


def build_board(base: Case | TaskList, profile: EvalProfile, *, fill: float | None) -> Board:
    """The board of a case (at ``fill``) or of a saved run (``fill=None``) on this profile."""
    if isinstance(base, Case):
        if fill is None:
            raise ValueError("a synthetic board needs a fill")
        list_id = f"{base.id}:f{round(fill * 100)}"
        source = "synthetic"
        course_type = base.course.type
        exam_minutes: int | None = base.course.exam_minutes
        default_days = base.course.days_to_exam
        missing = (
            None
            if base.expect.missing_topic is None
            else next(t for t in base.expect.topics if t.key == base.expect.missing_topic)
        )
        missing_topic = (
            None if missing is None else ListTopic(key=missing.key, weight=missing.weight)
        )
    else:
        if fill is not None or base.source != "saved":
            raise ValueError("a saved board has no fill")
        list_id = base.id
        source = "saved"
        course_type = base.course_type
        exam_minutes = base.exam_minutes
        default_days = SAVED_DAYS_TO_EXAM
        missing_topic = None
    board_id = f"{list_id}:{profile.id}"

    exams = tuple(
        Exam(
            id=stable_id(board_id, "exam", i),
            exam_date=NOW.date() + dt.timedelta(days=days),
            difficulty=EXAM_DIFFICULTY,
        )
        for i, days in enumerate(_exam_days(profile, default_days))
    )
    budgets = exam_budgets(profile.profile, exams, NOW)

    tasks: list[Task] = []
    topics: dict[UUID, TopicRef] = {}
    task_topic: dict[UUID, UUID] = {}
    for index, exam in enumerate(exams):
        budget = budgets[exam.id]
        if budget <= 0:
            continue
        if isinstance(base, Case):
            exam_list = synthetic_list(base, budget, fill if fill is not None else 1.0)
        else:
            exam_list = scale_saved(base, budget)
        if profile.timeline.sitting == "moed_b":
            exam_list = moed_b_list(exam_list, budget, profile.profile.daily_study_minutes)
        ids = {t.key: stable_id(board_id, index, t.key) for t in exam_list.tasks}
        used = {t.topic for t in exam_list.tasks if t.topic is not None}
        for topic in exam_list.topics:
            topic_id = stable_id(board_id, index, "topic", topic.key)
            topics[topic_id] = TopicRef(
                id=topic_id,
                key=topic.key,
                weight=topic.weight,
                exam_id=exam.id,
                has_tasks=topic.key in used,
            )
        if missing_topic is not None:
            topic_id = stable_id(board_id, index, "topic", missing_topic.key)
            topics[topic_id] = TopicRef(
                id=topic_id,
                key=missing_topic.key,
                weight=missing_topic.weight,
                exam_id=exam.id,
                has_tasks=False,
            )
        for item in exam_list.tasks:
            task = Task(
                id=ids[item.key],
                exam_id=exam.id,
                kind=item.kind,
                estimated_minutes=item.minutes,
                focus=item.focus,
                depends_on=None if item.depends_on is None else ids.get(item.depends_on),
            )
            tasks.append(task)
            if item.topic is not None:
                task_topic[task.id] = stable_id(board_id, index, "topic", item.topic)
    return Board(
        id=board_id,
        list_id=list_id,
        profile_id=profile.id,
        course_type=course_type,
        source=source,
        fill=fill,
        profile=profile.profile,
        exams=exams,
        tasks=tuple(tasks),
        now=NOW,
        topics=topics,
        task_topic=task_topic,
        exam_minutes=exam_minutes,
        gap=profile.gap,
        gap_value=profile.gap_value,
    )


def build_boards(
    cases: Sequence[Case],
    saved: Sequence[TaskList],
    profiles: Sequence[EvalProfile],
    *,
    fills: Sequence[float] = FILLS,
) -> tuple[Board, ...]:
    """Cases x profiles x fills first, then saved runs x profiles (``fill=None``)."""
    boards: list[Board] = []
    for case in cases:
        for profile in profiles:
            for fill in fills:
                boards.append(build_board(case, profile, fill=fill))
    for run in saved:
        for profile in profiles:
            boards.append(build_board(run, profile, fill=None))
    seen: set[str] = set()
    for board in boards:
        if not _BOARD_ID.match(board.id):
            raise RuntimeError("board id is not privacy safe")
        if board.id in seen:
            raise RuntimeError("duplicate board id")
        seen.add(board.id)
    return tuple(boards)


def planner_tasks(board: Board) -> tuple[Task, ...]:
    """The tasks ``plan()`` is given for the board.

    S47: call the domain's study_rounds here, as the analysis service does, so the bank
    measures the code-made rounds too.
    """
    return board.tasks
