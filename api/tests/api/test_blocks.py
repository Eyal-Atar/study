import datetime as dt
from collections.abc import Callable
from typing import Any
from uuid import UUID

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


def _post(api: TestClient, user: ApiUser, block: UUID, action: str, **body: Any) -> Any:
    return api.post(f"/blocks/{block}/{action}", json=body or None, headers=user.headers)


def _status(db: psycopg.Connection, block: UUID) -> str:
    return str(scalar(db, "SELECT status FROM app.blocks WHERE id = %s", block))


def _task_status(db: psycopg.Connection, task: UUID) -> str:
    return str(scalar(db, "SELECT status FROM app.tasks WHERE id = %s", task))


def _task_blocks(db: psycopg.Connection, task: UUID) -> list[tuple[UUID, dt.datetime, dt.datetime]]:
    return [
        (row[0], row[1], row[2])
        for row in db.execute(
            "SELECT id, starts_at, ends_at FROM app.blocks "
            "WHERE task_id = %s AND status = 'planned' ORDER BY starts_at",
            (task,),
        ).fetchall()
    ]


def test_complete_marks_block_and_task(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))

    response = _post(api, user, block, "complete")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["block"]["status"] == "done"
    assert body["block"]["state"] == "done"
    assert body["task_status"] == "done"
    assert _status(db, block) == "done"
    assert _task_status(db, task) == "done"

    again = _post(api, user, block, "complete")
    assert again.status_code == 200, again.text
    # A second complete changes nothing; its progress says so (S19: no XP the second time).
    assert {**again.json(), "progress": None} == {**body, "progress": None}
    assert again.json()["progress"]["xp_change"] == 0


def test_complete_one_part_keeps_the_task_open(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=120)
    first = insert_block(
        db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10), part_index=1, part_count=2
    )
    insert_block(
        db, user.id, task, Z(2026, 11, 16, 11), Z(2026, 11, 16, 12), part_index=2, part_count=2
    )
    response = _post(api, user, first, "complete")
    assert response.status_code == 200, response.text
    assert response.json()["task_status"] == "todo"
    assert _task_status(db, task) == "todo"


def test_uncomplete_reopens_the_task(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    assert _post(api, user, block, "complete").json()["task_status"] == "done"

    response = _post(api, user, block, "uncomplete")
    assert response.status_code == 200, response.text
    assert response.json()["block"]["status"] == "planned"
    assert response.json()["task_status"] == "todo"
    assert _status(db, block) == "planned"
    assert _task_status(db, task) == "todo"

    planned = _post(api, user, block, "uncomplete")
    assert planned.status_code == 409
    assert planned.json()["code"] == "invalid_state"


def test_complete_a_missed_block_on_taken_time_is_409(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    missed_task = insert_task(db, user.id, exam, minutes=60)
    other = insert_task(db, user.id, exam, minutes=60, title="אחרת")
    missed = insert_block(
        db, user.id, missed_task, Z(2026, 11, 15, 9), Z(2026, 11, 15, 10), status="missed"
    )
    insert_block(db, user.id, other, Z(2026, 11, 15, 9), Z(2026, 11, 15, 10))

    response = _post(api, user, missed, "complete")
    assert response.status_code == 409
    assert response.json()["code"] == "plan_conflict"
    assert _status(db, missed) == "missed"
    assert _task_status(db, missed_task) == "todo"


def test_defer_moves_only_this_task(api: TestClient, user: ApiUser, db: psycopg.Connection) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task_a = insert_task(db, user.id, exam, minutes=60, title="א")
    task_b = insert_task(db, user.id, exam, minutes=60, title="ב")
    replan_apply(api, user)
    a_before = _task_blocks(db, task_a)
    b_before = _task_blocks(db, task_b)
    assert len(a_before) == 1
    assert b_before

    response = _post(api, user, a_before[0][0], "defer")
    assert response.status_code == 200, response.text
    body = response.json()
    a_after = _task_blocks(db, task_a)
    assert [(s, e) for _, s, e in a_after] != [(s, e) for _, s, e in a_before]
    assert _task_blocks(db, task_b) == b_before
    assert [block["id"] for block in body["blocks"]] == [str(a_after[0][0])]
    assert body["blocks"][0]["task_id"] == str(task_a)
    assert scalar(db, "SELECT reason FROM app.plan_versions WHERE id = %s", body["version_id"]) == (
        "defer"
    )


def test_defer_with_not_before(api: TestClient, user: ApiUser, db: psycopg.Connection) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))

    response = _post(api, user, block, "defer", not_before="2026-11-17T10:00:00Z")
    assert response.status_code == 200, response.text
    blocks = _task_blocks(db, task)
    assert blocks
    assert all(start >= Z(2026, 11, 17, 10) for _, start, _ in blocks)


def test_defer_that_cannot_fit_changes_nothing(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-17")
    task = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    before = _task_blocks(db, task)

    response = _post(api, user, block, "defer", not_before="2026-11-18T10:00:00Z")
    assert response.status_code == 409, response.text
    body = response.json()
    assert body["code"] == "placement_failed"
    assert isinstance(body["reason"], str)
    assert "blocked_by" in body
    assert _task_blocks(db, task) == before
    assert scalar(db, "SELECT count(*) FROM app.plan_versions") == 0


def test_defer_a_started_block_releases_it_whole(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    clock.set(Z(2026, 11, 16, 9, 30))

    response = _post(api, user, block, "defer")
    assert response.status_code == 200, response.text
    future = _task_blocks(db, task)
    assert sum((end - start).total_seconds() / 60 for _, start, end in future) == 60
    assert future
    assert all(start >= Z(2026, 11, 16, 10, 0) for _, start, _ in future)


def test_defer_a_past_block_is_409(api: TestClient, user: ApiUser, db: psycopg.Connection) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 15, 9), Z(2026, 11, 15, 10))

    response = _post(api, user, block, "defer")
    assert response.status_code == 409
    assert response.json()["code"] == "invalid_state"
    assert _status(db, block) == "planned"


def test_pin_and_unpin(api: TestClient, user: ApiUser, db: psycopg.Connection) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 15), Z(2026, 11, 16, 16))

    response = api.patch(f"/blocks/{block}", json={"pinned": True}, headers=user.headers)
    assert response.status_code == 200, response.text
    assert response.json()["pinned"] is True
    assert response.json()["id"] == str(block)
    replan_apply(api, user)
    assert _task_blocks(db, task) == [(block, Z(2026, 11, 16, 15), Z(2026, 11, 16, 16))]

    bad = api.patch(
        f"/blocks/{block}", json={"ends_at": "2026-11-16T09:00:00Z"}, headers=user.headers
    )
    assert bad.status_code == 422
    naive = api.patch(
        f"/blocks/{block}", json={"starts_at": "2026-11-16T09:00:00"}, headers=user.headers
    )
    assert naive.status_code == 422
    empty = api.patch(f"/blocks/{block}", json={}, headers=user.headers)
    assert empty.status_code == 422

    unpinned = api.patch(f"/blocks/{block}", json={"pinned": False}, headers=user.headers)
    assert unpinned.status_code == 200, unpinned.text
    assert unpinned.json()["pinned"] is False


def test_pin_a_past_block_is_409(api: TestClient, user: ApiUser, db: psycopg.Connection) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 15, 9), Z(2026, 11, 15, 10))
    response = api.patch(f"/blocks/{block}", json={"pinned": True}, headers=user.headers)
    assert response.status_code == 409
    assert response.json()["code"] == "invalid_state"


def test_deleted_task_block_is_404(api: TestClient, user: ApiUser, db: psycopg.Connection) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    db.execute("UPDATE app.tasks SET deleted_at = now() WHERE id = %s", (task,))
    for action in ("complete", "uncomplete", "defer"):
        response = _post(api, user, block, action)
        assert response.status_code == 404, action
        assert response.json()["code"] == "not_found"
    patch = api.patch(f"/blocks/{block}", json={"pinned": True}, headers=user.headers)
    assert patch.status_code == 404


def test_undo_of_a_defer(api: TestClient, user: ApiUser, db: psycopg.Connection) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    before = _task_blocks(db, task)

    deferred = _post(api, user, block, "defer", not_before="2026-11-17T10:00:00Z")
    assert deferred.status_code == 200, deferred.text
    assert _task_blocks(db, task) != before

    undone = api.post(
        "/plan/undo", json={"version_id": deferred.json()["version_id"]}, headers=user.headers
    )
    assert undone.status_code == 200, undone.text
    assert [(s, e) for _, s, e in _task_blocks(db, task)] == [(s, e) for _, s, e in before]
