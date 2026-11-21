"""Tasks: create, change and soft delete, each placed (or freed) without touching the rest."""

import datetime as dt
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final
from uuid import UUID

from psycopg import sql

from app.domain.planner import BlockStatus, TaskStatus, place_task, start_minute
from app.domain.time import local_date
from app.errors import ApiError
from app.services.board import Board, load_board
from app.services.plan_writes import (
    VersionReason,
    apply_result,
    delete_open_blocks,
    task_before,
)
from app.services.profiles import Conn

TASK_COLUMNS: Final = (
    "id, exam_id, title, kind, estimated_minutes, focus, depends_on_task_id, status, "
    "source, created_at, topic_id, material_id, position, bite_minutes"
)
_UPDATABLE: Final = frozenset(
    {"title", "kind", "estimated_minutes", "focus", "depends_on_task_id", "status", "topic_id"}
)
# A change to one of these moves the task on the board.
_PLACEMENT_FIELDS: Final = frozenset(
    {"kind", "estimated_minutes", "focus", "depends_on_task_id", "status"}
)

type Row = Mapping[str, Any]


@dataclass(frozen=True)
class PlacementOutcome:
    placed: bool
    reason: str | None
    blocked_by: UUID | None


_TASK_COLUMNS_OF_T: Final = ", ".join(f"t.{column.strip()}" for column in TASK_COLUMNS.split(","))


def list_tasks(conn: Conn, user_id: UUID, exam_id: UUID) -> Sequence[Row]:
    """The exam's live tasks, each with its analysis's reason (output.tasks[position - 1])."""
    exam = conn.execute(
        "SELECT sitting FROM app.exams WHERE user_id = %s AND id = %s AND deleted_at IS NULL",
        (user_id, exam_id),
    ).fetchone()
    if exam is None:
        raise ApiError("not_found")
    return conn.execute(
        f"SELECT {_TASK_COLUMNS_OF_T}, "  # noqa: S608 - a constant column list
        "a.output -> 'tasks' -> (t.position - 1) ->> 'reason' AS reason "
        "FROM app.tasks t "
        "LEFT JOIN app.analyses a ON a.id = t.analysis_id AND a.user_id = t.user_id "
        "AND t.source = 'ai' "
        "WHERE t.user_id = %s AND t.exam_id = %s AND t.deleted_at IS NULL AND t.sitting = %s "
        "ORDER BY t.position NULLS LAST, t.created_at, t.id",
        (user_id, exam_id, exam["sitting"]),
    ).fetchall()


def _live_task(conn: Conn, user_id: UUID, task_id: UUID) -> Row:
    """The task, if neither it nor its exam is deleted; else not_found."""
    row = conn.execute(
        f"SELECT {_TASK_COLUMNS_OF_T} FROM app.tasks t "  # noqa: S608 - a constant column list
        "JOIN app.exams e ON e.id = t.exam_id AND e.user_id = t.user_id "
        "WHERE t.user_id = %s AND t.id = %s AND t.deleted_at IS NULL AND e.deleted_at IS NULL",
        (user_id, task_id),
    ).fetchone()
    if row is None:
        raise ApiError("not_found")
    return row


def _refuse_closed(conn: Conn, user_id: UUID, task_id: UUID) -> None:
    """A task of a closed exam, or of a past sitting, is history: exam_in_past (as create_task)."""
    row = conn.execute(
        "SELECT 1 FROM app.tasks t JOIN app.exams e ON e.id = t.exam_id AND e.user_id = t.user_id "
        "WHERE t.user_id = %s AND t.id = %s AND e.closure IS NULL AND e.sitting = t.sitting",
        (user_id, task_id),
    ).fetchone()
    if row is None:
        raise ApiError("exam_in_past")


def _check_topic(conn: Conn, user_id: UUID, exam_id: UUID, topic_id: UUID) -> None:
    """The topic must belong to the same user and exam (the FK would say so, as a 500)."""
    row = conn.execute(
        "SELECT 1 FROM app.topics WHERE user_id = %s AND id = %s AND exam_id = %s",
        (user_id, topic_id, exam_id),
    ).fetchone()
    if row is None:
        raise ApiError("not_found")


def _check_cycle(conn: Conn, user_id: UUID, task_id: UUID, target: UUID) -> None:
    """Walk depends_on_task_id from the proposed target; reaching the task is a cycle."""
    seen: set[UUID] = set()
    current: UUID | None = target
    while current is not None and current not in seen:
        if current == task_id:
            raise ApiError("dependency_cycle")
        seen.add(current)
        row = conn.execute(
            "SELECT depends_on_task_id FROM app.tasks "
            "WHERE user_id = %s AND id = %s AND deleted_at IS NULL",
            (user_id, current),
        ).fetchone()
        current = None if row is None else row["depends_on_task_id"]


def _place(
    conn: Conn,
    user_id: UUID,
    now: dt.datetime,
    task_id: UUID,
    reason: VersionReason,
    before: Row | None = None,
    after: Row | None = None,
) -> tuple[PlacementOutcome | None, UUID | None]:
    """Place the task on a fresh board, releasing its candidate blocks; None if not on it."""
    board: Board = load_board(conn, user_id, now, lock=True)
    task = next((t for t in board.tasks if t.id == task_id), None)
    if task is None or task.status is not TaskStatus.TODO:
        return None, None
    start = start_minute(now)
    release = [
        block.id
        for block in board.blocks
        if block.task_id == task_id
        and block.status is BlockStatus.PLANNED
        and not block.pinned
        and block.starts_at >= start
    ]
    result = place_task(
        board.profile, board.exams, board.tasks, board.existing, task_id, now, release=release
    )
    if result.unscheduled:
        failure = result.unscheduled[0]
        return PlacementOutcome(False, failure.reason.value, failure.blocked_by), None
    version_id = apply_result(
        conn,
        user_id,
        board,
        result,
        reason,
        task_id=task_id,
        before=None if before is None else task_before(before, after),
    )
    return PlacementOutcome(True, None, None), version_id


def create_task(
    conn: Conn, user_id: UUID, now: dt.datetime, values: Mapping[str, Any]
) -> tuple[Row, PlacementOutcome, UUID | None]:
    board = load_board(conn, user_id, now, lock=True)
    exam = conn.execute(
        "SELECT exam_date, closure FROM app.exams "
        "WHERE user_id = %s AND id = %s AND deleted_at IS NULL",
        (user_id, values["exam_id"]),
    ).fetchone()
    if exam is None:
        raise ApiError("not_found")
    if exam["closure"] is not None or exam["exam_date"] < local_date(now, board.profile.timezone):
        raise ApiError("exam_in_past")
    if values["depends_on_task_id"] is not None:
        _live_task(conn, user_id, values["depends_on_task_id"])
    if values["topic_id"] is not None:
        _check_topic(conn, user_id, values["exam_id"], values["topic_id"])
    row = conn.execute(
        "INSERT INTO app.tasks (user_id, exam_id, title, kind, estimated_minutes, focus, "  # noqa: S608
        "depends_on_task_id, topic_id, source) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'user') "
        f"RETURNING {TASK_COLUMNS}",
        (
            user_id,
            values["exam_id"],
            values["title"],
            values["kind"],
            values["estimated_minutes"],
            values["focus"],
            values["depends_on_task_id"],
            values["topic_id"],
        ),
    ).fetchone()
    if row is None:
        raise RuntimeError("the new task is not visible to this user")
    outcome, version_id = _place(conn, user_id, now, row["id"], VersionReason.TASK_ADDED)
    if outcome is None:  # a todo task of a live exam is always on the board
        raise RuntimeError("the new task is not on the board")
    return row, outcome, version_id


def update_task(
    conn: Conn, user_id: UUID, now: dt.datetime, task_id: UUID, changes: Mapping[str, Any]
) -> tuple[Row, PlacementOutcome | None, UUID | None]:
    unknown = set(changes) - _UPDATABLE
    if unknown:
        raise ValueError(f"Not updatable: {sorted(unknown)}")
    board = load_board(conn, user_id, now, lock=True)
    before = _live_task(conn, user_id, task_id)
    _refuse_closed(conn, user_id, task_id)
    target = changes.get("depends_on_task_id")
    if target is not None:
        _live_task(conn, user_id, target)
        _check_cycle(conn, user_id, task_id, target)
    topic = changes.get("topic_id")
    if topic is not None:
        _check_topic(conn, user_id, before["exam_id"], topic)
    assignments = sql.SQL(", ").join(
        sql.SQL("{} = {}").format(sql.Identifier(column), sql.Placeholder()) for column in changes
    )
    row = conn.execute(
        sql.SQL("UPDATE app.tasks SET {} WHERE user_id = %s AND id = %s RETURNING {}").format(
            assignments, sql.SQL(TASK_COLUMNS)
        ),
        [*changes.values(), user_id, task_id],
    ).fetchone()
    if row is None:
        raise RuntimeError("the task vanished while it was locked")

    # Only a value that differs from the row moves the task: a PATCH that sends the
    # current focus (say) leaves the board as it is.
    moved = {field for field in _PLACEMENT_FIELDS & changes.keys() if before[field] != row[field]}
    if "status" in moved and row["status"] in ("done", "skipped"):
        version_id = delete_open_blocks(
            conn,
            user_id,
            board,
            [task_id],
            VersionReason.TASK_CHANGED,
            task_id=task_id,
            before=task_before(before, row),
        )
        return row, None, version_id
    if moved:
        outcome, version_id = _place(
            conn, user_id, now, task_id, VersionReason.TASK_CHANGED, before, row
        )
        return row, outcome, version_id
    return row, None, None


def delete_task(conn: Conn, user_id: UUID, now: dt.datetime, task_id: UUID) -> UUID | None:
    board = load_board(conn, user_id, now, lock=True)
    _live_task(conn, user_id, task_id)
    _refuse_closed(conn, user_id, task_id)
    conn.execute(
        "UPDATE app.tasks SET deleted_at = %s WHERE user_id = %s AND id = %s",
        (now, user_id, task_id),
    )
    return delete_open_blocks(
        conn,
        user_id,
        board,
        [task_id],
        VersionReason.TASK_DELETED,
        task_id=task_id,
        always_version=True,
    )
