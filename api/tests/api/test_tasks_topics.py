"""S15: tasks carry their topic, material, position and (in the list) the analysis's reason."""

import copy
from collections.abc import Callable
from typing import Any
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from tests.ai.samples import valid_output_dict
from tests.api.factories import (
    NOW,
    TEST_PROFILE,
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


@pytest.fixture
def other(make_api_user: MakeApiUser, db: psycopg.Connection) -> ApiUser:
    created = make_api_user()
    set_profile(db, created.id, **TEST_PROFILE)
    return created


def _output() -> dict[str, Any]:
    output = copy.deepcopy(valid_output_dict())
    for index, task in enumerate(output["tasks"], start=1):
        task["reason"] = f"נימוק {index}"
    return output


def insert_analysis(
    db: psycopg.Connection, user_id: UUID, exam_id: UUID, output: dict[str, Any]
) -> UUID:
    row = db.execute(
        "INSERT INTO app.analyses (user_id, exam_id, status, output, applied_at) "
        "VALUES (%s, %s, 'applied', %s, now()) RETURNING id",
        (user_id, exam_id, Jsonb(output)),
    ).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def insert_topic(
    db: psycopg.Connection, user_id: UUID, exam_id: UUID, name: str = "נושא", position: int = 1
) -> UUID:
    row = db.execute(
        "INSERT INTO app.topics (user_id, exam_id, name, weight, position) "
        "VALUES (%s, %s, %s, 3, %s) RETURNING id",
        (user_id, exam_id, name, position),
    ).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def _ai_task(
    db: psycopg.Connection,
    user_id: UUID,
    exam_id: UUID,
    analysis_id: UUID | None,
    position: int | None,
    title: str,
) -> UUID:
    task = insert_task(db, user_id, exam_id, title=title)
    db.execute(
        "UPDATE app.tasks SET source = 'ai', analysis_id = %s, position = %s WHERE id = %s",
        (analysis_id, position, task),
    )
    return task


def _post(api: TestClient, user: ApiUser, exam: Any, **fields: Any) -> Any:
    body = {"exam_id": str(exam), "title": "משימה", "kind": "learn", "estimated_minutes": 90}
    return api.post("/tasks", json={**body, **fields}, headers=user.headers)


def _list(api: TestClient, user: ApiUser, exam: UUID) -> list[dict[str, Any]]:
    response = api.get(f"/exams/{exam}/tasks", headers=user.headers)
    assert response.status_code == 200, response.text
    tasks: list[dict[str, Any]] = response.json()
    return tasks


def test_a_user_task_has_the_new_fields_empty(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    created = _post(api, user, exam)
    assert created.status_code == 201, created.text
    task = created.json()["task"]
    assert (task["topic_id"], task["material_id"], task["position"]) == (None, None, None)
    assert "reason" not in task

    patched = api.patch(f"/tasks/{task['id']}", json={"title": "אחר"}, headers=user.headers)
    assert patched.status_code == 200, patched.text
    assert patched.json()["task"]["position"] is None

    [listed] = _list(api, user, exam)
    assert listed == {**task, "title": "אחר", "reason": None}


def test_the_list_gives_each_ai_task_the_reason_of_its_position(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    analysis = insert_analysis(db, user.id, exam, _output())
    third = _ai_task(db, user.id, exam, analysis, 3, "שלישית")
    first = _ai_task(db, user.id, exam, analysis, 1, "ראשונה")
    beyond = _ai_task(db, user.id, exam, analysis, 50, "מחוץ לפלט")
    orphan = _ai_task(db, user.id, exam, None, 2, "בלי ניתוח")
    mine = insert_task(db, user.id, exam, title="שלי")

    listed = _list(api, user, exam)
    assert [(task["id"], task["position"], task["reason"]) for task in listed] == [
        (str(first), 1, "נימוק 1"),
        (str(orphan), 2, None),
        (str(third), 3, "נימוק 3"),
        (str(beyond), 50, None),
        (str(mine), None, None),
    ]


def test_the_reason_ignores_another_users_analysis(
    api: TestClient, user: ApiUser, other: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    theirs = insert_exam(db, other.id, exam_date="2026-11-20")
    insert_analysis(db, other.id, theirs, _output())
    _ai_task(db, user.id, exam, None, 1, "בלי ניתוח")
    assert [task["reason"] for task in _list(api, user, exam)] == [None]
    assert api.get(f"/exams/{exam}/tasks", headers=other.headers).status_code == 404


def test_create_with_a_topic_of_the_exam(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    topic = insert_topic(db, user.id, exam)
    created = _post(api, user, exam, topic_id=str(topic))
    assert created.status_code == 201, created.text
    assert created.json()["task"]["topic_id"] == str(topic)
    assert created.json()["placement"]["placed"] is True
    assert [task["topic_id"] for task in _list(api, user, exam)] == [str(topic)]


def test_create_with_a_foreign_topic_is_404_and_writes_nothing(
    api: TestClient, user: ApiUser, other: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    sibling = insert_exam(db, user.id, exam_date="2026-11-25")
    theirs = insert_exam(db, other.id, exam_date="2026-11-20")
    for topic in (
        insert_topic(db, user.id, sibling),
        insert_topic(db, other.id, theirs),
        UUID("00000000-0000-4000-8000-000000000000"),
    ):
        response = _post(api, user, exam, topic_id=str(topic))
        assert response.status_code == 404, response.text
        assert response.json()["code"] == "not_found"
    assert scalar(db, "SELECT count(*) FROM app.tasks") == 0
    assert scalar(db, "SELECT count(*) FROM app.blocks") == 0


def _blocks(db: psycopg.Connection) -> list[tuple[Any, ...]]:
    return [
        tuple(row)
        for row in db.execute(
            "SELECT id, starts_at, ends_at, status FROM app.blocks ORDER BY starts_at"
        ).fetchall()
    ]


def test_patch_topic_does_not_replace_the_task(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    topic = insert_topic(db, user.id, exam)
    task = _post(api, user, exam).json()["task"]["id"]
    blocks = _blocks(db)
    versions = scalar(db, "SELECT count(*) FROM app.plan_versions")

    set_topic = api.patch(f"/tasks/{task}", json={"topic_id": str(topic)}, headers=user.headers)
    assert set_topic.status_code == 200, set_topic.text
    body = set_topic.json()
    assert body["task"]["topic_id"] == str(topic)
    assert (body["placement"], body["version_id"]) == (None, None)

    both = api.patch(
        f"/tasks/{task}", json={"topic_id": None, "title": "חדשה"}, headers=user.headers
    )
    assert both.status_code == 200, both.text
    assert both.json()["task"]["topic_id"] is None
    assert both.json()["placement"] is None
    assert _blocks(db) == blocks
    assert scalar(db, "SELECT count(*) FROM app.plan_versions") == versions


def test_patch_topic_with_minutes_still_replaces(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    topic = insert_topic(db, user.id, exam)
    task = _post(api, user, exam).json()["task"]["id"]
    response = api.patch(
        f"/tasks/{task}",
        json={"topic_id": str(topic), "estimated_minutes": 60},
        headers=user.headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["placement"]["placed"] is True
    assert response.json()["task"]["topic_id"] == str(topic)


def test_patch_with_a_foreign_topic_is_404_and_changes_nothing(
    api: TestClient, user: ApiUser, other: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    sibling = insert_exam(db, user.id, exam_date="2026-11-25")
    theirs = insert_exam(db, other.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam)
    for topic in (insert_topic(db, user.id, sibling), insert_topic(db, other.id, theirs)):
        response = api.patch(
            f"/tasks/{task}", json={"topic_id": str(topic), "title": "x"}, headers=user.headers
        )
        assert response.status_code == 404, response.text
        assert response.json()["code"] == "not_found"
    assert scalar(db, "SELECT topic_id FROM app.tasks WHERE id = %s", task) is None
    assert scalar(db, "SELECT title FROM app.tasks WHERE id = %s", task) == "משימה"


def test_another_user_cannot_patch_the_topic_of_a_task(
    api: TestClient, user: ApiUser, other: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    topic = insert_topic(db, user.id, exam)
    task = insert_task(db, user.id, exam)
    response = api.patch(f"/tasks/{task}", json={"topic_id": str(topic)}, headers=other.headers)
    assert response.status_code == 404
    assert scalar(db, "SELECT topic_id FROM app.tasks WHERE id = %s", task) is None


def test_a_task_of_an_exam_dated_today_can_still_be_added(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date=NOW.date())
    assert _post(api, user, exam).status_code == 201
