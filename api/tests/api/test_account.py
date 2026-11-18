"""The account (S15): GET /me/export and DELETE /me.

The export is everything the user owns, as one JSON file, without the extracted text of
their materials or the storage paths. DELETE /me empties every app table of the user at
once and leaves only the delete_account job for the worker (tests/jobs/test_delete_account.py).
"""

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from app.domain.materials import JOB_DELETE_ACCOUNT
from tests.api.factories import NOW, TEST_PROFILE, insert_block, insert_exam, insert_task, scalar
from tests.fixtures_db import ApiUser, FrozenClock

MakeApiUser = Callable[[], ApiUser]

# Every table in app with a user column, and that column (profiles is keyed by id).
USER_COLUMN = {
    "profiles": "id",
    "exams": "user_id",
    "tasks": "user_id",
    "blocks": "user_id",
    "plan_versions": "user_id",
    "materials": "user_id",
    "jobs": "user_id",
    "topics": "user_id",
    "analyses": "user_id",
    "ai_usage": "user_id",
    "xp_events": "user_id",
    "badges": "user_id",
    "commitments": "user_id",
    "busy_events": "user_id",
}

TEXT_SENTINEL = "SENTINEL-TEXT-BY-PAGE-7f3a"


@dataclass(frozen=True)
class Filled:
    exam_id: UUID
    deleted_exam_id: UUID
    task_id: UUID
    deleted_task_id: UUID
    block_id: UUID
    topic_id: UUID
    material_id: UUID
    storage_path: str
    analysis_id: UUID
    job_id: UUID
    commitment_id: UUID
    deleted_commitment_id: UUID
    event_id: UUID
    deleted_event_id: UUID

    def ids(self) -> set[str]:
        return {
            str(value)
            for value in (
                self.exam_id,
                self.deleted_exam_id,
                self.task_id,
                self.deleted_task_id,
                self.block_id,
                self.topic_id,
                self.material_id,
                self.analysis_id,
                self.commitment_id,
                self.deleted_commitment_id,
                self.event_id,
                self.deleted_event_id,
            )
        }


def _one(db: psycopg.Connection, query: str, params: tuple[object, ...]) -> UUID:
    row = db.execute(query, params).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def fill_account(db: psycopg.Connection, user_id: UUID) -> Filled:
    """At least one row of this user in every table of app, written as the owner."""
    db.execute("INSERT INTO app.profiles (id) VALUES (%s) ON CONFLICT DO NOTHING", (user_id,))
    exam = insert_exam(db, user_id, name="אלגוריתמים", exam_date="2026-12-20")
    deleted_exam = insert_exam(db, user_id, name="נמחק", exam_date="2026-12-21", deleted=True)
    job = _one(
        db,
        "INSERT INTO app.jobs (user_id, kind, payload) VALUES (%s, 'generate_plan', '{}') "
        "RETURNING id",
        (user_id,),
    )
    analysis = _one(
        db,
        "INSERT INTO app.analyses (user_id, exam_id, job_id, status, output, applied_at, "
        "material_keys) VALUES (%s, %s, %s, 'applied', %s, now(), %s) RETURNING id",
        (
            user_id,
            exam,
            job,
            Jsonb({"tasks": [{"title": "T", "reason": "because"}]}),
            Jsonb({"key": "internal"}),
        ),
    )
    topic = _one(
        db,
        "INSERT INTO app.topics (user_id, exam_id, name, weight, position, analysis_id) "
        "VALUES (%s, %s, 'גרפים', 3, 1, %s) RETURNING id",
        (user_id, exam, analysis),
    )
    material = uuid4()
    path = f"{user_id}/{exam}/{material}"
    db.execute(
        "INSERT INTO app.materials (id, user_id, exam_id, storage_path, filename, kind, mime, "
        "size_bytes, page_count, scanned_pages, ingest_status, text_by_page, ingested_at) "
        "VALUES (%s, %s, %s, %s, 'n.pdf', 'notes', 'application/pdf', 1000, 1, 0, 'ready', %s, "
        "now())",
        (material, user_id, exam, path, Jsonb([TEXT_SENTINEL])),
    )
    task = insert_task(db, user_id, exam, title="ללמוד")
    deleted_task = insert_task(db, user_id, exam, title="נמחקה")
    db.execute("UPDATE app.tasks SET deleted_at = now() WHERE id = %s", (deleted_task,))
    version = _one(
        db,
        "INSERT INTO app.plan_versions (user_id, reason, snapshot) "
        "VALUES (%s, 'replan', '{\"v\": 1, \"blocks\": []}') RETURNING id",
        (user_id,),
    )
    block = insert_block(
        db,
        user_id,
        task,
        starts_at=NOW.replace(hour=8),
        ends_at=NOW.replace(hour=9),
    )
    db.execute("UPDATE app.blocks SET plan_version_id = %s WHERE id = %s", (version, block))
    db.execute("UPDATE app.blocks SET status = 'done' WHERE id = %s", (block,))
    db.execute(
        "INSERT INTO app.xp_events (user_id, block_id, xp, study_date) "
        "VALUES (%s, %s, 50, '2026-11-16')",
        (user_id, block),
    )
    db.execute("INSERT INTO app.badges (user_id, badge_key) VALUES (%s, 'first_task')", (user_id,))
    db.execute(
        "INSERT INTO app.ai_usage (user_id, job_id, exam_id, model, input_tokens, output_tokens) "
        "VALUES (%s, %s, %s, 'claude-test', 100, 20)",
        (user_id, job, exam),
    )
    commitment = _one(
        db,
        "INSERT INTO app.commitments (user_id, title, kind, weekday, start_time, end_time, "
        "valid_from, valid_until, source_job_id) "
        "VALUES (%s, 'עבודה', 'work', 1, '16:00', '22:00', '2026-11-01', '2027-01-10', %s) "
        "RETURNING id",
        (user_id, job),
    )
    deleted_commitment = _one(
        db,
        "INSERT INTO app.commitments (user_id, title, kind, weekday, start_time, end_time, "
        "valid_from, deleted_at) VALUES (%s, 'ישן', 'class', 3, '22:00', '01:00', "
        "'2026-10-01', now()) RETURNING id",
        (user_id,),
    )
    event = _one(
        db,
        "INSERT INTO app.busy_events (user_id, title, starts_at, ends_at) "
        "VALUES (%s, 'חתונה', '2026-11-19T18:00Z', '2026-11-19T23:00Z') RETURNING id",
        (user_id,),
    )
    deleted_event = _one(
        db,
        "INSERT INTO app.busy_events (user_id, starts_at, ends_at, deleted_at) "
        "VALUES (%s, '2026-11-20T10:00Z', '2026-11-20T11:00Z', now()) RETURNING id",
        (user_id,),
    )
    db.execute(
        "INSERT INTO app.plan_versions (user_id, reason, snapshot, busy_event_id) "
        "VALUES (%s, 'busy_added', '{\"v\": 1, \"blocks\": []}', %s)",
        (user_id, event),
    )
    return Filled(
        exam_id=exam,
        deleted_exam_id=deleted_exam,
        task_id=task,
        deleted_task_id=deleted_task,
        block_id=block,
        topic_id=topic,
        material_id=material,
        storage_path=path,
        analysis_id=analysis,
        job_id=job,
        commitment_id=commitment,
        deleted_commitment_id=deleted_commitment,
        event_id=event,
        deleted_event_id=deleted_event,
    )


def counts(db: psycopg.Connection, user_id: UUID) -> dict[str, int]:
    result: dict[str, int] = {}
    for table, column in USER_COLUMN.items():
        result[table] = scalar(
            db,
            f"SELECT count(*) FROM app.{table} WHERE {column} = %s",  # noqa: S608 - constants
            user_id,
        )
    return result


@pytest.fixture
def user(api: TestClient, make_api_user: MakeApiUser, clock: FrozenClock) -> ApiUser:
    clock.set(NOW)
    created = make_api_user()
    response = api.patch("/me", json=TEST_PROFILE, headers=created.headers)
    assert response.status_code == 200, response.text
    return created


def _export(api: TestClient, user: ApiUser) -> dict[str, Any]:
    response = api.get("/me/export", headers=user.headers)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


# --- GET /me/export -------------------------------------------------------------------------


def test_export_has_the_documented_shape(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    filled = fill_account(db, user.id)

    body = _export(api, user)

    assert set(body) == {
        "format",
        "version",
        "exported_at",
        "profile",
        "exams",
        "tasks",
        "blocks",
        "topics",
        "materials",
        "analyses",
        "ai_usage",
        "xp_events",
        "badges",
        "commitments",
        "busy_events",
    }
    assert body["format"] == "studyflow-export"
    assert body["version"] == 1
    assert body["exported_at"] == "2026-11-16T05:00:00Z"
    me = api.get("/me", headers=user.headers).json()
    assert body["profile"] == {**me, "created_at": body["profile"]["created_at"]}
    assert body["profile"]["email"] == "student@example.com"
    assert body["profile"]["created_at"] is not None

    exams = {exam["id"]: exam for exam in body["exams"]}
    assert set(exams) == {str(filled.exam_id), str(filled.deleted_exam_id)}
    assert set(exams[str(filled.exam_id)]) == {
        "id",
        "name",
        "exam_date",
        "difficulty",
        "color_index",
        "deleted_at",
        "created_at",
    }
    assert exams[str(filled.exam_id)]["deleted_at"] is None
    assert exams[str(filled.deleted_exam_id)]["deleted_at"] is not None
    assert exams[str(filled.exam_id)]["exam_date"] == "2026-12-20"

    tasks = {task["id"]: task for task in body["tasks"]}
    assert set(tasks) == {str(filled.task_id), str(filled.deleted_task_id)}
    assert tasks[str(filled.deleted_task_id)]["deleted_at"] is not None
    assert set(tasks[str(filled.task_id)]) == {
        "id",
        "exam_id",
        "title",
        "kind",
        "estimated_minutes",
        "focus",
        "depends_on_task_id",
        "status",
        "source",
        "topic_id",
        "material_id",
        "position",
        "analysis_id",
        "deleted_at",
        "created_at",
    }

    (block,) = body["blocks"]
    assert block["id"] == str(filled.block_id)
    assert set(block) == {
        "id",
        "task_id",
        "starts_at",
        "ends_at",
        "part_index",
        "part_count",
        "pinned",
        "status",
        "created_at",
    }
    (topic,) = body["topics"]
    assert topic["id"] == str(filled.topic_id)
    assert set(topic) == {
        "id",
        "exam_id",
        "name",
        "weight",
        "evidence",
        "position",
        "analysis_id",
        "created_at",
    }
    (material,) = body["materials"]
    assert set(material) == {
        "id",
        "exam_id",
        "filename",
        "kind",
        "mime",
        "size_bytes",
        "page_count",
        "scanned_pages",
        "ingest_status",
        "ingest_error",
        "warnings",
        "created_at",
        "ingested_at",
    }
    assert material["id"] == str(filled.material_id)
    (analysis,) = body["analyses"]
    assert set(analysis) == {
        "id",
        "exam_id",
        "status",
        "error",
        "output",
        "warnings",
        "dropped",
        "total_minutes",
        "budget_minutes",
        "created_at",
        "applied_at",
        "undone_at",
    }
    assert analysis["output"] == {"tasks": [{"title": "T", "reason": "because"}]}
    (usage,) = body["ai_usage"]
    assert usage == {
        "model": "claude-test",
        "input_tokens": 100,
        "output_tokens": 20,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "exam_id": str(filled.exam_id),
        "created_at": usage["created_at"],
    }
    (event,) = body["xp_events"]
    assert event == {
        "id": event["id"],
        "block_id": str(filled.block_id),
        "xp": 50,
        "study_date": "2026-11-16",
        "created_at": event["created_at"],
    }
    (badge,) = body["badges"]
    assert badge == {"badge_key": "first_task", "earned_at": badge["earned_at"]}

    commitments = {item["id"]: item for item in body["commitments"]}
    assert set(commitments) == {str(filled.commitment_id), str(filled.deleted_commitment_id)}
    commitment = commitments[str(filled.commitment_id)]
    assert commitment == {
        "id": str(filled.commitment_id),
        "title": "עבודה",
        "kind": "work",
        "weekday": 1,
        "start_time": "16:00:00",
        "end_time": "22:00:00",
        "valid_from": "2026-11-01",
        "valid_until": "2027-01-10",
        "source_job_id": str(filled.job_id),
        "created_at": commitment["created_at"],
        "deleted_at": None,
    }
    assert commitments[str(filled.deleted_commitment_id)]["deleted_at"] is not None
    events = {item["id"]: item for item in body["busy_events"]}
    assert set(events) == {str(filled.event_id), str(filled.deleted_event_id)}
    event = events[str(filled.event_id)]
    assert event == {
        "id": str(filled.event_id),
        "title": "חתונה",
        "starts_at": "2026-11-19T18:00:00Z",
        "ends_at": "2026-11-19T23:00:00Z",
        "created_at": event["created_at"],
        "deleted_at": None,
    }
    assert events[str(filled.deleted_event_id)]["title"] is None
    assert events[str(filled.deleted_event_id)]["deleted_at"] is not None


def test_export_profile_carries_the_hobby_from_the_commitments(
    api: TestClient, user: ApiUser
) -> None:
    response = api.patch(
        "/me", json={"hobby_start": "18:30", "hobby_minutes": 90}, headers=user.headers
    )
    assert response.status_code == 200, response.text

    body = _export(api, user)

    assert (body["profile"]["hobby_start"], body["profile"]["hobby_minutes"]) == ("18:30", 90)
    me = api.get("/me", headers=user.headers).json()
    assert body["profile"] == {**me, "created_at": body["profile"]["created_at"]}
    assert len(body["commitments"]) == 7


def test_export_never_carries_extracted_text_or_storage_paths(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    filled = fill_account(db, user.id)

    response = api.get("/me/export", headers=user.headers)

    assert response.status_code == 200
    raw = response.text
    assert TEXT_SENTINEL not in raw
    assert filled.storage_path not in raw
    assert "text_by_page" not in raw
    assert "storage_path" not in raw
    # Internal columns stay out as well.
    assert "material_keys" not in raw
    assert "internal" not in raw
    assert "plan_version_id" not in raw


def test_export_is_an_attachment_named_by_the_local_day(
    api: TestClient, db: psycopg.Connection, user: ApiUser, clock: FrozenClock
) -> None:
    # 23:30 UTC on the 16th is already the 17th in Jerusalem.
    db.execute("UPDATE app.profiles SET timezone = 'Asia/Jerusalem' WHERE id = %s", (user.id,))
    clock.set(NOW.replace(hour=23, minute=30))

    response = api.get("/me/export", headers=user.headers)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert (
        response.headers["content-disposition"]
        == 'attachment; filename="studyflow-export-2026-11-17.json"'
    )
    assert response.json()["exported_at"] == "2026-11-16T23:30:00Z"


def test_export_holds_only_the_callers_rows(
    api: TestClient, db: psycopg.Connection, user: ApiUser, make_api_user: MakeApiUser
) -> None:
    mine = fill_account(db, user.id)
    other = make_api_user()
    theirs = fill_account(db, other.id)

    raw = api.get("/me/export", headers=other.headers).text

    for value in mine.ids() | {str(user.id)}:
        assert value not in raw
    assert str(theirs.exam_id) in raw


def test_export_works_for_a_user_without_a_profile(
    api: TestClient, make_api_user: MakeApiUser, clock: FrozenClock
) -> None:
    clock.set(NOW)
    fresh = make_api_user()

    body = _export(api, fresh)

    assert body["profile"]["id"] == str(fresh.id)
    assert body["exams"] == []
    assert body["ai_usage"] == []


def test_export_orders_rows_deterministically(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-12-20")
    for index in range(5):
        insert_task(db, user.id, exam, title=f"t{index}", created_at=NOW)

    first = _export(api, user)["tasks"]
    second = _export(api, user)["tasks"]

    assert first == second
    assert [task["id"] for task in first] == sorted(task["id"] for task in first)


# --- DELETE /me -----------------------------------------------------------------------------


def test_delete_me_empties_the_account_and_queues_one_job(
    api: TestClient, db: psycopg.Connection, user: ApiUser, make_api_user: MakeApiUser
) -> None:
    fill_account(db, user.id)
    other = make_api_user()
    fill_account(db, other.id)
    others_before = counts(db, other.id)

    response = api.delete("/me", headers=user.headers)

    assert response.status_code == 202, response.text
    body = response.json()
    assert set(body) == {"job_id"}
    job_id = UUID(body["job_id"])
    assert counts(db, user.id) == {**dict.fromkeys(USER_COLUMN, 0), "jobs": 1}
    row = db.execute(
        "SELECT id, kind, payload, status FROM app.jobs WHERE user_id = %s", (user.id,)
    ).fetchone()
    assert row == (job_id, JOB_DELETE_ACCOUNT, {}, "queued")
    assert counts(db, other.id) == others_before
    # The user in Auth stays until the worker deletes it.
    assert scalar(db, "SELECT count(*) FROM auth.users WHERE id = %s", user.id) == 1


def test_a_second_delete_replaces_the_queued_job(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    first = api.delete("/me", headers=user.headers)
    assert first.status_code == 202

    second = api.delete("/me", headers=user.headers)

    assert second.status_code == 202
    # delete_account_data() deletes the user's jobs too, the first delete_account included:
    # there is only ever one, the latest.
    rows = db.execute("SELECT id, kind FROM app.jobs WHERE user_id = %s", (user.id,)).fetchall()
    assert rows == [(UUID(second.json()["job_id"]), JOB_DELETE_ACCOUNT)]


def test_delete_me_needs_a_token(api: TestClient) -> None:
    assert api.delete("/me").status_code == 401
    assert api.get("/me/export").status_code == 401


def test_delete_me_takes_no_body_fields(api: TestClient, user: ApiUser) -> None:
    # A body is ignored; the route has no parameters to fill from it.
    response = api.request(
        "DELETE", "/me", headers=user.headers, content=json.dumps({"user_id": str(uuid4())})
    )
    assert response.status_code == 202
