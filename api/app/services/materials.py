"""Materials: register an upload (and queue its ingest), list them, delete one.

The row and its job are written in the caller's one transaction, so a refused or failed
registration leaves neither behind. Every check runs before the first write.
"""

from collections.abc import Mapping, Sequence
from typing import Any, Final
from uuid import UUID

import psycopg.errors

from app.config import Settings
from app.domain.materials import JOB_DELETE_MATERIAL_FILE, JOB_INGEST_MATERIAL, MaterialKind
from app.errors import ApiError
from app.jobs.queue import enqueue
from app.services.profiles import Conn, lock_user

MATERIAL_COLUMNS: Final = (
    "id, exam_id, filename, kind, mime, size_bytes, page_count, scanned_pages, ingest_status, "
    "ingest_error, warnings, created_at, ingested_at"
)

type Row = Mapping[str, Any]


def storage_path(user_id: UUID, exam_id: UUID, material_id: UUID) -> str:
    """The object's path in the bucket; the table's CHECK requires exactly this."""
    return f"{user_id}/{exam_id}/{material_id}"


def _require_live_exam(conn: Conn, user_id: UUID, exam_id: UUID) -> None:
    exam = conn.execute(
        "SELECT 1 FROM app.exams WHERE user_id = %s AND id = %s AND deleted_at IS NULL",
        (user_id, exam_id),
    ).fetchone()
    if exam is None:
        raise ApiError("not_found")


def list_materials(conn: Conn, user_id: UUID, exam_id: UUID) -> Sequence[Row]:
    _require_live_exam(conn, user_id, exam_id)
    return conn.execute(
        f"SELECT {MATERIAL_COLUMNS} FROM app.materials "  # noqa: S608 - a constant column list
        "WHERE user_id = %s AND exam_id = %s ORDER BY created_at, id",
        (user_id, exam_id),
    ).fetchall()


def register_material(
    conn: Conn,
    user_id: UUID,
    exam_id: UUID,
    *,
    material_id: UUID,
    filename: str,
    kind: MaterialKind,
    mime: str,
    size_bytes: int,
    settings: Settings,
) -> tuple[Row, UUID]:
    """Insert the material and queue its ingest job; returns the row and the job's id."""
    # The per-user lock (the profile row) makes the count and the INSERT one step: without it,
    # parallel registrations would all count the same number and pass the limit together.
    lock_user(conn, user_id)
    _require_live_exam(conn, user_id, exam_id)
    if size_bytes > settings.max_material_bytes:
        raise ApiError("file_too_large", extra={"limit_bytes": settings.max_material_bytes})
    count_row = conn.execute(
        "SELECT count(*) AS n FROM app.materials WHERE user_id = %s AND exam_id = %s",
        (user_id, exam_id),
    ).fetchone()
    if count_row is None:
        raise RuntimeError("SELECT count(*) returned no row")
    if count_row["n"] >= settings.max_materials_per_exam:
        raise ApiError("too_many_materials", extra={"limit": settings.max_materials_per_exam})
    try:
        row = conn.execute(
            "INSERT INTO app.materials "  # noqa: S608 - a constant column list
            "(id, user_id, exam_id, storage_path, filename, kind, mime, size_bytes) "
            f"VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING {MATERIAL_COLUMNS}",
            (
                material_id,
                user_id,
                exam_id,
                storage_path(user_id, exam_id, material_id),
                filename,
                kind,
                mime,
                size_bytes,
            ),
        ).fetchone()
    except psycopg.errors.UniqueViolation as error:
        # Deliberately 409, also when the id is another user's material (the primary key is
        # global): ids are random v4 UUIDs chosen by the client, so this reveals nothing useful,
        # and the plan accepted it. Do not turn it into a 404.
        raise ApiError("already_exists") from error
    if row is None:
        raise RuntimeError("the new material is not visible to this user")
    job_id = enqueue(conn, user_id, JOB_INGEST_MATERIAL, {"material_id": str(material_id)})
    return row, job_id


def delete_material(conn: Conn, user_id: UUID, material_id: UUID) -> UUID:
    """Delete the row and queue the deletion of its file; returns the job's id."""
    row = conn.execute(
        "DELETE FROM app.materials WHERE user_id = %s AND id = %s RETURNING storage_path",
        (user_id, material_id),
    ).fetchone()
    if row is None:
        raise ApiError("not_found")
    return enqueue(conn, user_id, JOB_DELETE_MATERIAL_FILE, {"storage_path": row["storage_path"]})


def update_kind(conn: Conn, user_id: UUID, material_id: UUID, kind: MaterialKind) -> Row:
    """Set the kind of a material whose exam is live; no re-analysis, the board is untouched."""
    row = conn.execute(
        "UPDATE app.materials SET kind = %s "  # noqa: S608 - a constant column list
        "WHERE user_id = %s AND id = %s AND EXISTS ("
        "SELECT 1 FROM app.exams WHERE app.exams.id = app.materials.exam_id "
        "AND app.exams.user_id = %s AND app.exams.deleted_at IS NULL) "
        f"RETURNING {MATERIAL_COLUMNS}",
        (kind, user_id, material_id, user_id),
    ).fetchone()
    if row is None:
        raise ApiError("not_found")
    return row
