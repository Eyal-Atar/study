"""POST /analyses/{id}/apply: preview a reanalysis draft, apply it, and undo it.

A draft replaces the exam's AI tasks that nothing was done in (todo, no done block); the
done, skipped and started AI tasks and the user's tasks stay. The preview runs the same
write in a transaction that is rolled back, so it shows exactly what the apply writes.
"""

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
    Z,
    insert_block,
    insert_exam,
    insert_material,
    insert_task,
    replan_apply,
    scalar,
    set_profile,
)
from tests.fixtures_db import ApiUser, FrozenClock

MakeApiUser = Callable[[], ApiUser]
Dump = dict[str, list[tuple[Any, ...]]]

# The 7 tasks of the sample output.
NEW_TITLES = [task["title"] for task in valid_output_dict()["tasks"]]


@pytest.fixture
def user(make_api_user: MakeApiUser, db: psycopg.Connection, clock: FrozenClock) -> ApiUser:
    created = make_api_user()
    set_profile(db, created.id, **TEST_PROFILE)
    clock.set(NOW)
    return created


@pytest.fixture
def exam(db: psycopg.Connection, user: ApiUser) -> UUID:
    return insert_exam(db, user.id, name="חדו״א", exam_date="2026-11-23")


def _ai_task(
    db: psycopg.Connection,
    user_id: UUID,
    exam_id: UUID,
    title: str,
    *,
    status: str = "todo",
    minutes: int = 60,
) -> UUID:
    task = insert_task(db, user_id, exam_id, title=title, status=status, minutes=minutes)
    db.execute("UPDATE app.tasks SET source = 'ai' WHERE id = %s", (task,))
    return task


def _draft(
    db: psycopg.Connection,
    user_id: UUID,
    exam_id: UUID,
    *,
    status: str = "draft",
    material_keys: dict[str, UUID] | None = None,
) -> UUID:
    row = db.execute(
        "INSERT INTO app.analyses (user_id, exam_id, status, output, material_keys, "
        "warnings, dropped, total_minutes, budget_minutes) "
        "VALUES (%s, %s, %s, %s, %s, '{}', '{}', 420, 600) RETURNING id",
        (
            user_id,
            exam_id,
            status,
            Jsonb(valid_output_dict()),
            Jsonb({key: str(value) for key, value in (material_keys or {}).items()}),
        ),
    ).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def _preview(api: TestClient, user: ApiUser, analysis: UUID) -> Any:
    return api.post(f"/analyses/{analysis}/apply", json={"preview": True}, headers=user.headers)


def _apply(api: TestClient, user: ApiUser, analysis: UUID, basis: str) -> Any:
    return api.post(
        f"/analyses/{analysis}/apply",
        json={"preview": False, "basis": basis},
        headers=user.headers,
    )


def _preview_ok(api: TestClient, user: ApiUser, analysis: UUID) -> dict[str, Any]:
    response = _preview(api, user, analysis)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _apply_ok(api: TestClient, user: ApiUser, analysis: UUID) -> dict[str, Any]:
    basis = _preview_ok(api, user, analysis)["basis"]
    response = _apply(api, user, analysis, basis)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _dump(db: psycopg.Connection, user_id: UUID) -> Dump:
    out: Dump = {}
    for table in ("tasks", "topics", "blocks", "plan_versions", "analyses"):
        out[table] = [
            tuple(row)
            for row in db.execute(
                f"SELECT * FROM app.{table} WHERE user_id = %s ORDER BY id",  # noqa: S608
                (user_id,),
            ).fetchall()
        ]
    return out


def _planned(db: psycopg.Connection, user_id: UUID) -> list[tuple[Any, ...]]:
    """The user's planned blocks that start from now on: (id, task, start, end)."""
    return [
        tuple(row)
        for row in db.execute(
            "SELECT id, task_id, starts_at, ends_at FROM app.blocks "
            "WHERE user_id = %s AND status = 'planned' AND starts_at >= %s ORDER BY id",
            (user_id, NOW),
        ).fetchall()
    ]


@pytest.fixture
def board(api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID) -> dict[str, UUID]:
    """One task of each kind the reanalysis must tell apart, placed by a replan."""
    tasks = {
        "replace": _ai_task(db, user.id, exam, "ישנה בלי התקדמות"),
        "started": _ai_task(db, user.id, exam, "ישנה שהתחילה"),
        "done": _ai_task(db, user.id, exam, "ישנה שנעשתה", status="done"),
        "skipped": _ai_task(db, user.id, exam, "ישנה שדולגה", status="skipped"),
        "user": insert_task(db, user.id, exam, title="של המשתמש"),
    }
    done_block = insert_block(
        db, user.id, tasks["started"], Z(2026, 11, 15, 9), Z(2026, 11, 15, 10), status="done"
    )
    assert done_block
    replan_apply(api, user)
    return tasks


def test_preview_writes_nothing(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID, board: dict[str, UUID]
) -> None:
    analysis = _draft(db, user.id, exam)
    before = _dump(db, user.id)
    body = _preview_ok(api, user, analysis)
    assert _dump(db, user.id) == before
    assert body["basis"]
    assert body["version_id"] is None
    assert body["replaced"] == [{"id": str(board["replace"]), "title": "ישנה בלי התקדמות"}]
    assert [item["title"] for item in body["added"]] == NEW_TITLES
    assert body["added_blocks"]
    assert body["removed_blocks"]


def test_apply_replaces_only_untouched_ai_tasks(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID, board: dict[str, UUID]
) -> None:
    analysis = _draft(db, user.id, exam)
    body = _apply_ok(api, user, analysis)

    deleted = {
        row[0]: row[1]
        for row in db.execute(
            "SELECT id, deleted_at FROM app.tasks WHERE user_id = %s AND analysis_id IS NULL",
            (user.id,),
        ).fetchall()
    }
    assert deleted[board["replace"]] == NOW
    for name in ("started", "done", "skipped", "user"):
        assert deleted[board[name]] is None, name
    assert body["replaced"] == [{"id": str(board["replace"]), "title": "ישנה בלי התקדמות"}]
    assert body["kept"] == 4
    assert [(item["title"], item["kind"], item["minutes"]) for item in body["added"]] == [
        (task["title"], task["kind"], task["minutes"]) for task in valid_output_dict()["tasks"]
    ]

    new_tasks = db.execute(
        "SELECT title, source, deleted_at FROM app.tasks WHERE user_id = %s AND analysis_id = %s",
        (user.id, analysis),
    ).fetchall()
    assert sorted(row[0] for row in new_tasks) == sorted(NEW_TITLES)
    assert {(row[1], row[2]) for row in new_tasks} == {("ai", None)}
    assert scalar(db, "SELECT count(*) FROM app.topics WHERE analysis_id = %s", analysis) == 3

    row = db.execute(
        "SELECT status, applied_at, replaced_task_ids FROM app.analyses WHERE id = %s",
        (analysis,),
    ).fetchone()
    assert row is not None
    assert (row[0], row[1], row[2]) == ("applied", NOW, [board["replace"]])

    version = db.execute(
        "SELECT id, reason, exam_id, analysis_id FROM app.plan_versions "
        "WHERE user_id = %s ORDER BY created_at DESC LIMIT 1",
        (user.id,),
    ).fetchone()
    assert version is not None
    assert (str(version[0]), version[1], version[2], version[3]) == (
        body["version_id"],
        "exam_reanalyzed",
        exam,
        analysis,
    )
    # The replaced task has no planned block left; the new ones were planned.
    assert not [b for b in _planned(db, user.id) if b[1] == board["replace"]]
    planned_tasks = {UUID(block["task_id"]) for block in body["added_blocks"]}
    new_ids = {
        r[0]
        for r in db.execute(
            "SELECT id FROM app.tasks WHERE analysis_id = %s", (analysis,)
        ).fetchall()
    }
    assert planned_tasks & new_ids
    plan = api.get("/plan", headers=user.headers)
    assert plan.json()["undo"]["reason"] == "exam_reanalyzed"


def _without_task_ids(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # The new tasks get new ids in each run.
    return [{k: v for k, v in item.items() if k not in ("task_id", "blocked_by")} for item in items]


def test_preview_matches_apply(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID, board: dict[str, UUID]
) -> None:
    analysis = _draft(db, user.id, exam)
    previewed = _preview_ok(api, user, analysis)
    response = _apply(api, user, analysis, previewed["basis"])
    assert response.status_code == 200, response.text
    applied = response.json()
    assert applied["version_id"] is not None
    assert applied["replaced"] == previewed["replaced"]
    assert applied["kept"] == previewed["kept"]
    assert _without_task_ids(applied["added"]) == _without_task_ids(previewed["added"])
    assert len(applied["added_blocks"]) == len(previewed["added_blocks"])
    # The new tasks get new ids in each run: compare the times of the added blocks.
    assert _without_task_ids(applied["added_blocks"]) == _without_task_ids(
        previewed["added_blocks"]
    )
    assert applied["removed_blocks"] == previewed["removed_blocks"]
    assert _without_task_ids(applied["unscheduled"]) == _without_task_ids(previewed["unscheduled"])
    assert applied["shortfalls"] == previewed["shortfalls"]


def test_stale_basis_writes_nothing(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID, board: dict[str, UUID]
) -> None:
    analysis = _draft(db, user.id, exam)
    basis = _preview_ok(api, user, analysis)["basis"]
    marked = api.patch(f"/tasks/{board['user']}", json={"status": "done"}, headers=user.headers)
    assert marked.status_code == 200, marked.text
    before = _dump(db, user.id)
    response = _apply(api, user, analysis, basis)
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "stale_plan"
    assert _dump(db, user.id) == before
    assert scalar(db, "SELECT status FROM app.analyses WHERE id = %s", analysis) == "draft"


def test_applied_draft_cannot_apply_again(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID, board: dict[str, UUID]
) -> None:
    analysis = _draft(db, user.id, exam)
    _apply_ok(api, user, analysis)
    before = _dump(db, user.id)
    preview = _preview(api, user, analysis)
    assert preview.status_code == 409, preview.text
    assert preview.json()["code"] == "invalid_state"
    response = _apply(api, user, analysis, "0" * 64)
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "invalid_state"
    assert _dump(db, user.id) == before


def test_superseded_draft_cannot_apply(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID, board: dict[str, UUID]
) -> None:
    analysis = _draft(db, user.id, exam, status="superseded")
    before = _dump(db, user.id)
    for response in (_preview(api, user, analysis), _apply(api, user, analysis, "0" * 64)):
        assert response.status_code == 409, response.text
        assert response.json()["code"] == "invalid_state"
    assert _dump(db, user.id) == before


def test_unknown_analysis_is_404(api: TestClient, user: ApiUser) -> None:
    response = _preview(api, user, UUID(int=1))
    assert response.status_code == 404, response.text
    assert response.json()["code"] == "not_found"


def test_draft_of_a_past_exam_cannot_apply(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    analysis = _draft(db, user.id, exam)
    db.execute("UPDATE app.exams SET exam_date = '2026-11-10' WHERE id = %s", (exam,))
    response = _preview(api, user, analysis)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "exam_in_past"


def test_draft_of_a_deleted_exam_is_404(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    analysis = _draft(db, user.id, exam)
    db.execute("UPDATE app.exams SET deleted_at = %s WHERE id = %s", (NOW, exam))
    response = _preview(api, user, analysis)
    assert response.status_code == 404, response.text
    assert response.json()["code"] == "not_found"


def test_started_and_pinned_blocks_stay(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    task = _ai_task(db, user.id, exam, "ישנה")
    half_hour = dt.timedelta(minutes=30)
    started = insert_block(
        db, user.id, task, NOW - half_hour, NOW + half_hour, part_index=1, part_count=2
    )
    pinned = insert_block(
        db,
        user.id,
        task,
        Z(2026, 11, 17, 8),
        Z(2026, 11, 17, 9),
        pinned=True,
        part_index=2,
        part_count=2,
    )
    analysis = _draft(db, user.id, exam)
    body = _apply_ok(api, user, analysis)
    ids = {
        row[0]
        for row in db.execute("SELECT id FROM app.blocks WHERE task_id = %s", (task,)).fetchall()
    }
    assert ids == {started}
    assert [block["id"] for block in body["removed_blocks"]] == [str(pinned)]
    assert body["replaced"] == [{"id": str(task), "title": "ישנה"}]


def test_undo_brings_back_the_old_tasks_and_blocks(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID, board: dict[str, UUID]
) -> None:
    analysis = _draft(db, user.id, exam)
    planned_before = _planned(db, user.id)
    assert [b for b in planned_before if b[1] == board["replace"]]
    body = _apply_ok(api, user, analysis)

    response = api.post("/plan/undo", json={"version_id": body["version_id"]}, headers=user.headers)
    assert response.status_code == 200, response.text

    assert scalar(db, "SELECT deleted_at FROM app.tasks WHERE id = %s", board["replace"]) is None
    new = db.execute(
        "SELECT id, deleted_at FROM app.tasks WHERE analysis_id = %s", (analysis,)
    ).fetchall()
    assert len(new) == len(NEW_TITLES)
    assert {row[1] for row in new} == {NOW}
    assert _planned(db, user.id) == planned_before
    row = db.execute(
        "SELECT status, undone_at FROM app.analyses WHERE id = %s", (analysis,)
    ).fetchone()
    assert row is not None
    assert (row[0], row[1]) == ("undone", NOW)
    # An undone draft is not a draft again.
    again = _preview(api, user, analysis)
    assert again.status_code == 409, again.text
    assert again.json()["code"] == "invalid_state"


def test_deleted_material_loses_its_link(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    syllabus = insert_material(db, user.id, exam, kind="syllabus", filename="סילבוס.pdf")
    past = insert_material(db, user.id, exam)
    analysis = _draft(db, user.id, exam, material_keys={"M1": syllabus, "M2": past})
    db.execute("DELETE FROM app.materials WHERE id = %s", (past,))
    _apply_ok(api, user, analysis)
    links = {
        row[0]: row[1]
        for row in db.execute(
            "SELECT kind, material_id FROM app.tasks WHERE analysis_id = %s "
            "AND kind IN ('review', 'simulation')",
            (analysis,),
        ).fetchall()
    }
    assert links == {"review": syllabus, "simulation": None}
