"""The parse_timetable job, end to end through the worker with a fake Claude and storage."""

import json
from collections.abc import Callable, Iterator, Sequence
from datetime import timedelta
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg.rows import DictRow

from app.ai.client import AiError, AnalysisReply
from app.ai.timetable import SYSTEM_PROMPT, file_block
from app.auth import CurrentUser
from app.config import Settings
from app.domain.materials import JOB_PARSE_TIMETABLE, timetable_path
from app.jobs.ingest import HANDLERS, ON_CRASHED
from app.jobs.queue import JobRow
from app.jobs.storage import StorageUnavailable
from app.jobs.timetable import parse_timetable, parse_timetable_crashed
from app.jobs.worker import Worker
from tests.ai.fake_client import FakeAnalysisClient, reply
from tests.fixtures_db import FrozenClock
from tests.jobs.conftest import MakeJob
from tests.jobs.fake_storage import MemoryStorage
from tests.jobs.pdfs import GARBAGE_PDF, make_pdf

type Conn = psycopg.Connection[DictRow]

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
ZIP = b"PK\x03\x04" + b"\x00" * 64

ITEM: dict[str, Any] = {
    "title": "מבוא להסתברות - הרצאה",
    "kind": "class",
    "weekday": 0,
    "start": "10:15",
    "end": "11:45",
}
SECOND: dict[str, Any] = ITEM | {"title": "מבוא להסתברות - תרגול", "weekday": 3}


def _text(*items: dict[str, Any], readable: bool = True) -> str:
    return json.dumps({"readable": readable, "commitments": list(items)}, ensure_ascii=False)


class Harness:
    """Uploads a file, queues the job and runs it once with a fake Claude."""

    def __init__(
        self,
        *,
        make_job: MakeJob,
        read_job: Callable[[UUID], JobRow],
        storage: MemoryStorage,
        make_worker: Callable[..., Worker],
        user: CurrentUser,
        settings: Settings,
    ) -> None:
        self.make_job = make_job
        self.read_job = read_job
        self.storage = storage
        self.make_worker = make_worker
        self.user = user
        self.settings = settings

    def upload(self, data: bytes, *, user: CurrentUser | None = None) -> str:
        path = timetable_path((user or self.user).id, uuid4())
        self.storage.files[path] = data
        return path

    def queue(self, path: str, mime: str, **columns: Any) -> UUID:
        payload = {"upload_id": path.rsplit("/", 1)[-1], "storage_path": path, "mime": mime}
        return self.make_job(self.user, JOB_PARSE_TIMETABLE, payload, **columns)

    def run(
        self,
        job_id: UUID,
        replies: Sequence[AnalysisReply | AiError | Exception] = (),
        *,
        settings: Settings | None = None,
        factory: Callable[[Settings], Any] | None = None,
    ) -> tuple[JobRow, FakeAnalysisClient]:
        client = _RaisingFake(replies)
        worker = self.make_worker(
            settings if settings is not None else self.settings,
            factory if factory is not None else (lambda _settings: client),
        )
        assert worker.run_once()
        return self.read_job(job_id), client


class _RaisingFake(FakeAnalysisClient):
    """The fake client, which may also raise any exception (a bug in the client)."""

    def __init__(self, replies: Sequence[AnalysisReply | AiError | Exception]) -> None:
        self._raw = list(replies)
        super().__init__([r for r in replies if isinstance(r, (AnalysisReply, AiError))])

    def complete(self, **kwargs: Any) -> AnalysisReply:
        index = len(self.calls)
        if index < len(self._raw):
            item = self._raw[index]
            if not isinstance(item, (AnalysisReply, AiError)):
                self.calls.append(kwargs)
                raise item
        return super().complete(**kwargs)


@pytest.fixture
def timetable_settings(worker_settings: Settings) -> Settings:
    return worker_settings.model_copy(
        update={"ai_model_timetable": "test-model", "anthropic_api_key": None}
    )


@pytest.fixture
def make_timetable_worker(
    migrated_database_url: str,
    storage: MemoryStorage,
    clock: FrozenClock,
    db: psycopg.Connection,
) -> Iterator[Callable[..., Worker]]:
    workers: list[Worker] = []

    def make(settings: Settings, factory: Callable[[Settings], Any]) -> Worker:
        worker = Worker(
            migrated_database_url,
            storage=storage,
            settings=settings,
            handlers=HANDLERS,
            clock=clock,
            on_crashed=ON_CRASHED,
            # The analysis client must never be used by this job.
            ai_client_factory=_no_analysis_client,
            timetable_ai_client_factory=factory,
        )
        worker.connect()
        workers.append(worker)
        return worker

    try:
        yield make
    finally:
        for worker in workers:
            worker.close()


def _no_analysis_client(_settings: Settings) -> Any:
    raise AssertionError("parse_timetable used the analysis client")


@pytest.fixture
def h(
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    storage: MemoryStorage,
    make_timetable_worker: Callable[..., Worker],
    make_user: Callable[[], CurrentUser],
    timetable_settings: Settings,
) -> Harness:
    return Harness(
        make_job=make_job,
        read_job=read_job,
        storage=storage,
        make_worker=make_timetable_worker,
        user=make_user(),
        settings=timetable_settings,
    )


def _usage_rows(db: psycopg.Connection, job_id: UUID) -> list[tuple[Any, ...]]:
    return db.execute(
        "SELECT exam_id, model, input_tokens, output_tokens FROM app.ai_usage WHERE job_id = %s",
        (job_id,),
    ).fetchall()


def test_registered() -> None:
    assert HANDLERS[JOB_PARSE_TIMETABLE] is parse_timetable
    assert ON_CRASHED[JOB_PARSE_TIMETABLE] is parse_timetable_crashed


def test_timetable_path() -> None:
    user, upload = uuid4(), uuid4()
    assert timetable_path(user, upload) == f"{user}/timetables/{upload}"


def test_an_image_is_read_and_the_file_deleted(h: Harness, db: psycopg.Connection) -> None:
    path = h.upload(PNG)
    job_id = h.queue(path, "image/png")
    job, client = h.run(job_id, [reply(_text(SECOND, ITEM))])
    assert job.status == "done"
    assert job.result == {
        "commitments": [
            {
                "title": ITEM["title"],
                "kind": "class",
                "weekday": 0,
                "start": "10:15",
                "end": "11:45",
            },
            {
                "title": SECOND["title"],
                "kind": "class",
                "weekday": 3,
                "start": "10:15",
                "end": "11:45",
            },
        ],
        "model": "test-model",
    }
    (call,) = client.calls
    assert call["system"] == SYSTEM_PROMPT
    assert call["messages"][0]["content"][0] == file_block(PNG, "image/png")
    assert _usage_rows(db, job_id) == [(None, "test-model", 1000, 500)]
    assert h.storage.deleted == [path]
    assert path not in h.storage.files


def test_a_pdf_goes_as_a_document(h: Harness) -> None:
    pdf = make_pdf(["Sunday 10:15 Probability"])
    path = h.upload(pdf)
    job_id = h.queue(path, "application/pdf")
    job, client = h.run(job_id, [reply(_text(ITEM))])
    assert job.status == "done"
    block = client.calls[0]["messages"][0]["content"][0]
    assert block == file_block(pdf, "application/pdf")
    assert block["type"] == "document"
    assert h.storage.deleted == [path]


def test_an_invalid_answer_is_retried_once(h: Harness, db: psycopg.Connection) -> None:
    path = h.upload(JPEG)
    job_id = h.queue(path, "image/jpeg")
    first = reply(_text(ITEM | {"start": "25:00"}))
    job, client = h.run(job_id, [first, reply(_text(ITEM))])
    assert job.status == "done"
    assert len(client.calls) == 2
    turn = client.calls[1]["messages"]
    assert turn[1] == {"role": "assistant", "content": first.content}
    assert "commitments.0.start: invalid_time" in turn[2]["content"]
    assert len(_usage_rows(db, job_id)) == 2


def test_two_invalid_answers_fail_the_job(h: Harness, db: psycopg.Connection) -> None:
    path = h.upload(PNG)
    job_id = h.queue(path, "image/png")
    job, _ = h.run(job_id, [reply("nope"), reply(_text(ITEM | {"weekday": 7}))])
    assert (job.status, job.error) == ("failed", "timetable_invalid")
    assert len(_usage_rows(db, job_id)) == 2
    assert h.storage.deleted == [path]


@pytest.mark.parametrize("text", [_text(readable=False), _text(ITEM, readable=False), _text()])
def test_unreadable(h: Harness, db: psycopg.Connection, text: str) -> None:
    path = h.upload(PNG)
    job_id = h.queue(path, "image/png")
    job, client = h.run(job_id, [reply(text)])
    assert (job.status, job.error) == ("failed", "timetable_unreadable")
    assert len(client.calls) == 1
    assert len(_usage_rows(db, job_id)) == 1
    assert h.storage.deleted == [path]


def test_refusal_fails_at_once(h: Harness, db: psycopg.Connection) -> None:
    path = h.upload(PNG)
    job_id = h.queue(path, "image/png")
    job, _ = h.run(job_id, [reply("", stop_reason="refusal")])
    assert (job.status, job.error) == ("failed", "ai_refused")
    assert len(_usage_rows(db, job_id)) == 1
    assert h.storage.deleted == [path]


@pytest.mark.parametrize(
    "payload_path",
    [
        lambda user, other: timetable_path(other, uuid4()),
        lambda user, other: f"{user}/{uuid4()}/{uuid4()}",
        lambda user, other: f"{user}/timetables/../{other}/timetables/{uuid4()}",
        lambda user, other: f"{user}/timetables/{uuid4()}/x",
        lambda user, other: f"{user}/timetables/",
        lambda user, other: f"{user}/timetables/not-a-uuid",
        lambda user, other: 42,
    ],
)
def test_a_path_outside_the_users_timetables_is_refused(
    h: Harness,
    make_user: Callable[[], CurrentUser],
    payload_path: Callable[[UUID, UUID], Any],
) -> None:
    other = make_user()
    victim = h.upload(PNG, user=other)
    path = payload_path(h.user.id, other.id)
    h.storage.files[str(path)] = PNG
    job_id = h.make_job(
        h.user,
        JOB_PARSE_TIMETABLE,
        {"upload_id": str(uuid4()), "storage_path": path, "mime": "image/png"},
    )
    job, client = h.run(job_id, [])
    assert (job.status, job.error) == ("failed", "internal_error")
    assert client.calls == []
    assert h.storage.deleted == []
    assert victim in h.storage.files


def test_a_payload_without_a_path_is_refused(h: Harness) -> None:
    job_id = h.make_job(h.user, JOB_PARSE_TIMETABLE, {"mime": "image/png"})
    job, _ = h.run(job_id, [])
    assert (job.status, job.error) == ("failed", "internal_error")


@pytest.mark.parametrize(
    ("data", "mime"),
    [
        (PNG, "image/jpeg"),
        (JPEG, "image/png"),
        (ZIP, "application/pdf"),
        (make_pdf(["x"]), "image/png"),
        (PNG, "image/gif"),
        (PNG, None),
    ],
)
def test_a_file_that_is_not_its_registered_type(h: Harness, data: bytes, mime: str | None) -> None:
    path = h.upload(data)
    job_id = h.queue(path, mime)  # type: ignore[arg-type]
    job, client = h.run(job_id, [])
    assert (job.status, job.error) == ("failed", "unsupported_file")
    assert client.calls == []
    assert h.storage.deleted == [path]


def test_an_image_over_the_limit(h: Harness) -> None:
    path = h.upload(PNG + b"\x00" * 100)
    job_id = h.queue(path, "image/png")
    settings = h.settings.model_copy(update={"max_timetable_image_bytes": 64})
    job, client = h.run(job_id, [], settings=settings)
    assert (job.status, job.error) == ("failed", "file_too_large")
    assert client.calls == []
    assert h.storage.deleted == [path]


def test_a_pdf_over_the_material_limit(h: Harness) -> None:
    path = h.upload(make_pdf(["x"]))
    job_id = h.queue(path, "application/pdf")
    settings = h.settings.model_copy(update={"max_material_bytes": 64})
    job, _ = h.run(job_id, [], settings=settings)
    assert (job.status, job.error) == ("failed", "file_too_large")


def test_a_pdf_with_too_many_pages(h: Harness) -> None:
    path = h.upload(make_pdf(["a", "b", "c", "d", "e"]))
    job_id = h.queue(path, "application/pdf")
    job, client = h.run(job_id, [])
    assert (job.status, job.error) == ("failed", "too_many_pages")
    assert client.calls == []
    assert h.storage.deleted == [path]


def test_four_pages_are_fine(h: Harness) -> None:
    path = h.upload(make_pdf(["a", "b", "c", "d"]))
    job_id = h.queue(path, "application/pdf")
    job, _ = h.run(job_id, [reply(_text(ITEM))])
    assert job.status == "done"


def test_an_unreadable_pdf(h: Harness) -> None:
    path = h.upload(GARBAGE_PDF)
    job_id = h.queue(path, "application/pdf")
    job, client = h.run(job_id, [])
    assert (job.status, job.error) == ("failed", "pdf_unreadable")
    assert client.calls == []
    assert h.storage.deleted == [path]


def test_a_file_that_was_never_uploaded(h: Harness) -> None:
    path = timetable_path(h.user.id, uuid4())
    job_id = h.queue(path, "image/png")
    job, _ = h.run(job_id, [])
    assert (job.status, job.error) == ("failed", "file_missing")


def test_storage_down_is_retried_and_keeps_the_file(h: Harness) -> None:
    path = h.upload(PNG)
    h.storage.failures[path] = StorageUnavailable("down")
    job_id = h.queue(path, "image/png")
    job, _ = h.run(job_id, [])
    assert (job.status, job.error) == ("queued", "storage_unavailable")
    assert path in h.storage.files


def test_ai_unavailable_is_retried_and_keeps_the_file(h: Harness, db: psycopg.Connection) -> None:
    path = h.upload(PNG)
    job_id = h.queue(path, "image/png")
    job, _ = h.run(job_id, [reply("nope"), AiError("ai_unavailable", retry=True)])
    assert (job.status, job.error) == ("queued", "ai_unavailable")
    assert h.storage.deleted == []
    # The paid first call is in the ledger even though the job will run again.
    assert len(_usage_rows(db, job_id)) == 1


def test_ai_unavailable_on_the_last_attempt_deletes_the_file(h: Harness) -> None:
    path = h.upload(PNG)
    job_id = h.queue(path, "image/png", attempts=2, max_attempts=3)
    job, _ = h.run(job_id, [AiError("ai_unavailable", retry=True)])
    assert (job.status, job.error) == ("failed", "ai_unavailable")
    assert h.storage.deleted == [path]


@pytest.mark.parametrize("code", ["ai_no_credit", "ai_rejected", "ai_not_configured"])
def test_account_errors_fail_at_once(h: Harness, db: psycopg.Connection, code: str) -> None:
    path = h.upload(PNG)
    job_id = h.queue(path, "image/png")
    job, _ = h.run(job_id, [AiError(code)])
    assert (job.status, job.error) == ("failed", code)
    assert _usage_rows(db, job_id) == []
    assert h.storage.deleted == [path]


def test_no_timetable_model_is_not_configured(h: Harness) -> None:
    path = h.upload(PNG)
    job_id = h.queue(path, "image/png")
    # The real factory: a key and an analysis model, but no AI_MODEL_TIMETABLE.
    from app.ai.client import AnthropicAnalysisClient

    settings = h.settings.model_copy(
        update={
            "anthropic_api_key": "sk-ant-test",
            "ai_model_analysis": "analysis-model",
            "ai_model_timetable": None,
        }
    )
    job, _ = h.run(job_id, settings=settings, factory=AnthropicAnalysisClient.for_timetable)
    assert (job.status, job.error) == ("failed", "ai_not_configured")
    assert h.storage.deleted == [path]


def test_an_unexpected_error_is_retried_and_keeps_the_file(h: Harness) -> None:
    path = h.upload(PNG)
    job_id = h.queue(path, "image/png")
    job, _ = h.run(job_id, [RuntimeError("bug")])
    assert (job.status, job.error) == ("queued", "internal_error")
    assert h.storage.deleted == []


def test_an_unexpected_error_on_the_last_attempt_deletes_the_file(h: Harness) -> None:
    path = h.upload(PNG)
    job_id = h.queue(path, "image/png", attempts=2, max_attempts=3)
    job, _ = h.run(job_id, [RuntimeError("bug")])
    assert (job.status, job.error) == ("failed", "internal_error")
    assert h.storage.deleted == [path]


class _UndeletableStorage(MemoryStorage):
    def delete(self, path: str) -> None:
        raise StorageUnavailable("down")


def test_a_failed_delete_never_fails_a_successful_job(
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    make_timetable_worker: Callable[..., Worker],
    make_user: Callable[[], CurrentUser],
    timetable_settings: Settings,
    migrated_database_url: str,
    clock: FrozenClock,
    caplog: pytest.LogCaptureFixture,
) -> None:
    storage = _UndeletableStorage()
    user = make_user()
    path = timetable_path(user.id, uuid4())
    storage.files[path] = PNG
    job_id = make_job(
        user, JOB_PARSE_TIMETABLE, {"upload_id": "x", "storage_path": path, "mime": "image/png"}
    )
    client = FakeAnalysisClient([reply(_text(ITEM))])
    worker = Worker(
        migrated_database_url,
        storage=storage,
        settings=timetable_settings,
        handlers=HANDLERS,
        clock=clock,
        on_crashed=ON_CRASHED,
        timetable_ai_client_factory=lambda _settings: client,
    )
    worker.connect()
    try:
        assert worker.run_once()
    finally:
        worker.close()
    assert read_job(job_id).status == "done"
    assert "could not delete the timetable file" in caplog.text
    assert path not in caplog.text


def _crashed_job(h: Harness, clock: FrozenClock, path: object) -> UUID:
    return h.make_job(
        h.user,
        JOB_PARSE_TIMETABLE,
        {"upload_id": "x", "storage_path": path, "mime": "image/png"},
        status="running",
        attempts=3,
        max_attempts=3,
        locked_at=clock.now - timedelta(hours=1),
    )


def test_a_crashed_job_deletes_its_file(h: Harness, clock: FrozenClock) -> None:
    path = h.upload(PNG)
    job_id = _crashed_job(h, clock, path)
    job, client = h.run(job_id, [])
    assert (job.status, job.error) == ("failed", "worker_crashed")
    assert client.calls == []
    assert h.storage.deleted == [path]


def test_a_crashed_job_with_a_forged_path_deletes_nothing(
    h: Harness, clock: FrozenClock, make_user: Callable[[], CurrentUser]
) -> None:
    victim = h.upload(PNG, user=make_user())
    job_id = _crashed_job(h, clock, victim)
    job, _ = h.run(job_id, [])
    assert (job.status, job.error) == ("failed", "worker_crashed")
    assert h.storage.deleted == []
