"""Exams: list, create, change and soft delete (which also frees their future blocks)."""

import datetime as dt
from collections.abc import Mapping, Sequence
from typing import Any, Final
from uuid import UUID

from psycopg import sql

from app.domain.time import local_date
from app.errors import ApiError
from app.services.board import load_board
from app.services.plan_writes import VersionReason, delete_open_blocks
from app.services.profiles import Conn, ensure_profile, to_planner_profile

EXAM_COLUMNS: Final = "id, name, exam_date, difficulty, created_at"
_UPDATABLE: Final = frozenset({"name", "exam_date", "difficulty"})
_PLAN_FIELDS: Final = ("exam_date", "difficulty")
# How far ahead an exam may be: the planner works day by day up to the exam, so a date
# years away (or 9999-12-31) would cost seconds of CPU or overflow its date arithmetic.
MAX_DAYS_AHEAD: Final = 730

type Row = Mapping[str, Any]


def _today(conn: Conn, user_id: UUID, now: dt.datetime) -> dt.date:
    profile = to_planner_profile(ensure_profile(conn, user_id))
    return local_date(now, profile.timezone)


def _check_date(exam_date: dt.date, today: dt.date) -> None:
    if exam_date < today:
        raise ApiError("exam_in_past")
    if exam_date > today + dt.timedelta(days=MAX_DAYS_AHEAD):
        raise ApiError(
            "validation_error",
            extra={"errors": [{"loc": ["body", "exam_date"], "type": "too_far_ahead"}]},
        )


def list_exams(conn: Conn, user_id: UUID) -> Sequence[Row]:
    return conn.execute(
        f"SELECT {EXAM_COLUMNS} FROM app.exams "  # noqa: S608 - a constant column list
        "WHERE user_id = %s AND deleted_at IS NULL ORDER BY exam_date, created_at, id",
        (user_id,),
    ).fetchall()


def _live_exam(conn: Conn, user_id: UUID, exam_id: UUID) -> Row:
    row = conn.execute(
        f"SELECT {EXAM_COLUMNS} FROM app.exams "  # noqa: S608 - a constant column list
        "WHERE user_id = %s AND id = %s AND deleted_at IS NULL",
        (user_id, exam_id),
    ).fetchone()
    if row is None:
        raise ApiError("not_found")
    return row


def create_exam(
    conn: Conn,
    user_id: UUID,
    now: dt.datetime,
    name: str,
    exam_date: dt.date,
    difficulty: int,
) -> Row:
    _check_date(exam_date, _today(conn, user_id, now))
    row = conn.execute(
        "INSERT INTO app.exams (user_id, name, exam_date, difficulty) VALUES (%s, %s, %s, %s) "  # noqa: S608
        f"RETURNING {EXAM_COLUMNS}",
        (user_id, name, exam_date, difficulty),
    ).fetchone()
    if row is None:
        raise RuntimeError("the new exam is not visible to this user")
    return row


def update_exam(
    conn: Conn, user_id: UUID, now: dt.datetime, exam_id: UUID, changes: Mapping[str, Any]
) -> tuple[Row, bool]:
    unknown = set(changes) - _UPDATABLE
    if unknown:
        raise ValueError(f"Not updatable: {sorted(unknown)}")
    board = load_board(conn, user_id, now, lock=True)
    before = _live_exam(conn, user_id, exam_id)
    if "exam_date" in changes:
        _check_date(changes["exam_date"], local_date(now, board.profile.timezone))
    assignments = sql.SQL(", ").join(
        sql.SQL("{} = {}").format(sql.Identifier(column), sql.Placeholder()) for column in changes
    )
    row = conn.execute(
        sql.SQL("UPDATE app.exams SET {} WHERE user_id = %s AND id = %s RETURNING {}").format(
            assignments, sql.SQL(EXAM_COLUMNS)
        ),
        [*changes.values(), user_id, exam_id],
    ).fetchone()
    if row is None:
        raise RuntimeError("the exam vanished while it was locked")
    plan_affected = any(before[field] != row[field] for field in _PLAN_FIELDS if field in changes)
    return row, plan_affected


def delete_exam(conn: Conn, user_id: UUID, now: dt.datetime, exam_id: UUID) -> UUID | None:
    board = load_board(conn, user_id, now, lock=True)
    _live_exam(conn, user_id, exam_id)
    conn.execute(
        "UPDATE app.exams SET deleted_at = %s WHERE user_id = %s AND id = %s",
        (now, user_id, exam_id),
    )
    task_ids = [
        row["id"]
        for row in conn.execute(
            "SELECT id FROM app.tasks WHERE user_id = %s AND exam_id = %s AND deleted_at IS NULL",
            (user_id, exam_id),
        ).fetchall()
    ]
    return delete_open_blocks(
        conn,
        user_id,
        board,
        task_ids,
        VersionReason.EXAM_DELETED,
        exam_id=exam_id,
        always_version=True,
    )
