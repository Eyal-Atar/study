from collections.abc import Callable
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from tests.api.factories import NOW, TEST_PROFILE, Z, insert_exam, register_material, set_profile
from tests.fixtures_db import ApiUser, FrozenClock

MakeApiUser = Callable[[], ApiUser]


@pytest.fixture
def user(make_api_user: MakeApiUser, db: psycopg.Connection, clock: FrozenClock) -> ApiUser:
    created = make_api_user()
    set_profile(db, created.id, **TEST_PROFILE)
    clock.set(NOW)
    return created


def _job(api: TestClient, db: psycopg.Connection, user: ApiUser) -> UUID:
    exam = insert_exam(db, user.id, exam_date="2026-12-01")
    return UUID(register_material(api, user, exam)["job_id"])


def test_get_job_shows_status_and_hides_internals(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    job_id = _job(api, db, user)
    db.execute(
        "UPDATE app.jobs SET status = 'done', attempts = 1, started_at = %s, finished_at = %s, "
        "stage = 'extract', percent = 100, result = %s WHERE id = %s",
        (Z(2026, 11, 16, 5), Z(2026, 11, 16, 5, 1), Jsonb({"page_count": 3}), job_id),
    )
    response = api.get(f"/jobs/{job_id}", headers=user.headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == str(job_id)
    assert body["kind"] == "ingest_material"
    assert body["status"] == "done"
    assert body["stage"] == "extract"
    assert body["percent"] == 100
    assert body["error"] is None
    assert body["result"] == {"page_count": 3}
    assert body["finished_at"] is not None
    assert body["started_at"] is not None
    for hidden in ("payload", "attempts", "locked_at", "max_attempts", "run_at", "user_id"):
        assert hidden not in body


def test_get_job_of_another_user_is_404(
    api: TestClient, db: psycopg.Connection, make_api_user: MakeApiUser, user: ApiUser
) -> None:
    job_id = _job(api, db, user)
    other = make_api_user()
    set_profile(db, other.id, **TEST_PROFILE)
    response = api.get(f"/jobs/{job_id}", headers=other.headers)
    assert response.status_code == 404, response.text
    assert response.json()["code"] == "not_found"
    assert str(job_id) not in response.text
