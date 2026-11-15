import threading
from collections.abc import Callable, Mapping
from datetime import timedelta
from typing import Any
from uuid import UUID

import psycopg
import pytest
from psycopg.pq import TransactionStatus
from psycopg.rows import DictRow

from app.auth import CurrentUser
from app.config import Settings
from app.jobs.queue import JobRow
from app.jobs.worker import Handler, JobContext, JobFailed, Worker
from tests.fixtures_db import FrozenClock
from tests.jobs.conftest import MakeJob

type Conn = psycopg.Connection[DictRow]
type MakeWorker = Callable[..., Worker]


def test_run_once_returns_false_when_idle(make_worker: MakeWorker) -> None:
    assert make_worker({}).run_once() is False


def test_successful_handler_marks_done_with_result(
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    clock: FrozenClock,
) -> None:
    job_id = make_job(make_user())
    worker = make_worker({"k": lambda ctx: {"pages": 3}})

    assert worker.run_once() is True

    job = read_job(job_id)
    assert job.status == "done"
    assert job.result == {"pages": 3}
    assert job.error is None
    assert job.attempts == 1
    assert job.finished_at == clock.now
    assert worker.run_once() is False


def test_permanent_failure_is_not_retried(
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
) -> None:
    job_id = make_job(make_user())

    def handler(ctx: JobContext) -> None:
        raise JobFailed("file_missing")

    worker = make_worker({"k": handler})
    assert worker.run_once() is True

    job = read_job(job_id)
    assert job.status == "failed"
    assert job.error == "file_missing"
    assert job.attempts == 1
    assert worker.run_once() is False


@pytest.mark.parametrize(
    ("error", "code"),
    [
        (RuntimeError("boom"), "internal_error"),
        (JobFailed("storage_unavailable", retry=True), "storage_unavailable"),
    ],
)
def test_retryable_failure_backs_off_then_fails(
    error: Exception,
    code: str,
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    clock: FrozenClock,
) -> None:
    job_id = make_job(make_user())
    calls: list[int] = []

    def handler(ctx: JobContext) -> None:
        calls.append(ctx.job.attempts)
        raise error

    worker = make_worker({"k": handler})

    assert worker.run_once() is True
    job = read_job(job_id)
    assert (job.status, job.error) == ("queued", code)
    assert job.run_at == clock.now + timedelta(seconds=30)
    assert job.locked_at is None
    assert worker.run_once() is False  # not due yet

    clock.advance(seconds=30)
    assert worker.run_once() is True
    job = read_job(job_id)
    assert (job.status, job.error) == ("queued", code)
    assert job.run_at == clock.now + timedelta(seconds=60)

    clock.advance(seconds=60)
    assert worker.run_once() is True
    job = read_job(job_id)
    assert (job.status, job.error) == ("failed", code)
    assert job.attempts == 3
    assert job.finished_at == clock.now
    assert calls == [1, 2, 3]
    assert worker.run_once() is False


def test_crashed_job_past_its_attempts_is_failed_as_worker_crashed(
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    clock: FrozenClock,
) -> None:
    job_id = make_job(
        make_user(), status="running", attempts=3, locked_at=clock.now - timedelta(hours=1)
    )
    calls: list[UUID] = []

    def handler(ctx: JobContext) -> None:
        calls.append(ctx.job.id)

    assert make_worker({"k": handler}).run_once() is True

    job = read_job(job_id)
    assert job.status == "failed"
    assert job.error == "worker_crashed"
    assert job.attempts == 4
    assert calls == []


def test_unknown_kind_fails_without_retry(
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
) -> None:
    job_id = make_job(make_user(), kind="nope")
    worker = make_worker({"k": lambda ctx: None})

    assert worker.run_once() is True
    job = read_job(job_id)
    assert job.status == "failed"
    assert job.error == "unknown_kind"
    assert job.attempts == 1


def test_context_progress_and_last_attempt(
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
) -> None:
    job_id = make_job(make_user())
    seen: list[JobRow] = []

    def handler(ctx: JobContext) -> Mapping[str, Any]:
        ctx.progress("extracting", 50)
        seen.append(read_job(ctx.job.id))
        return {"last": ctx.last_attempt}

    assert make_worker({"k": handler}).run_once() is True

    assert len(seen) == 1
    assert seen[0].status == "running"
    assert (seen[0].stage, seen[0].percent) == ("extracting", 50)
    job = read_job(job_id)
    assert job.result == {"last": False}
    assert job.max_attempts == 3


def test_last_attempt_is_true_on_the_final_try(
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
) -> None:
    job_id = make_job(make_user(), attempts=2)

    def handler(ctx: JobContext) -> Mapping[str, Any]:
        return {"last": ctx.last_attempt}

    assert make_worker({"k": handler}).run_once() is True
    assert read_job(job_id).result == {"last": True}


def test_context_user_transaction_applies_rls(
    db: psycopg.Connection,
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
) -> None:
    a = make_user()
    b = make_user()
    for user in (a, b):
        db.execute(
            "INSERT INTO app.exams (user_id, name, exam_date) VALUES (%s, %s, %s)",
            (user.id, "Algorithms", "2027-01-20"),
        )
    owner = db.execute("SELECT current_user").fetchone()
    assert owner is not None
    job_id = make_job(a)

    def handler(ctx: JobContext) -> Mapping[str, Any]:
        with ctx.user_transaction() as conn:
            exams = conn.execute("SELECT count(*) AS n FROM app.exams").fetchone()
            role = conn.execute("SELECT current_user AS r").fetchone()
        assert exams is not None
        assert role is not None
        after = ctx._conn.execute("SELECT current_user AS r").fetchone()
        assert after is not None
        assert ctx._conn.info.transaction_status == TransactionStatus.IDLE
        return {"exams": exams["n"], "role": role["r"], "after": after["r"]}

    assert make_worker({"k": handler}).run_once() is True

    job = read_job(job_id)
    assert job.status == "done", job.error
    assert job.result == {"exams": 1, "role": "authenticated", "after": owner[0]}


def test_run_forever_stops_on_the_event(
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    worker_settings: Settings,
) -> None:
    fast = worker_settings.model_copy(update={"worker_poll_seconds": 0.05})
    done = threading.Event()

    def handler(ctx: JobContext) -> None:
        done.set()

    handlers: Mapping[str, Handler] = {"k": handler}
    worker = make_worker(handlers, settings=fast)
    stop = threading.Event()
    thread = threading.Thread(target=worker.run_forever, kwargs={"stop": stop})
    thread.start()
    try:
        job_id = make_job(make_user())
        assert done.wait(5)
        for _ in range(100):
            if read_job(job_id).status == "done":
                break
            threading.Event().wait(0.02)
        assert read_job(job_id).status == "done"
    finally:
        stop.set()
        thread.join(1)
    assert not thread.is_alive()


def test_run_forever_reconnects_after_losing_the_connection(
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    worker_settings: Settings,
) -> None:
    fast = worker_settings.model_copy(update={"worker_poll_seconds": 0.05})
    done = threading.Event()

    def handler(ctx: JobContext) -> None:
        done.set()

    worker = make_worker({"k": handler}, settings=fast)
    worker._connection().close()  # what a dropped connection looks like to the worker
    job_id = make_job(make_user())
    stop = threading.Event()
    thread = threading.Thread(target=worker.run_forever, kwargs={"stop": stop})
    thread.start()
    try:
        assert done.wait(5)
    finally:
        stop.set()
        thread.join(1)
    assert not thread.is_alive()
    assert read_job(job_id).status == "done"
