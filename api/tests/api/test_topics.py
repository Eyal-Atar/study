"""S15: GET /exams/{exam_id}/topics and PATCH /topics/{topic_id}."""

import copy
import datetime as dt
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


@pytest.fixture
def exam(db: psycopg.Connection, user: ApiUser) -> UUID:
    return insert_exam(db, user.id, exam_date="2026-11-23")


def _analysis(
    db: psycopg.Connection,
    user_id: UUID,
    exam_id: UUID,
    *,
    status: str = "applied",
    gaps: list[dict[str, str]] | None = None,
    at: dt.datetime = NOW,
) -> UUID:
    output = copy.deepcopy(valid_output_dict())
    output["gaps"] = gaps or []
    row = db.execute(
        "INSERT INTO app.analyses (user_id, exam_id, status, output, created_at, applied_at) "
        "VALUES (%s, %s, %s, %s, %s, CASE WHEN %s = 'applied' THEN %s END) RETURNING id",
        (user_id, exam_id, status, Jsonb(output), at, status, at),
    ).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def _topic(
    db: psycopg.Connection,
    user_id: UUID,
    exam_id: UUID,
    name: str,
    *,
    analysis_id: UUID | None = None,
    position: int = 1,
    weight: int = 3,
    evidence: str | None = None,
) -> UUID:
    row = db.execute(
        "INSERT INTO app.topics (user_id, exam_id, name, weight, evidence, position, "
        "analysis_id) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
        (user_id, exam_id, name, weight, evidence, position, analysis_id),
    ).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def _point(db: psycopg.Connection, task: UUID, topic: UUID, *, deleted: bool = False) -> None:
    db.execute(
        "UPDATE app.tasks SET topic_id = %s, deleted_at = CASE WHEN %s THEN now() END "
        "WHERE id = %s",
        (topic, deleted, task),
    )


def _get(api: TestClient, user: ApiUser, exam: UUID) -> dict[str, Any]:
    response = api.get(f"/exams/{exam}/topics", headers=user.headers)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def test_an_exam_without_analyses_has_no_topics(api: TestClient, user: ApiUser, exam: UUID) -> None:
    assert _get(api, user, exam) == {
        "analysis_id": None,
        "draft_analysis_id": None,
        "topics": [],
        "gaps": [],
    }


def test_topics_of_the_latest_applied_analysis_and_of_live_tasks(
    api: TestClient, user: ApiUser, db: psycopg.Connection, exam: UUID
) -> None:
    old = _analysis(
        db, user.id, exam, gaps=[{"topic": "ישן", "note": "x"}], at=NOW - dt.timedelta(days=2)
    )
    latest = _analysis(
        db, user.id, exam, gaps=[{"topic": "טורים", "note": "לא מופיע בחומרים"}],
        at=NOW - dt.timedelta(days=1),
    )  # fmt: skip
    draft = _analysis(db, user.id, exam, status="draft", at=NOW)
    _analysis(db, user.id, exam, status="superseded", at=NOW + dt.timedelta(seconds=1))

    second = _topic(db, user.id, exam, "נגזרות", analysis_id=latest, position=2, weight=4)
    first = _topic(
        db, user.id, exam, "גבולות", analysis_id=latest, position=1, weight=5, evidence="שאלה 1"
    )
    kept_old = _topic(db, user.id, exam, "ישן עם משימה", analysis_id=old, position=1)
    _topic(db, user.id, exam, "ישן בלי משימה", analysis_id=old, position=2)
    dead = _topic(db, user.id, exam, "ישן של משימה מחוקה", analysis_id=old, position=3)
    _topic(db, user.id, exam, "של הטיוטה", analysis_id=draft, position=1)
    _point(db, insert_task(db, user.id, exam), kept_old)
    _point(db, insert_task(db, user.id, exam), first)  # listed once, not twice
    _point(db, insert_task(db, user.id, exam), dead, deleted=True)

    body = _get(api, user, exam)
    assert body["analysis_id"] == str(latest)
    assert body["draft_analysis_id"] == str(draft)
    assert body["gaps"] == [{"topic": "טורים", "note": "לא מופיע בחומרים"}]
    assert [topic["id"] for topic in body["topics"]] == [str(first), str(kept_old), str(second)]
    assert body["topics"][0] == {
        "id": str(first),
        "exam_id": str(exam),
        "name": "גבולות",
        "weight": 5,
        "evidence": "שאלה 1",
        "position": 1,
        "analysis_id": str(latest),
    }


def test_a_draft_alone_gives_no_topics_but_its_id(
    api: TestClient, user: ApiUser, db: psycopg.Connection, exam: UUID
) -> None:
    draft = _analysis(db, user.id, exam, status="draft", gaps=[{"topic": "x", "note": "y"}])
    _topic(db, user.id, exam, "של הטיוטה", analysis_id=draft)
    assert _get(api, user, exam) == {
        "analysis_id": None,
        "draft_analysis_id": str(draft),
        "topics": [],
        "gaps": [],
    }


def test_topics_of_another_exam_are_not_listed(
    api: TestClient, user: ApiUser, db: psycopg.Connection, exam: UUID
) -> None:
    sibling = insert_exam(db, user.id, exam_date="2026-11-25")
    analysis = _analysis(db, user.id, sibling)
    _topic(db, user.id, sibling, "אחר", analysis_id=analysis)
    assert _get(api, user, exam)["topics"] == []


def test_topics_of_another_user_or_a_deleted_exam_are_404(
    api: TestClient, user: ApiUser, other: ApiUser, db: psycopg.Connection, exam: UUID
) -> None:
    analysis = _analysis(db, user.id, exam)
    _topic(db, user.id, exam, "שלי", analysis_id=analysis)
    response = api.get(f"/exams/{exam}/topics", headers=other.headers)
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
    gone = insert_exam(db, user.id, exam_date="2026-11-23", deleted=True)
    assert api.get(f"/exams/{gone}/topics", headers=user.headers).status_code == 404


def test_patch_topic_name_and_weight(
    api: TestClient, user: ApiUser, db: psycopg.Connection, exam: UUID
) -> None:
    analysis = _analysis(db, user.id, exam)
    topic = _topic(db, user.id, exam, "גבולות", analysis_id=analysis, weight=2, evidence="ש1")
    versions = scalar(db, "SELECT count(*) FROM app.plan_versions")

    renamed = api.patch(f"/topics/{topic}", json={"name": "  רציפות "}, headers=user.headers)
    assert renamed.status_code == 200, renamed.text
    assert renamed.json() == {
        "id": str(topic),
        "exam_id": str(exam),
        "name": "רציפות",
        "weight": 2,
        "evidence": "ש1",
        "position": 1,
        "analysis_id": str(analysis),
    }
    heavier = api.patch(f"/topics/{topic}", json={"weight": 5}, headers=user.headers)
    assert heavier.status_code == 200, heavier.text
    assert (heavier.json()["name"], heavier.json()["weight"]) == ("רציפות", 5)
    both = api.patch(f"/topics/{topic}", json={"name": "א", "weight": 1}, headers=user.headers)
    assert (both.json()["name"], both.json()["weight"]) == ("א", 1)
    assert "plan_affected" not in both.json()
    assert scalar(db, "SELECT count(*) FROM app.plan_versions") == versions
    assert _get(api, user, exam)["topics"][0]["name"] == "א"


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"name": ""},
        {"name": "   "},
        {"name": "x" * 121},
        {"name": "a\u0000b"},
        {"name": None},
        {"weight": 0},
        {"weight": 6},
        {"weight": None},
        {"evidence": "x"},
    ],
)
def test_patch_topic_validation(
    api: TestClient, user: ApiUser, db: psycopg.Connection, exam: UUID, body: dict[str, Any]
) -> None:
    topic = _topic(db, user.id, exam, "גבולות", weight=3)
    response = api.patch(f"/topics/{topic}", json=body, headers=user.headers)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "validation_error"
    assert scalar(db, "SELECT name FROM app.topics WHERE id = %s", topic) == "גבולות"


def test_patch_topic_name_of_120_characters(
    api: TestClient, user: ApiUser, db: psycopg.Connection, exam: UUID
) -> None:
    topic = _topic(db, user.id, exam, "גבולות")
    response = api.patch(f"/topics/{topic}", json={"name": "x" * 120}, headers=user.headers)
    assert response.status_code == 200, response.text


def test_patch_topic_of_another_user_or_a_deleted_exam_is_404(
    api: TestClient, user: ApiUser, other: ApiUser, db: psycopg.Connection, exam: UUID
) -> None:
    topic = _topic(db, user.id, exam, "גבולות")
    response = api.patch(f"/topics/{topic}", json={"name": "שלו"}, headers=other.headers)
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
    gone = insert_exam(db, user.id, exam_date="2026-11-23", deleted=True)
    dead = _topic(db, user.id, gone, "מחוק")
    assert api.patch(f"/topics/{dead}", json={"weight": 1}, headers=user.headers).status_code == 404
    missing = UUID("00000000-0000-4000-8000-000000000000")
    assert (
        api.patch(f"/topics/{missing}", json={"weight": 1}, headers=user.headers).status_code == 404
    )
    assert scalar(db, "SELECT name FROM app.topics WHERE id = %s", topic) == "גבולות"
    assert scalar(db, "SELECT weight FROM app.topics WHERE id = %s", dead) == 3
