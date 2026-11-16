"""The account (S15): export everything the user owns, and delete the account at once.

Every query runs in the user's transaction (RLS) and still filters on `user_id`
explicitly. The export lists its columns by name: a column is exported only when it is
written here, so `materials.text_by_page`, `materials.storage_path`,
`analyses.material_keys` and `blocks.plan_version_id` (and any column a later migration
adds) never leave the database by accident. `plan_versions` and `jobs` are internal
(undo snapshots, operations) and are not exported.

The deletion (spec 7.11, plan S15 decision 9) has two steps: here, in one transaction,
`app.delete_account_data()` removes every app row of `auth.uid()` and the delete_account job
is queued; the worker then deletes the files and the Auth user (app/jobs/account.py).
"""

import datetime as dt
from collections.abc import Mapping
from typing import Any, Final
from uuid import UUID

from psycopg import sql

from app.domain.materials import JOB_DELETE_ACCOUNT
from app.domain.time import local_date, parse_timezone
from app.jobs.queue import enqueue
from app.services.profiles import Conn, ProfileRow, ensure_profile, lock_user

EXPORT_FORMAT: Final = "studyflow-export"
EXPORT_VERSION: Final = 1

# table -> (the columns exported, in this order; the ORDER BY). Constants only: they are
# composed as identifiers, never taken from a request.
_EXPORTED: Final[Mapping[str, tuple[tuple[str, ...], tuple[str, ...]]]] = {
    "exams": (
        ("id", "name", "exam_date", "difficulty", "deleted_at", "created_at"),
        ("created_at", "id"),
    ),
    "tasks": (
        (
            "id",
            "exam_id",
            "title",
            "kind",
            "estimated_minutes",
            "focus",
            "depends_on_task_id",
            "status",
            "source",
            "topic_id",
            "material_id",
            "position",
            "analysis_id",
            "deleted_at",
            "created_at",
        ),
        ("created_at", "id"),
    ),
    "blocks": (
        (
            "id",
            "task_id",
            "starts_at",
            "ends_at",
            "part_index",
            "part_count",
            "pinned",
            "status",
            "created_at",
        ),
        ("starts_at", "id"),
    ),
    "topics": (
        ("id", "exam_id", "name", "weight", "evidence", "position", "analysis_id", "created_at"),
        ("created_at", "id"),
    ),
    "materials": (
        (
            "id",
            "exam_id",
            "filename",
            "kind",
            "mime",
            "size_bytes",
            "page_count",
            "scanned_pages",
            "ingest_status",
            "ingest_error",
            "warnings",
            "created_at",
            "ingested_at",
        ),
        ("created_at", "id"),
    ),
    "analyses": (
        (
            "id",
            "exam_id",
            "status",
            "error",
            "output",
            "warnings",
            "dropped",
            "total_minutes",
            "budget_minutes",
            "created_at",
            "applied_at",
            "undone_at",
        ),
        ("created_at", "id"),
    ),
    "ai_usage": (
        (
            "model",
            "input_tokens",
            "output_tokens",
            "cache_creation_input_tokens",
            "cache_read_input_tokens",
            "exam_id",
            "created_at",
        ),
        # id breaks ties but is not exported (it means nothing to the user).
        ("created_at", "id"),
    ),
}


def _rows(conn: Conn, table: str, user_id: UUID) -> list[dict[str, Any]]:
    columns, order = _EXPORTED[table]
    query = sql.SQL("SELECT {columns} FROM {table} WHERE user_id = %s ORDER BY {order}").format(
        columns=sql.SQL(", ").join(sql.Identifier(column) for column in columns),
        table=sql.Identifier("app", table),
        order=sql.SQL(", ").join(sql.Identifier(column) for column in order),
    )
    return [dict(row) for row in conn.execute(query, (user_id,)).fetchall()]


def export_account(conn: Conn, user_id: UUID) -> tuple[ProfileRow, dict[str, list[dict[str, Any]]]]:
    """The profile (created if missing) and the user's rows of every exported table.

    One transaction, READ COMMITTED: each SELECT sees the commits made before it started.
    A board write committing between two of them could make the file slightly uneven;
    the export is a copy for the user, not a backup that is restored.
    """
    profile = ensure_profile(conn, user_id)
    return profile, {table: _rows(conn, table, user_id) for table in _EXPORTED}


def export_filename(profile: ProfileRow, now: dt.datetime) -> str:
    """studyflow-export-YYYY-MM-DD.json, by the user's local day."""
    day = local_date(now, parse_timezone(profile.timezone))
    return f"studyflow-export-{day.isoformat()}.json"


def delete_account(conn: Conn, user_id: UUID) -> UUID:
    """Delete every app row of the user now and queue the worker's delete_account job.

    `lock_user` first, like every board write: a write already holding the lock finishes
    before this, and one that comes after waits and then finds no profile. The function
    deletes only `auth.uid()`, the user of this transaction, so `user_id` is used for the
    job row only (RLS and the INSERT grant check it is the same user). It also deletes the
    user's earlier jobs, a queued delete_account included: there is only ever one.
    """
    lock_user(conn, user_id)
    conn.execute("SELECT app.delete_account_data()")
    return enqueue(conn, user_id, JOB_DELETE_ACCOUNT, {})
