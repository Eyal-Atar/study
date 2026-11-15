"""A small job queue in Postgres: the table app.jobs, claimed with FOR UPDATE SKIP LOCKED.

The API enqueues as the user (RLS, and INSERT on user_id, kind and payload only). The worker
connects as the schema owner and is the only writer of status, attempts, locks and results.
Every time comparison uses the `now` the caller passes in, never the database clock, so the
worker runs on its injected clock and tests can freeze it.

A job that stays `running` past the lock timeout belongs to a worker that died; `claim` takes
it again and counts the attempt. The payload is an opaque JSON object and the kind a string,
so any job type can share the queue.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Final
from uuid import UUID

import psycopg
from psycopg import sql
from psycopg.rows import DictRow
from psycopg.types.json import Jsonb

type Conn = psycopg.Connection[DictRow]

JOB_COLUMNS: Final = (
    "id",
    "user_id",
    "kind",
    "payload",
    "status",
    "attempts",
    "max_attempts",
    "run_at",
    "locked_at",
    "stage",
    "percent",
    "error",
    "result",
    "created_at",
    "started_at",
    "finished_at",
)
_COLUMNS: Final = sql.SQL(", ").join(sql.Identifier(column) for column in JOB_COLUMNS)

BACKOFF_BASE_SECONDS: Final = 30


@dataclass(frozen=True)
class JobRow:
    id: UUID
    user_id: UUID
    kind: str
    payload: Mapping[str, Any]
    status: str
    attempts: int
    max_attempts: int
    run_at: datetime
    locked_at: datetime | None
    stage: str | None
    percent: int | None
    error: str | None
    result: Mapping[str, Any] | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


def row_to_job(row: Mapping[str, Any]) -> JobRow:
    return JobRow(**{column: row[column] for column in JOB_COLUMNS})


def enqueue(conn: Conn, user_id: UUID, kind: str, payload: Mapping[str, Any]) -> UUID:
    """Add a job; run it inside the user's transaction, so it commits with the API's own writes."""
    row = conn.execute(
        "INSERT INTO app.jobs (user_id, kind, payload) VALUES (%s, %s, %s) RETURNING id",
        (user_id, kind, Jsonb(dict(payload))),
    ).fetchone()
    if row is None:
        raise RuntimeError("INSERT ... RETURNING returned no row")
    job_id: UUID = row["id"]
    return job_id


def get_job(conn: Conn, user_id: UUID, job_id: UUID) -> JobRow | None:
    row = conn.execute(
        sql.SQL("SELECT {} FROM app.jobs WHERE user_id = %s AND id = %s").format(_COLUMNS),
        (user_id, job_id),
    ).fetchone()
    return None if row is None else row_to_job(row)


_CLAIM: Final = sql.SQL("""
    UPDATE app.jobs
    SET status = 'running',
        attempts = attempts + 1,
        locked_at = %(now)s,
        started_at = coalesce(started_at, %(now)s),
        stage = NULL,
        percent = NULL
    WHERE id = (
        SELECT id FROM app.jobs
        WHERE (status = 'queued' AND run_at <= %(now)s)
           OR (status = 'running' AND locked_at < %(now)s - %(lock_timeout)s)
        ORDER BY run_at, created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING {}
""").format(_COLUMNS)


def claim(conn: Conn, now: datetime, *, lock_timeout: timedelta) -> JobRow | None:
    """Take the next due job, or a running one whose lock expired, and mark it running.

    On an autocommit connection this commits at once; inside an open transaction it is a
    savepoint, and the row stays locked until the outer transaction ends.
    """
    with conn.transaction():
        row = conn.execute(_CLAIM, {"now": now, "lock_timeout": lock_timeout}).fetchone()
    return None if row is None else row_to_job(row)


def heartbeat(
    conn: Conn,
    job_id: UUID,
    now: datetime,
    *,
    stage: str | None = None,
    percent: int | None = None,
) -> None:
    """Renew the lock, and record progress; a None stage or percent keeps the current value."""
    conn.execute(
        "UPDATE app.jobs SET locked_at = %s, stage = coalesce(%s, stage), "
        "percent = coalesce(%s, percent) WHERE id = %s AND status = 'running'",
        (now, stage, percent, job_id),
    )


def finish(conn: Conn, job_id: UUID, now: datetime, result: Mapping[str, Any] | None) -> None:
    conn.execute(
        "UPDATE app.jobs SET status = 'done', finished_at = %s, locked_at = NULL, error = NULL, "
        "percent = 100, result = %s WHERE id = %s",
        (now, None if result is None else Jsonb(dict(result)), job_id),
    )


def requeue(conn: Conn, job_id: UUID, *, run_at: datetime, error: str) -> None:
    """Put the job back for a later attempt; the last failure's code stays visible."""
    conn.execute(
        "UPDATE app.jobs SET status = 'queued', locked_at = NULL, run_at = %s, error = %s "
        "WHERE id = %s",
        (run_at, error, job_id),
    )


def fail(conn: Conn, job_id: UUID, now: datetime, error: str) -> None:
    conn.execute(
        "UPDATE app.jobs SET status = 'failed', finished_at = %s, locked_at = NULL, error = %s "
        "WHERE id = %s",
        (now, error, job_id),
    )


def backoff(attempt: int) -> timedelta:
    """The wait before the next try after `attempt` failed: 30s, 60s, 120s, ..."""
    return timedelta(seconds=BACKOFF_BASE_SECONDS * 2 ** (attempt - 1))
