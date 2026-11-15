import datetime as dt
import threading
from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from app.auth import CurrentUser
from app.db.pool import Database
from app.domain.planner import Interval, PlannedBlock, PlanResult
from app.services.board import load_board
from app.services.plan_writes import VersionReason, apply_result, latest_version
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


def _version(
    db: psycopg.Connection,
    user: ApiUser,
    reason: str,
    snapshot: dict[str, Any],
    *,
    exam_id: UUID | None = None,
    task_id: UUID | None = None,
) -> UUID:
    version: UUID = scalar(
        db,
        "INSERT INTO app.plan_versions (user_id, reason, snapshot, exam_id, task_id) "
        "VALUES (%s, %s, %s, %s, %s) RETURNING id",
        user.id,
        reason,
        Jsonb(snapshot),
        exam_id,
        task_id,
    )
    return version


def _planned(db: psycopg.Connection, task: UUID) -> list[dt.datetime]:
    return [
        row[0]
        for row in db.execute(
            "SELECT starts_at FROM app.blocks WHERE task_id = %s AND status = 'planned' "
            "ORDER BY starts_at",
            (task,),
        ).fetchall()
    ]


def test_undo_of_exam_deleted_brings_the_exam_and_its_blocks_back(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20", deleted=True)
    task = insert_task(db, user.id, exam)
    start = Z(2026, 11, 16, 8, 0)
    snapshot = {"v": 1, "blocks": [_snapshot_block(task, start, Z(2026, 11, 16, 9, 0))]}
    version = _version(db, user, "exam_deleted", snapshot, exam_id=exam)
    response = _undo(api, user, version)
    assert response.status_code == 200, response.text
    assert response.json()["restored"] == 1
    assert scalar(db, "SELECT deleted_at FROM app.exams WHERE id = %s", exam) is None
    assert _planned(db, task) == [start]


def test_undo_of_task_deleted_brings_the_task_and_its_blocks_back(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam)
    db.execute("UPDATE app.tasks SET deleted_at = now() WHERE id = %s", (task,))
    start = Z(2026, 11, 16, 8, 0)
    snapshot = {"v": 1, "blocks": [_snapshot_block(task, start, Z(2026, 11, 16, 9, 0))]}
    version = _version(db, user, "task_deleted", snapshot, task_id=task)
    response = _undo(api, user, version)
    assert response.status_code == 200, response.text
    assert scalar(db, "SELECT deleted_at FROM app.tasks WHERE id = %s", task) is None
    assert _planned(db, task) == [start]


def test_undo_of_task_added_deletes_the_task_and_its_blocks(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam)
    insert_block(db, user.id, task, Z(2026, 11, 16, 8, 0), Z(2026, 11, 16, 9, 0))
    version = _version(db, user, "task_added", {"v": 1, "blocks": []}, task_id=task)
    response = _undo(api, user, version)
    assert response.status_code == 200, response.text
    assert response.json()["deleted"] == 1
    assert scalar(db, "SELECT deleted_at FROM app.tasks WHERE id = %s", task) is not None
    assert _planned(db, task) == []


def test_undo_of_a_corrupted_snapshot_is_409_and_changes_nothing(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam)
    db.execute("UPDATE app.tasks SET deleted_at = now() WHERE id = %s", (task,))
    version = _version(db, user, "task_deleted", {"v": 1, "blocks": [{"id": 1}]}, task_id=task)
    response = _undo(api, user, version)
    assert response.status_code == 409
    assert response.json()["code"] == "invalid_state"
    assert scalar(db, "SELECT deleted_at FROM app.tasks WHERE id = %s", task) is not None
    assert scalar(db, "SELECT undone_at FROM app.plan_versions WHERE id = %s", version) is None


def _add_block(database: Database, user: CurrentUser, task: UUID, start: dt.datetime) -> UUID:
    with database.transaction(user) as conn:
        board = load_board(conn, user.id, NOW, lock=True)
        return _apply_one(conn, user, board, task, start)


def _apply_one(conn: Any, user: CurrentUser, board: Any, task: UUID, start: dt.datetime) -> UUID:
    result = PlanResult(
        blocks=(
            PlannedBlock(
                task_id=task,
                interval=Interval(start, start + dt.timedelta(hours=1)),
                part_index=1,
                part_count=1,
            ),
        ),
        removed=(),
        unscheduled=(),
        warnings=(),
        shortfalls=(),
    )
    version = apply_result(conn, user.id, board, result, VersionReason.REPLAN)
    assert version is not None
    return version


def test_the_latest_version_is_the_last_written_not_the_first_started(
    database: Database, make_user: Callable[[], CurrentUser], db: psycopg.Connection
) -> None:
    user = make_user()
    set_profile(db, user.id, **TEST_PROFILE)
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    first_task = insert_task(db, user.id, exam)
    second_task = insert_task(db, user.id, exam)
    started = threading.Event()
    other_done = threading.Event()
    late: list[UUID] = []
    errors: list[BaseException] = []

    def slow() -> None:
        try:
            with database.transaction(user) as conn:
                started.set()  # the transaction (and its now()) has begun
                assert other_done.wait(5)
                board = load_board(conn, user.id, NOW, lock=True)
                late.append(_apply_one(conn, user, board, first_task, Z(2026, 11, 16, 8, 0)))
        except BaseException as error:  # reported to the test thread
            errors.append(error)

    thread = threading.Thread(target=slow)
    thread.start()
    assert started.wait(5)
    _add_block(database, user, second_task, Z(2026, 11, 16, 10, 0))
    other_done.set()
    thread.join(5)
    assert not thread.is_alive()
    assert errors == []
    with database.transaction(user) as conn:
        latest = latest_version(conn, user.id)
    assert latest is not None
    assert latest.id == late[0]


def _task_row(db: psycopg.Connection, task: UUID) -> tuple[Any, ...]:
    row = db.execute(
        "SELECT title, kind, estimated_minutes, focus, depends_on_task_id, status "
        "FROM app.tasks WHERE id = %s",
        (task,),
    ).fetchone()
    assert row is not None
    return tuple(row)


def _block_rows(db: psycopg.Connection, task: UUID) -> list[tuple[Any, ...]]:
    return [
        tuple(row)
        for row in db.execute(
            "SELECT id, starts_at, ends_at, part_index, part_count, status FROM app.blocks "
            "WHERE task_id = %s ORDER BY starts_at",
            (task,),
        ).fetchall()
    ]


def _unplaced(api: TestClient, user: ApiUser) -> list[Any]:
    response = api.get("/plan", headers=user.headers)
    assert response.status_code == 200, response.text
    unplaced: list[Any] = response.json()["unplaced"]
    return unplaced


def test_undo_of_marking_a_task_done_brings_the_task_and_its_block_back(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=60)
    insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    task_before, blocks_before = _task_row(db, task), _block_rows(db, task)

    done = api.patch(f"/tasks/{task}", json={"status": "done"}, headers=user.headers)
    assert done.status_code == 200, done.text
    assert done.json()["version_id"] is not None
    assert _block_rows(db, task) == []

    response = _undo(api, user, done.json()["version_id"])
    assert response.status_code == 200, response.text
    assert response.json()["restored"] == 1
    assert _task_row(db, task) == task_before
    assert _block_rows(db, task) == blocks_before
    assert _unplaced(api, user) == []


def test_undo_of_a_longer_estimate_brings_the_estimate_and_its_block_back(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=60)
    insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    task_before, blocks_before = _task_row(db, task), _block_rows(db, task)

    longer = api.patch(f"/tasks/{task}", json={"estimated_minutes": 180}, headers=user.headers)
    assert longer.status_code == 200, longer.text
    assert longer.json()["version_id"] is not None

    response = _undo(api, user, longer.json()["version_id"])
    assert response.status_code == 200, response.text
    assert _task_row(db, task) == task_before
    assert _block_rows(db, task) == blocks_before
    assert _unplaced(api, user) == []


def test_undo_of_a_task_change_drops_a_dependency_that_is_gone(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    first = insert_task(db, user.id, exam, minutes=60, title="קודמת")
    task = insert_task(db, user.id, exam, minutes=60, depends_on=first)
    insert_block(db, user.id, first, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    insert_block(db, user.id, task, Z(2026, 11, 16, 10, 30), Z(2026, 11, 16, 11, 30))

    changed = api.patch(
        f"/tasks/{task}", json={"depends_on_task_id": None, "focus": 8}, headers=user.headers
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["version_id"] is not None
    db.execute("UPDATE app.tasks SET deleted_at = now() WHERE id = %s", (first,))

    response = _undo(api, user, changed.json()["version_id"])
    assert response.status_code == 200, response.text
    assert _task_row(db, task)[3:] == (5, None, "todo")


def test_delete_of_an_exam_without_blocks_can_be_undone(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    deleted = api.delete(f"/exams/{exam}", headers=user.headers)
    assert deleted.status_code == 200, deleted.text
    version = deleted.json()["version_id"]
    assert version is not None
    assert scalar(db, "SELECT reason FROM app.plan_versions WHERE id = %s", version) == (
        "exam_deleted"
    )

    response = _undo(api, user, version)
    assert response.status_code == 200, response.text
    assert scalar(db, "SELECT deleted_at FROM app.exams WHERE id = %s", exam) is None


def test_deletes_without_blocks_undo_one_after_the_other(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, status="done")
    task_deleted = api.delete(f"/tasks/{task}", headers=user.headers)
    assert task_deleted.status_code == 200, task_deleted.text
    assert task_deleted.json()["version_id"] is not None
    exam_deleted = api.delete(f"/exams/{exam}", headers=user.headers)
    assert exam_deleted.status_code == 200, exam_deleted.text

    assert _undo(api, user, exam_deleted.json()["version_id"]).status_code == 200
    assert scalar(db, "SELECT deleted_at FROM app.exams WHERE id = %s", exam) is None
    assert _undo(api, user, task_deleted.json()["version_id"]).status_code == 200
    assert scalar(db, "SELECT deleted_at FROM app.tasks WHERE id = %s", task) is None


def test_a_task_of_a_deleted_exam_cannot_be_deleted_so_undo_of_the_exam_keeps_it(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, status="done")
    exam_deleted = api.delete(f"/exams/{exam}", headers=user.headers)
    assert exam_deleted.status_code == 200, exam_deleted.text
    assert api.delete(f"/tasks/{task}", headers=user.headers).status_code == 404

    assert _undo(api, user, exam_deleted.json()["version_id"]).status_code == 200
    assert scalar(db, "SELECT deleted_at FROM app.exams WHERE id = %s", exam) is None
    assert scalar(db, "SELECT deleted_at FROM app.tasks WHERE id = %s", task) is None


def test_undo_leaves_a_started_block_that_is_unchanged_where_it_is(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    first = insert_task(db, user.id, exam, minutes=120)
    insert_block(db, user.id, first, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    before = _block_rows(db, first)
    added = api.post(
        "/tasks",
        json={"exam_id": str(exam), "title": "נוספת", "kind": "learn", "estimated_minutes": 60},
        headers=user.headers,
    )
    assert added.status_code == 201, added.text
    assert _block_rows(db, first) == before
    clock.set(Z(2026, 11, 16, 9, 30))  # the block of `first` has started

    response = _undo(api, user, added.json()["version_id"])
    assert response.status_code == 200, response.text
    assert response.json()["replaced"] == []
    assert _block_rows(db, first) == before
