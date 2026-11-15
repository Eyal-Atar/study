import datetime as dt
from collections.abc import Callable

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
    replan_apply,
    replan_preview,
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


def _instant(value: str) -> dt.datetime:
    assert value.endswith("Z")
    return dt.datetime.fromisoformat(value)


def test_preview_writes_nothing(api: TestClient, user: ApiUser, db: psycopg.Connection) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=120)
    body = replan_preview(api, user)
    assert body["added"]
    assert {block["task_id"] for block in body["added"]} == {str(task)}
    assert body["basis"]
    assert body["changed"] is True
    assert body["version_id"] is None
    assert body["removed"] == []
    assert scalar(db, "SELECT count(*) FROM app.blocks") == 0
    assert scalar(db, "SELECT count(*) FROM app.plan_versions") == 0


def test_apply_writes_blocks_and_a_version(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    insert_task(db, user.id, exam, minutes=120)
    previewed = replan_preview(api, user)
    applied = replan_apply(api, user, previewed["basis"])
    assert applied["changed"] is True
    assert applied["version_id"] is not None
    assert applied["added"] == previewed["added"]
    expected = sorted(
        (
            block["task_id"],
            _instant(block["starts_at"]),
            _instant(block["ends_at"]),
            block["part_index"],
            block["part_count"],
        )
        for block in applied["added"]
    )
    rows = db.execute(
        "SELECT task_id, starts_at, ends_at, part_index, part_count, plan_version_id "
        "FROM app.blocks ORDER BY starts_at"
    ).fetchall()
    assert sorted((str(r[0]), r[1], r[2], r[3], r[4]) for r in rows) == expected
    assert {str(r[5]) for r in rows} == {applied["version_id"]}
    versions = db.execute("SELECT id, reason, snapshot FROM app.plan_versions").fetchall()
    assert [(str(v[0]), v[1], v[2]) for v in versions] == [
        (applied["version_id"], "replan", {"v": 1, "blocks": []})
    ]


def test_apply_with_a_stale_basis_is_409(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    insert_task(db, user.id, exam, minutes=120)
    basis = replan_preview(api, user)["basis"]
    insert_task(db, user.id, exam, minutes=60, title="עוד משימה")
    response = api.post(
        "/plan/replan", json={"preview": False, "basis": basis}, headers=user.headers
    )
    assert response.status_code == 409
    assert response.json()["code"] == "stale_plan"
    assert scalar(db, "SELECT count(*) FROM app.blocks") == 0
    assert scalar(db, "SELECT count(*) FROM app.plan_versions") == 0


def test_apply_without_a_basis_is_422(api: TestClient, user: ApiUser) -> None:
    response = api.post("/plan/replan", json={"preview": False}, headers=user.headers)
    assert response.status_code == 422


def test_replan_of_an_unchanged_plan_changes_nothing(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    insert_task(db, user.id, exam, minutes=120)
    first = replan_apply(api, user, replan_preview(api, user)["basis"])
    second_preview = replan_preview(api, user)
    assert second_preview["changed"] is False
    assert second_preview["added"] == []
    second = replan_apply(api, user, second_preview["basis"])
    assert second["changed"] is False
    assert second["version_id"] is None
    assert scalar(db, "SELECT count(*) FROM app.plan_versions") == 1
    assert {
        str(row[0]) for row in db.execute("SELECT plan_version_id FROM app.blocks").fetchall()
    } == {first["version_id"]}


def test_unscheduled_and_shortfalls_are_reported(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-17")
    task = insert_task(db, user.id, exam, minutes=600)
    body = replan_preview(api, user)
    assert [(u["task_id"], u["reason"]) for u in body["unscheduled"]] == [
        (str(task), "not_enough_time")
    ]
    assert body["unscheduled"][0]["minutes"] > 0
    assert [s["exam_id"] for s in body["shortfalls"]] == [str(exam)]
    assert body["shortfalls"][0]["minutes"] > 0
    assert isinstance(body["warnings"], list)


def test_replan_places_only_what_old_done_blocks_leave(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=120)
    insert_block(db, user.id, task, Z(2026, 11, 13, 8, 0), Z(2026, 11, 13, 9, 0), status="done")
    plan = api.get("/plan", headers=user.headers).json()
    assert [u["minutes"] for u in plan["unplaced"]] == [60]
    body = replan_preview(api, user)
    added = sum(
        (_instant(b["ends_at"]) - _instant(b["starts_at"])) // dt.timedelta(minutes=1)
        for b in body["added"]
    )
    assert added == 60
    assert body["unscheduled"] == []


def test_apply_returns_the_basis_of_the_board_it_wrote(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    insert_task(db, user.id, exam, minutes=120)
    previewed = replan_preview(api, user)
    applied = replan_apply(api, user, previewed["basis"])
    assert applied["changed"] is True
    assert applied["basis"] != previewed["basis"]
    assert replan_preview(api, user)["basis"] == applied["basis"]
    again = replan_apply(api, user, applied["basis"])
    assert again["changed"] is False
