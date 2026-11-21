"""The S15 preferences on /me: the study start delay and its effect on the board through a
replan. The S15 hobby is gone from /me: since S35 it is commitments (/commitments), and S34
removed the compatibility fields."""

import datetime as dt
from collections.abc import Callable
from typing import Any

import psycopg
import pytest
from fastapi.testclient import TestClient

from tests.api.factories import (
    NOW,
    TEST_PROFILE,
    insert_exam,
    insert_task,
    replan_apply,
    set_profile,
)
from tests.fixtures_db import ApiUser, FrozenClock

MakeApiUser = Callable[[], ApiUser]


def _patch(api: TestClient, user: ApiUser, body: dict[str, Any]) -> Any:
    return api.patch("/me", json=body, headers=user.headers)


def test_defaults(api: TestClient, make_api_user: MakeApiUser) -> None:
    body = api.get("/me", headers=make_api_user().headers).json()
    assert body["study_start_delay_minutes"] == 60


def test_me_has_no_hobby_fields(api: TestClient, make_api_user: MakeApiUser) -> None:
    body = api.get("/me", headers=make_api_user().headers).json()
    assert "hobby_start" not in body
    assert "hobby_minutes" not in body


@pytest.mark.parametrize(
    ("body", "error"),
    [
        ({"hobby_start": "18:00", "hobby_minutes": 60}, "extra_forbidden"),
        ({"hobby_start": "18:00"}, "extra_forbidden"),
        ({"hobby_minutes": 60, "study_start_delay_minutes": 0}, "extra_forbidden"),
        # The old "turn it off" body: MePatch refuses a null before it looks at the names.
        ({"hobby_start": None, "hobby_minutes": None}, "value_error"),
    ],
)
def test_patch_me_rejects_hobby(
    api: TestClient,
    make_api_user: MakeApiUser,
    db: psycopg.Connection,
    body: dict[str, Any],
    error: str,
) -> None:
    # An unknown field like any other (MePatch forbids extras), and nothing is written:
    # neither a commitment nor the other fields of the same body.
    user = make_api_user()
    before = api.get("/me", headers=user.headers).json()
    response = _patch(api, user, body)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "validation_error"
    assert error in [item["type"] for item in response.json()["errors"]]
    assert api.get("/me", headers=user.headers).json() == before
    count = db.execute(
        "SELECT count(*) FROM app.commitments WHERE user_id = %s", (user.id,)
    ).fetchone()
    assert count == (0,)


def test_set_the_start_delay(api: TestClient, make_api_user: MakeApiUser) -> None:
    user = make_api_user()
    changed = _patch(api, user, {"study_start_delay_minutes": 0})
    assert changed.status_code == 200, changed.text
    assert changed.json()["study_start_delay_minutes"] == 0
    assert changed.json()["plan_affected"] is True
    assert _patch(api, user, {"study_start_delay_minutes": 0}).json()["plan_affected"] is False
    assert _patch(api, user, {"study_start_delay_minutes": 360}).status_code == 200


@pytest.mark.parametrize(
    "body",
    [
        {"study_start_delay_minutes": -1},
        {"study_start_delay_minutes": 361},
        {"study_start_delay_minutes": None},
        {"display_name": None},
    ],
)
def test_invalid_preferences(
    api: TestClient, make_api_user: MakeApiUser, body: dict[str, Any]
) -> None:
    user = make_api_user()
    before = api.get("/me", headers=user.headers).json()
    response = _patch(api, user, body)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert api.get("/me", headers=user.headers).json() == before


# The board: TEST_PROFILE is UTC, awake 06:00-23:00, morning and afternoon, 240 minutes a
# day and no rest days; with the default delay studying runs 07:00-17:00.


@pytest.fixture
def user(make_api_user: MakeApiUser, db: psycopg.Connection, clock: FrozenClock) -> ApiUser:
    created = make_api_user()
    set_profile(db, created.id, **TEST_PROFILE)
    clock.set(NOW)
    return created


def _planned(db: psycopg.Connection) -> list[tuple[dt.datetime, dt.datetime]]:
    rows = db.execute(
        "SELECT starts_at, ends_at FROM app.blocks WHERE status = 'planned' ORDER BY starts_at"
    ).fetchall()
    return [(row[0].astimezone(dt.UTC), row[1].astimezone(dt.UTC)) for row in rows]


def _board(api: TestClient, user: ApiUser, db: psycopg.Connection) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    for _ in range(4):
        insert_task(db, user.id, exam, minutes=120)
    replan_apply(api, user)


def test_a_longer_start_delay_moves_the_first_block_of_the_day(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    _board(api, user, db)
    first = min(start for start, _ in _planned(db) if start.date() == dt.date(2026, 11, 17))
    assert first.time() == dt.time(7)

    response = _patch(api, user, {"study_start_delay_minutes": 180})
    assert response.json()["plan_affected"] is True
    replan_apply(api, user)

    days: dict[dt.date, dt.datetime] = {}
    for start, _ in _planned(db):
        days.setdefault(start.date(), start)
    # Studying now starts at 09:00; a block still valid (from 09:00 on) stays where it is.
    assert dt.date(2026, 11, 17) in days
    assert all(start.time() >= dt.time(9) for start in days.values())
