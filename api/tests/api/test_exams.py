import datetime as dt
from collections.abc import Callable
from typing import Any

import psycopg
import pytest
from fastapi.testclient import TestClient

from tests.api.factories import (
    NOW,
    TEST_PROFILE,
    Z,
    insert_block,
    insert_exam,
    insert_task,
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


def test_exam_crud(api: TestClient, user: ApiUser) -> None:
    later = api.post(
        "/exams", json={"name": "מאוחר", "exam_date": "2026-12-01"}, headers=user.headers
    )
    assert later.status_code == 201, later.text
    assert later.json()["plan_affected"] is True
    assert later.json()["exam"]["difficulty"] == 3
    sooner = api.post(
        "/exams",
        json={"name": "  מוקדם ", "exam_date": "2026-11-20", "difficulty": 5},
        headers=user.headers,
    )
    assert sooner.status_code == 201
    assert sooner.json()["exam"]["name"] == "מוקדם"

    listed = api.get("/exams", headers=user.headers).json()
    assert [exam["name"] for exam in listed] == ["מוקדם", "מאוחר"]

    exam_id = later.json()["exam"]["id"]
    renamed = api.patch(f"/exams/{exam_id}", json={"name": "חדש"}, headers=user.headers)
    assert renamed.status_code == 200
    assert renamed.json()["plan_affected"] is False
    assert renamed.json()["exam"]["name"] == "חדש"
    moved = api.patch(f"/exams/{exam_id}", json={"exam_date": "2026-12-05"}, headers=user.headers)
    assert moved.json()["plan_affected"] is True
    harder = api.patch(f"/exams/{exam_id}", json={"difficulty": 1}, headers=user.headers)
    assert harder.json()["plan_affected"] is True


@pytest.mark.parametrize(
    "body",
    [
        {"name": "", "exam_date": "2026-12-01"},
        {"name": "   ", "exam_date": "2026-12-01"},
        {"name": "x" * 201, "exam_date": "2026-12-01"},
        {"name": "x", "exam_date": "2026-12-01", "difficulty": 6},
        {"name": "x", "exam_date": "2026-12-01", "difficulty": 0},
        {"name": "x", "exam_date": "2026-11-15"},
        {"name": "x", "exam_date": "2026-11-16"},
        {"name": "x", "exam_date": "2026-12-01", "unknown": 1},
    ],
)
def test_exam_validation(api: TestClient, user: ApiUser, body: dict[str, Any]) -> None:
    response = api.post("/exams", json=body, headers=user.headers)
    assert response.status_code == 422, response.text
    if body["exam_date"] in ("2026-11-15", "2026-11-16") and "unknown" not in body:
        assert response.json()["code"] == "exam_in_past"


def test_patch_exam_into_the_past_and_missing(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    for date in ("2026-11-15", "2026-11-16"):  # today is 2026-11-16: no study day is left
        past = api.patch(f"/exams/{exam}", json={"exam_date": date}, headers=user.headers)
        assert past.status_code == 422
        assert past.json()["code"] == "exam_in_past"
    assert str(scalar(db, "SELECT exam_date FROM app.exams WHERE id = %s", exam)) == "2026-11-20"
    empty = api.patch(f"/exams/{exam}", json={}, headers=user.headers)
    assert empty.status_code == 422
    gone = insert_exam(db, user.id, exam_date="2026-11-20", deleted=True)
    missing = api.patch(f"/exams/{gone}", json={"name": "x"}, headers=user.headers)
    assert missing.status_code == 404
    assert api.delete(f"/exams/{gone}", headers=user.headers).status_code == 404


def test_delete_exam_removes_future_blocks_and_undo_brings_them_back(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=180)
    insert_block(
        db, user.id, task, Z(2026, 11, 15, 9), Z(2026, 11, 15, 10),
        status="done", part_index=1, part_count=3,
    )  # fmt: skip
    first = (Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    second = (Z(2026, 11, 17, 9), Z(2026, 11, 17, 10))
    insert_block(db, user.id, task, *first, part_index=2, part_count=3)
    insert_block(db, user.id, task, *second, part_index=3, part_count=3)

    deleted = api.delete(f"/exams/{exam}", headers=user.headers)
    assert deleted.status_code == 200, deleted.text
    body = deleted.json()
    assert body["plan_affected"] is True
    assert body["version_id"] is not None
    assert scalar(db, "SELECT count(*) FROM app.blocks WHERE status = 'planned'") == 0
    assert scalar(db, "SELECT count(*) FROM app.blocks WHERE status = 'done'") == 1
    assert api.get("/exams", headers=user.headers).json() == []

    undone = api.post("/plan/undo", json={"version_id": body["version_id"]}, headers=user.headers)
    assert undone.status_code == 200, undone.text
    assert [e["id"] for e in api.get("/exams", headers=user.headers).json()] == [str(exam)]
    rows = db.execute(
        "SELECT starts_at, ends_at FROM app.blocks WHERE status = 'planned' ORDER BY starts_at"
    ).fetchall()
    assert rows == [first, second]


def _too_far(response: Any) -> None:
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["code"] == "validation_error"
    assert [error["loc"] for error in body["errors"]] == [["body", "exam_date"]]


def test_exam_date_is_at_most_two_years_ahead(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    last = (NOW.date() + dt.timedelta(days=730)).isoformat()
    after = (NOW.date() + dt.timedelta(days=731)).isoformat()
    for date in (after, "9999-12-31"):
        _too_far(api.post("/exams", json={"name": "רחוק", "exam_date": date}, headers=user.headers))
    assert scalar(db, "SELECT count(*) FROM app.exams") == 0
    created = api.post("/exams", json={"name": "רחוק", "exam_date": last}, headers=user.headers)
    assert created.status_code == 201, created.text

    exam = created.json()["exam"]["id"]
    for date in (after, "9999-12-31"):
        _too_far(api.patch(f"/exams/{exam}", json={"exam_date": date}, headers=user.headers))
    assert str(scalar(db, "SELECT exam_date FROM app.exams WHERE id = %s", exam)) == last


def test_an_exam_dated_today_keeps_its_date_on_other_changes(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-16")
    renamed = api.patch(f"/exams/{exam}", json={"name": "חדש"}, headers=user.headers)
    assert renamed.status_code == 200, renamed.text
    same = api.patch(
        f"/exams/{exam}", json={"name": "שוב", "exam_date": "2026-11-16"}, headers=user.headers
    )
    assert same.status_code == 200, same.text
    assert same.json()["plan_affected"] is False
    tomorrow = api.patch(f"/exams/{exam}", json={"exam_date": "2026-11-17"}, headers=user.headers)
    assert tomorrow.status_code == 200, tomorrow.text


def test_tomorrow_follows_the_profile_timezone(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    set_profile(db, user.id, timezone="Asia/Jerusalem")
    clock.set(Z(2026, 11, 15, 23, 30))  # 01:30 on 2026-11-16 in Jerusalem, 2026-11-15 in UTC
    today = api.post(
        "/exams", json={"name": "היום", "exam_date": "2026-11-16"}, headers=user.headers
    )
    assert today.status_code == 422, today.text
    assert today.json()["code"] == "exam_in_past"
    tomorrow = api.post(
        "/exams", json={"name": "מחר", "exam_date": "2026-11-17"}, headers=user.headers
    )
    assert tomorrow.status_code == 201, tomorrow.text


def test_exam_in_past_says_the_date_has_passed_or_is_today(api: TestClient, user: ApiUser) -> None:
    response = api.post(
        "/exams", json={"name": "היום", "exam_date": "2026-11-16"}, headers=user.headers
    )
    assert response.json()["title"] == "תאריך המבחן כבר עבר, או שהוא היום."


def test_today_follows_the_profile_timezone_for_the_upper_bound(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    set_profile(db, user.id, timezone="Asia/Jerusalem")
    clock.set(Z(2026, 11, 15, 23, 30))  # 01:30 on 2026-11-16 in Jerusalem
    last = (dt.date(2026, 11, 16) + dt.timedelta(days=730)).isoformat()
    created = api.post("/exams", json={"name": "רחוק", "exam_date": last}, headers=user.headers)
    assert created.status_code == 201, created.text


@pytest.mark.parametrize("method", ["post", "patch"])
def test_exam_name_with_a_nul_character_is_422(
    api: TestClient, user: ApiUser, db: psycopg.Connection, method: str
) -> None:
    body = {"name": "a\u0000b", "exam_date": "2026-11-20"}
    if method == "post":
        response = api.post("/exams", json=body, headers=user.headers)
    else:
        exam = insert_exam(db, user.id, exam_date="2026-11-20")
        response = api.patch(f"/exams/{exam}", json={"name": body["name"]}, headers=user.headers)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert response.json()["errors"][0]["loc"][:2] == ["body", "name"]
