from collections.abc import Callable
from datetime import timedelta
from uuid import UUID

import psycopg
from psycopg.rows import DictRow, dict_row

from app.auth import CurrentUser
from app.db.session import user_transaction
from app.jobs.queue import (
    JobRow,
    backoff,
    claim,
    enqueue,
    fail,
    finish,
    get_job,
    heartbeat,
    requeue,
)
from tests.fixtures_db import FrozenClock
from tests.jobs.conftest import MakeJob

type Conn = psycopg.Connection[DictRow]
LOCK = timedelta(minutes=10)


def test_enqueue_as_user_and_claim_as_owner(
    owner_db: Conn,
    user_db: Conn,
    make_user: Callable[[], CurrentUser],
    clock: FrozenClock,
    read_job: Callable[[UUID], JobRow],
) -> None:
    user = make_user()
    with user_transaction(user_db, user) as conn:
        job_id = enqueue(conn, user.id, "ingest_material", {"material_id": "x"})
    queued = read_job(job_id)
    assert queued.status == "queued"
    assert queued.attempts == 0
    assert queued.payload == {"material_id": "x"}
    # The table stamps run_at with the real clock; bring it to the frozen one.
    owner_db.execute("UPDATE app.jobs SET run_at = %s WHERE id = %s", (clock.now, job_id))

    job = claim(owner_db, clock.now, lock_timeout=LOCK)

    assert job is not None
    assert job.id == job_id
    assert job.user_id == user.id
    assert job.status == "running"
    assert job.attempts == 1
    assert job.locked_at == clock.now
    assert job.started_at == clock.now
    assert claim(owner_db, clock.now, lock_timeout=LOCK) is None


def test_claim_respects_run_at_and_order(
    owner_db: Conn,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    clock: FrozenClock,
) -> None:
    user = make_user()
    now = clock.now
    later = make_job(user, run_at=now + timedelta(minutes=5), created_at=now - timedelta(hours=1))
    second = make_job(user, run_at=now - timedelta(minutes=1), created_at=now)
    first = make_job(user, run_at=now - timedelta(minutes=1), created_at=now - timedelta(seconds=1))

    claimed = [claim(owner_db, now, lock_timeout=LOCK) for _ in range(3)]
    assert [job.id if job else None for job in claimed] == [first, second, None]

    clock.advance(minutes=5)
    job = claim(owner_db, clock.now, lock_timeout=LOCK)
    assert job is not None
    assert job.id == later


def test_two_claims_in_open_transactions_get_distinct_jobs(
    migrated_database_url: str,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    clock: FrozenClock,
) -> None:
    user = make_user()
    make_job(user)
    make_job(user)
    with (
        psycopg.connect(migrated_database_url, row_factory=dict_row, autocommit=True) as one,
        psycopg.connect(migrated_database_url, row_factory=dict_row, autocommit=True) as two,
    ):
        with one.transaction(), two.transaction():
            a = claim(one, clock.now, lock_timeout=LOCK)
            b = claim(two, clock.now, lock_timeout=LOCK)
            assert a is not None
            assert b is not None
            assert a.id != b.id
            # Both jobs are locked by an open transaction: a third claim gets nothing.
            with one.transaction():
                assert claim(one, clock.now, lock_timeout=LOCK) is None


def test_two_claims_with_one_job_get_it_once(
    migrated_database_url: str,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    clock: FrozenClock,
) -> None:
    user = make_user()
    job_id = make_job(user)
    with (
        psycopg.connect(migrated_database_url, row_factory=dict_row, autocommit=True) as one,
        psycopg.connect(migrated_database_url, row_factory=dict_row, autocommit=True) as two,
    ):
        with one.transaction(), two.transaction():
            a = claim(one, clock.now, lock_timeout=LOCK)
            b = claim(two, clock.now, lock_timeout=LOCK)
            assert a is not None
            assert a.id == job_id
            assert b is None


def test_stale_running_job_is_reclaimed_after_the_timeout(
    owner_db: Conn,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    clock: FrozenClock,
) -> None:
    user = make_user()
    now = clock.now
    fresh = make_job(user, status="running", attempts=1, locked_at=now - timedelta(minutes=9))
    assert claim(owner_db, now, lock_timeout=LOCK) is None

    stale = make_job(user, status="running", attempts=1, locked_at=now - timedelta(minutes=11))
    job = claim(owner_db, now, lock_timeout=LOCK)
    assert job is not None
    assert job.id == stale
    assert job.attempts == 2
    assert job.locked_at == now
    assert job.id != fresh


def test_heartbeat_finish_requeue_fail_write_the_right_columns(
    owner_db: Conn,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    clock: FrozenClock,
    read_job: Callable[[UUID], JobRow],
) -> None:
    user = make_user()
    first = make_job(user)
    job = claim(owner_db, clock.now, lock_timeout=LOCK)
    assert job is not None
    assert job.id == first

    clock.advance(seconds=5)
    heartbeat(owner_db, first, clock.now, stage="downloading", percent=10)
    beat = read_job(first)
    assert beat.locked_at == clock.now
    assert (beat.stage, beat.percent) == ("downloading", 10)
    heartbeat(owner_db, first, clock.now)
    assert (read_job(first).stage, read_job(first).percent) == ("downloading", 10)

    clock.advance(seconds=5)
    finish(owner_db, first, clock.now, {"a": 1})
    done = read_job(first)
    assert done.status == "done"
    assert done.finished_at == clock.now
    assert done.percent == 100
    assert done.locked_at is None
    assert done.error is None
    assert done.result == {"a": 1}

    second = make_job(user)
    assert claim(owner_db, clock.now, lock_timeout=LOCK) is not None
    retry_at = clock.now + timedelta(seconds=30)
    requeue(owner_db, second, run_at=retry_at, error="storage_unavailable")
    queued = read_job(second)
    assert queued.status == "queued"
    assert queued.run_at == retry_at
    assert queued.locked_at is None
    assert queued.error == "storage_unavailable"

    fail(owner_db, second, clock.now, "file_missing")
    failed = read_job(second)
    assert failed.status == "failed"
    assert failed.finished_at == clock.now
    assert failed.locked_at is None
    assert failed.error == "file_missing"


def test_backoff() -> None:
    assert backoff(1) == timedelta(seconds=30)
    assert backoff(2) == timedelta(seconds=60)
    assert backoff(3) == timedelta(seconds=120)


def test_get_job_is_scoped_to_the_user(
    user_db: Conn,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
) -> None:
    a = make_user()
    b = make_user()
    job_id = make_job(a)
    with user_transaction(user_db, b) as conn:
        assert get_job(conn, b.id, job_id) is None
        # Asking for A's id as B: RLS hides the row even when the filter matches it.
        assert get_job(conn, a.id, job_id) is None
    with user_transaction(user_db, a) as conn:
        job = get_job(conn, a.id, job_id)
    assert job is not None
    assert job.id == job_id
    assert job.user_id == a.id
