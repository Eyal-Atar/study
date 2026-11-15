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


def _post(api: TestClient, user: ApiUser, exam: Any, **fields: Any) -> Any:
    body = {"exam_id": str(exam), "title": "משימה", "kind": "learn", "estimated_minutes": 90}
    return api.post("/tasks", json={**body, **fields}, headers=user.headers)


def _tasks(api: TestClient, user: ApiUser, exam: Any) -> list[dict[str, Any]]:
    response = api.get(f"/exams/{exam}/tasks", headers=user.headers)
    assert response.status_code == 200, response.text
    tasks: list[dict[str, Any]] = response.json()
    return tasks


def test_create_task_places_it(api: TestClient, user: ApiUser, db: psycopg.Connection) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    response = _post(api, user, exam)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["placement"] == {"placed": True, "reason": None, "blocked_by": None}
    assert body["task"]["source"] == "user"
    assert body["task"]["focus"] == 5
    rows = db.execute("SELECT starts_at, ends_at, plan_version_id FROM app.blocks").fetchall()
    assert rows
    assert sum((end - start).total_seconds() / 60 for start, end, _ in rows) == 90
    assert {str(row[2]) for row in rows} == {body["version_id"]}
    assert scalar(db, "SELECT reason FROM app.plan_versions WHERE id = %s", body["version_id"]) == (
        "task_added"
    )


def test_create_task_that_does_not_fit_is_kept(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-17")
    response = _post(api, user, exam, estimated_minutes=600)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["placement"]["placed"] is False
    assert body["placement"]["reason"] == "not_enough_time"
    assert body["version_id"] is None
    assert [task["id"] for task in _tasks(api, user, exam)] == [body["task"]["id"]]
    assert scalar(db, "SELECT count(*) FROM app.blocks") == 0
    assert scalar(db, "SELECT count(*) FROM app.plan_versions") == 0


def test_undo_of_an_added_task_removes_it(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    created = _post(api, user, exam).json()
    undone = api.post(
        "/plan/undo", json={"version_id": created["version_id"]}, headers=user.headers
    )
    assert undone.status_code == 200, undone.text
    assert _tasks(api, user, exam) == []
    assert scalar(db, "SELECT count(*) FROM app.blocks WHERE status = 'planned'") == 0


def test_shorten_a_split_task(api: TestClient, user: ApiUser, db: psycopg.Connection) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=300)
    insert_block(db, user.id, task, Z(2026, 11, 17, 9), Z(2026, 11, 17, 11, 30), part_count=2)
    insert_block(
        db, user.id, task, Z(2026, 11, 18, 9), Z(2026, 11, 18, 11, 30), part_index=2, part_count=2
    )
    response = api.patch(f"/tasks/{task}", json={"estimated_minutes": 120}, headers=user.headers)
    assert response.status_code == 200, response.text
    assert response.json()["placement"]["placed"] is True
    rows = db.execute(
        "SELECT starts_at, ends_at, part_index, part_count FROM app.blocks "
        "WHERE task_id = %s ORDER BY starts_at",
        (task,),
    ).fetchall()
    assert sum((end - start).total_seconds() / 60 for start, end, _, _ in rows) == 120
    assert [row[2] for row in rows] == list(range(1, len(rows) + 1))
    assert {row[3] for row in rows} == {len(rows)}


def test_title_only_patch_changes_no_board(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam)
    insert_block(db, user.id, task, Z(2026, 11, 17, 9), Z(2026, 11, 17, 10))
    response = api.patch(f"/tasks/{task}", json={"title": " חדש "}, headers=user.headers)
    assert response.status_code == 200
    assert response.json()["placement"] is None
    assert response.json()["version_id"] is None
    assert response.json()["task"]["title"] == "חדש"
    assert scalar(db, "SELECT count(*) FROM app.plan_versions") == 0


def test_failed_placement_keeps_fields_and_board(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-17")
    task = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    response = api.patch(f"/tasks/{task}", json={"estimated_minutes": 600}, headers=user.headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["placement"]["placed"] is False
    assert body["task"]["estimated_minutes"] == 600
    assert body["version_id"] is None
    assert scalar(db, "SELECT id FROM app.blocks WHERE task_id = %s", task) == block


def test_delete_a_task_with_parts(api: TestClient, user: ApiUser, db: psycopg.Connection) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=120)
    other = insert_task(db, user.id, exam, minutes=60)
    insert_block(
        db, user.id, task, Z(2026, 11, 15, 9), Z(2026, 11, 15, 10),
        status="done", part_count=2,
    )  # fmt: skip
    insert_block(
        db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10), part_index=2, part_count=2
    )
    kept = insert_block(db, user.id, other, Z(2026, 11, 16, 11), Z(2026, 11, 16, 12))
    response = api.delete(f"/tasks/{task}", headers=user.headers)
    assert response.status_code == 200, response.text
    assert response.json()["version_id"] is not None
    rows = db.execute("SELECT task_id, status FROM app.blocks ORDER BY starts_at").fetchall()
    assert [(row[0], row[1]) for row in rows] == [(task, "done"), (other, "planned")]
    assert scalar(db, "SELECT id FROM app.blocks WHERE task_id = %s", other) == kept
    assert _tasks(api, user, exam)[0]["id"] == str(other)
    assert api.delete(f"/tasks/{task}", headers=user.headers).status_code == 404


def test_mark_task_done_frees_its_future_blocks(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=120)
    insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10), part_count=2)
    insert_block(
        db, user.id, task, Z(2026, 11, 17, 9), Z(2026, 11, 17, 10), part_index=2, part_count=2
    )
    response = api.patch(f"/tasks/{task}", json={"status": "done"}, headers=user.headers)
    assert response.status_code == 200, response.text
    assert response.json()["task"]["status"] == "done"
    assert response.json()["version_id"] is not None
    assert scalar(db, "SELECT count(*) FROM app.blocks") == 0


def test_dependency_rules(
    api: TestClient, user: ApiUser, db: psycopg.Connection, make_api_user: MakeApiUser
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    stranger = make_api_user()
    foreign_exam = insert_exam(db, stranger.id, exam_date="2026-11-20")
    foreign_task = insert_task(db, stranger.id, foreign_exam)
    assert _post(api, user, exam, depends_on_task_id=str(foreign_task)).status_code == 404

    b = insert_task(db, user.id, exam, title="B")
    a = insert_task(db, user.id, exam, title="A", depends_on=b)
    mine = api.patch(
        f"/tasks/{b}", json={"depends_on_task_id": str(foreign_task)}, headers=user.headers
    )
    assert mine.status_code == 404
    cycle = api.patch(f"/tasks/{b}", json={"depends_on_task_id": str(a)}, headers=user.headers)
    assert cycle.status_code == 422
    assert cycle.json()["code"] == "dependency_cycle"
    assert scalar(db, "SELECT depends_on_task_id FROM app.tasks WHERE id = %s", b) is None
    own = api.patch(f"/tasks/{b}", json={"depends_on_task_id": str(b)}, headers=user.headers)
    assert own.json()["code"] == "dependency_cycle"
    removed = api.patch(f"/tasks/{a}", json={"depends_on_task_id": None}, headers=user.headers)
    assert removed.status_code == 200, removed.text
    assert removed.json()["task"]["depends_on_task_id"] is None


def test_title_is_stored_as_text(api: TestClient, user: ApiUser, db: psycopg.Connection) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    title = "<script>alert(1)</script>"
    response = _post(api, user, exam, title=title)
    assert response.status_code == 201
    assert response.json()["task"]["title"] == title
    assert response.headers["content-type"] == "application/json"


@pytest.mark.parametrize(
    "fields",
    [
        {"estimated_minutes": 4},
        {"estimated_minutes": 601},
        {"focus": 0},
        {"focus": 11},
        {"kind": "lecture"},
        {"title": "  "},
        {"title": "x" * 201},
        {"title": "a\u0000b"},
        {"unknown": 1},
    ],
)
def test_task_validation(
    api: TestClient, user: ApiUser, db: psycopg.Connection, fields: dict[str, Any]
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    assert _post(api, user, exam, **fields).status_code == 422


def test_task_exam_must_be_live_and_not_past(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    deleted = insert_exam(db, user.id, exam_date="2026-11-20", deleted=True)
    assert _post(api, user, deleted).status_code == 404
    past = insert_exam(db, user.id, exam_date="2026-11-15")
    response = _post(api, user, past)
    assert response.status_code == 422
    assert response.json()["code"] == "exam_in_past"
    assert api.get(f"/exams/{deleted}/tasks", headers=user.headers).status_code == 404


def _blocks(db: psycopg.Connection, task: Any) -> list[tuple[Any, ...]]:
    return [
        tuple(row)
        for row in db.execute(
            "SELECT id, starts_at, ends_at, status, pinned FROM app.blocks "
            "WHERE task_id = %s ORDER BY starts_at",
            (task,),
        ).fetchall()
    ]


def _patch(api: TestClient, user: ApiUser, task: Any, **fields: Any) -> dict[str, Any]:
    response = api.patch(f"/tasks/{task}", json=fields, headers=user.headers)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


@pytest.mark.parametrize("fields", [{"focus": 5}, {"kind": "learn"}, {"status": "todo"}])
def test_patch_with_unchanged_placement_values_leaves_the_board(
    api: TestClient, user: ApiUser, db: psycopg.Connection, fields: dict[str, Any]
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, focus=5, kind="learn")
    insert_block(db, user.id, task, Z(2026, 11, 18, 9), Z(2026, 11, 18, 10))
    before = _blocks(db, task)
    body = _patch(api, user, task, **fields)
    assert body["placement"] is None
    assert body["version_id"] is None
    assert _blocks(db, task) == before
    assert scalar(db, "SELECT count(*) FROM app.plan_versions") == 0


def test_patch_minutes_keeps_pinned_done_and_started_blocks(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=240)
    done = insert_block(db, user.id, task, Z(2026, 11, 15, 9), Z(2026, 11, 15, 10), status="done")
    started = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    pinned = insert_block(db, user.id, task, Z(2026, 11, 17, 9), Z(2026, 11, 17, 10), pinned=True)
    free = insert_block(db, user.id, task, Z(2026, 11, 18, 9), Z(2026, 11, 18, 10))
    clock.set(Z(2026, 11, 16, 9, 30))
    kept = {row[0]: row for row in _blocks(db, task) if row[0] in (done, started, pinned)}

    body = _patch(api, user, task, estimated_minutes=300)
    assert body["placement"]["placed"] is True
    assert body["version_id"] is not None
    after = {row[0]: row for row in _blocks(db, task)}
    for block_id, row in kept.items():
        assert after[block_id] == row
    assert free not in after
    assert sum((row[2] - row[1]).total_seconds() / 60 for row in after.values()) == 300


@pytest.mark.parametrize(
    "fields", [{"kind": "practice"}, {"focus": 9}, {"depends_on_task_id": "other"}]
)
def test_patch_that_changes_a_placement_field_places_again(
    api: TestClient, user: ApiUser, db: psycopg.Connection, fields: dict[str, Any]
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    other = insert_task(db, user.id, exam, title="אחרת")
    insert_block(db, user.id, other, Z(2026, 11, 16, 6), Z(2026, 11, 16, 7))
    task = insert_task(db, user.id, exam, focus=5, kind="learn")
    block = insert_block(db, user.id, task, Z(2026, 11, 18, 9), Z(2026, 11, 18, 10))
    if fields.get("depends_on_task_id") == "other":
        fields = {"depends_on_task_id": str(other)}
    body = _patch(api, user, task, **fields)
    assert body["placement"]["placed"] is True
    assert body["version_id"] is not None
    assert scalar(db, "SELECT reason FROM app.plan_versions WHERE id = %s", body["version_id"]) == (
        "task_changed"
    )
    assert block not in [row[0] for row in _blocks(db, task)]


def test_patch_status_back_to_todo_places_the_task(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=90, status="done")
    body = _patch(api, user, task, status="todo")
    assert body["placement"]["placed"] is True
    assert body["version_id"] is not None
    rows = _blocks(db, task)
    assert sum((row[2] - row[1]).total_seconds() / 60 for row in rows) == 90


def test_patch_status_skipped_frees_its_open_blocks(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=180)
    done = insert_block(db, user.id, task, Z(2026, 11, 15, 9), Z(2026, 11, 15, 10), status="done")
    insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    insert_block(db, user.id, task, Z(2026, 11, 17, 9), Z(2026, 11, 17, 10), pinned=True)
    body = _patch(api, user, task, status="skipped")
    assert body["placement"] is None
    assert body["version_id"] is not None
    assert [row[0] for row in _blocks(db, task)] == [done]


def test_patch_a_task_of_a_past_exam_does_not_place_it(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-15")
    task = insert_task(db, user.id, exam, minutes=60)
    body = _patch(api, user, task, estimated_minutes=120)
    assert body["placement"] is None
    assert body["version_id"] is None
    assert body["task"]["estimated_minutes"] == 120
    assert scalar(db, "SELECT count(*) FROM app.blocks") == 0


def test_a_task_of_a_deleted_exam_is_not_found(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20", deleted=True)
    task = insert_task(db, user.id, exam)
    live = insert_exam(db, user.id, exam_date="2026-11-20")
    patched = api.patch(f"/tasks/{task}", json={"title": "חדש"}, headers=user.headers)
    assert patched.status_code == 404
    assert api.delete(f"/tasks/{task}", headers=user.headers).status_code == 404
    assert _post(api, user, live, depends_on_task_id=str(task)).status_code == 404
    mine = insert_task(db, user.id, live)
    target = api.patch(
        f"/tasks/{mine}", json={"depends_on_task_id": str(task)}, headers=user.headers
    )
    assert target.status_code == 404
    assert scalar(db, "SELECT title FROM app.tasks WHERE id = %s", task) == "משימה"
    assert scalar(db, "SELECT deleted_at FROM app.tasks WHERE id = %s", task) is None


def test_patch_title_with_a_nul_character_is_422(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam)
    response = api.patch(f"/tasks/{task}", json={"title": "a\u0000b"}, headers=user.headers)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert response.json()["errors"][0]["loc"][:2] == ["body", "title"]


def test_tasks_are_listed_by_position_then_creation(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    unplaced = insert_task(db, user.id, exam, title="ללא סדר")
    second = insert_task(db, user.id, exam, title="שנייה")
    first = insert_task(db, user.id, exam, title="ראשונה")
    db.execute("UPDATE app.tasks SET position = 2 WHERE id = %s", (second,))
    db.execute("UPDATE app.tasks SET position = 1 WHERE id = %s", (first,))
    assert [task["id"] for task in _tasks(api, user, exam)] == [
        str(first),
        str(second),
        str(unplaced),
    ]
