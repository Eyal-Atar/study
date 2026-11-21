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


def test_a_hobby_set_after_a_preview_makes_its_apply_stale(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    insert_task(db, user.id, exam, minutes=120)
    basis = replan_preview(api, user)["basis"]
    assert _patch(api, user, {"hobby_start": "18:30", "hobby_minutes": 90}).status_code == 200
    response = api.post(
        "/plan/replan", json={"preview": False, "basis": basis}, headers=user.headers
    )
    assert response.status_code == 409
    assert response.json()["code"] == "stale_plan"


# S35: the hobby is a view over the commitments (app/services/hobby.py).
def _live_hobby_rows(db: psycopg.Connection, user: ApiUser) -> int:
    row = db.execute(
        "SELECT count(*) FROM app.commitments WHERE user_id = %s AND deleted_at IS NULL "
        "AND title = 'Me time'",
        (user.id,),
    ).fetchone()
    assert row is not None
    return int(row[0])


def test_a_hobby_row_edited_elsewhere_is_replaced_without_piling_up(
    api: TestClient, make_api_user: MakeApiUser, db: psycopg.Connection
) -> None:
    user = make_api_user()
    _patch(api, user, {"hobby_start": "19:00", "hobby_minutes": 60})
    commitments = api.get("/commitments", headers=user.headers).json()["commitments"]
    assert len(commitments) == 7
    edited = api.patch(
        f"/commitments/{commitments[0]['id']}",
        json={"start_time": "20:00", "end_time": "21:00"},
        headers=user.headers,
    )
    assert edited.status_code == 200, edited.text
    # Six rows left at 19:00: no longer a whole set, so no hobby.
    assert api.get("/me", headers=user.headers).json()["hobby_start"] is None

    for _ in range(3):
        again = _patch(api, user, {"hobby_start": "19:00", "hobby_minutes": 60})
        assert again.status_code == 200, again.text
        assert again.json()["hobby_start"] == "19:00"
    # The six old rows at 19:00 were replaced, not added to: seven at 19:00, one at 20:00.
    assert _live_hobby_rows(db, user) == 8


def test_a_duplicate_hobby_row_does_not_hide_the_hobby(
    api: TestClient, make_api_user: MakeApiUser
) -> None:
    user = make_api_user()
    _patch(api, user, {"hobby_start": "19:00", "hobby_minutes": 60})
    extra = api.post(
        "/commitments",
        json={
            "title": "זמן לעצמי",
            "kind": "other",
            "weekday": 2,
            "start_time": "19:00",
            "end_time": "20:00",
        },
        headers=user.headers,
    )
    assert extra.status_code == 201, extra.text
    assert api.get("/me", headers=user.headers).json()["hobby_start"] == "19:00"


def test_a_legacy_titled_hobby_is_recognised_and_replaced_without_duplicates(
    api: TestClient, make_api_user: MakeApiUser, db: psycopg.Connection
) -> None:
    user = make_api_user()
    api.get("/me", headers=user.headers)
    # Rows written before 2026-11-21 carry the Hebrew title; there is no migration.
    db.execute(
        "INSERT INTO app.commitments (user_id, title, kind, weekday, start_time, end_time, "
        "valid_from) SELECT %s, 'זמן לעצמי', 'other', n, '19:00', '20:00', '2026-01-01' "
        "FROM generate_series(0, 6) AS n",
        (user.id,),
    )
    me = api.get("/me", headers=user.headers).json()
    assert me["hobby_start"] == "19:00"
    assert me["hobby_minutes"] == 60

    assert _patch(api, user, {"hobby_start": "19:00", "hobby_minutes": 90}).status_code == 200
    live = db.execute(
        "SELECT title, count(*) FROM app.commitments WHERE user_id = %s "
        "AND deleted_at IS NULL GROUP BY title",
        (user.id,),
    ).fetchall()
    assert [(row[0], row[1]) for row in live] == [("Me time", 7)]
    assert _patch(api, user, {"hobby_start": None, "hobby_minutes": None}).status_code == 200
    assert _live_hobby_rows(db, user) == 0


def test_me_time_survives_without_the_profile_columns(
    api: TestClient, make_api_user: MakeApiUser, db: psycopg.Connection
) -> None:
    # 0017 (S34) dropped profiles.hobby_start/hobby_minutes; Me time lives in the commitments.
    columns = db.execute(
        "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'app' "
        "AND table_name = 'profiles' AND column_name LIKE 'hobby%'"
    ).fetchone()
    assert columns == (0,)
    user = make_api_user()
    response = _patch(api, user, {"hobby_start": "20:00", "hobby_minutes": 60})
    assert response.status_code == 200, response.text
    me = api.get("/me", headers=user.headers).json()
    assert me["hobby_start"] == "20:00"
    assert me["hobby_minutes"] == 60
    assert _live_hobby_rows(db, user) == 7


def test_the_hobby_respects_the_commitment_limit(
    api: TestClient, make_api_user: MakeApiUser, db: psycopg.Connection
) -> None:
    user = make_api_user()
    api.get("/me", headers=user.headers)
    db.execute(
        "INSERT INTO app.commitments (user_id, title, kind, weekday, start_time, end_time, "
        "valid_from) SELECT %s, 'עבודה', 'work', n %% 7, '08:00', '09:00', '2026-01-01' "
        "FROM generate_series(1, 95) AS n",
        (user.id,),
    )
    response = _patch(api, user, {"hobby_start": "19:00", "hobby_minutes": 60})
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "too_many_commitments"
