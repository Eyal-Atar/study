"""Weekly commitments (S35): GET/POST/PATCH/DELETE /commitments.

A change to a commitment moves nothing and writes no plan version (plan decision 8): the
answer says plan_affected, and the web offers POST /plan/replan with a preview. The replan
then never leaves a planned block over a commitment.
"""

import datetime as dt
from collections.abc import Callable
from typing import Any
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from tests.api.factories import (
    NOW,
    TEST_PROFILE,
    Z,
    insert_exam,
    insert_task,
    replan_apply,
    replan_preview,
    scalar,
    set_profile,
)
from tests.fixtures_db import ApiUser, FrozenClock

MakeApiUser = Callable[[], ApiUser]

WORK: dict[str, Any] = {
    "title": "עבודה",
    "kind": "work",
    "weekday": 1,
    "start_time": "16:00",
    "end_time": "22:00",
}


@pytest.fixture
def user(make_api_user: MakeApiUser, db: psycopg.Connection, clock: FrozenClock) -> ApiUser:
    created = make_api_user()
    set_profile(db, created.id, **TEST_PROFILE)
    clock.set(NOW)
    return created


def _post(api: TestClient, user: ApiUser, body: dict[str, Any]) -> Any:
    return api.post("/commitments", json=body, headers=user.headers)


def _created(api: TestClient, user: ApiUser, body: dict[str, Any] | None = None) -> dict[str, Any]:
    response = _post(api, user, WORK if body is None else body)
    assert response.status_code == 201, response.text
    commitment: dict[str, Any] = response.json()["commitment"]
    return commitment


def _error_types(response: Any) -> list[tuple[list[Any], str]]:
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["code"] == "validation_error"
    return [(item["loc"], item["type"]) for item in body["errors"]]


# --- POST -----------------------------------------------------------------------------------


def test_post_creates_a_commitment_from_local_today(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    response = _post(api, user, WORK)

    assert response.status_code == 201, response.text
    body = response.json()
    assert set(body) == {"commitment", "plan_affected"}
    assert body["plan_affected"] is True
    commitment = body["commitment"]
    assert commitment == {
        "id": commitment["id"],
        "title": "עבודה",
        "kind": "work",
        "weekday": 1,
        "start_time": "16:00",
        "end_time": "22:00",
        "valid_from": "2026-11-16",
        "valid_until": None,
        "source_job_id": None,
        "created_at": commitment["created_at"],
    }
    # A setting, not a board change: no version, no block.
    assert scalar(db, "SELECT count(*) FROM app.plan_versions") == 0
    assert scalar(db, "SELECT count(*) FROM app.blocks") == 0


def test_valid_from_defaults_to_the_profiles_local_today(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    db.execute("UPDATE app.profiles SET timezone = 'Asia/Jerusalem' WHERE id = %s", (user.id,))
    clock.set(Z(2026, 11, 16, 23, 30))  # 01:30 on the 17th in Jerusalem

    assert _created(api, user)["valid_from"] == "2026-11-17"


def test_post_keeps_explicit_validity(api: TestClient, user: ApiUser) -> None:
    commitment = _created(
        api, user, {**WORK, "valid_from": "2026-11-01", "valid_until": "2027-01-10"}
    )
    assert commitment["valid_from"] == "2026-11-01"
    assert commitment["valid_until"] == "2027-01-10"


def test_a_commitment_may_cross_midnight(api: TestClient, user: ApiUser) -> None:
    commitment = _created(api, user, {**WORK, "start_time": "22:00", "end_time": "02:00"})
    assert (commitment["start_time"], commitment["end_time"]) == ("22:00", "02:00")
    # Exactly 15 minutes across midnight is enough.
    _created(api, user, {**WORK, "start_time": "23:50", "end_time": "00:05"})


@pytest.mark.parametrize(
    ("changes", "expected"),
    [
        ({"start_time": "10:00", "end_time": "10:14"}, (["body", "end_time"], "too_short")),
        ({"start_time": "23:55", "end_time": "00:05"}, (["body", "end_time"], "too_short")),
        (
            {"start_time": "10:00", "end_time": "10:00"},
            (["body", "end_time"], "same_as_start_time"),
        ),
        (
            {"valid_from": "2026-11-20", "valid_until": "2026-11-19"},
            (["body", "valid_until"], "before_valid_from"),
        ),
        # valid_from defaults to today (2026-11-16), so an earlier valid_until is refused.
        ({"valid_until": "2026-11-15"}, (["body", "valid_until"], "before_valid_from")),
    ],
)
def test_post_refuses_cross_field_errors(
    api: TestClient,
    user: ApiUser,
    db: psycopg.Connection,
    changes: dict[str, Any],
    expected: tuple[list[str], str],
) -> None:
    assert _error_types(_post(api, user, {**WORK, **changes})) == [expected]
    assert scalar(db, "SELECT count(*) FROM app.commitments") == 0


@pytest.mark.parametrize(
    "changes",
    [
        {"title": "שם\x00"},
        {"title": "   "},
        {"title": "א" * 101},
        {"kind": "hobby"},
        {"weekday": 7},
        {"weekday": -1},
        {"start_time": "10:00:30"},
        {"end_time": "25:00"},
        {"unknown": 1},
    ],
)
def test_post_refuses_invalid_fields(
    api: TestClient, user: ApiUser, changes: dict[str, Any]
) -> None:
    response = _post(api, user, {**WORK, **changes})
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "validation_error"


def test_post_refuses_past_the_limit(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    with db.cursor() as cursor:
        cursor.executemany(
            "INSERT INTO app.commitments (user_id, title, kind, weekday, start_time, end_time, "
            "valid_from) VALUES (%s, 'x', 'other', %s, '08:00', '09:00', '2026-11-01')",
            [(user.id, index % 7) for index in range(100)],
        )
    response = _post(api, user, WORK)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "too_many_commitments"
    assert response.json()["limit"] == 100

    # A deleted commitment does not count.
    db.execute(
        "UPDATE app.commitments SET deleted_at = now() WHERE id = "
        "(SELECT id FROM app.commitments WHERE user_id = %s LIMIT 1)",
        (user.id,),
    )
    assert _post(api, user, WORK).status_code == 201


# --- GET ------------------------------------------------------------------------------------


def test_get_lists_live_commitments_in_week_order(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    late = _created(api, user, {**WORK, "weekday": 3, "start_time": "18:00"})
    early = _created(api, user, {**WORK, "weekday": 3, "start_time": "08:00"})
    sunday = _created(api, user, {**WORK, "weekday": 0})
    gone = _created(api, user, {**WORK, "weekday": 2})
    assert api.delete(f"/commitments/{gone['id']}", headers=user.headers).status_code == 200

    response = api.get("/commitments", headers=user.headers)

    assert response.status_code == 200, response.text
    assert [item["id"] for item in response.json()["commitments"]] == [
        sunday["id"],
        early["id"],
        late["id"],
    ]


# --- PATCH ----------------------------------------------------------------------------------


def _patch(api: TestClient, user: ApiUser, commitment_id: str, body: dict[str, Any]) -> Any:
    return api.patch(f"/commitments/{commitment_id}", json=body, headers=user.headers)


def test_patch_of_the_title_or_kind_does_not_affect_the_plan(
    api: TestClient, user: ApiUser
) -> None:
    commitment = _created(api, user)

    response = _patch(api, user, commitment["id"], {"title": "משמרת", "kind": "other"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"commitment", "plan_affected"}
    assert body["plan_affected"] is False
    assert body["commitment"] == {**commitment, "title": "משמרת", "kind": "other"}


@pytest.mark.parametrize(
    "changes",
    [
        {"weekday": 2},
        {"start_time": "15:00"},
        {"end_time": "23:00"},
        {"valid_from": "2026-11-20"},
        {"valid_until": "2026-12-31"},
    ],
)
def test_patch_of_the_time_affects_the_plan(
    api: TestClient, user: ApiUser, db: psycopg.Connection, changes: dict[str, Any]
) -> None:
    commitment = _created(api, user)

    response = _patch(api, user, commitment["id"], changes)

    assert response.status_code == 200, response.text
    assert response.json()["plan_affected"] is True
    assert response.json()["commitment"] == {**commitment, **changes}
    assert scalar(db, "SELECT count(*) FROM app.plan_versions") == 0


def test_patch_that_sends_the_same_time_does_not_affect_the_plan(
    api: TestClient, user: ApiUser
) -> None:
    commitment = _created(api, user)
    response = _patch(api, user, commitment["id"], {"start_time": "16:00", "weekday": 1})
    assert response.status_code == 200, response.text
    assert response.json()["plan_affected"] is False


def test_patch_can_clear_valid_until(api: TestClient, user: ApiUser) -> None:
    commitment = _created(api, user, {**WORK, "valid_until": "2026-12-31"})
    response = _patch(api, user, commitment["id"], {"valid_until": None})
    assert response.status_code == 200, response.text
    assert response.json()["commitment"]["valid_until"] is None
    assert response.json()["plan_affected"] is True


@pytest.mark.parametrize(
    ("changes", "expected"),
    [
        # The merged row is checked: 16:00 and a new end 16:10.
        ({"end_time": "16:10"}, (["body", "end_time"], "too_short")),
        ({"start_time": "22:00"}, (["body", "end_time"], "same_as_start_time")),
        # valid_from is 2026-11-16.
        ({"valid_until": "2026-11-15"}, (["body", "valid_until"], "before_valid_from")),
    ],
)
def test_patch_validates_the_merged_row(
    api: TestClient, user: ApiUser, changes: dict[str, Any], expected: tuple[list[str], str]
) -> None:
    commitment = _created(api, user)
    assert _error_types(_patch(api, user, commitment["id"], changes)) == [expected]
    listed = api.get("/commitments", headers=user.headers).json()["commitments"]
    assert listed == [commitment]


@pytest.mark.parametrize(
    "body", [{}, {"title": None}, {"weekday": None}, {"title": "x\x00"}, {"start_time": "1:2:3"}]
)
def test_patch_refuses_invalid_bodies(api: TestClient, user: ApiUser, body: dict[str, Any]) -> None:
    commitment = _created(api, user)
    response = _patch(api, user, commitment["id"], body)
    assert response.status_code == 422, response.text


# --- DELETE ---------------------------------------------------------------------------------


def test_delete_is_soft_and_affects_the_plan(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    commitment = _created(api, user)

    response = api.delete(f"/commitments/{commitment['id']}", headers=user.headers)

    assert response.status_code == 200, response.text
    assert response.json() == {"plan_affected": True}
    assert scalar(
        db, "SELECT deleted_at IS NOT NULL FROM app.commitments WHERE id = %s", commitment["id"]
    )
    assert api.get("/commitments", headers=user.headers).json() == {"commitments": []}
    # Deleted is gone: every path by id answers 404.
    again = api.delete(f"/commitments/{commitment['id']}", headers=user.headers)
    assert again.status_code == 404
    assert _patch(api, user, commitment["id"], {"title": "x"}).status_code == 404
    assert scalar(db, "SELECT count(*) FROM app.plan_versions") == 0


def test_unknown_commitment_is_404(api: TestClient, user: ApiUser) -> None:
    unknown = uuid4()
    assert api.delete(f"/commitments/{unknown}", headers=user.headers).status_code == 404
    assert _patch(api, user, str(unknown), {"title": "x"}).status_code == 404


# --- Ownership ------------------------------------------------------------------------------


def test_another_user_cannot_see_or_change_a_commitment(
    api: TestClient, user: ApiUser, make_api_user: MakeApiUser, db: psycopg.Connection
) -> None:
    commitment = _created(api, user)
    other = make_api_user()
    before = db.execute("SELECT * FROM app.commitments ORDER BY id").fetchall()

    assert api.get("/commitments", headers=other.headers).json() == {"commitments": []}
    patched = api.patch(
        f"/commitments/{commitment['id']}", json={"title": "x"}, headers=other.headers
    )
    assert patched.status_code == 404
    assert patched.json()["code"] == "not_found"
    deleted = api.delete(f"/commitments/{commitment['id']}", headers=other.headers)
    assert deleted.status_code == 404

    assert db.execute("SELECT * FROM app.commitments ORDER BY id").fetchall() == before


# --- End to end -----------------------------------------------------------------------------


def _occurrences(commitments: list[dict[str, Any]], first: dt.date, days: int) -> list[Any]:
    """The UTC occurrences (the test profile is UTC) of the commitments over `days` days."""
    found: list[tuple[dt.datetime, dt.datetime]] = []
    for offset in range(-1, days):
        day = first + dt.timedelta(days=offset)
        sunday_weekday = (day.weekday() + 1) % 7
        for item in commitments:
            if item["weekday"] != sunday_weekday:
                continue
            start = dt.datetime.combine(day, dt.time.fromisoformat(item["start_time"]), dt.UTC)
            end = dt.datetime.combine(day, dt.time.fromisoformat(item["end_time"]), dt.UTC)
            if end <= start:
                end += dt.timedelta(days=1)
            found.append((start, end))
    return found


def test_after_a_replan_no_planned_block_overlaps_busy_time(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-22")
    for index in range(4):
        insert_task(db, user.id, exam, minutes=90, title=f"משימה {index}")
    replan_apply(api, user)
    assert scalar(db, "SELECT count(*) FROM app.blocks") > 0

    # Every morning taken, every day of the week, and a night shift that crosses midnight.
    commitments = [
        _created(
            api,
            user,
            {
                "title": "הרצאות",
                "kind": "class",
                "weekday": weekday,
                "start_time": "07:00",
                "end_time": "11:30",
            },
        )
        for weekday in range(7)
    ]
    commitments.append(
        _created(api, user, {**WORK, "weekday": 2, "start_time": "13:00", "end_time": "01:00"})
    )

    event = api.post(
        "/busy-events",
        json={"starts_at": "2026-11-19T11:30:00Z", "ends_at": "2026-11-19T17:00:00Z"},
        headers=user.headers,
    )
    assert event.status_code == 201, event.text

    preview = replan_preview(api, user)
    applied = replan_apply(api, user, preview["basis"])
    assert applied["changed"] is True

    blocks = db.execute(
        "SELECT starts_at, ends_at FROM app.blocks WHERE user_id = %s AND status = 'planned' "
        "AND ends_at > %s",
        (user.id, NOW),
    ).fetchall()
    assert blocks
    taken = [
        *_occurrences(commitments, NOW.date(), 10),
        (Z(2026, 11, 19, 11, 30), Z(2026, 11, 19, 17, 0)),
    ]
    for starts_at, ends_at in blocks:
        for start, end in taken:
            assert not (starts_at < end and start < ends_at), (starts_at, ends_at, start, end)
