"""Weekly commitments (S35): the user's fixed busy hours, which the planner never schedules over.

A change to a commitment is a global change (7.6 step 8), like a change of the study windows:
it is saved without moving any block, and the answer says plan_affected, so the web offers
POST /plan/replan with a preview. There is no plan version: undo of a setting is the opposite
setting.
"""

import datetime as dt
from collections.abc import Sequence
from typing import Any, Final
from uuid import UUID

from app.errors import ApiError
from app.schemas.commitments import CommitmentIn
from app.services.profiles import Conn

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
