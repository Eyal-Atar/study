"""Weekly commitments (S35): the user's fixed busy hours, which the planner never schedules over.

A change to a commitment is a global change (7.6 step 8), like a change of the study windows:
it is saved without moving any block, and the answer says plan_affected, so the web offers
POST /plan/replan with a preview. There is no plan version: undo of a setting is the opposite
setting.
"""

import datetime as dt
from collections.abc import Mapping, Sequence
from typing import Any, Final
from uuid import UUID

from psycopg import sql

from app.domain.time import local_date, parse_timezone
from app.errors import ApiError
from app.schemas.commitments import CommitmentIn, time_errors, validity_errors
from app.services.profiles import Conn, lock_user

MAX_LIVE_COMMITMENTS: Final = 100

COMMITMENT_COLUMNS: Final = (
    "id, title, kind, weekday, start_time, end_time, valid_from, valid_until, source_job_id, "
    "created_at"
)


_INSERT: Final = (
    "INSERT INTO app.commitments (user_id, title, kind, weekday, start_time, end_time, "
    "valid_from, valid_until, source_job_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) "
    "RETURNING id, title, kind, weekday, start_time, end_time, valid_from, valid_until, "
    "source_job_id, created_at"
)


def live_count(conn: Conn, user_id: UUID) -> int:
    row = conn.execute(
        "SELECT count(*) AS n FROM app.commitments WHERE user_id = %s AND deleted_at IS NULL",
        (user_id,),
    ).fetchone()
    if row is None:
        raise RuntimeError("SELECT count(*) returned no row")
    count: int = row["n"]
    return count


def insert_commitments(
    conn: Conn,
    user_id: UUID,
    items: Sequence[CommitmentIn],
    today: dt.date,
    *,
    source_job_id: UUID | None = None,
) -> list[dict[str, Any]]:
    """Insert the items (already validated, cross-field errors included), in order.

    The caller holds the user lock, so the count and the inserts are one step. More than
    MAX_LIVE_COMMITMENTS live commitments → 422 too_many_commitments, nothing written.
    """
    if live_count(conn, user_id) + len(items) > MAX_LIVE_COMMITMENTS:
        raise ApiError("too_many_commitments", extra={"limit": MAX_LIVE_COMMITMENTS})
    rows: list[dict[str, Any]] = []
    for item in items:
        row = conn.execute(
            _INSERT,
            (
                user_id,
                item.title,
                item.kind,
                item.weekday,
                item.start_time,
                item.end_time,
                item.valid_from or today,
                item.valid_until,
                source_job_id,
            ),
        ).fetchone()
        if row is None:
            raise RuntimeError("the new commitment is not visible to this user")
        rows.append(row)
    return rows


# A change to one of these moves taken time, so the plan may need a replan.
_TIME_FIELDS: Final = frozenset({"weekday", "start_time", "end_time", "valid_from", "valid_until"})
_UPDATABLE: Final = (
    "title",
    "kind",
    "weekday",
    "start_time",
    "end_time",
    "valid_from",
    "valid_until",
)


def _today(conn: Conn, user_id: UUID, now: dt.datetime) -> dt.date:
    """The profile's local today, after taking the user lock (every write here holds it)."""
    profile = lock_user(conn, user_id)
    return local_date(now, parse_timezone(profile.timezone))


def list_commitments(conn: Conn, user_id: UUID) -> list[dict[str, Any]]:
    """The user's live commitments, by (weekday, start_time, end_time, id)."""
    return conn.execute(
        f"SELECT {COMMITMENT_COLUMNS} FROM app.commitments "  # noqa: S608 - a constant list
        "WHERE user_id = %s AND deleted_at IS NULL "
        "ORDER BY weekday, start_time, end_time, id",
        (user_id,),
    ).fetchall()


def create_commitment(
    conn: Conn, user_id: UUID, now: dt.datetime, item: CommitmentIn
) -> dict[str, Any]:
    """Insert one commitment; valid_from defaults to the profile's local today."""
    today = _today(conn, user_id, now)
    if errors := item.errors(today):
        raise ApiError("validation_error", extra={"errors": errors})
    (row,) = insert_commitments(conn, user_id, [item], today)
    return row


def _live(conn: Conn, user_id: UUID, commitment_id: UUID) -> dict[str, Any]:
    row: dict[str, Any] | None = conn.execute(
        f"SELECT {COMMITMENT_COLUMNS} FROM app.commitments "  # noqa: S608 - a constant list
        "WHERE user_id = %s AND id = %s AND deleted_at IS NULL",
        (user_id, commitment_id),
    ).fetchone()
    if row is None:
        raise ApiError("not_found")
    return row


def update_commitment(
    conn: Conn, user_id: UUID, commitment_id: UUID, changes: Mapping[str, Any]
) -> tuple[dict[str, Any], bool]:
    """Change the given fields; the row as it is now, and whether its time changed.

    The merged row is validated like a new one (time_errors, validity_errors), so a change
    of one end is checked against the other. A change of the title or kind alone, or one
    that sends the values already there, does not affect the plan.
    """
    lock_user(conn, user_id)
    current = _live(conn, user_id, commitment_id)
    merged = {**current, **changes}
    errors = [
        *time_errors(merged["start_time"], merged["end_time"]),
        *validity_errors(merged["valid_from"], merged["valid_until"]),
    ]
    if errors:
        raise ApiError("validation_error", extra={"errors": errors})
    fields = [field for field in _UPDATABLE if field in changes]
    assignments = sql.SQL(", ").join(
        sql.SQL("{} = {}").format(sql.Identifier(field), sql.Placeholder()) for field in fields
    )
    row: dict[str, Any] | None = conn.execute(
        sql.SQL(
            "UPDATE app.commitments SET {} WHERE user_id = %s AND id = %s AND deleted_at IS NULL "
            "RETURNING {}"
        ).format(assignments, sql.SQL(COMMITMENT_COLUMNS)),
        [*(changes[field] for field in fields), user_id, commitment_id],
    ).fetchone()
    if row is None:
        raise RuntimeError("the commitment vanished under the user lock")
    plan_affected = any(current[field] != row[field] for field in _TIME_FIELDS)
    return row, plan_affected


def delete_commitment(conn: Conn, user_id: UUID, now: dt.datetime, commitment_id: UUID) -> None:
    """Soft-delete a live commitment; a deleted or unknown one is not_found."""
    lock_user(conn, user_id)
    row = conn.execute(
        "UPDATE app.commitments SET deleted_at = %s "
        "WHERE user_id = %s AND id = %s AND deleted_at IS NULL RETURNING id",
        (now, user_id, commitment_id),
    ).fetchone()
    if row is None:
        raise ApiError("not_found")
