"""Exam closure (S45): GET /closures, POST /exams/{id}/close, and undo of the closure versions."""

import datetime as dt
from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from app.auth import CurrentUser
from app.db.pool import Database
from app.services.board import load_board
from app.services.plan_writes import (
    EXAM_BEFORE_FIELDS,
    VersionReason,
    create_version,
    exam_before,
)
from tests.api.factories import (
    NOW,
    TEST_PROFILE,
    Z,
    insert_analysis,
    insert_block,
    insert_exam,
    insert_task,
    scalar,
    set_profile,
)
from tests.fixtures_db import ApiUser, FrozenClock

MakeApiUser = Callable[[], ApiUser]

# Monday 2026-11-16 (TEST_PROFILE is UTC): closure of an exam dated today opens at 19:00.
EVENING = Z(2026, 11, 16, 19, 0)


@pytest.fixture
def user(make_api_user: MakeApiUser, db: psycopg.Connection, clock: FrozenClock) -> ApiUser:
    created = make_api_user()
    set_profile(db, created.id, **TEST_PROFILE)
    clock.set(NOW)
    return created


def _closures(api: TestClient, user: ApiUser) -> dict[str, Any]:
    response = api.get("/closures", headers=user.headers)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _close(api: TestClient, user: ApiUser, exam_id: UUID, outcome: str) -> Any:
    return api.post(f"/exams/{exam_id}/close", json={"outcome": outcome}, headers=user.headers)


def _undo(api: TestClient, user: ApiUser, version_id: str | UUID) -> Any:
    return api.post("/plan/undo", json={"version_id": str(version_id)}, headers=user.headers)


def _exam(db: psycopg.Connection, exam_id: UUID) -> tuple[Any, ...]:
    row = db.execute(
        "SELECT closure, closed_at, sitting, exam_date, first_exam_date FROM app.exams "
        "WHERE id = %s",
        (exam_id,),
    ).fetchone()
    assert row is not None
    return tuple(row)


def _planned(db: psycopg.Connection, user_id: UUID) -> set[tuple[UUID, UUID]]:
    return {
        (row[0], row[1])
        for row in db.execute(
            "SELECT id, task_id FROM app.blocks WHERE user_id = %s AND status = 'planned'",
            (user_id,),
        ).fetchall()
    }


def _ids(items: list[dict[str, Any]]) -> list[str]:
    return [item["exam_id"] for item in items]


def _current(user: ApiUser) -> CurrentUser:
    return CurrentUser(id=user.id, email=None, claims={"sub": str(user.id)})


# --- GET /closures ----------------------------------------------------------------------


def test_a_future_exam_is_not_pending(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    insert_exam(db, user.id, exam_date="2026-11-20")
    assert _closures(api, user) == {"pending": [], "waiting": []}


def test_an_exam_dated_today_is_pending_from_19_00(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-16")
    clock.set(Z(2026, 11, 16, 18, 59))
    assert _closures(api, user)["pending"] == []
    clock.set(EVENING)
    pending = _closures(api, user)["pending"]
    assert _ids(pending) == [str(exam)]
    assert pending[0]["state"] == "pending"
    assert pending[0]["opens_at"] == "2026-11-16T19:00:00Z"


def test_closure_opens_at_19_00_in_the_users_time_zone(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    set_profile(db, user.id, timezone="Asia/Jerusalem")
    exam = insert_exam(db, user.id, exam_date="2026-11-16")
    # Israel is UTC+2 in November: 19:00 local is 17:00 UTC.
    clock.set(Z(2026, 11, 16, 16, 59))
    assert _closures(api, user)["pending"] == []
    assert _close(api, user, exam, "done").status_code == 409
    clock.set(Z(2026, 11, 16, 17, 0))
    pending = _closures(api, user)["pending"]
    assert _ids(pending) == [str(exam)]
    assert pending[0]["opens_at"] == "2026-11-16T17:00:00Z"


def test_a_past_exam_is_pending_with_its_stats_and_topics(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, name="Calculus", exam_date="2026-11-15")
    later = insert_exam(db, user.id, name="Earlier still", exam_date="2026-11-14")
    done = insert_task(db, user.id, exam, minutes=90, status="done")
    insert_task(db, user.id, exam, minutes=30)
    insert_task(db, user.id, exam, minutes=60, status="skipped")
    insert_block(db, user.id, done, Z(2026, 11, 13, 9), Z(2026, 11, 13, 10, 30), status="done")
    analysis = insert_analysis(db, user.id, exam)
    second = scalar(
        db,
        "INSERT INTO app.topics (user_id, exam_id, name, weight, position, analysis_id) "
        "VALUES (%s, %s, 'Integrals', 3, 2, %s) RETURNING id",
        user.id,
        exam,
        analysis,
    )
    first = scalar(
        db,
        "INSERT INTO app.topics (user_id, exam_id, name, weight, position, analysis_id) "
        "VALUES (%s, %s, 'Limits', 2, 1, %s) RETURNING id",
        user.id,
        exam,
        analysis,
    )

    body = _closures(api, user)

    assert body["waiting"] == []
    assert _ids(body["pending"]) == [str(later), str(exam)]
    item = body["pending"][1]
    assert item == {
        "exam_id": str(exam),
        "exam_name": "Calculus",
        "exam_date": "2026-11-15",
        "color_index": item["color_index"],
        "sitting": 1,
        "state": "pending",
        "options": ["done", "moed_b"],
        "opens_at": "2026-11-15T19:00:00Z",
        "studied_minutes": 90,
        "tasks_done": 1,
        "tasks_total": 2,
        "completion_percent": 75,
        "topics": [{"id": str(first), "name": "Limits"}, {"id": str(second), "name": "Integrals"}],
    }
    assert isinstance(item["color_index"], int)


def test_closures_skip_deleted_exams_and_other_users(
    api: TestClient, user: ApiUser, db: psycopg.Connection, make_api_user: MakeApiUser
) -> None:
    insert_exam(db, user.id, exam_date="2026-11-15", deleted=True)
    other = make_api_user()
    insert_exam(db, other.id, exam_date="2026-11-15")
    assert _closures(api, user) == {"pending": [], "waiting": []}


# --- closing: done ----------------------------------------------------------------------


def test_closing_done_frees_the_time_for_the_other_exams_and_undo_brings_it_back(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    exam_a = insert_exam(db, user.id, name="A", exam_date="2026-11-16")
    exam_b = insert_exam(db, user.id, name="B", exam_date="2026-11-20")
    task_a = insert_task(db, user.id, exam_a, minutes=60)
    task_b = insert_task(db, user.id, exam_b, minutes=60)
    clock.set(EVENING)
    # A planned block of A's leftover task later tonight: closing deletes it.
    block_a = insert_block(db, user.id, task_a, Z(2026, 11, 16, 20), Z(2026, 11, 16, 21))
    before = _planned(db, user.id)
    assert before == {(block_a, task_a)}

    response = _close(api, user, exam_a, "done")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["event"] == {
        "kind": "course_bloomed",
        "exam_id": str(exam_a),
        "exam_name": "A",
        "color_index": body["exam"]["color_index"],
    }
    assert body["exam"]["id"] == str(exam_a)
    assert body["exam"]["state"] == "done"
    assert body["exam"]["sitting"] == 1
    assert body["exam"]["closed_at"] == "2026-11-16T19:00:00Z"
    assert [block["id"] for block in body["replan"]["removed"]] == [str(block_a)]
    assert body["replan"]["added"]
    assert {block["task_id"] for block in body["replan"]["added"]} == {str(task_b)}
    assert body["replan"]["unscheduled"] == []
    assert body["replan"]["shortfalls"] == []
    version_id = body["version_id"]
    assert scalar(db, "SELECT reason FROM app.plan_versions WHERE id = %s", version_id) == (
        "exam_closed"
    )
    assert _exam(db, exam_a)[:2] == ("done", EVENING)
    after = _planned(db, user.id)
    assert (block_a, task_a) not in after
    assert {task for _, task in after} == {task_b}
    assert _closures(api, user)["pending"] == []

    undone = _undo(api, user, version_id)

    assert undone.status_code == 200, undone.text
    assert _exam(db, exam_a)[:2] == (None, None)
    assert _planned(db, user.id) == before
    assert _ids(_closures(api, user)["pending"]) == [str(exam_a)]


def test_closing_writes_a_version_even_when_the_board_does_not_change(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-15")
    response = _close(api, user, exam, "done")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["replan"] == {"added": [], "removed": [], "unscheduled": [], "shortfalls": []}
    assert _undo(api, user, body["version_id"]).status_code == 200
    assert _exam(db, exam)[:2] == (None, None)


def test_closing_leaves_xp_as_it_was(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-15")
    task = insert_task(db, user.id, exam, status="done")
    block = insert_block(db, user.id, task, Z(2026, 11, 14, 9), Z(2026, 11, 14, 10), status="done")
    db.execute(
        "INSERT INTO app.xp_events (user_id, block_id, xp, study_date) "
        "VALUES (%s, %s, 60, '2026-11-14')",
        (user.id, block),
    )
    before = api.get("/progress", headers=user.headers).json()["total_xp"]
    assert before == 60

    assert _close(api, user, exam, "done").status_code == 200

    assert api.get("/progress", headers=user.headers).json()["total_xp"] == before


# --- closing: moed_b --------------------------------------------------------------------


def test_moed_b_waits_and_then_closes_done_and_undo_returns_it_to_waiting(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-15")

    waiting = _close(api, user, exam, "moed_b")

    assert waiting.status_code == 200, waiting.text
    body = waiting.json()
    assert body["event"] is None
    assert body["exam"]["state"] == "waiting_moed_b"
    assert scalar(db, "SELECT reason FROM app.plan_versions WHERE id = %s", body["version_id"]) == (
        "exam_moed_b"
    )
    lists = _closures(api, user)
    assert lists["pending"] == []
    assert _ids(lists["waiting"]) == [str(exam)]
    assert lists["waiting"][0]["options"] == ["done"]
    assert lists["waiting"][0]["state"] == "waiting_moed_b"

    again = _close(api, user, exam, "moed_b")
    assert again.status_code == 409
    assert again.json()["code"] == "invalid_state"

    clock.advance(hours=2)
    done = _close(api, user, exam, "done")
    assert done.status_code == 200, done.text
    assert done.json()["exam"]["state"] == "done"
    assert done.json()["event"]["kind"] == "course_bloomed"
    assert _closures(api, user) == {"pending": [], "waiting": []}

    assert _undo(api, user, done.json()["version_id"]).status_code == 200
    assert _exam(db, exam)[:2] == ("moed_b", NOW)
    assert _ids(_closures(api, user)["waiting"]) == [str(exam)]


def test_deleting_a_pending_exam_takes_it_off_closures_and_undo_brings_it_back(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, name="Calculus", exam_date="2026-11-15")
    insert_task(db, user.id, exam, minutes=90, status="done")
    insert_task(db, user.id, exam, minutes=30)
    before = _closures(api, user)
    assert _ids(before["pending"]) == [str(exam)]
    item = before["pending"][0]
    assert item["sitting"] == 1
    assert item["options"] == ["done", "moed_b"]

    deleted = api.delete(f"/exams/{exam}", headers=user.headers)

    assert deleted.status_code == 200, deleted.text
    version_id = deleted.json()["version_id"]
    assert version_id is not None
    assert _closures(api, user) == {"pending": [], "waiting": []}

    assert _undo(api, user, version_id).status_code == 200
    after = _closures(api, user)
    assert after["waiting"] == []
    assert _ids(after["pending"]) == [str(exam)]
    restored = after["pending"][0]
    assert restored["state"] == "pending"
    assert restored["options"] == ["done", "moed_b"]
    assert restored["tasks_total"] == item["tasks_total"]
    assert restored["studied_minutes"] == item["studied_minutes"]


def test_deleting_a_waiting_exam_and_undo_returns_it_to_waiting(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-15")
    assert _close(api, user, exam, "moed_b").status_code == 200
    assert _ids(_closures(api, user)["waiting"]) == [str(exam)]

    deleted = api.delete(f"/exams/{exam}", headers=user.headers)

    assert deleted.status_code == 200, deleted.text
    version_id = deleted.json()["version_id"]
    assert version_id is not None
    assert _closures(api, user) == {"pending": [], "waiting": []}
    assert api.get("/exams", headers=user.headers).json() == []

    assert _undo(api, user, version_id).status_code == 200
    after = _closures(api, user)
    assert after["pending"] == []
    assert _ids(after["waiting"]) == [str(exam)]
    listed = api.get("/exams", headers=user.headers).json()
    assert [(e["id"], e["state"]) for e in listed] == [(str(exam), "waiting_moed_b")]


def test_a_second_sitting_closes_only_done(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-15")
    db.execute(
        "UPDATE app.exams SET sitting = 2, first_exam_date = '2026-11-01' WHERE id = %s", (exam,)
    )
    pending = _closures(api, user)["pending"]
    assert pending[0]["options"] == ["done"]
    assert pending[0]["sitting"] == 2
    assert _close(api, user, exam, "moed_b").status_code == 409
    assert _close(api, user, exam, "done").status_code == 200


# --- refusals ---------------------------------------------------------------------------


def test_an_active_exam_cannot_be_closed(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    future = insert_exam(db, user.id, exam_date="2026-11-20")
    today = insert_exam(db, user.id, exam_date="2026-11-16")
    clock.set(Z(2026, 11, 16, 18, 59))
    for exam in (future, today):
        response = _close(api, user, exam, "done")
        assert response.status_code == 409, response.text
        assert response.json()["code"] == "invalid_state"
    assert scalar(db, "SELECT count(*) FROM app.plan_versions WHERE user_id = %s", user.id) == 0


def test_a_done_exam_cannot_be_closed_again(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-15")
    assert _close(api, user, exam, "done").status_code == 200
    for outcome in ("done", "moed_b"):
        assert _close(api, user, exam, outcome).status_code == 409


def test_another_users_or_a_deleted_exam_is_not_found(
    api: TestClient, user: ApiUser, db: psycopg.Connection, make_api_user: MakeApiUser
) -> None:
    other = make_api_user()
    theirs = insert_exam(db, other.id, exam_date="2026-11-15")
    deleted = insert_exam(db, user.id, exam_date="2026-11-15", deleted=True)
    for exam in (theirs, deleted, uuid4()):
        response = _close(api, user, exam, "done")
        assert response.status_code == 404, response.text
        assert response.json()["code"] == "not_found"
    assert scalar(db, "SELECT closure FROM app.exams WHERE id = %s", theirs) is None


@pytest.mark.parametrize(
    "body", [{"outcome": "passed"}, {}, {"outcome": "done", "grade": 90}, {"outcome": None}]
)
def test_a_bad_outcome_is_422(
    api: TestClient, user: ApiUser, db: psycopg.Connection, body: dict[str, Any]
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-15")
    response = api.post(f"/exams/{exam}/close", json=body, headers=user.headers)
    assert response.status_code == 422, response.text


# --- undo of moed_b_opened (written as Task 3 writes it) --------------------------------


def _open_moed_b(
    database: Database, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> tuple[UUID, list[UUID]]:
    """Open a second sitting the way POST /exams/{id}/moed-b does: version, exam, tasks."""
    with database.transaction(_current(user)) as conn:
        board = load_board(conn, user.id, NOW, lock=True)
        old = conn.execute("SELECT * FROM app.exams WHERE id = %s", (exam,)).fetchone()
        assert old is not None
        version = create_version(
            conn,
            user.id,
            board,
            VersionReason.MOED_B_OPENED,
            exam,
            None,
            None,
            exam_before=exam_before(old, EXAM_BEFORE_FIELDS),
        )
        conn.execute(
            "UPDATE app.exams SET sitting = 2, closure = NULL, closed_at = NULL, "
            "first_exam_date = exam_date, exam_date = '2026-11-25', first_grade = 48, "
            "moed_b_notes = 'Integrals', moed_b_topic_ids = %s WHERE id = %s",
            ([uuid4()], exam),
        )
    tasks = [insert_task(db, user.id, exam, title=f"Moed B {n}") for n in range(2)]
    assert scalar(db, "SELECT sitting FROM app.tasks WHERE id = %s", tasks[0]) == 2
    insert_block(db, user.id, tasks[0], Z(2026, 11, 17, 9), Z(2026, 11, 17, 10))
    return version, tasks


def test_undo_of_moed_b_opened_deletes_its_tasks_and_returns_the_exam_to_waiting(
    api: TestClient, user: ApiUser, db: psycopg.Connection, database: Database
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-10")
    first_task = insert_task(db, user.id, exam, status="done")
    db.execute(
        "UPDATE app.exams SET closure = 'moed_b', closed_at = %s WHERE id = %s",
        (Z(2026, 11, 10, 19, 30), exam),
    )
    version, tasks = _open_moed_b(database, db, user, exam)
    assert _closures(api, user)["waiting"] == []

    response = _undo(api, user, version)

    assert response.status_code == 200, response.text
    assert _exam(db, exam) == ("moed_b", Z(2026, 11, 10, 19, 30), 1, dt.date(2026, 11, 10), None)
    row = db.execute(
        "SELECT first_grade, moed_b_notes, moed_b_topic_ids FROM app.exams WHERE id = %s",
        (exam,),
    ).fetchone()
    assert row == (None, None, [])
    for task in tasks:
        assert scalar(db, "SELECT deleted_at FROM app.tasks WHERE id = %s", task) is not None
    assert scalar(db, "SELECT deleted_at FROM app.tasks WHERE id = %s", first_task) is None
    assert _planned(db, user.id) == set()
    assert _ids(_closures(api, user)["waiting"]) == [str(exam)]


@pytest.mark.parametrize("progress", ["done_task", "done_block", "running_block"])
def test_undo_of_moed_b_opened_is_refused_once_a_moed_b_task_has_progress(
    api: TestClient,
    user: ApiUser,
    db: psycopg.Connection,
    database: Database,
    clock: FrozenClock,
    progress: str,
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-10")
    db.execute(
        "UPDATE app.exams SET closure = 'moed_b', closed_at = %s WHERE id = %s",
        (Z(2026, 11, 10, 19, 30), exam),
    )
    version, tasks = _open_moed_b(database, db, user, exam)
    if progress == "done_task":
        db.execute("UPDATE app.tasks SET status = 'done' WHERE id = %s", (tasks[1],))
    elif progress == "done_block":
        insert_block(db, user.id, tasks[1], Z(2026, 11, 16, 3), Z(2026, 11, 16, 4), status="done")
    else:
        clock.set(Z(2026, 11, 17, 9, 30))

    response = _undo(api, user, version)

    assert response.status_code == 409, response.text
    assert response.json()["code"] == "invalid_state"
    assert _exam(db, exam)[:3] == (None, None, 2)
    for task in tasks:
        assert scalar(db, "SELECT deleted_at FROM app.tasks WHERE id = %s", task) is None
    assert scalar(db, "SELECT undone_at FROM app.plan_versions WHERE id = %s", version) is None


# --- an invalid exam_before -------------------------------------------------------------


@pytest.mark.parametrize(
    "before",
    [
        {},
        {"bogus": 1},
        {"closure": 5},
        {"closure": "passed", "closed_at": None},
        {"closed_at": "2026-11-16T19:00:00"},
        {"closed_at": "yesterday"},
        {"exam_date": None},
        {"exam_date": 20261116},
        {"sitting": True},
        {"sitting": "1"},
        {"first_grade": 101},
        {"moed_b_topic_ids": ["not-a-uuid"]},
        {"moed_b_topic_ids": None},
        {"moed_b_notes": 7},
        # Well formed, but it breaks the exam's CHECKs (a closure without closed_at).
        {"closure": "done"},
    ],
)
def test_undo_of_a_closure_refuses_an_invalid_exam_before(
    api: TestClient, user: ApiUser, db: psycopg.Connection, before: dict[str, Any]
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-15")
    version = scalar(
        db,
        "INSERT INTO app.plan_versions (user_id, reason, snapshot, exam_id, exam_before) "
        "VALUES (%s, 'exam_closed', %s, %s, %s) RETURNING id",
        user.id,
        Jsonb({"v": 1, "blocks": []}),
        exam,
        Jsonb(before),
    )

    response = _undo(api, user, version)

    assert response.status_code == 409, response.text
    assert response.json()["code"] == "invalid_state"
    assert _exam(db, exam)[:2] == (None, None)
    assert scalar(db, "SELECT undone_at FROM app.plan_versions WHERE id = %s", version) is None


def test_exam_before_is_json_safe() -> None:
    topic = uuid4()
    row = {
        "exam_date": dt.date(2026, 11, 25),
        "sitting": 2,
        "closure": None,
        "closed_at": dt.datetime(2026, 11, 10, 19, 30, 15, tzinfo=dt.UTC),
        "closure_notified_at": None,
        "first_exam_date": dt.date(2026, 11, 10),
        "first_grade": 48,
        "moed_b_notes": "Integrals",
        "moed_b_topic_ids": [topic],
        "name": "ignored",
    }
    assert exam_before(row, EXAM_BEFORE_FIELDS) == {
        "exam_date": "2026-11-25",
        "sitting": 2,
        "closure": None,
        "closed_at": "2026-11-10T19:30:15+00:00",
        "closure_notified_at": None,
        "first_exam_date": "2026-11-10",
        "first_grade": 48,
        "moed_b_notes": "Integrals",
        "moed_b_topic_ids": [str(topic)],
    }
    assert exam_before(row, ("closure", "closed_at")) == {
        "closure": None,
        "closed_at": "2026-11-10T19:30:15+00:00",
    }


def test_only_the_current_topic_generation_is_listed(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, name="Calculus", exam_date="2026-11-15")
    old = insert_analysis(db, user.id, exam, "superseded")
    new = insert_analysis(db, user.id, exam)
    for name, position, analysis in (("Limits", 1, old), ("Limits", 1, new), ("Series", 2, new)):
        db.execute(
            "INSERT INTO app.topics (user_id, exam_id, name, weight, position, analysis_id) "
            "VALUES (%s, %s, %s, 3, %s, %s)",
            (user.id, exam, name, position, analysis),
        )

    (item,) = _closures(api, user)["pending"]

    assert [t["name"] for t in item["topics"]] == ["Limits", "Series"]
