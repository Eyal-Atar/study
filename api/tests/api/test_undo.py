import datetime as dt
from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from tests.api.factories import (
    NOW,
    TEST_PROFILE,
    Z,
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


def _undo(api: TestClient, user: ApiUser, version_id: str | UUID) -> Any:
    return api.post("/plan/undo", json={"version_id": str(version_id)}, headers=user.headers)


def _future_blocks(
    db: psycopg.Connection, now: dt.datetime
) -> list[tuple[UUID, dt.datetime, dt.datetime]]:
    return [
        (row[0], row[1], row[2])
        for row in db.execute(
            "SELECT task_id, starts_at, ends_at FROM app.blocks "
            "WHERE status = 'planned' AND starts_at >= %s ORDER BY starts_at",
            (now,),
        ).fetchall()
    ]


def _snapshot_block(task_id: UUID, start: dt.datetime, end: dt.datetime) -> dict[str, Any]:
    return {
        "id": str(uuid4()),
        "task_id": str(task_id),
        "starts_at": start.isoformat(),
        "ends_at": end.isoformat(),
        "part_index": 1,
        "part_count": 1,
        "pinned": False,
    }


def test_undo_restores_the_blocks_before_the_change(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=120)
    replan_apply(api, user)
    after_a = _future_blocks(db, NOW)
    assert after_a
    db.execute("UPDATE app.tasks SET estimated_minutes = 240 WHERE id = %s", (task,))
    b = replan_apply(api, user)
    assert b["changed"] is True
    assert _future_blocks(db, NOW) != after_a

    response = _undo(api, user, b["version_id"])
    assert response.status_code == 200, response.text
    assert _future_blocks(db, NOW) == after_a
    assert scalar(db, "SELECT undone_at FROM app.plan_versions WHERE id = %s", b["version_id"])
    body = response.json()
    assert body["replaced"] == []
    assert body["unplaced"] == []


def test_only_the_latest_version_can_be_undone(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=120)
    a = replan_apply(api, user)
    db.execute("UPDATE app.tasks SET estimated_minutes = 240 WHERE id = %s", (task,))
    b = replan_apply(api, user)

    stale = _undo(api, user, a["version_id"])
    assert stale.status_code == 409
    assert stale.json()["code"] == "stale_plan"

    assert _undo(api, user, b["version_id"]).status_code == 200
    undone_a = _undo(api, user, a["version_id"])
    assert undone_a.status_code == 200, undone_a.text
    assert _future_blocks(db, NOW) == []

    again = _undo(api, user, a["version_id"])
    assert again.status_code == 409
    assert again.json()["code"] == "nothing_to_undo"


def test_undo_skips_blocks_of_finished_tasks_and_replaces_dropped(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    finished = insert_task(db, user.id, exam, minutes=60, status="done", title="הושלמה")
    gone = insert_task(db, user.id, exam, minutes=60, title="נמחקה לגמרי")
    late = insert_task(db, user.id, exam, minutes=60, title="השעה עברה")
    kept = insert_task(db, user.id, exam, minutes=60, title="חוזרת")
    snapshot = {
        "v": 1,
        "blocks": [
            _snapshot_block(late, Z(2026, 11, 16, 6, 0), Z(2026, 11, 16, 7, 0)),
            _snapshot_block(finished, Z(2026, 11, 16, 9, 0), Z(2026, 11, 16, 10, 0)),
            _snapshot_block(gone, Z(2026, 11, 16, 10, 30), Z(2026, 11, 16, 11, 30)),
            _snapshot_block(kept, Z(2026, 11, 16, 12, 0), Z(2026, 11, 16, 13, 0)),
        ],
    }
    version = scalar(
        db,
        "INSERT INTO app.plan_versions (user_id, reason, snapshot) "
        "VALUES (%s, 'replan', %s) RETURNING id",
        user.id,
        Jsonb(snapshot),
    )
    db.execute("DELETE FROM app.tasks WHERE id = %s", (gone,))
    clock.set(Z(2026, 11, 16, 8, 0))  # the block of `late` has passed

    response = _undo(api, user, version)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["restored"] == 1
    assert body["deleted"] == 0
    assert body["replaced"] == [str(late)]
    assert body["unplaced"] == []

    blocks = db.execute("SELECT task_id, starts_at FROM app.blocks ORDER BY starts_at").fetchall()
    by_task = {row[0]: row[1] for row in blocks}
    assert set(by_task) == {late, kept}
    assert by_task[kept] == Z(2026, 11, 16, 12, 0)
    assert by_task[late] >= Z(2026, 11, 16, 8, 0)
    assert scalar(db, "SELECT undone_at FROM app.plan_versions WHERE id = %s", version)
