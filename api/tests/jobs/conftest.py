"""Fixtures for the job queue and the worker."""

from collections.abc import Callable, Iterator, Mapping
from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import make_conninfo
from psycopg.rows import DictRow, dict_row
from psycopg.types.json import Jsonb

from app.auth import CurrentUser
from app.config import Settings
from app.jobs.ingest import HANDLERS, ON_CRASHED
from app.jobs.queue import JOB_COLUMNS, JobRow, row_to_job
from app.jobs.worker import CrashHandler, Handler, Worker
from tests.fixtures_db import FrozenClock
from tests.jobs.fake_storage import MemoryStorage


@pytest.fixture
def worker_settings(settings: Settings) -> Settings:
    return settings.model_copy(
        update={
            "worker_poll_seconds": 2.0,
            "job_lock_timeout_seconds": 600,
        }
    )


@pytest.fixture
def storage() -> MemoryStorage:
    return MemoryStorage()


@pytest.fixture
def owner_db(
    migrated_database_url: str, db: psycopg.Connection
) -> Iterator[psycopg.Connection[DictRow]]:
    """The schema owner with dict rows, as the queue functions expect; db empties the tables."""
    with psycopg.connect(migrated_database_url, row_factory=dict_row, autocommit=True) as conn:
        yield conn


@pytest.fixture
def user_db(migrated_database_url: str) -> Iterator[psycopg.Connection[DictRow]]:
    """studyflow_api with dict rows; use it through user_transaction."""
    url = make_conninfo(migrated_database_url, user="studyflow_api")
    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as conn:
        yield conn


@pytest.fixture
def make_worker(
    migrated_database_url: str,
    storage: MemoryStorage,
    worker_settings: Settings,
    clock: FrozenClock,
    db: psycopg.Connection,
) -> Iterator[Callable[..., Worker]]:
    # Depends on db so that every test starts from an empty queue.
    workers: list[Worker] = []

    def make(
        handlers: Mapping[str, Handler],
        *,
        settings: Settings | None = None,
        on_crashed: Mapping[str, CrashHandler] | None = None,
    ) -> Worker:
        worker = Worker(
            migrated_database_url,
            storage=storage,
            settings=settings if settings is not None else worker_settings,
            handlers=handlers,
            clock=clock,
            on_crashed=on_crashed,
        )
        worker.connect()
        workers.append(worker)
        return worker

    try:
        yield make
    finally:
        for worker in workers:
            worker.close()


@pytest.fixture
def worker(make_worker: Callable[..., Worker]) -> Worker:
    """A worker with the real job handlers, the memory storage and the frozen clock."""
    return make_worker(HANDLERS, on_crashed=ON_CRASHED)


type MakeJob = Callable[..., UUID]


@pytest.fixture
def make_job(owner_db: psycopg.Connection[DictRow], clock: FrozenClock) -> MakeJob:
    """Insert a job as the owner, runnable at the frozen clock unless the test says otherwise.

    The table defaults run_at and created_at to the real wall clock, which the frozen clock
    does not follow, so both are set explicitly.
    """

    def make(
        user: CurrentUser,
        kind: str = "k",
        payload: Mapping[str, Any] | None = None,
        *,
        run_at: datetime | None = None,
        created_at: datetime | None = None,
        **columns: Any,
    ) -> UUID:
        row = owner_db.execute(
            "INSERT INTO app.jobs (user_id, kind, payload) VALUES (%s, %s, %s) RETURNING id",
            (user.id, kind, Jsonb(dict(payload or {}))),
        ).fetchone()
        assert row is not None
        job_id: UUID = row["id"]
        values: dict[str, Any] = {
            "run_at": run_at if run_at is not None else clock.now,
            "created_at": created_at if created_at is not None else clock.now,
            **columns,
        }
        for column, value in values.items():
            owner_db.execute(
                sql.SQL("UPDATE app.jobs SET {} = %s WHERE id = %s").format(sql.Identifier(column)),
                (value, job_id),
            )
        return job_id

    return make


@pytest.fixture
def read_job(owner_db: psycopg.Connection[DictRow]) -> Callable[[UUID], JobRow]:
    def read(job_id: UUID) -> JobRow:
        columns = sql.SQL(", ").join(sql.Identifier(column) for column in JOB_COLUMNS)
        row = owner_db.execute(
            sql.SQL("SELECT {} FROM app.jobs WHERE id = %s").format(columns), (job_id,)
        ).fetchone()
        assert row is not None
        return row_to_job(row)

    return read
