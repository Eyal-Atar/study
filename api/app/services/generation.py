"""Ask for a plan (or one exam's reanalysis) as a job, under a daily quota of AI requests.

A request is one job that calls Claude: `generate_plan` or `reanalyze_exam`. The quota counts
the user's jobs of those kinds created since midnight of the quota day, in
`settings.ai_quota_timezone` and not in the profile's timezone (a profile timezone is the
user's to change, and would move their midnight). A job that failed without spending
anything (no `ai_usage` row) does not count; a queued or running one does.

Everything runs under the per-user lock (the profile row), so the active-job check, the
count and the INSERT are one step: parallel requests cannot all pass at the limit.
"""

import datetime as dt
from dataclasses import dataclass
from typing import Final
from uuid import UUID

from app.config import Settings
from app.domain.materials import JOB_GENERATE_PLAN, JOB_REANALYZE_EXAM
from app.domain.time import local_date, local_day_bounds, parse_timezone
from app.errors import ApiError
from app.jobs.queue import enqueue
from app.services.profiles import Conn, lock_user, to_planner_profile

AI_JOB_KINDS: Final = (JOB_GENERATE_PLAN, JOB_REANALYZE_EXAM)
_ACTIVE: Final = ("queued", "running")


@dataclass(frozen=True)
class GenerationRequest:
    job_id: UUID
    created: bool


def _quota_day(now: dt.datetime, settings: Settings) -> tuple[dt.datetime, dt.datetime]:
    tz = parse_timezone(settings.ai_quota_timezone)
    return local_day_bounds(local_date(now, tz), tz)


def quota_day_start(now: dt.datetime, settings: Settings) -> dt.datetime:
    """Midnight (in UTC) of the quota day that contains now."""
    return _quota_day(now, settings)[0]


def quota_resets_at(now: dt.datetime, settings: Settings) -> dt.datetime:
    """The next midnight of the quota timezone, in UTC: when the count starts again."""
    return _quota_day(now, settings)[1]


def ai_requests_today(conn: Conn, user_id: UUID, now: dt.datetime, settings: Settings) -> int:
    row = conn.execute(
        """
        SELECT count(*) AS n FROM app.jobs AS j
        WHERE j.user_id = %(user_id)s
          AND j.kind = ANY(%(kinds)s)
          AND j.created_at >= %(start)s
          AND NOT (
              j.status = 'failed'
              AND NOT EXISTS (
                  SELECT 1 FROM app.ai_usage AS u
                  WHERE u.user_id = %(user_id)s AND u.job_id = j.id
              )
          )
        """,
        {"user_id": user_id, "kinds": list(AI_JOB_KINDS), "start": quota_day_start(now, settings)},
    ).fetchone()
    if row is None:
        raise RuntimeError("SELECT count(*) returned no row")
    count: int = row["n"]
    return count


def _check_quota(conn: Conn, user_id: UUID, now: dt.datetime, settings: Settings) -> None:
    limit = settings.ai_daily_generation_limit
    if ai_requests_today(conn, user_id, now, settings) >= limit:
        raise ApiError(
            "ai_quota_exceeded",
            extra={"limit": limit, "resets_at": quota_resets_at(now, settings).isoformat()},
        )


def _active_generation(conn: Conn, user_id: UUID) -> UUID | None:
    row = conn.execute(
        "SELECT id FROM app.jobs WHERE user_id = %s AND kind = %s AND status = ANY(%s) "
        "ORDER BY created_at DESC, id LIMIT 1",
        (user_id, JOB_GENERATE_PLAN, list(_ACTIVE)),
    ).fetchone()
    return None if row is None else row["id"]


def _active_reanalysis(conn: Conn, user_id: UUID, exam_id: UUID) -> UUID | None:
    row = conn.execute(
        "SELECT id FROM app.jobs WHERE user_id = %s AND kind = %s AND status = ANY(%s) "
        "AND payload->>'exam_id' = %s ORDER BY created_at DESC, id LIMIT 1",
        (user_id, JOB_REANALYZE_EXAM, list(_ACTIVE), str(exam_id)),
    ).fetchone()
    return None if row is None else row["id"]


def _exams_to_analyze(conn: Conn, user_id: UUID, today: dt.date) -> list[UUID]:
    """Live exams whose date has not passed and that have no live AI task, by date."""
    rows = conn.execute(
        """
        SELECT e.id FROM app.exams AS e
        WHERE e.user_id = %(user_id)s
          AND e.deleted_at IS NULL
          AND e.exam_date >= %(today)s
          AND NOT EXISTS (
              SELECT 1 FROM app.tasks AS t
              WHERE t.user_id = %(user_id)s
                AND t.exam_id = e.id
                AND t.source = 'ai'
                AND t.deleted_at IS NULL
          )
        ORDER BY e.exam_date, e.created_at, e.id
        """,
        {"user_id": user_id, "today": today},
    ).fetchall()
    return [row["id"] for row in rows]


def request_generation(
    conn: Conn, user_id: UUID, now: dt.datetime, settings: Settings
) -> GenerationRequest:
    """Queue a generate_plan job for every exam not yet analyzed, or return the active one."""
    profile = to_planner_profile(lock_user(conn, user_id))
    active = _active_generation(conn, user_id)
    if active is not None:
        return GenerationRequest(job_id=active, created=False)
    exam_ids = _exams_to_analyze(conn, user_id, local_date(now, profile.timezone))
    if not exam_ids:
        raise ApiError("nothing_to_analyze")
    _check_quota(conn, user_id, now, settings)
    job_id = enqueue(conn, user_id, JOB_GENERATE_PLAN, {"exam_ids": [str(e) for e in exam_ids]})
    return GenerationRequest(job_id=job_id, created=True)


def request_reanalysis(
    conn: Conn, user_id: UUID, exam_id: UUID, now: dt.datetime, settings: Settings
) -> GenerationRequest:
    """Queue a reanalyze_exam job for one live, upcoming exam, or return its active one."""
    profile = to_planner_profile(lock_user(conn, user_id))
    exam = conn.execute(
        "SELECT exam_date FROM app.exams WHERE user_id = %s AND id = %s AND deleted_at IS NULL",
        (user_id, exam_id),
    ).fetchone()
    if exam is None:
        raise ApiError("not_found")
    if exam["exam_date"] < local_date(now, profile.timezone):
        raise ApiError("exam_in_past")
    active = _active_reanalysis(conn, user_id, exam_id)
    if active is not None:
        return GenerationRequest(job_id=active, created=False)
    _check_quota(conn, user_id, now, settings)
    job_id = enqueue(conn, user_id, JOB_REANALYZE_EXAM, {"exam_id": str(exam_id)})
    return GenerationRequest(job_id=job_id, created=True)
