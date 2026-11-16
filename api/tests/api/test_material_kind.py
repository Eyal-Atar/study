from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from tests.api.factories import (
    NOW,
    TEST_PROFILE,
    insert_exam,
    insert_material,
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


def _kind(db: psycopg.Connection, material_id: UUID) -> str:
    return str(scalar(db, "SELECT kind FROM app.materials WHERE id = %s", material_id))


def test_patch_changes_kind_and_list_shows_it(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    material = insert_material(db, user.id, exam, kind="other")
    before = api.get(f"/exams/{exam}/materials", headers=user.headers).json()[0]
    response = api.patch(f"/materials/{material}", json={"kind": "syllabus"}, headers=user.headers)
    assert response.status_code == 200
    body = response.json()
    assert body == {**before, "kind": "syllabus"}
    listed = api.get(f"/exams/{exam}/materials", headers=user.headers).json()
    assert [item["kind"] for item in listed] == ["syllabus"]
    assert _kind(db, material) == "syllabus"


@pytest.mark.parametrize(
    "body",
    [{"kind": "bogus"}, {"kind": "notes", "filename": "x.pdf"}, {}],
    ids=["unknown_kind", "extra_field", "empty_body"],
)
def test_patch_rejects_invalid_body(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID, body: dict[str, Any]
) -> None:
    material = insert_material(db, user.id, exam, kind="other")
    response = api.patch(f"/materials/{material}", json=body, headers=user.headers)
    assert response.status_code == 422
    assert _kind(db, material) == "other"


def test_patch_other_users_material_is_404_and_unchanged(
    api: TestClient,
    db: psycopg.Connection,
    user: ApiUser,
    make_api_user: MakeApiUser,
) -> None:
    other = make_api_user()
    set_profile(db, other.id, **TEST_PROFILE)
    other_exam = insert_exam(db, other.id, exam_date="2026-12-01")
    material = insert_material(db, other.id, other_exam, kind="other")
    response = api.patch(f"/materials/{material}", json={"kind": "notes"}, headers=user.headers)
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
    assert _kind(db, material) == "other"


def test_patch_material_of_deleted_exam_is_404(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    deleted_exam = insert_exam(db, user.id, exam_date="2026-12-01", deleted=True)
    material = insert_material(db, user.id, deleted_exam, kind="other")
    response = api.patch(f"/materials/{material}", json={"kind": "notes"}, headers=user.headers)
    assert response.status_code == 404
    assert _kind(db, material) == "other"


def test_patch_nonexistent_material_is_404(api: TestClient, user: ApiUser) -> None:
    response = api.patch(f"/materials/{uuid4()}", json={"kind": "notes"}, headers=user.headers)
    assert response.status_code == 404
