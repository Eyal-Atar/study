from collections.abc import Callable, Iterator
from typing import Any, Protocol
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg.rows import DictRow
from psycopg.types.json import Jsonb

import app.jobs.__main__ as worker_main
from app.auth import CurrentUser
from app.config import Settings
from app.domain.materials import JOB_DELETE_MATERIAL_FILE, JOB_INGEST_MATERIAL
from app.jobs.ingest import HANDLERS
from app.jobs.queue import JobRow
from app.jobs.storage import StorageUnavailable
from app.jobs.worker import Worker
from tests.fixtures_db import FrozenClock
from tests.jobs.conftest import MakeJob
from tests.jobs.fake_storage import MemoryStorage
from tests.jobs.pdfs import GARBAGE_PDF, make_pdf

type Conn = psycopg.Connection[DictRow]
type MakeWorker = Callable[..., Worker]

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
FIRST = "The first page has enough words to count as real text."
THIRD = "The third page also has enough words to count as real text."
ZIP = b"PK\x03\x04" + b"\x00" * 64


class Register(Protocol):
    def __call__(
        self,
        user: CurrentUser,
        exam: UUID,
        *,
        mime: str = "application/pdf",
        data: bytes | None = None,
    ) -> tuple[UUID, UUID]: ...


@pytest.fixture
def make_exam(owner_db: Conn) -> Callable[[CurrentUser], UUID]:
    def make(user: CurrentUser) -> UUID:
        row = owner_db.execute(
            "INSERT INTO app.exams (user_id, name, exam_date) VALUES (%s, 'x', '2027-01-01') "
            "RETURNING id",
            (user.id,),
        ).fetchone()
        assert row is not None
        exam_id: UUID = row["id"]
        return exam_id

    return make


def _path(user_id: UUID, exam_id: UUID, material_id: UUID) -> str:
    return f"{user_id}/{exam_id}/{material_id}"


def _insert_material(
    owner_db: Conn, user: CurrentUser, exam: UUID, *, mime: str, size: int
) -> UUID:
    material_id = uuid4()
    owner_db.execute(
        "INSERT INTO app.materials (id, user_id, exam_id, storage_path, filename, kind, mime, "
        "size_bytes) VALUES (%s, %s, %s, %s, 'notes', 'notes', %s, %s)",
        (material_id, user.id, exam, _path(user.id, exam, material_id), mime, max(size, 1)),
    )
    return material_id


@pytest.fixture
def register(owner_db: Conn, storage: MemoryStorage, make_job: MakeJob) -> Register:
    """Insert a material and its ingest job as the owner, and put its file in storage."""

    def make(
        user: CurrentUser,
        exam: UUID,
        *,
        mime: str = "application/pdf",
        data: bytes | None = None,
    ) -> tuple[UUID, UUID]:
        content = data if data is not None else make_pdf(["one page of notes"])
        material_id = _insert_material(owner_db, user, exam, mime=mime, size=len(content))
        storage.files[_path(user.id, exam, material_id)] = content
        job_id = make_job(user, JOB_INGEST_MATERIAL, {"material_id": str(material_id)})
        return material_id, job_id

    return make


def _material(owner_db: Conn, material_id: UUID) -> dict[str, Any]:
    row = owner_db.execute("SELECT * FROM app.materials WHERE id = %s", (material_id,)).fetchone()
    assert row is not None
    return dict(row)


def test_pdf_is_ingested_with_text_and_scanned_pages(
    worker: Worker,
    register: Register,
    make_user: Callable[[], CurrentUser],
    make_exam: Callable[[CurrentUser], UUID],
    owner_db: Conn,
    read_job: Callable[[UUID], JobRow],
    clock: FrozenClock,
) -> None:
    user = make_user()
    material_id, job_id = register(user, make_exam(user), data=make_pdf([FIRST, "", THIRD]))

    assert worker.run_once() is True

    material = _material(owner_db, material_id)
    assert material["ingest_status"] == "ready"
    assert material["ingest_error"] is None
    assert material["page_count"] == 3
    assert material["scanned_pages"] == 1
    assert material["text_by_page"][0]["text"] == FIRST
    assert material["text_by_page"][1] == {"page": 2, "text": "", "scanned": True}
    assert material["warnings"] == []
    assert material["ingested_at"] == clock.now
    job = read_job(job_id)
    assert job.status == "done"
    assert job.result is not None
    assert job.result["page_count"] == 3
    assert job.result == {
        "material_id": str(material_id),
        "page_count": 3,
        "scanned_pages": 1,
        "warnings": [],
    }


def test_truncated_pdf_gets_a_visible_warning(
    make_worker: MakeWorker,
    worker_settings: Settings,
    register: Register,
    make_user: Callable[[], CurrentUser],
    make_exam: Callable[[CurrentUser], UUID],
    owner_db: Conn,
    read_job: Callable[[UUID], JobRow],
) -> None:
    user = make_user()
    material_id, job_id = register(user, make_exam(user), data=make_pdf(["a b c", "d e f", "g"]))
    worker = make_worker(
        HANDLERS, settings=worker_settings.model_copy(update={"max_material_pages": 2})
    )

    assert worker.run_once() is True

    material = _material(owner_db, material_id)
    assert material["ingest_status"] == "ready"
    assert material["page_count"] == 3
    assert len(material["text_by_page"]) == 2
    assert material["warnings"] == ["pages_truncated"]
    job = read_job(job_id)
    assert job.result is not None
    assert job.result["warnings"] == ["pages_truncated"]


def test_image_is_one_scanned_page(
    worker: Worker,
    register: Register,
    make_user: Callable[[], CurrentUser],
    make_exam: Callable[[CurrentUser], UUID],
    owner_db: Conn,
    read_job: Callable[[UUID], JobRow],
) -> None:
    user = make_user()
    material_id, job_id = register(user, make_exam(user), mime="image/png", data=PNG)

    assert worker.run_once() is True

    material = _material(owner_db, material_id)
    assert material["ingest_status"] == "ready"
    assert material["page_count"] == 1
    assert material["scanned_pages"] == 1
    assert material["text_by_page"] == [{"page": 1, "text": "", "scanned": True}]
    assert read_job(job_id).status == "done"


def test_missing_upload_fails_visibly(
    worker: Worker,
    register: Register,
    storage: MemoryStorage,
    make_user: Callable[[], CurrentUser],
    make_exam: Callable[[CurrentUser], UUID],
    owner_db: Conn,
    read_job: Callable[[UUID], JobRow],
) -> None:
    user = make_user()
    material_id, job_id = register(user, make_exam(user))
    storage.files.clear()

    assert worker.run_once() is True

    material = _material(owner_db, material_id)
    assert material["ingest_status"] == "failed"
    assert material["ingest_error"] == "file_missing"
    assert material["text_by_page"] is None
    job = read_job(job_id)
    assert job.status == "failed"
    assert job.error == "file_missing"
    assert job.attempts == 1
    assert worker.run_once() is False


@pytest.mark.parametrize(
    ("mime", "data", "max_bytes", "code"),
    [
        pytest.param("application/pdf", ZIP, None, "unsupported_file", id="zip-as-pdf"),
        pytest.param("application/pdf", PNG, None, "unsupported_file", id="png-as-pdf"),
        pytest.param("image/png", make_pdf(["x"]), None, "unsupported_file", id="pdf-as-png"),
        pytest.param("application/pdf", GARBAGE_PDF, None, "pdf_unreadable", id="garbage-pdf"),
        pytest.param("application/pdf", make_pdf(["x"]), 100, "file_too_large", id="too-large"),
    ],
)
def test_wrong_type_and_unreadable_pdf_fail_permanently(
    mime: str,
    data: bytes,
    max_bytes: int | None,
    code: str,
    make_worker: MakeWorker,
    worker_settings: Settings,
    register: Register,
    make_user: Callable[[], CurrentUser],
    make_exam: Callable[[CurrentUser], UUID],
    owner_db: Conn,
    read_job: Callable[[UUID], JobRow],
    clock: FrozenClock,
) -> None:
    settings = worker_settings
    if max_bytes is not None:
        settings = worker_settings.model_copy(update={"max_material_bytes": max_bytes})
    worker = make_worker(HANDLERS, settings=settings)
    user = make_user()
    material_id, job_id = register(user, make_exam(user), mime=mime, data=data)

    assert worker.run_once() is True

    material = _material(owner_db, material_id)
    assert material["ingest_status"] == "failed"
    assert material["ingest_error"] == code
    job = read_job(job_id)
    assert job.status == "failed"
    assert job.error == code
    assert job.attempts == 1
    clock.advance(hours=1)
    assert worker.run_once() is False


def test_storage_outage_retries_then_fails(
    worker: Worker,
    register: Register,
    storage: MemoryStorage,
    make_user: Callable[[], CurrentUser],
    make_exam: Callable[[CurrentUser], UUID],
    owner_db: Conn,
    read_job: Callable[[UUID], JobRow],
    clock: FrozenClock,
) -> None:
    user = make_user()
    exam = make_exam(user)
    material_id, job_id = register(user, exam)
    storage.failures[_path(user.id, exam, material_id)] = StorageUnavailable()

    assert worker.run_once() is True
    material = _material(owner_db, material_id)
    assert material["ingest_status"] == "queued"
    assert material["ingest_error"] is None
    job = read_job(job_id)
    assert job.status == "queued"
    assert job.error == "storage_unavailable"

    clock.advance(seconds=30)
    assert worker.run_once() is True
    assert _material(owner_db, material_id)["ingest_status"] == "queued"
    clock.advance(seconds=60)
    assert worker.run_once() is True

    material = _material(owner_db, material_id)
    assert material["ingest_status"] == "failed"
    assert material["ingest_error"] == "storage_unavailable"
    job = read_job(job_id)
    assert job.status == "failed"
    assert job.error == "storage_unavailable"
    assert job.attempts == 3


def test_forged_payload_cannot_touch_another_users_material(
    worker: Worker,
    register: Register,
    make_user: Callable[[], CurrentUser],
    make_exam: Callable[[CurrentUser], UUID],
    make_job: MakeJob,
    owner_db: Conn,
    read_job: Callable[[UUID], JobRow],
    clock: FrozenClock,
) -> None:
    user_a, user_b = make_user(), make_user()
    material_b, job_b = register(user_b, make_exam(user_b))
    # A's forged job sorts first, so it runs before B's real one.
    forged = make_job(
        user_a,
        JOB_INGEST_MATERIAL,
        {"material_id": str(material_b)},
        created_at=clock.now.replace(year=2020),
    )

    assert worker.run_once() is True

    job = read_job(forged)
    assert job.status == "failed"
    assert job.error == "material_missing"
    material = _material(owner_db, material_b)
    assert material["ingest_status"] == "queued"
    assert material["ingest_error"] is None
    assert material["text_by_page"] is None

    assert worker.run_once() is True
    assert read_job(job_b).status == "done"
    assert _material(owner_db, material_b)["ingest_status"] == "ready"


@pytest.mark.parametrize("payload", [{}, {"material_id": "not-a-uuid"}])
def test_bad_payload_is_material_missing(
    payload: dict[str, Any],
    worker: Worker,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
) -> None:
    job_id = make_job(make_user(), JOB_INGEST_MATERIAL, payload)

    assert worker.run_once() is True

    job = read_job(job_id)
    assert job.status == "failed"
    assert job.error == "material_missing"


class _DeletingStorage(MemoryStorage):
    """Deletes the material row (as the owner) during the download, then returns the bytes."""

    def __init__(self, owner_db: Conn) -> None:
        super().__init__()
        self._owner_db = owner_db

    def download(self, path: str, *, max_bytes: int) -> bytes:
        data = super().download(path, max_bytes=max_bytes)
        self._owner_db.execute("DELETE FROM app.materials WHERE storage_path = %s", (path,))
        return data


@pytest.fixture
def worker_with(
    migrated_database_url: str,
    worker_settings: Settings,
    clock: FrozenClock,
    db: psycopg.Connection,
) -> Iterator[Callable[[MemoryStorage], Worker]]:
    """A worker with the real handlers and a storage the test builds itself."""
    workers: list[Worker] = []

    def make(storage: MemoryStorage) -> Worker:
        worker = Worker(
            migrated_database_url,
            storage=storage,
            settings=worker_settings,
            handlers=HANDLERS,
            clock=clock,
        )
        worker.connect()
        workers.append(worker)
        return worker

    try:
        yield make
    finally:
        for worker in workers:
            worker.close()


def test_material_deleted_mid_flight_is_reported_missing(
    worker_with: Callable[[MemoryStorage], Worker],
    make_user: Callable[[], CurrentUser],
    make_exam: Callable[[CurrentUser], UUID],
    make_job: MakeJob,
    owner_db: Conn,
    read_job: Callable[[UUID], JobRow],
) -> None:
    storage = _DeletingStorage(owner_db)
    worker = worker_with(storage)
    user = make_user()
    exam = make_exam(user)
    material_id = _insert_material(owner_db, user, exam, mime="application/pdf", size=10)
    storage.files[_path(user.id, exam, material_id)] = make_pdf(["text"])
    job_id = make_job(user, JOB_INGEST_MATERIAL, {"material_id": str(material_id)})

    assert worker.run_once() is True

    job = read_job(job_id)
    assert job.status == "failed"
    assert job.error == "material_missing"
    assert owner_db.execute(
        "SELECT count(*) AS n FROM app.materials WHERE id = %s", (material_id,)
    ).fetchone() == {"n": 0}


class _CountingStorage(MemoryStorage):
    def __init__(self) -> None:
        super().__init__()
        self.downloads = 0

    def download(self, path: str, *, max_bytes: int) -> bytes:
        self.downloads += 1
        return super().download(path, max_bytes=max_bytes)


def test_already_ready_material_is_not_processed_again(
    worker_with: Callable[[MemoryStorage], Worker],
    make_user: Callable[[], CurrentUser],
    make_exam: Callable[[CurrentUser], UUID],
    make_job: MakeJob,
    owner_db: Conn,
    read_job: Callable[[UUID], JobRow],
    clock: FrozenClock,
) -> None:
    storage = _CountingStorage()
    worker = worker_with(storage)
    user = make_user()
    exam = make_exam(user)
    material_id = _insert_material(owner_db, user, exam, mime="application/pdf", size=10)
    storage.files[_path(user.id, exam, material_id)] = make_pdf(["new text"])
    text = [{"page": 1, "text": "old text", "scanned": False}]
    owner_db.execute(
        "UPDATE app.materials SET ingest_status = 'ready', page_count = 4, scanned_pages = 0, "
        "warnings = %s, text_by_page = %s, ingested_at = %s WHERE id = %s",
        (["pages_truncated"], Jsonb(text), clock.now, material_id),
    )
    job_id = make_job(user, JOB_INGEST_MATERIAL, {"material_id": str(material_id)})

    assert worker.run_once() is True

    job = read_job(job_id)
    assert job.status == "done"
    assert job.result == {
        "material_id": str(material_id),
        "page_count": 4,
        "scanned_pages": 0,
        "warnings": ["pages_truncated"],
    }
    assert storage.downloads == 0
    material = _material(owner_db, material_id)
    assert material["ingest_status"] == "ready"
    assert material["text_by_page"] == text


def test_delete_material_file_removes_from_storage(
    worker: Worker,
    storage: MemoryStorage,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
    clock: FrozenClock,
) -> None:
    user, other = make_user(), make_user()
    own_path = f"{user.id}/{uuid4()}/{uuid4()}"
    other_path = f"{other.id}/{uuid4()}/{uuid4()}"
    storage.files[own_path] = b"x"
    storage.files[other_path] = b"y"
    forged = make_job(user, JOB_DELETE_MATERIAL_FILE, {"storage_path": other_path})

    assert worker.run_once() is True

    job = read_job(forged)
    assert job.status == "failed"
    assert job.error == "material_missing"
    assert storage.deleted == []
    assert other_path in storage.files

    clock.advance(seconds=1)
    job_id = make_job(user, JOB_DELETE_MATERIAL_FILE, {"storage_path": own_path})
    assert worker.run_once() is True

    job = read_job(job_id)
    assert job.status == "done"
    assert job.result == {"storage_path": own_path}
    assert storage.deleted == [own_path]


@pytest.mark.parametrize(
    "payload",
    [{}, {"storage_path": 7}, {"storage_path": "{user}"}, {"storage_path": "{user}/../x"}],
    ids=str,
)
def test_delete_material_file_rejects_bad_paths(
    payload: dict[str, Any],
    worker: Worker,
    storage: MemoryStorage,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
) -> None:
    user = make_user()
    path = payload.get("storage_path")
    if isinstance(path, str):
        # "{user}" alone is the bare prefix without the separator; "{user}/../x" climbs out.
        payload = {"storage_path": path.replace("{user}", str(user.id))}
    job_id = make_job(user, JOB_DELETE_MATERIAL_FILE, payload)

    assert worker.run_once() is True

    job = read_job(job_id)
    assert job.status == "failed"
    assert job.error == "material_missing"
    assert storage.deleted == []


def test_delete_material_file_retries_on_outage(
    worker: Worker,
    storage: MemoryStorage,
    make_user: Callable[[], CurrentUser],
    make_job: MakeJob,
    read_job: Callable[[UUID], JobRow],
) -> None:
    user = make_user()
    path = f"{user.id}/{uuid4()}/{uuid4()}"
    storage.failures[path] = StorageUnavailable()
    job_id = make_job(user, JOB_DELETE_MATERIAL_FILE, {"storage_path": path})

    assert worker.run_once() is True

    job = read_job(job_id)
    assert job.status == "queued"
    assert job.error == "storage_unavailable"


def test_main_requires_the_worker_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("WORKER_DATABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    monkeypatch.setattr(
        worker_main,
        "Settings",
        lambda: Settings(supabase_url="https://test-ref.supabase.co", _env_file=None),
    )

    def no_connect(self: Worker) -> None:
        raise AssertionError("main() must not connect without its settings")

    monkeypatch.setattr(Worker, "connect", no_connect)

    with pytest.raises(SystemExit) as raised:
        worker_main.main()

    assert str(raised.value) == "WORKER_DATABASE_URL and SUPABASE_SECRET_KEY are required"


def test_main_requires_the_secret_key_too(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    monkeypatch.setattr(
        worker_main,
        "Settings",
        lambda: Settings(
            supabase_url="https://test-ref.supabase.co",
            worker_database_url="postgresql://localhost:1/none",
            _env_file=None,
        ),
    )

    def no_connect(self: Worker) -> None:
        raise AssertionError("main() must not connect without its settings")

    monkeypatch.setattr(Worker, "connect", no_connect)

    with pytest.raises(SystemExit):
        worker_main.main()
