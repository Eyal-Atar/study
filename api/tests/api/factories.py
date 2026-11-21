"""Rows written straight to the test database (as the owner, past RLS) for API tests."""

import datetime as dt
from typing import Any
from uuid import UUID, uuid4

import psycopg
from fastapi.testclient import TestClient
from psycopg import sql

from tests.fixtures_db import ApiUser

DELETED_AT = dt.datetime(2026, 11, 1, tzinfo=dt.UTC)
# Monday 2026-11-16, 05:00 UTC: an hour before the test profile wakes up.
NOW = dt.datetime(2026, 11, 16, 5, 0, tzinfo=dt.UTC)
TEST_PROFILE: dict[str, Any] = {
    "timezone": "UTC",
    "wake_time": "06:00",
    "sleep_time": "23:00",
    "study_windows": ["morning", "afternoon"],
    "daily_study_minutes": 240,
    "rest_days_before_exam": 0,
}


def Z(year: int, month: int, day: int, hour: int = 0, minute: int = 0) -> dt.datetime:
    """An aware UTC datetime: Z(2026, 11, 16, 9, 0)."""
    return dt.datetime(year, month, day, hour, minute, tzinfo=dt.UTC)


def _id(row: tuple[Any, ...] | None) -> UUID:
    assert row is not None
    return UUID(str(row[0]))


def insert_exam(
    db: psycopg.Connection,
    user_id: UUID,
    *,
    name: str = "מבחן",
    exam_date: dt.date | str,
    difficulty: int = 3,
    deleted: bool = False,
) -> UUID:
    return _id(
        db.execute(
            "INSERT INTO app.exams (user_id, name, exam_date, difficulty, deleted_at) "
            "VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (user_id, name, exam_date, difficulty, DELETED_AT if deleted else None),
        ).fetchone()
    )


def insert_task(
    db: psycopg.Connection,
    user_id: UUID,
    exam_id: UUID,
    *,
    title: str = "משימה",
    kind: str = "learn",
    minutes: int = 60,
    focus: int = 5,
    depends_on: UUID | None = None,
    status: str = "todo",
    created_at: dt.datetime | None = None,
) -> UUID:
    return _id(
        db.execute(
            "INSERT INTO app.tasks (user_id, exam_id, title, kind, estimated_minutes, focus, "
            "depends_on_task_id, status, source, created_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'user', coalesce(%s, now())) RETURNING id",
            (user_id, exam_id, title, kind, minutes, focus, depends_on, status, created_at),
        ).fetchone()
    )


def insert_block(
    db: psycopg.Connection,
    user_id: UUID,
    task_id: UUID,
    starts_at: dt.datetime,
    ends_at: dt.datetime,
    *,
    status: str = "planned",
    pinned: bool = False,
    part_index: int = 1,
    part_count: int = 1,
) -> UUID:
    return _id(
        db.execute(
            "INSERT INTO app.blocks (user_id, task_id, starts_at, ends_at, status, pinned, "
            "part_index, part_count) VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (user_id, task_id, starts_at, ends_at, status, pinned, part_index, part_count),
        ).fetchone()
    )


def set_profile(db: psycopg.Connection, user_id: UUID, **columns: Any) -> None:
    """Create the profile if missing and set the given columns."""
    db.execute("INSERT INTO app.profiles (id) VALUES (%s) ON CONFLICT DO NOTHING", (user_id,))
    if not columns:
        return
    assignments = sql.SQL(", ").join(
        sql.SQL("{} = {}").format(sql.Identifier(name), sql.Placeholder()) for name in columns
    )
    db.execute(
        sql.SQL("UPDATE app.profiles SET {} WHERE id = %s").format(assignments),
        [*columns.values(), user_id],
    )


def scalar(db: psycopg.Connection, query: str, *params: object) -> Any:
    """The single value of a query run as the owner."""
    row = db.execute(query, params).fetchone()
    assert row is not None
    return row[0]


def replan_preview(api: TestClient, user: ApiUser) -> dict[str, Any]:
    response = api.post("/plan/replan", json={"preview": True}, headers=user.headers)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def replan_apply(api: TestClient, user: ApiUser, basis: str | None = None) -> dict[str, Any]:
    """Apply a replan with the given basis, or with a fresh preview's."""
    if basis is None:
        basis = replan_preview(api, user)["basis"]
    response = api.post(
        "/plan/replan", json={"preview": False, "basis": basis}, headers=user.headers
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def register_material(
    api: TestClient,
    user: ApiUser,
    exam_id: UUID,
    *,
    material_id: UUID | None = None,
    filename: str = "מבחן.pdf",
    kind: str = "past_exam",
    mime: str = "application/pdf",
    size_bytes: int = 1000,
) -> dict[str, Any]:
    """Register a material through the API; expects 201 and returns the body."""
    response = api.post(
        f"/exams/{exam_id}/materials",
        json={
            "id": str(material_id if material_id is not None else uuid4()),
            "filename": filename,
            "kind": kind,
            "mime": mime,
            "size_bytes": size_bytes,
        },
        headers=user.headers,
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def insert_material(
    db: psycopg.Connection,
    user_id: UUID,
    exam_id: UUID,
    *,
    material_id: UUID | None = None,
    filename: str = "מבחן.pdf",
    kind: str = "past_exam",
    mime: str = "application/pdf",
    size_bytes: int = 1000,
    created_at: dt.datetime | None = None,
) -> UUID:
    """A material row written as the owner, with the storage path the CHECK requires."""
    material_id = material_id if material_id is not None else uuid4()
    return _id(
        db.execute(
            "INSERT INTO app.materials (id, user_id, exam_id, storage_path, filename, kind, "
            "mime, size_bytes, created_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, coalesce(%s, now())) RETURNING id",
            (
                material_id,
                user_id,
                exam_id,
                f"{user_id}/{exam_id}/{material_id}",
                filename,
                kind,
                mime,
                size_bytes,
                created_at,
            ),
        ).fetchone()
    )


def insert_analysis(
    db: psycopg.Connection, user_id: UUID, exam_id: UUID, status: str = "applied"
) -> UUID:
    """An analysis row of the exam; an applied one is dated now, so a later one is the latest."""
    return _id(
        db.execute(
            "INSERT INTO app.analyses (user_id, exam_id, status, output, applied_at) "
            "VALUES (%s, %s, %s, '{}', CASE WHEN %s = 'applied' THEN clock_timestamp() END) "
            "RETURNING id",
            (user_id, exam_id, status, status),
        ).fetchone()
    )
