import threading
import time
from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from tests.api.factories import (
    NOW,
    TEST_PROFILE,
    Z,
    insert_exam,
    insert_material,
    register_material,
    scalar,
    set_profile,
)
from tests.fixtures_db import ApiUser, FrozenClock

MakeApiUser = Callable[[], ApiUser]


@pytest.fixture
def user(make_api_user: MakeApiUser, db: psycopg.Connection, clock: FrozenClock) -> ApiUser:
    created = make_api_user()
    set_profile(db, created.id, **TEST_PROFILE)
    clock.set(NOW)
    return created


@pytest.fixture
def exam(db: psycopg.Connection, user: ApiUser) -> UUID:
    return insert_exam(db, user.id, exam_date="2026-12-01")


def _body(**changes: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "id": str(uuid4()),
        "filename": "מבחן.pdf",
        "kind": "past_exam",
        "mime": "application/pdf",
        "size_bytes": 1000,
    }
    body.update(changes)
    return body


def _counts(db: psycopg.Connection, user_id: UUID) -> tuple[int, int]:
    return (
        scalar(db, "SELECT count(*) FROM app.materials WHERE user_id = %s", user_id),
        scalar(db, "SELECT count(*) FROM app.jobs WHERE user_id = %s", user_id),
    )


def test_register_creates_material_and_job(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    material_id = uuid4()
    body = register_material(api, user, exam, material_id=material_id)
    material = body["material"]
    assert material["id"] == str(material_id)
    assert material["exam_id"] == str(exam)
    assert material["ingest_status"] == "queued"
    assert material["warnings"] == []
    assert material["page_count"] is None
    assert material["scanned_pages"] is None
    assert material["ingested_at"] is None
    assert "storage_path" not in material
    assert "text_by_page" not in material
    path = scalar(db, "SELECT storage_path FROM app.materials WHERE id = %s", material_id)
    assert path == f"{user.id}/{exam}/{material_id}"

    job_id = UUID(body["job_id"])
    row = db.execute(
        "SELECT status, kind, payload, user_id FROM app.jobs WHERE id = %s", (job_id,)
    ).fetchone()
    assert row is not None
    assert row[0] == "queued"
    assert row[1] == "ingest_material"
    assert row[2] == {"material_id": str(material_id)}
    assert row[3] == user.id

    job = api.get(f"/jobs/{job_id}", headers=user.headers)
    assert job.status_code == 200, job.text
    assert job.json()["status"] == "queued"
    assert job.json()["kind"] == "ingest_material"
    assert "payload" not in job.json()


def test_list_materials_in_order_and_without_text(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    late = insert_material(db, user.id, exam, created_at=Z(2026, 11, 15, 12))
    tied = sorted([uuid4(), uuid4()])
    for material_id in reversed(tied):
        insert_material(db, user.id, exam, material_id=material_id, created_at=Z(2026, 11, 15, 9))
    db.execute("UPDATE app.materials SET text_by_page = '[]'::jsonb WHERE user_id = %s", (user.id,))
    response = api.get(f"/exams/{exam}/materials", headers=user.headers)
    assert response.status_code == 200, response.text
    listed = response.json()
    assert [item["id"] for item in listed] == [str(tied[0]), str(tied[1]), str(late)]
    for item in listed:
        assert "text_by_page" not in item
        assert "storage_path" not in item


def test_list_materials_of_missing_exam_is_404(api: TestClient, user: ApiUser) -> None:
    response = api.get(f"/exams/{uuid4()}/materials", headers=user.headers)
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


@pytest.mark.parametrize(
    "case",
    [
        "zip_mime",
        "empty_filename",
        "blank_filename",
        "nul_filename",
        "long_filename",
        "bad_kind",
        "zero_size",
        "unknown_field",
        "too_large",
        "deleted_exam",
        "other_users_exam",
    ],
)
def test_register_validation(
    api: TestClient,
    db: psycopg.Connection,
    make_api_user: MakeApiUser,
    settings: Settings,
    user: ApiUser,
    exam: UUID,
    case: str,
) -> None:
    target = exam
    expected_status, expected_code = 422, "validation_error"
    body = _body()
    if case == "zip_mime":
        body["mime"] = "application/zip"
    elif case == "empty_filename":
        body["filename"] = ""
    elif case == "blank_filename":
        body["filename"] = "   "
    elif case == "nul_filename":
        body["filename"] = "a\x00b.pdf"
    elif case == "long_filename":
        body["filename"] = "x" * 256
    elif case == "bad_kind":
        body["kind"] = "exam"
    elif case == "zero_size":
        body["size_bytes"] = 0
    elif case == "unknown_field":
        body["storage_path"] = f"{user.id}/{exam}/{body['id']}"
    elif case == "too_large":
        body["size_bytes"] = settings.max_material_bytes + 1
        expected_code = "file_too_large"
    elif case == "deleted_exam":
        target = insert_exam(db, user.id, exam_date="2026-12-01", deleted=True)
        expected_status, expected_code = 404, "not_found"
    elif case == "other_users_exam":
        other = make_api_user()
        set_profile(db, other.id, **TEST_PROFILE)
        target = insert_exam(db, other.id, exam_date="2026-12-01")
        expected_status, expected_code = 404, "not_found"

    response = api.post(f"/exams/{target}/materials", json=body, headers=user.headers)
    assert response.status_code == expected_status, response.text
    assert response.json()["code"] == expected_code
    if case == "too_large":
        assert response.json()["limit_bytes"] == settings.max_material_bytes
    assert _counts(db, user.id) == (0, 0)
    assert scalar(db, "SELECT count(*) FROM app.materials") == 0


def test_too_many_materials(
    api: TestClient, db: psycopg.Connection, settings: Settings, user: ApiUser, exam: UUID
) -> None:
    assert settings.max_materials_per_exam == 15
    for _ in range(15):
        register_material(api, user, exam)
    assert _counts(db, user.id) == (15, 15)
    extra_id = uuid4()
    response = api.post(
        f"/exams/{exam}/materials", json=_body(id=str(extra_id)), headers=user.headers
    )
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "too_many_materials"
    assert response.json()["limit"] == 15
    assert scalar(db, "SELECT count(*) FROM app.materials WHERE id = %s", extra_id) == 0
    assert _counts(db, user.id) == (15, 15)
    # The limit is per exam: another exam still takes files.
    other_exam = insert_exam(db, user.id, exam_date="2026-12-02")
    register_material(api, user, other_exam)


def test_concurrent_registrations_stop_at_the_limit(
    api: TestClient,
    db: psycopg.Connection,
    migrated_database_url: str,
    user: ApiUser,
    exam: UUID,
) -> None:
    """Two registrations at 14 files: the per-user lock lets exactly one of them in.

    A second owner connection holds app.jobs, so a request that got past the count waits
    at its enqueue. Without the lock both requests reach that point having counted 14;
    with it the second waits for the first to commit and then counts 15.
    """
    for _ in range(14):
        insert_material(db, user.id, exam)
    barrier = threading.Barrier(2)
    results: list[Any] = []
    errors: list[BaseException] = []

    def post() -> None:
        try:
            barrier.wait(5)
            results.append(api.post(f"/exams/{exam}/materials", json=_body(), headers=user.headers))
        except BaseException as error:  # reported to the test thread
            errors.append(error)

    threads = [threading.Thread(target=post) for _ in range(2)]
    with psycopg.connect(migrated_database_url) as holder:
        holder.execute("LOCK TABLE app.jobs IN EXCLUSIVE MODE")
        for thread in threads:
            thread.start()
        # Both requests are blocked: one (or both) on app.jobs, or one on the user lock.
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            waiting = scalar(
                db,
                "SELECT count(*) FROM pg_stat_activity "
                "WHERE datname = current_database() AND wait_event_type = 'Lock'",
            )
            if waiting >= 2:
                break
            time.sleep(0.02)
        holder.commit()
    for thread in threads:
        thread.join(20)
    assert not any(thread.is_alive() for thread in threads)
    assert errors == []
    assert sorted(response.status_code for response in results) == [201, 422]
    refused = next(response for response in results if response.status_code == 422)
    assert refused.json()["code"] == "too_many_materials"
    assert _counts(db, user.id) == (15, 1)


def test_duplicate_id_is_409(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    material_id = uuid4()
    register_material(api, user, exam, material_id=material_id)
    before = _counts(db, user.id)
    response = api.post(
        f"/exams/{exam}/materials", json=_body(id=str(material_id)), headers=user.headers
    )
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "already_exists"
    assert _counts(db, user.id) == before


def test_delete_material_enqueues_file_deletion(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    material_id = UUID(register_material(api, user, exam)["material"]["id"])
    path = f"{user.id}/{exam}/{material_id}"
    response = api.delete(f"/materials/{material_id}", headers=user.headers)
    assert response.status_code == 204, response.text
    assert response.content == b""
    assert scalar(db, "SELECT count(*) FROM app.materials WHERE id = %s", material_id) == 0
    jobs = db.execute(
        "SELECT status, payload FROM app.jobs WHERE user_id = %s AND kind = 'delete_material_file'",
        (user.id,),
    ).fetchall()
    assert [(row[0], row[1]) for row in jobs] == [("queued", {"storage_path": path})]

    again = api.delete(f"/materials/{material_id}", headers=user.headers)
    assert again.status_code == 404
    assert again.json()["code"] == "not_found"
    assert _counts(db, user.id) == (0, 2)


def test_filename_is_stored_as_text(api: TestClient, user: ApiUser, exam: UUID) -> None:
    filename = "<script>x</script>.pdf"
    response = api.post(
        f"/exams/{exam}/materials", json=_body(filename=filename), headers=user.headers
    )
    assert response.status_code == 201, response.text
    assert response.headers["content-type"] == "application/json"
    assert response.json()["material"]["filename"] == filename
    listed = api.get(f"/exams/{exam}/materials", headers=user.headers)
    assert listed.headers["content-type"] == "application/json"
    assert [item["filename"] for item in listed.json()] == [filename]
