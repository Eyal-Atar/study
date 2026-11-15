"""Materials end to end: register through the API, run the worker, read the result back.

These are the acceptance tests of S10: an uploaded file is ingested, and scanned pages are
marked. The API writes the rows and the job; the worker (real handlers, memory storage)
does the work; the API shows what happened.
"""

from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from app.config import Settings
from app.domain.materials import normalize_text
from app.jobs.ingest import HANDLERS
from app.jobs.worker import Worker
from tests.api.factories import NOW, TEST_PROFILE, register_material, scalar
from tests.fixtures_db import ApiUser, FrozenClock
from tests.jobs.fake_storage import MemoryStorage
from tests.jobs.pdfs import make_pdf

type MakeApiUser = Callable[[], ApiUser]
type MakeWorker = Callable[..., Worker]

FIRST = "The first page has enough words to count as real text."
THIRD = "The third page also has enough words to count as real text."


def _ok(response: Any, status: int = 200) -> Any:
    assert response.status_code == status, response.text
    return response.json() if response.content else None


@pytest.fixture
def new_user(
    api: TestClient, make_api_user: MakeApiUser, clock: FrozenClock
) -> Callable[[], ApiUser]:
    """A user whose profile was filled through PATCH /me."""
    clock.set(NOW)

    def make() -> ApiUser:
        user = make_api_user()
        _ok(api.patch("/me", json=TEST_PROFILE, headers=user.headers))
        return user

    return make


def _create_exam(api: TestClient, user: ApiUser) -> UUID:
    body = _ok(
        api.post("/exams", json={"name": "מבחן", "exam_date": "2026-12-01"}, headers=user.headers),
        201,
    )
    return UUID(body["exam"]["id"])


def _path(user: ApiUser, exam_id: UUID, material_id: UUID) -> str:
    return f"{user.id}/{exam_id}/{material_id}"


def _upload(
    api: TestClient,
    storage: MemoryStorage,
    user: ApiUser,
    exam_id: UUID,
    data: bytes | None,
) -> tuple[UUID, UUID]:
    """Register through the API and, unless data is None, put the file where the API said."""
    material_id = uuid4()
    body = register_material(
        api, user, exam_id, material_id=material_id, size_bytes=len(data or b"x")
    )
    if data is not None:
        storage.files[_path(user, exam_id, material_id)] = data
    return material_id, UUID(body["job_id"])


def _catch_up(db: psycopg.Connection, clock: FrozenClock) -> None:
    """Move the frozen clock to the latest job's run_at if it is behind.

    The API's jobs get run_at from the database's real clock, which the frozen one does not
    follow; the worker only takes jobs whose run_at has come.
    """
    latest = scalar(db, "SELECT max(run_at) FROM app.jobs")
    if latest is not None and latest > clock.now:
        clock.set(latest)


def _materials(api: TestClient, user: ApiUser, exam_id: UUID) -> list[dict[str, Any]]:
    body: list[dict[str, Any]] = _ok(api.get(f"/exams/{exam_id}/materials", headers=user.headers))
    return body


def _job(api: TestClient, user: ApiUser, job_id: UUID) -> dict[str, Any]:
    body: dict[str, Any] = _ok(api.get(f"/jobs/{job_id}", headers=user.headers))
    return body


def test_registered_pdf_is_ingested_and_visible_in_the_api(
    api: TestClient,
    db: psycopg.Connection,
    worker: Worker,
    storage: MemoryStorage,
    new_user: Callable[[], ApiUser],
    clock: FrozenClock,
) -> None:
    user = new_user()
    exam_id = _create_exam(api, user)
    material_id, job_id = _upload(api, storage, user, exam_id, make_pdf([FIRST, "", THIRD]))
    assert _job(api, user, job_id)["status"] == "queued"

    _catch_up(db, clock)
    assert worker.run_once() is True

    job = _job(api, user, job_id)
    assert job["status"] == "done"
    assert job["percent"] == 100
    assert job["result"]["page_count"] == 3
    [material] = _materials(api, user, exam_id)
    assert material["id"] == str(material_id)
    assert material["ingest_status"] == "ready"
    assert material["page_count"] == 3
    assert material["scanned_pages"] == 1
    assert material["warnings"] == []
    assert worker.run_once() is False


def test_truncated_file_shows_a_warning_in_the_api(
    api: TestClient,
    db: psycopg.Connection,
    make_worker: MakeWorker,
    worker_settings: Settings,
    storage: MemoryStorage,
    new_user: Callable[[], ApiUser],
    clock: FrozenClock,
) -> None:
    worker = make_worker(
        HANDLERS, settings=worker_settings.model_copy(update={"max_material_pages": 2})
    )
    user = new_user()
    exam_id = _create_exam(api, user)
    _, job_id = _upload(api, storage, user, exam_id, make_pdf([FIRST, "d e f", THIRD]))

    _catch_up(db, clock)
    assert worker.run_once() is True

    [material] = _materials(api, user, exam_id)
    assert material["ingest_status"] == "ready"
    assert material["page_count"] == 3
    assert material["warnings"] == ["pages_truncated"]
    assert _job(api, user, job_id)["result"]["warnings"] == ["pages_truncated"]


def test_failed_upload_is_visible_in_the_api(
    api: TestClient,
    db: psycopg.Connection,
    worker: Worker,
    storage: MemoryStorage,
    new_user: Callable[[], ApiUser],
    clock: FrozenClock,
) -> None:
    user = new_user()
    exam_id = _create_exam(api, user)
    _, job_id = _upload(api, storage, user, exam_id, None)

    _catch_up(db, clock)
    assert worker.run_once() is True

    job = _job(api, user, job_id)
    assert job["status"] == "failed"
    assert job["error"] == "file_missing"
    [material] = _materials(api, user, exam_id)
    assert material["ingest_status"] == "failed"
    assert material["ingest_error"] == "file_missing"


def test_two_users_get_their_own_texts(
    api: TestClient,
    db: psycopg.Connection,
    worker: Worker,
    storage: MemoryStorage,
    new_user: Callable[[], ApiUser],
    clock: FrozenClock,
) -> None:
    user_a, user_b = new_user(), new_user()
    exam_a, exam_b = _create_exam(api, user_a), _create_exam(api, user_b)
    text_a = "Alpha notes belong to the first user and nobody else at all."
    text_b = "Bravo notes belong to the second user and nobody else at all."
    material_a, job_a = _upload(api, storage, user_a, exam_a, make_pdf([text_a]))
    material_b, job_b = _upload(api, storage, user_b, exam_b, make_pdf([text_b]))

    _catch_up(db, clock)
    assert worker.run_once() is True
    assert worker.run_once() is True

    assert _job(api, user_a, job_a)["status"] == "done"
    assert _job(api, user_b, job_b)["status"] == "done"
    pages_a = scalar(db, "SELECT text_by_page FROM app.materials WHERE id = %s", material_a)
    pages_b = scalar(db, "SELECT text_by_page FROM app.materials WHERE id = %s", material_b)
    assert [page["text"] for page in pages_a] == [text_a]
    assert [page["text"] for page in pages_b] == [text_b]
    listed_b = _materials(api, user_b, exam_b)
    assert [material["id"] for material in listed_b] == [str(material_b)]
    assert str(material_a) not in str(listed_b)


def test_delete_removes_the_row_and_then_the_file(
    api: TestClient,
    db: psycopg.Connection,
    worker: Worker,
    storage: MemoryStorage,
    new_user: Callable[[], ApiUser],
    clock: FrozenClock,
) -> None:
    user = new_user()
    exam_id = _create_exam(api, user)
    material_id, _ = _upload(api, storage, user, exam_id, make_pdf([FIRST]))
    _catch_up(db, clock)
    assert worker.run_once() is True
    assert _materials(api, user, exam_id)[0]["ingest_status"] == "ready"

    _ok(api.delete(f"/materials/{material_id}", headers=user.headers), 204)
    assert _materials(api, user, exam_id) == []
    assert storage.deleted == []

    _catch_up(db, clock)
    assert worker.run_once() is True

    assert storage.deleted == [_path(user, exam_id, material_id)]
    assert _materials(api, user, exam_id) == []


def _insert_with_text(db: psycopg.Connection, user: ApiUser, exam_id: UUID, text: str) -> UUID:
    material_id = uuid4()
    db.execute(
        "INSERT INTO app.materials (id, user_id, exam_id, storage_path, filename, kind, mime, "
        "size_bytes, text_by_page) VALUES (%s, %s, %s, %s, 'n', 'notes', 'application/pdf', 1, %s)",
        (
            material_id,
            user.id,
            exam_id,
            _path(user, exam_id, material_id),
            Jsonb([{"page": 1, "text": text, "scanned": False}]),
        ),
    )
    return material_id


def test_text_with_nul_survives_the_database(
    api: TestClient, db: psycopg.Connection, new_user: Callable[[], ApiUser]
) -> None:
    user = new_user()
    exam_id = _create_exam(api, user)

    with pytest.raises((psycopg.errors.UntranslatableCharacter, psycopg.DataError)):
        _insert_with_text(db, user, exam_id, "a\x00b")

    material_id = _insert_with_text(db, user, exam_id, normalize_text("a\x00b\ud800c"))
    pages = scalar(db, "SELECT text_by_page FROM app.materials WHERE id = %s", material_id)
    assert pages[0]["text"] == "abc"
