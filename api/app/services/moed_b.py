"""Opening Moed B: a focused second sitting built from the exam's materials, no Claude (S45).

One transaction under the user lock: a `moed_b_opened` version (the board before, and the
exam's fields before in exam_before, so undo brings both back), the exam moved to sitting 2
with the new date, the new tasks, and a replan of the whole board into the same version.
"""

import datetime as dt
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final
from uuid import UUID

from app.domain.closure import ExamState, exam_state
from app.domain.moed_b import MoedBPlan, SourceTask, SourceTopic, build_moed_b_tasks
from app.domain.planner import (
    Exam,
    ExamShortfall,
    TaskKind,
    TaskStatus,
    Unscheduled,
    exam_budgets,
    replan,
)
from app.domain.time import local_date
from app.errors import ApiError
from app.services.board import load_board
from app.services.exams import _check_date
from app.services.plan_writes import (
    EXAM_BEFORE_FIELDS,
    VersionReason,
    changes,
    create_version,
    exam_before,
    renumber,
    write_changes,
)
from app.services.profiles import Conn

type Row = Mapping[str, Any]

_EXAM_COLUMNS: Final = (
    "id, name, exam_date, difficulty, color_index, sitting, closure, closed_at, "
    "closure_notified_at, first_exam_date, first_grade, moed_b_notes, moed_b_topic_ids"
)


@dataclass(frozen=True)
class WeakTopic:
    id: UUID
    name: str


@dataclass(frozen=True)
class MoedBOutcome:
    exam: Row
    state: ExamState
    version_id: UUID
    tasks_created: int
    weak_topics: tuple[WeakTopic, ...]
    trimmed: int
    unscheduled: tuple[Unscheduled, ...]
    shortfalls: tuple[ExamShortfall, ...]


def _exam(conn: Conn, user_id: UUID, exam_id: UUID) -> Row:
    row = conn.execute(
        f"SELECT {_EXAM_COLUMNS} FROM app.exams "  # noqa: S608 - a constant column list
        "WHERE user_id = %s AND id = %s AND deleted_at IS NULL",
        (user_id, exam_id),
    ).fetchone()
    if row is None:
        raise ApiError("not_found")
    return row


def _topics(conn: Conn, user_id: UUID, exam_id: UUID) -> list[SourceTopic]:
    return [
        SourceTopic(id=r["id"], name=r["name"], weight=r["weight"], position=r["position"])
        for r in conn.execute(
            "SELECT id, name, weight, position FROM app.topics "
            "WHERE user_id = %s AND exam_id = %s ORDER BY position, id",
            (user_id, exam_id),
        ).fetchall()
    ]


def _source_tasks(conn: Conn, user_id: UUID, exam_id: UUID, sitting: int) -> list[SourceTask]:
    return [
        SourceTask(
            id=r["id"],
            title=r["title"],
            kind=TaskKind(r["kind"]),
            minutes=r["estimated_minutes"],
            topic_id=r["topic_id"],
            status=TaskStatus(r["status"]),
            position=r["position"],
            depends_on=r["depends_on_task_id"],
        )
        for r in conn.execute(
            "SELECT id, title, kind, estimated_minutes, topic_id, status, position, "
            "depends_on_task_id FROM app.tasks "
            "WHERE user_id = %s AND exam_id = %s AND sitting = %s AND deleted_at IS NULL "
            "ORDER BY position NULLS LAST, created_at, id",
            (user_id, exam_id, sitting),
        ).fetchall()
    ]


def _check_topics(selected: Sequence[UUID], topics: Sequence[SourceTopic]) -> list[UUID]:
    known = {topic.id for topic in topics}
    if any(topic_id not in known for topic_id in selected):
        raise ApiError(
            "validation_error",
            extra={"errors": [{"loc": ["body", "hard_topic_ids"], "type": "unknown_topic"}]},
        )
    return list(dict.fromkeys(selected))


def _insert_tasks(conn: Conn, user_id: UUID, exam_id: UUID, plan: MoedBPlan) -> int:
    # One by one, in order: a prerequisite always comes before the task that depends on it.
    ids: dict[int, UUID] = {}
    for task in plan.tasks:
        depends_on = None if task.depends_on_key is None else ids[task.depends_on_key]
        row = conn.execute(
            "INSERT INTO app.tasks (user_id, exam_id, title, kind, estimated_minutes, focus, "
            "depends_on_task_id, source, topic_id, position) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, 'ai', %s, %s) RETURNING id",
            (
                user_id,
                exam_id,
                task.title,
                task.kind.value,
                task.minutes,
                task.focus,
                depends_on,
                task.topic_id,
                task.key + 1,
            ),
        ).fetchone()
        if row is None:
            raise RuntimeError("the new task is not visible to this user")
        ids[task.key] = row["id"]
    return len(ids)


def open_moed_b(
    conn: Conn,
    user_id: UUID,
    now: dt.datetime,
    exam_id: UUID,
    exam_date: dt.date,
    grade: int | None,
    hard_topic_ids: Sequence[UUID],
    hard_notes: str | None,
) -> MoedBOutcome:
    """Open the exam's Moed B on exam_date; only from waiting_moed_b (409 otherwise)."""
    board = load_board(conn, user_id, now, lock=True)
    tz = board.profile.timezone
    row = _exam(conn, user_id, exam_id)
    if exam_state(row["exam_date"], row["closure"], now, tz) is not ExamState.WAITING_MOED_B:
        raise ApiError("invalid_state")
    _check_date(exam_date, local_date(now, tz))

    topics = _topics(conn, user_id, exam_id)
    selected = _check_topics(hard_topic_ids, topics)
    notes = None if hard_notes is None else hard_notes.strip() or None

    budget = exam_budgets(
        board.profile,
        [*board.exams, Exam(id=exam_id, exam_date=exam_date, difficulty=row["difficulty"])],
        now,
    ).get(exam_id)
    plan = build_moed_b_tasks(
        topics, _source_tasks(conn, user_id, exam_id, row["sitting"]), selected, notes, budget
    )

    version_id = create_version(
        conn,
        user_id,
        board,
        VersionReason.MOED_B_OPENED,
        exam_id,
        None,
        None,
        exam_before=exam_before(row, EXAM_BEFORE_FIELDS),
    )
    # Sitting 2 before the tasks: the tasks_set_sitting trigger copies it into each new task.
    updated = conn.execute(
        "UPDATE app.exams SET sitting = 2, first_exam_date = exam_date, exam_date = %s, "  # noqa: S608
        "closure = NULL, closed_at = NULL, closure_notified_at = NULL, first_grade = %s, "
        "moed_b_notes = %s, moed_b_topic_ids = %s "
        f"WHERE user_id = %s AND id = %s RETURNING {_EXAM_COLUMNS}",
        (exam_date, grade, notes, list(plan.weak_topic_ids), user_id, exam_id),
    ).fetchone()
    if updated is None:
        raise RuntimeError("the exam is not visible to this user")
    created = _insert_tasks(conn, user_id, exam_id, plan)

    after = load_board(conn, user_id, now)
    result = replan(after.profile, after.exams, after.tasks, after.existing, now)
    write_changes(conn, user_id, changes(after, result), version_id)
    renumber(conn, user_id, now)

    names = {topic.id: topic.name for topic in topics}
    return MoedBOutcome(
        exam=updated,
        state=exam_state(updated["exam_date"], updated["closure"], now, tz),
        version_id=version_id,
        tasks_created=created,
        weak_topics=tuple(WeakTopic(id=i, name=names[i]) for i in plan.weak_topic_ids),
        trimmed=plan.trimmed,
        unscheduled=result.unscheduled,
        shortfalls=result.shortfalls,
    )
