import logging
import threading
import time
from collections.abc import Callable, Mapping
from datetime import timedelta
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg.pq import TransactionStatus
from psycopg.rows import DictRow

from app.ai.client import AiError, AnalysisClient, Usage
from app.auth import CurrentUser
from app.config import Settings
from app.jobs.queue import JobRow
from app.jobs.worker import Handler, JobContext, JobFailed, JobLost, Worker
from tests.ai.fake_client import FakeAnalysisClient
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


def test_database_error_is_logged_without_its_message(
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    caplog: pytest.LogCaptureFixture,
) -> None:
    job_id = make_job(make_user())
    sentinel = "SENTINEL-extracted-text-7f3a"

    def handler(ctx: JobContext) -> None:
        raise psycopg.errors.CheckViolation(f"DETAIL: Failing row contains ({sentinel}, ...)")

    worker = make_worker({"k": handler})
    with caplog.at_level(logging.DEBUG):
        assert worker.run_once() is True

    assert "CheckViolation" in caplog.text
    assert sentinel not in caplog.text
    assert all(record.exc_info is None for record in caplog.records)
    job = read_job(job_id)
    assert (job.status, job.error, job.attempts) == ("queued", "internal_error", 1)


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


@pytest.mark.parametrize("raises", [False, True])
def test_crash_callback_runs_and_never_stops_the_fail(
    raises: bool,
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

    def crashed(ctx: JobContext) -> None:
        calls.append(ctx.job.id)
        if raises:
            raise RuntimeError("boom")

    def handler(ctx: JobContext) -> None:
        raise AssertionError("a crashed job must not run again")

    worker = make_worker({"k": handler}, on_crashed={"k": crashed, "other": crashed})
    assert worker.run_once() is True

    assert calls == [job_id]
    job = read_job(job_id)
    assert (job.status, job.error) == ("failed", "worker_crashed")
    assert worker.run_once() is False


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


def _reclaim(owner_db: Conn, job_id: UUID, clock: FrozenClock) -> None:
    """What another worker's claim of an expired lock does to the row."""
    owner_db.execute(
        "UPDATE app.jobs SET attempts = attempts + 1, locked_at = %s, stage = 'reclaimed', "
        "percent = 7 WHERE id = %s",
        (clock.now, job_id),
    )


@pytest.mark.parametrize("call", ["progress", "keepalive"])
def test_handler_that_lost_its_claim_writes_nothing(
    call: str,
    owner_db: Conn,
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    clock: FrozenClock,
    caplog: pytest.LogCaptureFixture,
) -> None:
    job_id = make_job(make_user())
    raised: list[BaseException] = []
    after_reclaim: list[JobRow] = []

    def handler(ctx: JobContext) -> Mapping[str, Any]:
        clock.advance(seconds=31)
        _reclaim(owner_db, job_id, clock)
        after_reclaim.append(read_job(job_id))
        clock.advance(seconds=31)
        try:
            if call == "progress":
                ctx.progress("saving", 90)
            else:
                ctx.keepalive()
        except JobLost as exc:
            raised.append(exc)
            raise
        return {"must": "not be written"}

    with caplog.at_level(logging.INFO):
        assert make_worker({"k": handler}).run_once() is True

    assert len(raised) == 1
    assert read_job(job_id) == after_reclaim[0]
    assert read_job(job_id).status == "running"
    assert read_job(job_id).attempts == 2
    lost = [r for r in caplog.records if "lost" in r.getMessage()]
    assert lost
    assert all(r.levelno == logging.INFO for r in lost)
    assert all(r.exc_info is None for r in caplog.records)


@pytest.mark.parametrize("outcome", ["return", "fail", "retry"])
def test_an_end_write_after_a_lost_claim_only_warns(
    outcome: str,
    owner_db: Conn,
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    clock: FrozenClock,
    caplog: pytest.LogCaptureFixture,
) -> None:
    job_id = make_job(make_user())
    after_reclaim: list[JobRow] = []

    def handler(ctx: JobContext) -> Mapping[str, Any]:
        _reclaim(owner_db, job_id, clock)
        after_reclaim.append(read_job(job_id))
        if outcome == "fail":
            raise JobFailed("file_missing")
        if outcome == "retry":
            raise JobFailed("storage_unavailable", retry=True)
        return {"stale": True}

    with caplog.at_level(logging.INFO):
        assert make_worker({"k": handler}).run_once() is True

    assert read_job(job_id) == after_reclaim[0]
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert any("claim lost" in r.getMessage() for r in warnings)


def test_progress_rejects_a_bad_stage_or_percent(
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    clock: FrozenClock,
) -> None:
    job_id = make_job(make_user())
    errors: list[str] = []
    seen: list[JobRow] = []

    def handler(ctx: JobContext) -> None:
        claimed = read_job(job_id)
        clock.advance(seconds=31)
        bad: list[tuple[str, Any]] = [
            ("Analyzing", 10),
            ("a1", 10),
            ("saving", 101),
            ("saving", -1),
            ("saving", True),
            ("saving", 5.0),
        ]
        for stage, percent in bad:
            with pytest.raises(ValueError) as info:
                ctx.progress(stage, percent)
            errors.append(str(info.value))
        assert read_job(job_id) == claimed
        seen.append(claimed)

    assert make_worker({"k": handler}).run_once() is True
    assert len(errors) == 6
    assert len(seen) == 1
    assert read_job(job_id).status == "done"


def test_progress_accepts_the_bounds() -> None:
    # Validation runs before any SQL, so a context without a usable connection is enough.
    for stage, percent in [("a", 0), ("a" + "_" * 39, 100)]:
        JobContext._check_progress(stage, percent)
    with pytest.raises(ValueError):
        JobContext._check_progress("a" * 41, 50)


def test_job_failed_rejects_a_bad_code() -> None:
    with pytest.raises(ValueError):
        JobFailed("Bad Code")
    with pytest.raises(ValueError):
        JobFailed("")
    with pytest.raises(ValueError):
        JobFailed("a" * 61)
    assert JobFailed("a" * 60).code == "a" * 60
    assert JobFailed("ai_not_configured", retry=True).retry is True


def test_keepalive_writes_at_most_every_30_seconds(
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    clock: FrozenClock,
) -> None:
    job_id = make_job(make_user())
    claimed_at = clock.now

    def handler(ctx: JobContext) -> None:
        ctx.keepalive()
        ctx.keepalive()
        assert read_job(job_id).locked_at == claimed_at

        clock.advance(seconds=29)
        ctx.keepalive()
        assert read_job(job_id).locked_at == claimed_at

        clock.advance(seconds=2)
        ctx.keepalive()
        assert read_job(job_id).locked_at == clock.now
        assert (read_job(job_id).stage, read_job(job_id).percent) == (None, None)

        # progress renews the lock too, and restarts the 30 seconds.
        clock.advance(seconds=31)
        ctx.progress("analyzing", 40)
        beat = clock.now
        clock.advance(seconds=20)
        ctx.keepalive()
        assert read_job(job_id).locked_at == beat
        clock.advance(seconds=10)
        ctx.keepalive()
        job = read_job(job_id)
        assert job.locked_at == clock.now
        assert (job.stage, job.percent) == ("analyzing", 40)

    assert make_worker({"k": handler}).run_once() is True
    job = read_job(job_id)
    assert job.status == "done", job.error


def test_record_usage_writes_rows_as_the_owner(
    owner_db: Conn,
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    clock: FrozenClock,
) -> None:
    user = make_user()
    job_id = make_job(user)
    exam_id = uuid4()
    usage = [
        Usage("test-model", 1000, 500, 200, 0),
        Usage("test-model", 1100, 600, 0, 200),
    ]

    def handler(ctx: JobContext) -> None:
        ctx.record_usage(usage, exam_id=exam_id)
        ctx.record_usage([], exam_id=None)

    assert make_worker({"k": handler}).run_once() is True

    assert read_job(job_id).status == "done"
    rows = owner_db.execute(
        "SELECT user_id, job_id, exam_id, model, input_tokens, output_tokens, "
        "cache_creation_input_tokens, cache_read_input_tokens, created_at "
        "FROM app.ai_usage ORDER BY input_tokens"
    ).fetchall()
    assert len(rows) == 2
    assert all(
        (row["user_id"], row["job_id"], row["exam_id"]) == (user.id, job_id, exam_id)
        for row in rows
    )
    assert [
        Usage(
            row["model"],
            row["input_tokens"],
            row["output_tokens"],
            row["cache_creation_input_tokens"],
            row["cache_read_input_tokens"],
        )
        for row in rows
    ] == usage
    assert all(row["created_at"] == clock.now for row in rows)


def test_record_usage_refuses_inside_a_user_transaction(
    owner_db: Conn,
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
) -> None:
    job_id = make_job(make_user())
    refused: list[bool] = []

    def handler(ctx: JobContext) -> None:
        with ctx.user_transaction():
            with pytest.raises(RuntimeError):
                ctx.record_usage([Usage("test-model", 1, 1, 0, 0)], exam_id=None)
            refused.append(True)

    assert make_worker({"k": handler}).run_once() is True

    assert refused == [True]
    assert read_job(job_id).status == "done"
    count = owner_db.execute("SELECT count(*) AS n FROM app.ai_usage").fetchone()
    assert count is not None
    assert count["n"] == 0


def test_ai_client_is_built_once(
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    worker_settings: Settings,
) -> None:
    make_job(make_user())
    make_job(make_user())
    built: list[Settings] = []
    clients: list[AnalysisClient] = []

    def factory(settings: Settings) -> AnalysisClient:
        built.append(settings)
        return FakeAnalysisClient([])

    def handler(ctx: JobContext) -> None:
        clients.append(ctx.ai_client())
        clients.append(ctx.ai_client())

    worker = make_worker({"k": handler}, ai_client_factory=factory)
    assert worker.run_once() is True
    assert built == [worker_settings]
    assert clients[0] is clients[1]

    # Each job builds its own.
    assert worker.run_once() is True
    assert len(built) == 2
    assert clients[2] is not clients[0]


def test_ai_client_error_reaches_the_handler(
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
) -> None:
    job_id = make_job(make_user())

    def factory(settings: Settings) -> AnalysisClient:
        raise AiError("ai_not_configured")

    def handler(ctx: JobContext) -> None:
        try:
            ctx.ai_client()
        except AiError as exc:
            raise JobFailed(exc.code) from None

    assert make_worker({"k": handler}, ai_client_factory=factory).run_once() is True
    job = read_job(job_id)
    assert (job.status, job.error) == ("failed", "ai_not_configured")


def test_default_ai_client_needs_the_settings(
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
) -> None:
    # The default factory is AnthropicAnalysisClient.from_settings; the test settings have
    # no key, so it refuses without touching the network.
    job_id = make_job(make_user())

    def handler(ctx: JobContext) -> None:
        try:
            ctx.ai_client()
        except AiError as exc:
            raise JobFailed(exc.code) from None

    assert make_worker({"k": handler}).run_once() is True
    assert read_job(job_id).error == "ai_not_configured"


@pytest.mark.parametrize("call", ["progress", "keepalive"])
def test_heartbeat_refuses_inside_a_user_transaction(
    call: str,
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    clock: FrozenClock,
) -> None:
    job_id = make_job(make_user())
    refused: list[bool] = []

    def handler(ctx: JobContext) -> None:
        claimed = read_job(job_id)
        clock.advance(seconds=31)
        with ctx.user_transaction():
            with pytest.raises(RuntimeError):
                if call == "progress":
                    ctx.progress("saving", 90)
                else:
                    ctx.keepalive()
        assert read_job(job_id) == claimed
        refused.append(True)

    assert make_worker({"k": handler}).run_once() is True
    assert refused == [True]
    assert read_job(job_id).status == "done"


def test_job_lost_cannot_be_swallowed_by_except_exception(
    owner_db: Conn,
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    clock: FrozenClock,
) -> None:
    job_id = make_job(make_user())
    after_reclaim: list[JobRow] = []
    went_on: list[bool] = []

    def handler(ctx: JobContext) -> Mapping[str, Any]:
        _reclaim(owner_db, job_id, clock)
        after_reclaim.append(read_job(job_id))
        try:
            ctx.progress("saving", 90)
        except Exception:  # noqa: S110 - the point of the test
            pass
        went_on.append(True)
        return {"must": "not be written"}

    assert make_worker({"k": handler}).run_once() is True
    assert went_on == []
    assert read_job(job_id) == after_reclaim[0]


def test_run_forever_survives_a_lost_claim(
    owner_db: Conn,
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    worker_settings: Settings,
    clock: FrozenClock,
) -> None:
    fast = worker_settings.model_copy(update={"worker_poll_seconds": 0.05})
    lost = make_job(make_user(), kind="lose")
    done = threading.Event()

    def lose(ctx: JobContext) -> None:
        _reclaim(owner_db, lost, clock)
        ctx.progress("saving", 90)

    def ok(ctx: JobContext) -> None:
        done.set()

    worker = make_worker({"lose": lose, "k": ok}, settings=fast)
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
        assert thread.is_alive()
    finally:
        stop.set()
        thread.join(1)
    assert not thread.is_alive()
    assert read_job(lost).stage == "reclaimed"


def test_crash_callback_that_lost_its_claim_writes_nothing(
    owner_db: Conn,
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    clock: FrozenClock,
) -> None:
    job_id = make_job(
        make_user(), status="running", attempts=3, locked_at=clock.now - timedelta(hours=1)
    )
    after_reclaim: list[JobRow] = []

    def crashed(ctx: JobContext) -> None:
        _reclaim(owner_db, job_id, clock)
        after_reclaim.append(read_job(job_id))
        ctx.progress("saving", 90)

    worker = make_worker({"k": lambda ctx: None}, on_crashed={"k": crashed})
    assert worker.run_once() is True
    assert read_job(job_id) == after_reclaim[0]


TICK = 0.02


def _keepalive_threads() -> list[threading.Thread]:
    return [t for t in threading.enumerate() if t.name.startswith("keepalive-")]


def test_keeping_alive_renews_the_lock_while_the_block_runs(
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    clock: FrozenClock,
) -> None:
    job_id = make_job(make_user())
    claimed_at = clock.now
    seen: list[JobRow] = []

    def handler(ctx: JobContext) -> None:
        clock.advance(seconds=5)
        with ctx.keeping_alive(interval=TICK):
            threading.Event().wait(TICK * 3.5)
            assert _keepalive_threads()
        seen.append(read_job(job_id))
        assert _keepalive_threads() == []

    assert make_worker({"k": handler}).run_once() is True
    assert seen[0].locked_at == claimed_at + timedelta(seconds=5)
    assert (seen[0].stage, seen[0].percent) == (None, None)
    assert read_job(job_id).status == "done"


def test_keeping_alive_raises_job_lost_on_exit(
    owner_db: Conn,
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    clock: FrozenClock,
) -> None:
    job_id = make_job(make_user())
    after_reclaim: list[JobRow] = []
    block_finished: list[bool] = []
    raised: list[BaseException] = []

    def handler(ctx: JobContext) -> None:
        try:
            with ctx.keeping_alive(interval=TICK):
                _reclaim(owner_db, job_id, clock)
                after_reclaim.append(read_job(job_id))
                clock.advance(seconds=5)
                threading.Event().wait(TICK * 3.5)
                block_finished.append(True)
        except JobLost as exc:
            raised.append(exc)
            raise
        finally:
            assert _keepalive_threads() == []

    assert make_worker({"k": handler}).run_once() is True
    assert block_finished == [True]
    assert len(raised) == 1
    assert read_job(job_id) == after_reclaim[0]


def test_keeping_alive_lets_the_block_error_through(
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
) -> None:
    job_id = make_job(make_user())

    def handler(ctx: JobContext) -> None:
        try:
            with ctx.keeping_alive(interval=TICK):
                raise JobFailed("ai_unavailable")
        finally:
            assert _keepalive_threads() == []

    assert make_worker({"k": handler}).run_once() is True
    assert (read_job(job_id).status, read_job(job_id).error) == ("failed", "ai_unavailable")


def test_keeping_alive_refuses_inside_a_user_transaction(
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
) -> None:
    job_id = make_job(make_user())
    refused: list[bool] = []

    def handler(ctx: JobContext) -> None:
        with ctx.user_transaction():
            with pytest.raises(RuntimeError):
                with ctx.keeping_alive(interval=TICK):
                    pass
        assert _keepalive_threads() == []
        refused.append(True)

    assert make_worker({"k": handler}).run_once() is True
    assert refused == [True]
    assert read_job(job_id).status == "done"


def test_keeping_alive_skips_a_beat_while_a_transaction_is_open(
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    clock: FrozenClock,
) -> None:
    # Breaking the documented rule (the block uses the connection) must not make a beat
    # write inside the user's transaction, nor kill the thread.
    job_id = make_job(make_user())
    claimed_at = clock.now
    seen: list[JobRow] = []

    def handler(ctx: JobContext) -> None:
        clock.advance(seconds=5)
        with ctx.keeping_alive(interval=TICK):
            with ctx.user_transaction():
                threading.Event().wait(TICK * 3.5)
                seen.append(read_job(job_id))

    assert make_worker({"k": handler}).run_once() is True
    assert seen[0].locked_at == claimed_at
    assert read_job(job_id).status == "done"


def test_keepalive_inside_keeping_alive_is_a_no_op(
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    clock: FrozenClock,
) -> None:
    # The client calls ctx.keepalive on every stream event while the ticker beats on the
    # same connection; the ticker's UPDATE must never make keepalive see a busy connection.
    job_id = make_job(make_user())
    calls: list[int] = []

    def handler(ctx: JobContext) -> None:
        clock.advance(seconds=31)
        with ctx.keeping_alive(interval=0.001):
            deadline = time.monotonic() + 0.3
            while time.monotonic() < deadline:
                ctx.keepalive()
                calls.append(1)
        # Outside the block keepalive works again.
        clock.advance(seconds=31)
        ctx.keepalive()
        assert read_job(job_id).locked_at == clock.now

    assert make_worker({"k": handler}).run_once() is True
    assert len(calls) > 100
    assert read_job(job_id).status == "done", read_job(job_id).error


def test_keepalive_inside_keeping_alive_raises_once_the_ticker_lost_the_claim(
    owner_db: Conn,
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    clock: FrozenClock,
) -> None:
    job_id = make_job(make_user())
    after_reclaim: list[JobRow] = []
    raised_inside: list[bool] = []

    def handler(ctx: JobContext) -> None:
        with ctx.keeping_alive(interval=TICK):
            _reclaim(owner_db, job_id, clock)
            after_reclaim.append(read_job(job_id))
            deadline = time.monotonic() + 5
            try:
                while time.monotonic() < deadline:
                    ctx.keepalive()
                    threading.Event().wait(TICK / 4)
            except JobLost:
                raised_inside.append(True)
                raise

    assert make_worker({"k": handler}).run_once() is True
    assert raised_inside == [True]
    assert read_job(job_id) == after_reclaim[0]
    assert _keepalive_threads() == []


def test_keeping_alive_survives_any_error_in_a_beat(
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    clock: FrozenClock,
    caplog: pytest.LogCaptureFixture,
) -> None:
    job_id = make_job(make_user())
    claimed_at = clock.now
    ticks: list[int] = []
    seen: list[JobRow] = []

    def flaky_clock() -> Any:
        ticks.append(1)
        if len(ticks) == 1:
            raise ArithmeticError("boom")
        return clock.now

    def handler(ctx: JobContext) -> None:
        ctx._clock = flaky_clock
        clock.advance(seconds=5)
        with ctx.keeping_alive(interval=TICK):
            threading.Event().wait(TICK * 5)
            assert _keepalive_threads()
        seen.append(read_job(job_id))
        ctx._clock = clock

    with caplog.at_level(logging.WARNING):
        assert make_worker({"k": handler}).run_once() is True
    assert "ArithmeticError" in caplog.text
    assert "boom" not in caplog.text
    # The first beat failed; a later one still renewed the lock.
    assert len(ticks) >= 2
    assert seen[0].locked_at == claimed_at + timedelta(seconds=5)
    assert read_job(job_id).status == "done", read_job(job_id).error


def test_keeping_alive_blocks_do_not_nest(
    make_worker: MakeWorker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
) -> None:
    job_id = make_job(make_user())

    def handler(ctx: JobContext) -> None:
        with ctx.keeping_alive(interval=TICK):
            with pytest.raises(RuntimeError):
                with ctx.keeping_alive(interval=TICK):
                    pass
            assert len(_keepalive_threads()) == 1
        assert _keepalive_threads() == []

    assert make_worker({"k": handler}).run_once() is True
    assert read_job(job_id).status == "done", read_job(job_id).error
