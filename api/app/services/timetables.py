"""A timetable photo (S35): register the upload as a parse_timetable job, then approve it.

The browser uploads the file to the materials bucket at timetable_path(user_id, id) and
then registers it here; the API builds the path itself, so a job only ever reads a file of
its own user. The job writes no commitments: Claude's proposal waits in jobs.result until
the user approves the items they keep (edited or not), which are written then, each one
checked like POST /commitments, with source_job_id. Like every commitment change this is a
global change (plan_affected, no plan version).
"""

import datetime as dt
from collections.abc import Sequence
from typing import Any
from uuid import UUID

from app.config import Settings
from app.domain.materials import IMAGE_MIMES, JOB_PARSE_TIMETABLE, timetable_path
from app.domain.time import local_date, parse_timezone
from app.errors import ApiError
from app.jobs.queue import enqueue
from app.schemas.commitments import CommitmentIn
from app.services.commitments import insert_commitments
from app.services.generation import check_quota
from app.services.profiles import Conn, lock_user


def size_limit(mime: str, settings: Settings) -> int:
    """An image goes to Claude as is (its own limit); a PDF only as a material may."""
    if mime in IMAGE_MIMES:
        return min(settings.max_timetable_image_bytes, settings.max_material_bytes)
    return settings.max_material_bytes


def register_timetable(
    conn: Conn,
    user_id: UUID,
    upload_id: UUID,
    mime: str,
    size_bytes: int,
    now: dt.datetime,
    settings: Settings,
) -> UUID:
    """Queue the parse_timetable job of an uploaded file; returns the job's id.

    Under the user lock the duplicate check, the quota count and the enqueue are one step.
    """
    lock_user(conn, user_id)
    limit = size_limit(mime, settings)
    if size_bytes > limit:
        raise ApiError("file_too_large", extra={"limit_bytes": limit})
    duplicate = conn.execute(
        "SELECT 1 FROM app.jobs WHERE user_id = %s AND kind = %s AND payload->>'upload_id' = %s",
        (user_id, JOB_PARSE_TIMETABLE, str(upload_id)),
    ).fetchone()
    if duplicate is not None:
        raise ApiError("already_exists")
    check_quota(
        conn,
        user_id,
        now,
        settings,
        kinds=(JOB_PARSE_TIMETABLE,),
        limit=settings.ai_daily_timetable_limit,
    )
    return enqueue(
        conn,
        user_id,
        JOB_PARSE_TIMETABLE,
        {
            "upload_id": str(upload_id),
            "storage_path": timetable_path(user_id, upload_id),
            "mime": mime,
        },
    )


def _with_shared_dates(
    item: CommitmentIn, valid_from: dt.date | None, valid_until: dt.date | None
) -> CommitmentIn:
    update: dict[str, dt.date] = {}
    if item.valid_from is None and valid_from is not None:
        update["valid_from"] = valid_from
    if item.valid_until is None and valid_until is not None:
        update["valid_until"] = valid_until
    return item.model_copy(update=update) if update else item


def apply_timetable(
    conn: Conn,
    user_id: UUID,
    job_id: UUID,
    items: Sequence[CommitmentIn],
    valid_from: dt.date | None,
    valid_until: dt.date | None,
    now: dt.datetime,
) -> list[dict[str, Any]]:
    """Write the approved items as commitments of the job; returns their rows, in order.

    The job must be the user's parse_timetable job (else 404) and done: queued or running
    is 409 job_not_ready, failed is 409 invalid_state. A job whose live commitments exist
    was approved already (409 already_applied); once they are all deleted it may be again.
    """
    profile = lock_user(conn, user_id)
    job = conn.execute(
        "SELECT status FROM app.jobs WHERE user_id = %s AND id = %s AND kind = %s",
        (user_id, job_id, JOB_PARSE_TIMETABLE),
    ).fetchone()
    if job is None:
        raise ApiError("not_found")
    if job["status"] in ("queued", "running"):
        raise ApiError("job_not_ready")
    if job["status"] != "done":
        raise ApiError("invalid_state")
    applied = conn.execute(
        "SELECT 1 FROM app.commitments "
        "WHERE user_id = %s AND source_job_id = %s AND deleted_at IS NULL LIMIT 1",
        (user_id, job_id),
    ).fetchone()
    if applied is not None:
        raise ApiError("already_applied")

    today = local_date(now, parse_timezone(profile.timezone))
    merged = [_with_shared_dates(item, valid_from, valid_until) for item in items]
    # Each item's errors are on ["body", <field>]; here they are on ["body", "items", i, ...].
    errors: list[dict[str, object]] = []
    for index, item in enumerate(merged):
        for error in item.errors(today):
            loc = error["loc"]
            fields = list(loc)[1:] if isinstance(loc, list) else []
            errors.append({**error, "loc": ["body", "items", index, *fields]})
    if errors:
        raise ApiError("validation_error", extra={"errors": errors})
    return insert_commitments(conn, user_id, merged, today, source_job_id=job_id)
