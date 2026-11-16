"""Topics of an exam: the list the exam screen shows, and editing a topic in place."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final
from uuid import UUID

from psycopg import sql

from app.errors import ApiError
from app.services.profiles import Conn

TOPIC_COLUMNS: Final = "id, exam_id, name, weight, evidence, position, analysis_id"
_TOPIC_COLUMNS_OF_TP: Final = ", ".join(
    f"tp.{column.strip()}" for column in TOPIC_COLUMNS.split(",")
)
_UPDATABLE: Final = frozenset({"name", "weight"})

type Row = Mapping[str, Any]


@dataclass(frozen=True)
class ExamTopics:
    analysis_id: UUID | None
    draft_analysis_id: UUID | None
    topics: Sequence[Row]
    gaps: Sequence[Mapping[str, Any]]


def _latest(conn: Conn, user_id: UUID, exam_id: UUID, status: str, order: str) -> Row | None:
    return conn.execute(
        sql.SQL(
            "SELECT id, output FROM app.analyses "
            "WHERE user_id = %s AND exam_id = %s AND status = %s "
            "ORDER BY {} DESC NULLS LAST, created_at DESC, id DESC LIMIT 1"
        ).format(sql.Identifier(order)),
        (user_id, exam_id, status),
    ).fetchone()


def exam_topics(conn: Conn, user_id: UUID, exam_id: UUID) -> ExamTopics:
    exam = conn.execute(
        "SELECT 1 FROM app.exams WHERE user_id = %s AND id = %s AND deleted_at IS NULL",
        (user_id, exam_id),
    ).fetchone()
    if exam is None:
        raise ApiError("not_found")
    applied = _latest(conn, user_id, exam_id, "applied", "applied_at")
    draft = _latest(conn, user_id, exam_id, "draft", "created_at")
    applied_id: UUID | None = None if applied is None else applied["id"]
    topics = conn.execute(
        f"SELECT {_TOPIC_COLUMNS_OF_TP} FROM app.topics tp "  # noqa: S608 - a constant column list
        "WHERE tp.user_id = %(user_id)s AND tp.exam_id = %(exam_id)s "
        "AND (tp.analysis_id = %(analysis_id)s OR EXISTS ("
        "    SELECT 1 FROM app.tasks t "
        "    WHERE t.user_id = %(user_id)s AND t.exam_id = %(exam_id)s "
        "      AND t.topic_id = tp.id AND t.deleted_at IS NULL"
        ")) "
        "ORDER BY tp.position NULLS LAST, tp.created_at, tp.id",
        {"user_id": user_id, "exam_id": exam_id, "analysis_id": applied_id},
    ).fetchall()
    output = None if applied is None else applied["output"]
    gaps = output.get("gaps") if isinstance(output, dict) else None
    return ExamTopics(
        analysis_id=applied_id,
        draft_analysis_id=None if draft is None else draft["id"],
        topics=topics,
        gaps=gaps if isinstance(gaps, list) else [],
    )


def update_topic(conn: Conn, user_id: UUID, topic_id: UUID, changes: Mapping[str, Any]) -> Row:
    """Rename or reweigh a topic of a live exam. The board does not depend on it."""
    unknown = set(changes) - _UPDATABLE
    if unknown or not changes:
        raise ValueError(f"Not updatable: {sorted(unknown)}")
    assignments = sql.SQL(", ").join(
        sql.SQL("{} = {}").format(sql.Identifier(column), sql.Placeholder()) for column in changes
    )
    row = conn.execute(
        sql.SQL(
            "UPDATE app.topics tp SET {} FROM app.exams e "
            "WHERE tp.user_id = %s AND tp.id = %s "
            "AND e.user_id = tp.user_id AND e.id = tp.exam_id AND e.deleted_at IS NULL "
            "RETURNING {}"
        ).format(assignments, sql.SQL(_TOPIC_COLUMNS_OF_TP)),
        [*changes.values(), user_id, topic_id],
    ).fetchone()
    if row is None:
        raise ApiError("not_found")
    return row
