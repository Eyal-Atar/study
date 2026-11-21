"""What exam closure and Moed B change in the existing services (S45, Task 5).

The state is set with direct SQL (the closing endpoints are other tests' business): exams
list and patch, tasks, generation and the morning review skip closed exams and past
sittings, the export carries the new columns, deletion leaves nothing, and the progress
archive lists the exams closed as done.
"""

import datetime as dt
from collections.abc import Callable
from typing import Any
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from app.auth import CurrentUser
from app.db.pool import Database
from app.services.generation import _exams_to_analyze
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


def _close(db: psycopg.Connection, exam: UUID, closure: str) -> None:
    db.execute(
        "UPDATE app.exams SET closure = %s, closed_at = now() WHERE id = %s", (closure, exam)
    )


def _sitting_two(db: psycopg.Connection, exam: UUID, new_date: str) -> None:
    """Moed B by hand: the exam moves to sitting 2 (tasks inserted from now on are sitting 2)."""
    db.execute(
        "UPDATE app.exams SET sitting = 2, first_exam_date = exam_date, first_grade = 55, "
        "exam_date = %s WHERE id = %s",
        (new_date, exam),
    )


def _exams(api: TestClient, user: ApiUser) -> dict[str, dict[str, Any]]:
    response = api.get("/exams", headers=user.headers)
    assert response.status_code == 200, response.text
    return {exam["name"]: exam for exam in response.json()}


# --- GET /exams, PATCH /exams ---------------------------------------------------------------


def test_exam_list_shows_the_state_and_the_new_fields(
    api: TestClient, db: psycopg.Connection, user: ApiUser, clock: FrozenClock
) -> None:
    insert_exam(db, user.id, name="active", exam_date="2026-12-20")
    insert_exam(db, user.id, name="pending", exam_date="2026-11-20")
    waiting = insert_exam(db, user.id, name="waiting", exam_date="2026-11-18")
    done = insert_exam(db, user.id, name="done", exam_date="2026-11-17")
    second = insert_exam(db, user.id, name="second", exam_date="2026-11-10")
    _close(db, waiting, "moed_b")
    _close(db, done, "done")
    _sitting_two(db, second, "2026-12-25")

    clock.set(Z(2026, 11, 20, 19, 30))
    exams = _exams(api, user)
    assert {name: exam["state"] for name, exam in exams.items()} == {
        "active": "active",
        "pending": "pending",
        "waiting": "waiting_moed_b",
        "done": "done",
        "second": "active",
    }
    assert exams["active"]["sitting"] == 1
    assert exams["active"]["closed_at"] is None
    assert exams["active"]["first_exam_date"] is None
    assert exams["done"]["closed_at"] is not None
    assert exams["second"]["sitting"] == 2
    assert exams["second"]["first_exam_date"] == "2026-11-10"
    assert exams["second"]["first_grade"] == 55

    clock.set(Z(2026, 11, 20, 18, 59))
    assert _exams(api, user)["pending"]["state"] == "active"


def test_create_returns_an_active_state(api: TestClient, user: ApiUser) -> None:
    response = api.post(
        "/exams", json={"name": "new", "exam_date": "2026-12-01"}, headers=user.headers
    )
    assert response.status_code == 201, response.text
    assert response.json()["exam"]["state"] == "active"
    assert response.json()["exam"]["sitting"] == 1


@pytest.mark.parametrize("closure", ["done", "moed_b"])
def test_a_closed_exam_keeps_its_date_and_difficulty_but_can_be_renamed(
    api: TestClient, db: psycopg.Connection, user: ApiUser, closure: str
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-14")
    _close(db, exam, closure)
    url = f"/exams/{exam}"

    for body in ({"exam_date": "2026-12-30"}, {"difficulty": 5}):
        response = api.patch(url, json=body, headers=user.headers)
        assert response.status_code == 409, response.text
        assert response.json()["code"] == "invalid_state"

    renamed = api.patch(url, json={"name": "renamed"}, headers=user.headers)
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["exam"]["name"] == "renamed"
    assert renamed.json()["exam"]["state"] == ("done" if closure == "done" else "waiting_moed_b")
    # Sending the same values back is not a change.
    same = api.patch(url, json={"difficulty": 3}, headers=user.headers)
    assert same.status_code == 200, same.text


def test_a_pending_exam_moved_to_a_future_date_is_active_again(
    api: TestClient, db: psycopg.Connection, user: ApiUser, clock: FrozenClock
) -> None:
    exam = insert_exam(db, user.id, name="e", exam_date="2026-11-20")
    clock.set(Z(2026, 11, 20, 20))
    assert _exams(api, user)["e"]["state"] == "pending"

    response = api.patch(f"/exams/{exam}", json={"exam_date": "2026-11-27"}, headers=user.headers)

    assert response.status_code == 200, response.text
    assert response.json()["exam"]["state"] == "active"
    assert response.json()["exam"]["exam_date"] == "2026-11-27"


def test_moving_the_date_clears_the_closure_push_mark(
    api: TestClient, db: psycopg.Connection, user: ApiUser, clock: FrozenClock
) -> None:
    exam = insert_exam(db, user.id, name="e", exam_date="2026-11-20")
    db.execute("UPDATE app.exams SET closure_notified_at = now() WHERE id = %s", (exam,))
    clock.set(Z(2026, 11, 20, 20))

    renamed = api.patch(f"/exams/{exam}", json={"name": "f"}, headers=user.headers)
    assert renamed.status_code == 200, renamed.text
    marked = "SELECT closure_notified_at IS NOT NULL FROM app.exams WHERE id = %s"
    assert scalar(db, marked, exam) is True

    moved = api.patch(f"/exams/{exam}", json={"exam_date": "2026-11-27"}, headers=user.headers)
    assert moved.status_code == 200, moved.text
    assert scalar(db, marked, exam) is False


# --- tasks ----------------------------------------------------------------------------------


def test_a_task_cannot_be_added_to_a_closed_exam(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-30")
    _close(db, exam, "moed_b")
    body = {"exam_id": str(exam), "title": "t", "kind": "learn", "estimated_minutes": 30}

    response = api.post("/tasks", json=body, headers=user.headers)

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "exam_in_past"
    assert scalar(db, "SELECT count(*) FROM app.tasks WHERE exam_id = %s", exam) == 0


def test_the_exam_task_list_holds_only_the_current_sitting(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-14")
    insert_task(db, user.id, exam, title="first sitting")
    _sitting_two(db, exam, "2026-12-20")
    insert_task(db, user.id, exam, title="second sitting")

    response = api.get(f"/exams/{exam}/tasks", headers=user.headers)

    assert response.status_code == 200, response.text
    assert [task["title"] for task in response.json()] == ["second sitting"]


# --- generation and review ------------------------------------------------------------------


def test_the_analysis_picker_skips_closed_exams_and_counts_only_the_current_sitting(
    db: psycopg.Connection, database: Database, user: ApiUser
) -> None:
    caller = CurrentUser(
        id=user.id,
        email=None,
        claims={"sub": str(user.id), "role": "authenticated", "aud": "authenticated"},
    )
    open_exam = insert_exam(db, user.id, name="open", exam_date="2026-12-20")
    closed = insert_exam(db, user.id, name="closed", exam_date="2026-12-21")
    second = insert_exam(db, user.id, name="second", exam_date="2026-11-10")
    _close(db, closed, "moed_b")
    # An AI task of sitting 1 keeps `second` analyzed until it moves to sitting 2.
    db.execute(
        "INSERT INTO app.tasks (user_id, exam_id, title, kind, estimated_minutes, focus, source) "
        "VALUES (%s, %s, 't', 'learn', 30, 5, 'ai')",
        (user.id, second),
    )
    with database.transaction(caller) as conn:
        assert _exams_to_analyze(conn, user.id, dt.date(2026, 11, 9)) == [open_exam]
    _sitting_two(db, second, "2026-12-22")
    with database.transaction(caller) as conn:
        assert _exams_to_analyze(conn, user.id, dt.date(2026, 11, 16)) == [open_exam, second]


def test_reanalysis_of_a_closed_exam_is_refused(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-12-20")
    _close(db, exam, "done")

    response = api.post(f"/exams/{exam}/reanalyze", headers=user.headers)

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "exam_in_past"


def test_the_morning_review_skips_closed_exams(
    api: TestClient, db: psycopg.Connection, user: ApiUser, clock: FrozenClock
) -> None:
    clock.set(Z(2026, 11, 16, 13))
    open_exam = insert_exam(db, user.id, name="open", exam_date="2026-11-20")
    closed = insert_exam(db, user.id, name="closed", exam_date="2026-11-20")
    open_task = insert_task(db, user.id, open_exam)
    closed_task = insert_task(db, user.id, closed)
    insert_block(db, user.id, open_task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    insert_block(db, user.id, closed_task, Z(2026, 11, 16, 10), Z(2026, 11, 16, 11))
    _close(db, closed, "done")

    response = api.get("/review", headers=user.headers)

    assert response.status_code == 200, response.text
    assert [block["task_id"] for block in response.json()["blocks"]] == [str(open_task)]


def test_the_morning_review_skips_tasks_of_a_past_sitting(
    api: TestClient, db: psycopg.Connection, user: ApiUser, clock: FrozenClock
) -> None:
    clock.set(Z(2026, 11, 16, 13))
    exam = insert_exam(db, user.id, exam_date="2026-11-12")
    old = insert_task(db, user.id, exam)
    insert_block(db, user.id, old, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    _sitting_two(db, exam, "2026-12-20")
    fresh = insert_task(db, user.id, exam)
    insert_block(db, user.id, fresh, Z(2026, 11, 16, 11), Z(2026, 11, 16, 12))

    response = api.get("/review", headers=user.headers)

    assert [block["task_id"] for block in response.json()["blocks"]] == [str(fresh)]


# --- export and deletion --------------------------------------------------------------------


def test_the_export_carries_the_closure_columns_and_second_sitting_tasks(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-14")
    topic = scalar(
        db,
        "INSERT INTO app.topics (user_id, exam_id, name, weight, position) "
        "VALUES (%s, %s, 'topic', 3, 1) RETURNING id",
        user.id,
        exam,
    )
    insert_task(db, user.id, exam, title="first")
    _sitting_two(db, exam, "2026-12-20")
    db.execute(
        "UPDATE app.exams SET moed_b_notes = 'hard', moed_b_topic_ids = %s WHERE id = %s",
        ([topic], exam),
    )
    insert_task(db, user.id, exam, title="second")
    _close(db, exam, "done")

    response = api.get("/me/export", headers=user.headers)

    assert response.status_code == 200, response.text
    body = response.json()
    (exported,) = body["exams"]
    assert exported["sitting"] == 2
    assert exported["closure"] == "done"
    assert exported["closed_at"] is not None
    assert exported["closure_notified_at"] is None
    assert exported["first_exam_date"] == "2026-11-14"
    assert exported["first_grade"] == 55
    assert exported["moed_b_notes"] == "hard"
    assert exported["moed_b_topic_ids"] == [str(topic)]
    assert {task["title"]: task["sitting"] for task in body["tasks"]} == {"first": 1, "second": 2}
    assert body["version"] == 1


def test_delete_me_removes_closed_exams_and_second_sitting_rows(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    done = insert_exam(db, user.id, name="done", exam_date="2026-11-14")
    waiting = insert_exam(db, user.id, name="waiting", exam_date="2026-11-15")
    second = insert_exam(db, user.id, name="second", exam_date="2026-11-10")
    insert_task(db, user.id, done)
    insert_task(db, user.id, waiting)
    insert_task(db, user.id, second, title="first sitting")
    _close(db, done, "done")
    _close(db, waiting, "moed_b")
    _sitting_two(db, second, "2026-12-20")
    insert_task(db, user.id, second, title="second sitting")
    db.execute(
        "INSERT INTO app.plan_versions (user_id, reason, snapshot, exam_id, exam_before) "
        "VALUES (%s, 'replan', %s, %s, %s)",
        (user.id, Jsonb({"v": 1, "blocks": []}), done, Jsonb({"closure": None})),
    )

    response = api.delete("/me", headers=user.headers)

    assert response.status_code == 202, response.text
    for table in ("exams", "tasks", "plan_versions"):
        assert scalar(db, f"SELECT count(*) FROM app.{table} WHERE user_id = %s", user.id) == 0  # noqa: S608


# --- progress archive -----------------------------------------------------------------------


def test_the_progress_archive_lists_exams_closed_as_done(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    older = insert_exam(db, user.id, name="older", exam_date="2026-11-10")
    newer = insert_exam(db, user.id, name="newer", exam_date="2026-11-12")
    waiting = insert_exam(db, user.id, name="waiting", exam_date="2026-11-13")
    open_exam = insert_exam(db, user.id, name="open", exam_date="2026-12-20")
    done_task = insert_task(db, user.id, older, minutes=90, status="done")
    insert_task(db, user.id, older, minutes=30)
    insert_block(db, user.id, done_task, Z(2026, 11, 9, 9), Z(2026, 11, 9, 10, 30), status="done")
    insert_task(db, user.id, open_exam)
    _close(db, waiting, "moed_b")
    _close(db, older, "done")
    db.execute(
        "UPDATE app.exams SET closure = 'done', closed_at = %s WHERE id = %s",
        (Z(2026, 11, 15, 20), newer),
    )

    response = api.get("/progress", headers=user.headers)

    assert response.status_code == 200, response.text
    archive = response.json()["archive"]
    assert [item["name"] for item in archive] == ["older", "newer"]
    assert set(archive[0]) == {
        "exam_id",
        "name",
        "color_index",
        "exam_date",
        "first_exam_date",
        "sitting",
        "closed_at",
        "studied_minutes",
        "tasks_done",
        "tasks_total",
        "completion_percent",
    }
    assert archive[0]["exam_id"] == str(older)
    assert archive[0]["studied_minutes"] == 90
    assert (archive[0]["tasks_done"], archive[0]["tasks_total"]) == (1, 2)
    assert archive[0]["completion_percent"] == 75
    assert archive[1]["tasks_total"] == 0


def test_closing_an_exam_does_not_change_the_xp(
    api: TestClient, db: psycopg.Connection, user: ApiUser, clock: FrozenClock
) -> None:
    clock.set(Z(2026, 11, 16, 13))
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    done = api.post(f"/blocks/{block}/complete", headers=user.headers)
    assert done.status_code == 200, done.text
    xp = api.get("/progress", headers=user.headers).json()["total_xp"]
    assert xp > 0

    _close(db, exam, "done")

    after = api.get("/progress", headers=user.headers).json()
    assert after["total_xp"] == xp
    assert [item["exam_id"] for item in after["archive"]] == [str(exam)]


def test_a_task_of_a_closed_exam_or_a_past_sitting_cannot_be_changed_or_deleted(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    closed = insert_exam(db, user.id, name="closed", exam_date="2026-11-30")
    in_closed = insert_task(db, user.id, closed)
    _close(db, closed, "moed_b")
    second = insert_exam(db, user.id, name="second", exam_date="2026-11-14")
    old = insert_task(db, user.id, second, title="old")
    _sitting_two(db, second, "2026-12-20")
    current = insert_task(db, user.id, second, title="current")

    for task in (in_closed, old):
        patched = api.patch(f"/tasks/{task}", json={"status": "done"}, headers=user.headers)
        assert patched.status_code == 422, patched.text
        assert patched.json()["code"] == "exam_in_past"
        deleted = api.delete(f"/tasks/{task}", headers=user.headers)
        assert deleted.status_code == 422, deleted.text
        assert deleted.json()["code"] == "exam_in_past"
        assert scalar(db, "SELECT deleted_at IS NULL FROM app.tasks WHERE id = %s", task) is True

    ok = api.patch(f"/tasks/{current}", json={"title": "renamed"}, headers=user.headers)
    assert ok.status_code == 200, ok.text
    assert api.delete(f"/tasks/{current}", headers=user.headers).status_code in (200, 204)
