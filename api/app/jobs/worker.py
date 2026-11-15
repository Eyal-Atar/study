"""The worker loop: claim a job, run its handler, and record how it ended.

The worker connects as the schema owner, which bypasses RLS, so it touches only app.jobs in
that role. A handler reaches the user's data through `JobContext.user_transaction()`, which
runs as that user under RLS, exactly like the API.

Outcomes: a handler that returns marks the job done with its result. `JobFailed(code)` fails
it at once with that code; `JobFailed(code, retry=True)` and any other exception (logged, and
recorded as `internal_error`) put it back with a backoff until its attempts run out, then fail
it. A job reclaimed after a crash that has already used all its attempts fails as
`worker_crashed` without running again; an `on_crashed` callback for its kind runs first, so
the job's own data can be marked failed too (its errors are logged and never stop the fail).
`jobs.error` only ever holds these fixed codes.

Every write after the claim is fenced on it (see queue.py). When `progress` or `keepalive`
finds the fence closed, the job was claimed again by another worker: they raise `JobLost`,
and the worker leaves the job alone without writing (an INFO line only). An end write
(finish, requeue, fail) that finds it closed is logged as a WARNING ("claim lost").

`JobContext.ai_client()` builds the Claude client once per job, from the worker's factory,
and `record_usage` writes the ledger app.ai_usage as the schema owner, outside any user
transaction; app.jobs and app.ai_usage are the only tables the worker writes as the owner.
"""

import logging
import re
import threading
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Final
from uuid import UUID

import psycopg
from psycopg.pq import TransactionStatus
from psycopg.rows import DictRow, dict_row

from app.ai.client import AnalysisClient, AnthropicAnalysisClient, Usage
from app.auth import CurrentUser
from app.config import Settings
from app.db.session import user_transaction
from app.jobs.queue import JobRow, backoff, claim, fail, finish, heartbeat, requeue
from app.jobs.storage import Storage

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(UTC)


# The same patterns as the CHECK constraints on app.jobs (stage and error).
STAGE_PATTERN: Final = re.compile(r"[a-z][a-z_]{0,39}")
CODE_PATTERN: Final = re.compile(r"[a-z][a-z_]{0,59}")
KEEPALIVE_SECONDS: Final = 30

type AiClientFactory = Callable[[Settings], AnalysisClient]


class JobFailed(Exception):
    """A handler's expected failure, with a fixed code for jobs.error (never a message)."""

    def __init__(self, code: str, *, retry: bool = False) -> None:
        if CODE_PATTERN.fullmatch(code) is None:
            raise ValueError(f"not a job error code: {code!r}")
        super().__init__(code)
        self.code = code
        self.retry = retry


class JobLost(Exception):
    """The job was claimed again by another worker; this one must stop and write nothing."""


@dataclass
class JobContext:
    """What a handler gets: its job, the storage client, the settings and the claim time."""

    job: JobRow
    storage: Storage
    settings: Settings
    now: datetime
    _conn: psycopg.Connection[DictRow] = field(repr=False)
    _clock: Callable[[], datetime] = field(repr=False)
    _ai_client_factory: AiClientFactory = field(
        repr=False, default=AnthropicAnalysisClient.from_settings
    )
    _ai_client: AnalysisClient | None = field(repr=False, default=None, init=False)
    _last_beat: datetime = field(repr=False, init=False)

    def __post_init__(self) -> None:
        # The claim itself set locked_at to `now`.
        self._last_beat = self.now

    def user_transaction(self) -> AbstractContextManager[psycopg.Connection[DictRow]]:
        """One transaction as the job's user, under RLS."""
        return self._user_transaction()

    @contextmanager
    def _user_transaction(self) -> Iterator[psycopg.Connection[DictRow]]:
        user = CurrentUser(id=self.job.user_id, email=None, claims={})
        with user_transaction(self._conn, user):
            yield self._conn

    @staticmethod
    def _check_progress(stage: str, percent: int) -> None:
        if STAGE_PATTERN.fullmatch(stage) is None:
            raise ValueError(f"not a job stage: {stage!r}")
        if not 0 <= percent <= 100:
            raise ValueError(f"percent out of range: {percent}")

    def progress(self, stage: str, percent: int) -> None:
        """Report progress; it also renews the job's lock. JobLost if the claim was lost."""
        self._check_progress(stage, percent)
        self._beat(stage=stage, percent=percent)

    def keepalive(self) -> None:
        """Renew the lock, at most every KEEPALIVE_SECONDS; JobLost if the claim was lost.

        Cheap to call often (on every streamed event of a Claude call): between beats it
        only reads the clock.
        """
        if self._clock() - self._last_beat >= timedelta(seconds=KEEPALIVE_SECONDS):
            self._beat()

    def _beat(self, *, stage: str | None = None, percent: int | None = None) -> None:
        now = self._clock()
        if not heartbeat(
            self._conn, self.job.id, self.job.attempts, now, stage=stage, percent=percent
        ):
            raise JobLost(str(self.job.id))
        self._last_beat = now

    def ai_client(self) -> AnalysisClient:
        """The Claude client, built on first use; AiError (e.g. ai_not_configured) propagates."""
        if self._ai_client is None:
            self._ai_client = self._ai_client_factory(self.settings)
        return self._ai_client

    def record_usage(self, usage: Sequence[Usage], *, exam_id: UUID | None) -> None:
        """Write one app.ai_usage row per call, as the owner, committed at once.

        Never inside user_transaction: the row would run as `authenticated` (no INSERT) and
        roll back with the user's writes, losing the record of money already spent.
        """
        if self._conn.info.transaction_status != TransactionStatus.IDLE:
            raise RuntimeError("record_usage needs a connection that is not in a transaction")
        if not usage:
            return
        now = self._clock()
        with self._conn.cursor() as cursor:
            cursor.executemany(
                "INSERT INTO app.ai_usage (user_id, job_id, exam_id, model, input_tokens, "
                "output_tokens, cache_creation_input_tokens, cache_read_input_tokens, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                [
                    (
                        self.job.user_id,
                        self.job.id,
                        exam_id,
                        item.model,
                        item.input_tokens,
                        item.output_tokens,
                        item.cache_creation_input_tokens,
                        item.cache_read_input_tokens,
                        now,
                    )
                    for item in usage
                ],
            )

    @property
    def last_attempt(self) -> bool:
        """True when a failure now will not be retried."""
        return self.job.attempts >= self.job.max_attempts


type Handler = Callable[[JobContext], Mapping[str, Any] | None]
type CrashHandler = Callable[[JobContext], None]


class Worker:
    def __init__(
        self,
        conninfo: str,
        *,
        storage: Storage,
        settings: Settings,
        handlers: Mapping[str, Handler],
        clock: Callable[[], datetime] | None = None,
        on_crashed: Mapping[str, CrashHandler] | None = None,
        ai_client_factory: AiClientFactory | None = None,
    ) -> None:
        self._conninfo = conninfo
        self._storage = storage
        self._settings = settings
        self._handlers = handlers
        self._on_crashed = on_crashed if on_crashed is not None else {}
        self._clock = clock if clock is not None else _utc_now
        self._ai_client_factory: AiClientFactory = (
            ai_client_factory
            if ai_client_factory is not None
            else AnthropicAnalysisClient.from_settings
        )
        self._conn: psycopg.Connection[DictRow] | None = None

    def connect(self) -> None:
        self.close()
        self._conn = psycopg.connect(self._conninfo, row_factory=dict_row, autocommit=True)

    def close(self) -> None:
        conn, self._conn = self._conn, None
        if conn is not None:
            conn.close()

    def _connection(self) -> psycopg.Connection[DictRow]:
        if self._conn is None:
            raise RuntimeError("Worker.connect() has not been called")
        return self._conn

    def run_once(self) -> bool:
        """Run at most one job; False when there was nothing to do."""
        conn = self._connection()
        now = self._clock()
        lock_timeout = timedelta(seconds=self._settings.job_lock_timeout_seconds)
        job = claim(conn, now, lock_timeout=lock_timeout)
        if job is None:
            return False

        context = JobContext(
            job=job,
            storage=self._storage,
            settings=self._settings,
            now=now,
            _conn=conn,
            _clock=self._clock,
            _ai_client_factory=self._ai_client_factory,
        )
        if job.attempts > job.max_attempts:
            crashed = self._on_crashed.get(job.kind)
            if crashed is not None:
                try:
                    crashed(context)
                except Exception:
                    logger.exception("job %s (%s) crash callback failed", job.id, job.kind)
            self._fail(conn, job, "worker_crashed")
            return True
        handler = self._handlers.get(job.kind)
        if handler is None:
            self._fail(conn, job, "unknown_kind")
            return True

        try:
            result = handler(context)
        except JobLost:
            logger.info("job %s (%s) lost its claim; leaving it", job.id, job.kind)
            return True
        except JobFailed as exc:
            code, retry = exc.code, exc.retry
        except psycopg.Error as exc:
            # No traceback and no message: a psycopg message can quote the failing row
            # ("DETAIL: Failing row contains ..."), extracted text included.
            logger.error(
                "job %s (%s) raised a database error: %s sqlstate=%s constraint=%s",
                job.id,
                job.kind,
                type(exc).__name__,
                exc.sqlstate,
                exc.diag.constraint_name,
            )
            code, retry = "internal_error", True
        except Exception:
            # The traceback goes to the log; jobs.error gets only the fixed code.
            logger.exception("job %s (%s) raised an unexpected error", job.id, job.kind)
            code, retry = "internal_error", True
        else:
            self._finish(conn, job, result)
            return True

        if retry and job.attempts < job.max_attempts:
            run_at = self._clock() + backoff(job.attempts)
            if requeue(conn, job.id, job.attempts, run_at=run_at, error=code):
                logger.info("job %s (%s) queued for retry: %s", job.id, job.kind, code)
            else:
                self._claim_lost(job)
        else:
            self._fail(conn, job, code)
        return True

    def _finish(
        self, conn: psycopg.Connection[DictRow], job: JobRow, result: Mapping[str, Any] | None
    ) -> None:
        try:
            finished = finish(conn, job.id, job.attempts, self._clock(), result)
        except (psycopg.errors.IntegrityError, psycopg.errors.DataError) as exc:
            # A result the table rejects (too large, not an object): rerunning gives the same.
            logger.warning("job %s (%s) result rejected: %s", job.id, job.kind, type(exc).__name__)
            self._fail(conn, job, "internal_error")
            return
        if finished:
            logger.info("job %s (%s) done", job.id, job.kind)
        else:
            self._claim_lost(job)

    def _fail(self, conn: psycopg.Connection[DictRow], job: JobRow, code: str) -> None:
        if fail(conn, job.id, job.attempts, self._clock(), code):
            logger.info("job %s (%s) failed: %s", job.id, job.kind, code)
        else:
            self._claim_lost(job)

    def _claim_lost(self, job: JobRow) -> None:
        logger.warning("job %s (%s) claim lost; its end was not written", job.id, job.kind)

    def run_forever(self, *, stop: threading.Event | None = None) -> None:
        """Run jobs until `stop` is set; survive lost connections and failing jobs."""
        stop = stop if stop is not None else threading.Event()
        poll = self._settings.worker_poll_seconds
        while not stop.is_set():
            try:
                if self._conn is None:
                    self.connect()
                worked = self.run_once()
            except psycopg.OperationalError as exc:
                logger.warning("worker lost the database: %s", type(exc).__name__)
                self.close()
                worked = False
            except Exception:
                logger.exception("worker iteration failed")
                worked = False
            if not worked:
                stop.wait(poll)
