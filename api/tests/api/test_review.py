"""The morning review (S18): GET /review, POST /blocks/{id}/reschedule and /skip, and undo."""

import datetime as dt
from collections.abc import Callable
from typing import Any
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

from tests.api.factories import (
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

# Monday 2026-11-16, 13:00 UTC: the morning is over, the afternoon window is open.
NOON = Z(2026, 11, 16, 13)


@pytest.fixture
def user(make_api_user: MakeApiUser, db: psycopg.Connection, clock: FrozenClock) -> ApiUser:
    created = make_api_user()
    set_profile(db, created.id, **TEST_PROFILE)
    clock.set(NOON)
    return created


def _review(api: TestClient, user: ApiUser) -> list[dict[str, Any]]:
    response = api.get("/review", headers=user.headers)
    assert response.status_code == 200, response.text
    blocks: list[dict[str, Any]] = response.json()["blocks"]
    return blocks


def _post(api: TestClient, user: ApiUser, block: UUID, action: str, body: Any = None) -> Any:
    return api.post(f"/blocks/{block}/{action}", json=body, headers=user.headers)


def _undo(api: TestClient, user: ApiUser, version_id: str) -> Any:
    response = api.post("/plan/undo", json={"version_id": version_id}, headers=user.headers)
    assert response.status_code == 200, response.text
    return response.json()


def _status(db: psycopg.Connection, block: UUID) -> str:
    return str(scalar(db, "SELECT status FROM app.blocks WHERE id = %s", block))


def _task_status(db: psycopg.Connection, task: UUID) -> str:
    return str(scalar(db, "SELECT status FROM app.tasks WHERE id = %s", task))


def _planned(db: psycopg.Connection, task: UUID) -> list[tuple[UUID, dt.datetime, dt.datetime]]:
    return [
        (row[0], row[1], row[2])
        for row in db.execute(
            "SELECT id, starts_at, ends_at FROM app.blocks "
            "WHERE task_id = %s AND status = 'planned' ORDER BY starts_at",
            (task,),
        ).fetchall()
    ]


def _all_blocks(db: psycopg.Connection, user_id: UUID) -> list[tuple[Any, ...]]:
    return [
        tuple(row)
        for row in db.execute(
            "SELECT id, task_id, starts_at, ends_at, status, pinned, part_index, part_count "
            "FROM app.blocks WHERE user_id = %s ORDER BY starts_at, id",
            (user_id,),
        ).fetchall()
    ]


def _version(db: psycopg.Connection, version_id: str) -> tuple[Any, ...]:
    row = db.execute(
        "SELECT reason, task_id, block_id, task_before FROM app.plan_versions WHERE id = %s",
        (version_id,),
    ).fetchone()
    assert row is not None
    return tuple(row)


# --- GET /review -------------------------------------------------------------------------


def test_review_lists_the_blocks_that_ended_without_a_mark(
    api: TestClient, make_api_user: MakeApiUser, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=600, title="לסקירה")
    this_morning = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    six_days_ago = insert_block(db, user.id, task, Z(2026, 11, 10, 9), Z(2026, 11, 10, 10))
    # Out: eight days old, done, missed, running now, still ahead.
    insert_block(db, user.id, task, Z(2026, 11, 8, 9), Z(2026, 11, 8, 10))
    insert_block(db, user.id, task, Z(2026, 11, 16, 10), Z(2026, 11, 16, 11), status="done")
    insert_block(db, user.id, task, Z(2026, 11, 15, 9), Z(2026, 11, 15, 10), status="missed")
    insert_block(db, user.id, task, Z(2026, 11, 16, 12, 30), Z(2026, 11, 16, 13, 30))
    insert_block(db, user.id, task, Z(2026, 11, 16, 15), Z(2026, 11, 16, 16))
    # Out: a skipped task, a done task, a deleted task, a deleted exam, a passed exam.
    skipped = insert_task(db, user.id, exam, status="skipped")
    insert_block(db, user.id, skipped, Z(2026, 11, 14, 9), Z(2026, 11, 14, 10))
    done = insert_task(db, user.id, exam, status="done")
    insert_block(db, user.id, done, Z(2026, 11, 14, 11), Z(2026, 11, 14, 12))
    deleted_task = insert_task(db, user.id, exam)
    insert_block(db, user.id, deleted_task, Z(2026, 11, 13, 9), Z(2026, 11, 13, 10))
    db.execute("UPDATE app.tasks SET deleted_at = now() WHERE id = %s", (deleted_task,))
    gone = insert_exam(db, user.id, exam_date="2026-11-20", deleted=True)
    gone_task = insert_task(db, user.id, gone)
    insert_block(db, user.id, gone_task, Z(2026, 11, 13, 11), Z(2026, 11, 13, 12))
    passed = insert_exam(db, user.id, exam_date="2026-11-15")
    passed_task = insert_task(db, user.id, passed)
    insert_block(db, user.id, passed_task, Z(2026, 11, 12, 9), Z(2026, 11, 12, 10))
    # Out: another user's overdue block.
    other = make_api_user()
    set_profile(db, other.id, **TEST_PROFILE)
    other_exam = insert_exam(db, other.id, exam_date="2026-11-20")
    other_task = insert_task(db, other.id, other_exam)
    insert_block(db, other.id, other_task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))

    blocks = _review(api, user)
    assert [block["id"] for block in blocks] == [str(six_days_ago), str(this_morning)]
    assert all(block["state"] == "overdue" for block in blocks)
    assert blocks[1]["task_title"] == "לסקירה"
    assert blocks[1]["study_date"] == "2026-11-16"
    assert blocks[0]["study_date"] == "2026-11-10"


def test_review_counts_study_days_in_the_profile_timezone(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    # Jerusalem is UTC+2 in November: 04:00 UTC on the 10th is 06:00 there, the 10th's
    # wake-up (in UTC it would be asleep, on the study day of the 9th: out of the review).
    set_profile(db, user.id, timezone="Asia/Jerusalem")
    clock.set(Z(2026, 11, 16, 11))  # 13:00 in Jerusalem
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=600)
    in_window = insert_block(db, user.id, task, Z(2026, 11, 10, 4), Z(2026, 11, 10, 5))
    insert_block(db, user.id, task, Z(2026, 11, 9, 18), Z(2026, 11, 9, 19))

    assert [block["id"] for block in _review(api, user)] == [str(in_window)]


def test_review_is_empty_without_overdue_blocks(api: TestClient, user: ApiUser) -> None:
    assert _review(api, user) == []


# --- POST /blocks/{id}/reschedule --------------------------------------------------------


def test_reschedule_moves_the_minutes_to_later_today_and_undo_brings_it_back(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))

    response = _post(api, user, block, "reschedule")
    assert response.status_code == 200, response.text
    body = response.json()
    assert _status(db, block) == "missed"
    new = _planned(db, task)
    assert len(new) == 1
    new_id, starts_at, ends_at = new[0]
    assert NOON <= starts_at and ends_at <= Z(2026, 11, 16, 23)
    assert [b["id"] for b in body["blocks"]] == [str(new_id)]
    assert body["blocks"][0]["study_date"] == "2026-11-16"
    assert _version(db, body["version_id"])[:3] == ("review_moved", task, block)
    assert _review(api, user) == []

    _undo(api, user, body["version_id"])
    assert _status(db, block) == "planned"
    assert _planned(db, task) == [(block, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))]
    assert [b["id"] for b in _review(api, user)] == [str(block)]


def test_reschedule_today_only_when_today_is_full_changes_nothing(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    # The rest of today's afternoon window, and of today's study minutes, is taken.
    busy = insert_task(db, user.id, exam, minutes=240, title="תופסת")
    insert_block(db, user.id, busy, Z(2026, 11, 16, 13), Z(2026, 11, 16, 17), pinned=True)
    before = _all_blocks(db, user.id)

    for body in (None, {"today_only": True}):
        response = _post(api, user, block, "reschedule", body)
        assert response.status_code == 409, response.text
        problem = response.json()
        assert problem["code"] == "placement_failed"
        assert problem["reason"] == "no_time_today"
        assert problem["blocked_by"] is None
        assert _all_blocks(db, user.id) == before
        assert scalar(db, "SELECT count(*) FROM app.plan_versions WHERE user_id = %s", user.id) == 0

    response = _post(api, user, block, "reschedule", {"today_only": False})
    assert response.status_code == 200, response.text
    assert _status(db, block) == "missed"
    new = _planned(db, task)
    assert len(new) == 1
    assert new[0][1] >= Z(2026, 11, 17)
    assert response.json()["blocks"][0]["study_date"] == "2026-11-17"


def test_reschedule_that_cannot_be_placed_is_placement_failed(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    # The exam is today, and today is full: there is nowhere to go.
    exam = insert_exam(db, user.id, exam_date="2026-11-16")
    task = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    busy = insert_task(db, user.id, exam, minutes=240, title="תופסת")
    insert_block(db, user.id, busy, Z(2026, 11, 16, 13), Z(2026, 11, 16, 17), pinned=True)
    before = _all_blocks(db, user.id)

    response = _post(api, user, block, "reschedule", {"today_only": False})
    assert response.status_code == 409, response.text
    problem = response.json()
    assert problem["code"] == "placement_failed"
    assert problem["reason"] != "no_time_today"
    assert "blocked_by" in problem
    assert _all_blocks(db, user.id) == before
    assert scalar(db, "SELECT count(*) FROM app.plan_versions WHERE user_id = %s", user.id) == 0


def test_reschedule_of_a_covered_task_still_writes_a_version(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(
        db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10), part_index=1, part_count=2
    )
    # A replan already placed the task's minutes again tomorrow.
    tomorrow = insert_block(
        db, user.id, task, Z(2026, 11, 17, 9), Z(2026, 11, 17, 10), part_index=2, part_count=2
    )

    response = _post(api, user, block, "reschedule")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["version_id"] is not None
    assert _status(db, block) == "missed"
    assert _planned(db, task) == [(tomorrow, Z(2026, 11, 17, 9), Z(2026, 11, 17, 10))]
    assert [b["id"] for b in body["blocks"]] == [str(tomorrow)]
    assert _version(db, body["version_id"])[:3] == ("review_moved", task, block)

    _undo(api, user, body["version_id"])
    assert _status(db, block) == "planned"
    assert _planned(db, task) == [
        (block, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10)),
        (tomorrow, Z(2026, 11, 17, 9), Z(2026, 11, 17, 10)),
    ]


def test_reschedule_of_an_older_block_outside_the_board_window(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    # Three days old: past the board's 48h lookback, still in the review.
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 13, 9), Z(2026, 11, 13, 10))
    assert [b["id"] for b in _review(api, user)] == [str(block)]

    response = _post(api, user, block, "reschedule")
    assert response.status_code == 200, response.text
    assert _status(db, block) == "missed"
    _undo(api, user, response.json()["version_id"])
    assert _status(db, block) == "planned"


def test_reschedule_rejects_an_unknown_field(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    response = _post(api, user, block, "reschedule", {"today_only": True, "extra": 1})
    assert response.status_code == 422
    assert _status(db, block) == "planned"


def test_reschedule_leaves_other_tasks_alone(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    other = insert_task(db, user.id, exam, minutes=60, title="אחרת")
    other_block = insert_block(db, user.id, other, Z(2026, 11, 16, 16), Z(2026, 11, 16, 17))

    response = _post(api, user, block, "reschedule")
    assert response.status_code == 200, response.text
    assert _planned(db, task)[0][1] < Z(2026, 11, 16, 16)
    assert _planned(db, other) == [(other_block, Z(2026, 11, 16, 16), Z(2026, 11, 16, 17))]
    _undo(api, user, response.json()["version_id"])
    assert _planned(db, other) == [(other_block, Z(2026, 11, 16, 16), Z(2026, 11, 16, 17))]


# --- POST /blocks/{id}/skip --------------------------------------------------------------


def test_skip_skips_the_task_and_undo_brings_it_all_back(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=120)
    block = insert_block(
        db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10), part_index=1, part_count=2
    )
    tomorrow = insert_block(
        db, user.id, task, Z(2026, 11, 17, 9), Z(2026, 11, 17, 10), part_index=2, part_count=2
    )
    other = insert_task(db, user.id, exam, minutes=60, title="אחרת")
    other_block = insert_block(db, user.id, other, Z(2026, 11, 16, 14), Z(2026, 11, 16, 15))

    response = _post(api, user, block, "skip")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["task_status"] == "skipped"
    assert _status(db, block) == "skipped"
    assert _task_status(db, task) == "skipped"
    assert _planned(db, task) == []
    assert _planned(db, other) == [(other_block, Z(2026, 11, 16, 14), Z(2026, 11, 16, 15))]
    assert _version(db, body["version_id"]) == ("review_skipped", task, block, {"status": "todo"})
    assert _review(api, user) == []

    _undo(api, user, body["version_id"])
    assert _task_status(db, task) == "todo"
    assert _status(db, block) == "planned"
    assert _planned(db, task) == [
        (block, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10)),
        (tomorrow, Z(2026, 11, 17, 9), Z(2026, 11, 17, 10)),
    ]
    assert _planned(db, other) == [(other_block, Z(2026, 11, 16, 14), Z(2026, 11, 16, 15))]
    assert [b["id"] for b in _review(api, user)] == [str(block)]


def test_skip_without_open_blocks_still_writes_a_version(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))

    response = _post(api, user, block, "skip")
    assert response.status_code == 200, response.text
    _undo(api, user, response.json()["version_id"])
    assert _task_status(db, task) == "todo"
    assert _status(db, block) == "planned"


def test_undo_does_not_revive_a_block_that_was_completed_since(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    response = _post(api, user, block, "reschedule")
    assert response.status_code == 200, response.text
    # Marking the missed block done (S09 allows it) writes no version.
    assert _post(api, user, block, "complete").status_code == 200
    _undo(api, user, response.json()["version_id"])
    assert _status(db, block) == "done"


# --- Refusals -----------------------------------------------------------------------------


@pytest.mark.parametrize("action", ["reschedule", "skip"])
def test_a_block_that_is_not_in_the_review_is_409(
    api: TestClient, user: ApiUser, db: psycopg.Connection, action: str
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=600)
    ahead = insert_block(db, user.id, task, Z(2026, 11, 16, 15), Z(2026, 11, 16, 16))
    running = insert_block(db, user.id, task, Z(2026, 11, 16, 12, 30), Z(2026, 11, 16, 13, 30))
    done = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10), status="done")
    missed = insert_block(
        db, user.id, task, Z(2026, 11, 16, 10), Z(2026, 11, 16, 11), status="missed"
    )
    finished = insert_task(db, user.id, exam, status="done")
    of_done_task = insert_block(db, user.id, finished, Z(2026, 11, 15, 9), Z(2026, 11, 15, 10))
    passed = insert_exam(db, user.id, exam_date="2026-11-15")
    passed_task = insert_task(db, user.id, passed)
    of_passed_exam = insert_block(db, user.id, passed_task, Z(2026, 11, 14, 9), Z(2026, 11, 14, 10))
    # Eight study days old: past the review's window, so GET /review does not list it.
    too_old = insert_block(db, user.id, task, Z(2026, 11, 9, 9), Z(2026, 11, 9, 10))
    assert str(too_old) not in [b["id"] for b in _review(api, user)]
    before = _all_blocks(db, user.id)

    for block in (ahead, running, done, missed, of_done_task, of_passed_exam, too_old):
        response = _post(api, user, block, action)
        assert response.status_code == 409, (block, response.text)
        assert response.json()["code"] == "invalid_state"
    assert _all_blocks(db, user.id) == before
    assert _task_status(db, task) == "todo"
    assert scalar(db, "SELECT count(*) FROM app.plan_versions WHERE user_id = %s", user.id) == 0


@pytest.mark.parametrize("action", ["reschedule", "skip"])
def test_a_block_of_a_deleted_task_or_exam_is_404(
    api: TestClient, user: ApiUser, db: psycopg.Connection, action: str
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    db.execute("UPDATE app.tasks SET deleted_at = now() WHERE id = %s", (task,))
    gone = insert_exam(db, user.id, exam_date="2026-11-20", deleted=True)
    gone_task = insert_task(db, user.id, gone)
    gone_block = insert_block(db, user.id, gone_task, Z(2026, 11, 16, 10), Z(2026, 11, 16, 11))

    for target in (block, gone_block, UUID(int=1)):
        response = _post(api, user, target, action)
        assert response.status_code == 404, response.text
        assert response.json()["code"] == "not_found"


def test_a_deleted_block_leaves_the_version_without_a_block(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    version = _post(api, user, block, "skip").json()["version_id"]
    db.execute("DELETE FROM app.blocks WHERE id = %s", (block,))
    assert _version(db, version)[1:3] == (task, None)
    # Undo still brings the task back.
    _undo(api, user, version)
    assert _task_status(db, task) == "todo"
