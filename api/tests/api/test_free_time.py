"""'I have time now' (S35): POST /plan/free-time.

The next tasks in line are placed from now on for the given minutes, pinned, and their
future blocks are released (plan decision 10). The study windows and the daily budget do not
apply to the session; busy time does. A version free_time is written, and undo deletes the
session's blocks and brings back the board as it was.
"""

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
    insert_exam,
    insert_task,
    replan_apply,
    scalar,
    set_profile,
)
from tests.fixtures_db import ApiUser, FrozenClock

MakeApiUser = Callable[[], ApiUser]

# Monday 18:00 UTC: past the afternoon window (12-17), so a replan plans from Tuesday.
EVENING = Z(2026, 11, 16, 18, 0)


@pytest.fixture
def user(make_api_user: MakeApiUser, db: psycopg.Connection, clock: FrozenClock) -> ApiUser:
    created = make_api_user()
    set_profile(db, created.id, **TEST_PROFILE)
    clock.set(EVENING)
    return created


def _free(api: TestClient, user: ApiUser, minutes: Any) -> Any:
    return api.post("/plan/free-time", json={"minutes": minutes}, headers=user.headers)


def _board(db: psycopg.Connection, user_id: UUID) -> list[tuple[Any, ...]]:
    return db.execute(
        "SELECT id, task_id, starts_at, ends_at, part_index, part_count, pinned, status "
        "FROM app.blocks WHERE user_id = %s ORDER BY starts_at, id",
        (user_id,),
    ).fetchall()


def _planned(api: TestClient, user: ApiUser, db: psycopg.Connection) -> tuple[UUID, UUID]:
    exam = insert_exam(db, user.id, exam_date="2026-11-22")
    first = insert_task(db, user.id, exam, minutes=60, title="ראשונה")
    second = insert_task(db, user.id, exam, minutes=60, title="שנייה")
    replan_apply(api, user)
    return first, second


def test_free_time_places_the_next_task_now_pinned(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    first, _ = _planned(api, user, db)
    old = {
        row[0]
        for row in db.execute("SELECT id FROM app.blocks WHERE task_id = %s", (first,)).fetchall()
    }
    assert old

    response = _free(api, user, 60)

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {
        "session_starts_at",
        "session_ends_at",
        "placed_task_ids",
        "blocks",
        "version_id",
    }
    assert body["session_starts_at"] == "2026-11-16T18:00:00Z"
    assert body["session_ends_at"] == "2026-11-16T19:00:00Z"
    assert body["placed_task_ids"] == [str(first)]
    (block,) = body["blocks"]
    assert block["task_id"] == str(first)
    assert block["starts_at"] == "2026-11-16T18:00:00Z"
    assert block["ends_at"] == "2026-11-16T19:00:00Z"
    assert block["pinned"] is True
    assert (block["part_index"], block["part_count"]) == (1, 1)
    # The task's earlier future blocks are released.
    for block_id in old:
        assert scalar(db, "SELECT count(*) FROM app.blocks WHERE id = %s", block_id) == 0
    assert (
        scalar(db, "SELECT reason FROM app.plan_versions WHERE id = %s", body["version_id"])
        == "free_time"
    )


def test_a_following_replan_does_not_move_the_session(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    _planned(api, user, db)
    body = _free(api, user, 60).json()
    (block,) = body["blocks"]

    clock.set(Z(2026, 11, 16, 18, 5))
    replan_apply(api, user)

    row = db.execute(
        "SELECT starts_at, ends_at, pinned FROM app.blocks WHERE id = %s", (block["id"],)
    ).fetchone()
    assert row == (Z(2026, 11, 16, 18, 0), Z(2026, 11, 16, 19, 0), True)


def test_undo_deletes_the_session_and_restores_the_board(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    _planned(api, user, db)
    before = _board(db, user.id)
    body = _free(api, user, 120).json()
    assert len(body["placed_task_ids"]) == 2
    assert _board(db, user.id) != before

    response = api.post("/plan/undo", json={"version_id": body["version_id"]}, headers=user.headers)

    assert response.status_code == 200, response.text
    assert _board(db, user.id) == before
    for block in body["blocks"]:
        assert scalar(db, "SELECT count(*) FROM app.blocks WHERE id = %s", block["id"]) == 0


def test_undo_after_the_session_started_takes_it_back_without_a_double_booking(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    """The session starts at once, so an undo a few minutes later meets a started block."""
    first, _ = _planned(api, user, db)
    before = _board(db, user.id)
    clock.set(EVENING + dt.timedelta(seconds=40))
    body = _free(api, user, 60).json()
    assert body["session_starts_at"] == "2026-11-16T18:01:00Z"
    clock.set(EVENING + dt.timedelta(minutes=5))

    response = api.post("/plan/undo", json={"version_id": body["version_id"]}, headers=user.headers)

    assert response.status_code == 200, response.text
    assert _board(db, user.id) == before
    planned = scalar(
        db,
        "SELECT coalesce(sum(extract(epoch FROM ends_at - starts_at) / 60), 0)::int "
        "FROM app.blocks WHERE task_id = %s AND status = 'planned'",
        first,
    )
    assert planned == 60


def test_undo_deletes_a_session_block_the_user_moved_since(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    _planned(api, user, db)
    before = _board(db, user.id)
    body = _free(api, user, 60).json()
    (block,) = body["blocks"]
    # Moved (still pinned and planned) after the session was made: part of what is undone.
    db.execute(
        "UPDATE app.blocks SET starts_at = %s, ends_at = %s WHERE id = %s",
        (Z(2026, 11, 16, 20, 0), Z(2026, 11, 16, 21, 0), block["id"]),
    )

    response = api.post("/plan/undo", json={"version_id": body["version_id"]}, headers=user.headers)

    assert response.status_code == 200, response.text
    assert _board(db, user.id) == before


def test_free_time_respects_busy_time(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    _planned(api, user, db)
    commitment = api.post(
        "/commitments",
        json={
            "title": "אימון",
            "kind": "other",
            "weekday": 1,
            "start_time": "18:00",
            "end_time": "18:45",
        },
        headers=user.headers,
    )
    assert commitment.status_code == 201, commitment.text

    body = _free(api, user, 120).json()

    assert body["blocks"]
    for block in body["blocks"]:
        if block["pinned"]:
            assert block["starts_at"] >= "2026-11-16T18:45:00Z"


def test_no_task_to_place_is_409_and_writes_nothing(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    response = _free(api, user, 60)
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "nothing_to_place"
    assert scalar(db, "SELECT count(*) FROM app.plan_versions") == 0


def test_no_free_time_is_409_and_writes_nothing(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    _planned(api, user, db)
    event = api.post(
        "/busy-events",
        json={
            "starts_at": EVENING.isoformat(),
            "ends_at": (EVENING + dt.timedelta(hours=3)).isoformat(),
        },
        headers=user.headers,
    )
    assert event.status_code == 201, event.text
    versions = scalar(db, "SELECT count(*) FROM app.plan_versions")
    before = _board(db, user.id)

    response = _free(api, user, 90)

    assert response.status_code == 409, response.text
    assert response.json()["code"] == "no_free_time"
    assert scalar(db, "SELECT count(*) FROM app.plan_versions") == versions
    assert _board(db, user.id) == before


@pytest.mark.parametrize("minutes", [29, 481, 0, -30, "abc", None, 60.5])
def test_minutes_must_be_30_to_480(api: TestClient, user: ApiUser, minutes: Any) -> None:
    response = _free(api, user, minutes)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "validation_error"


def test_the_body_is_strict(api: TestClient, user: ApiUser) -> None:
    assert api.post("/plan/free-time", json={}, headers=user.headers).status_code == 422
    extra = api.post("/plan/free-time", json={"minutes": 60, "x": 1}, headers=user.headers)
    assert extra.status_code == 422


@pytest.mark.parametrize("minutes", [30, 480])
def test_the_edges_are_accepted(
    api: TestClient, user: ApiUser, db: psycopg.Connection, minutes: int
) -> None:
    _planned(api, user, db)
    response = _free(api, user, minutes)
    assert response.status_code == 200, response.text


def test_free_time_touches_only_the_callers_board(
    api: TestClient, user: ApiUser, make_api_user: MakeApiUser, db: psycopg.Connection
) -> None:
    _planned(api, user, db)
    before = _board(db, user.id)
    other = make_api_user()
    set_profile(db, other.id, **TEST_PROFILE)

    response = _free(api, other, 60)

    assert response.status_code == 409
    assert response.json()["code"] == "nothing_to_place"
    assert _board(db, user.id) == before
