"""The S15 preferences on /me: the study start delay and the daily hobby, and their effect
on the board through a replan."""

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
    replan_preview,
    set_profile,
)
from tests.fixtures_db import ApiUser, FrozenClock

MakeApiUser = Callable[[], ApiUser]


def _patch(api: TestClient, user: ApiUser, body: dict[str, Any]) -> Any:
    return api.patch("/me", json=body, headers=user.headers)


def test_defaults(api: TestClient, make_api_user: MakeApiUser) -> None:
    body = api.get("/me", headers=make_api_user().headers).json()
    assert body["study_start_delay_minutes"] == 60
    assert body["hobby_start"] is None
    assert body["hobby_minutes"] is None


def test_set_and_clear_the_hobby(api: TestClient, make_api_user: MakeApiUser) -> None:
    user = make_api_user()
    on = _patch(api, user, {"hobby_start": "18:30", "hobby_minutes": 90})
    assert on.status_code == 200, on.text
    assert on.json()["hobby_start"] == "18:30"
    assert on.json()["hobby_minutes"] == 90
    assert on.json()["plan_affected"] is True
    assert api.get("/me", headers=user.headers).json()["hobby_start"] == "18:30"

    same = _patch(api, user, {"hobby_start": "18:30", "hobby_minutes": 90})
    assert same.json()["plan_affected"] is False

    off = _patch(api, user, {"hobby_start": None, "hobby_minutes": None})
    assert off.status_code == 200, off.text
    assert off.json()["hobby_start"] is None
    assert off.json()["hobby_minutes"] is None
    assert off.json()["plan_affected"] is True


def test_set_the_start_delay(api: TestClient, make_api_user: MakeApiUser) -> None:
    user = make_api_user()
    changed = _patch(api, user, {"study_start_delay_minutes": 0})
    assert changed.status_code == 200, changed.text
    assert changed.json()["study_start_delay_minutes"] == 0
    assert changed.json()["plan_affected"] is True
    assert _patch(api, user, {"study_start_delay_minutes": 0}).json()["plan_affected"] is False
    assert _patch(api, user, {"study_start_delay_minutes": 360}).status_code == 200


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"hobby_start": "18:00"}, "hobby_minutes"),
        ({"hobby_minutes": 60}, "hobby_start"),
        ({"hobby_start": "18:00", "hobby_minutes": None}, "hobby_minutes"),
        ({"hobby_start": None, "hobby_minutes": 60}, "hobby_start"),
        ({"hobby_start": None}, "hobby_minutes"),
    ],
)
def test_the_hobby_fields_go_together(
    api: TestClient, make_api_user: MakeApiUser, body: dict[str, Any], field: str
) -> None:
    user = make_api_user()
    before = api.get("/me", headers=user.headers).json()
    response = _patch(api, user, body)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert ["body", field] in [error["loc"] for error in response.json()["errors"]]
    assert api.get("/me", headers=user.headers).json() == before


@pytest.mark.parametrize(
    "body",
    [
        {"study_start_delay_minutes": -1},
        {"study_start_delay_minutes": 361},
        {"study_start_delay_minutes": None},
        {"hobby_start": "18:00", "hobby_minutes": 14},
        {"hobby_start": "18:00", "hobby_minutes": 241},
        {"hobby_start": "18:00:30", "hobby_minutes": 60},
        {"hobby_start": "25:00", "hobby_minutes": 60},
        {"hobby_start": "18:00+02:00", "hobby_minutes": 60},
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


def test_a_new_hobby_moves_planned_blocks_out_of_its_time(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    _board(api, user, db)

    def in_hobby(start: dt.datetime, end: dt.datetime) -> bool:
        hobby_start = dt.datetime.combine(start.date(), dt.time(8), dt.UTC)
        return start < hobby_start + dt.timedelta(minutes=120) and hobby_start < end

    before = _planned(db)
    assert any(in_hobby(*block) for block in before)

    response = _patch(api, user, {"hobby_start": "08:00", "hobby_minutes": 120})
    assert response.json()["plan_affected"] is True
    previewed = replan_preview(api, user)
    assert previewed["removed"]
    replan_apply(api, user, previewed["basis"])

    after = _planned(db)
    assert len(after) >= len(before) - 1  # the same work, maybe in other parts
    assert sum((end - start for start, end in after), dt.timedelta()) == sum(
        (end - start for start, end in before), dt.timedelta()
    )
    assert not any(in_hobby(*block) for block in after)


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
