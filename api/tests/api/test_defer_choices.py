"""POST /blocks/{id}/defer with a choice (S35): the next free slot, tomorrow, or a chosen time.

And GET /blocks/{id}/slots?date=, the times a block can be deferred to on a study day.
NOW is Monday 2026-11-16 05:00 UTC; the test profile is in UTC, awake 06:00-23:00, with the
default one-hour start delay, so a study day's planner time starts at 07:00.
"""

import datetime as dt
from collections.abc import Callable
from typing import Any
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

from tests.api.factories import (
    NOW,
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
MONDAY = 1  # weekday 0 is Sunday


@pytest.fixture
def user(make_api_user: MakeApiUser, db: psycopg.Connection, clock: FrozenClock) -> ApiUser:
    created = make_api_user()
    set_profile(db, created.id, **TEST_PROFILE)
    clock.set(NOW)
    return created


def _defer(api: TestClient, user: ApiUser, block: UUID, body: dict[str, Any] | None) -> Any:
    return api.post(f"/blocks/{block}/defer", json=body, headers=user.headers)


def _slots(api: TestClient, user: ApiUser, block: UUID, date: str | None = None) -> Any:
    params = {} if date is None else {"date": date}
    return api.get(f"/blocks/{block}/slots", params=params, headers=user.headers)


def _planned(
    db: psycopg.Connection, task: UUID
) -> list[tuple[UUID, dt.datetime, dt.datetime, bool]]:
    return [
        (row[0], row[1], row[2], row[3])
        for row in db.execute(
            "SELECT id, starts_at, ends_at, pinned FROM app.blocks "
            "WHERE task_id = %s AND status = 'planned' ORDER BY starts_at",
            (task,),
        ).fetchall()
    ]


def _instant(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value)


def _setup(
    db: psycopg.Connection, user: ApiUser, *, exam_date: str = "2026-11-25", minutes: int = 60
) -> tuple[UUID, UUID]:
    exam = insert_exam(db, user.id, exam_date=exam_date)
    return exam, insert_task(db, user.id, exam, minutes=minutes)


def _commitment(db: psycopg.Connection, user_id: UUID, weekday: int, start: str, end: str) -> None:
    db.execute(
        "INSERT INTO app.commitments (user_id, title, kind, weekday, start_time, end_time, "
        "valid_from) VALUES (%s, 'עבודה', 'work', %s, %s, %s, '2026-11-01')",
        (user_id, weekday, start, end),
    )


def _event(db: psycopg.Connection, user_id: UUID, start: dt.datetime, end: dt.datetime) -> None:
    db.execute(
        "INSERT INTO app.busy_events (user_id, title, starts_at, ends_at) "
        "VALUES (%s, 'חתונה', %s, %s)",
        (user_id, start, end),
    )


def _versions(db: psycopg.Connection) -> int:
    count: int = scalar(db, "SELECT count(*) FROM app.plan_versions")
    return count


# --- next and tomorrow ---------------------------------------------------------------------


def test_no_body_and_to_next_are_the_old_defer(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    response = _defer(api, user, block, None)
    assert response.status_code == 200, response.text
    first = _planned(db, task)
    assert [b[1] for b in first] != [Z(2026, 11, 16, 9)]
    assert all(start >= Z(2026, 11, 16, 10) for _, start, _, _ in first)
    assert not any(pinned for *_, pinned in first)

    again = _defer(api, user, first[0][0], {"to": "next"})
    assert again.status_code == 200, again.text
    assert all(start >= first[0][2] for _, start, _, _ in _planned(db, task))
    reasons = db.execute("SELECT reason FROM app.plan_versions ORDER BY created_at").fetchall()
    assert reasons == [("defer",), ("defer",)]


def test_next_with_not_before(api: TestClient, user: ApiUser, db: psycopg.Connection) -> None:
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    for body in ({"not_before": "2026-11-18T10:00:00Z"}, {"to": "next", "not_before": None}):
        response = _defer(api, user, block, body)
        assert response.status_code == 200, response.text
        block = _planned(db, task)[0][0]
    # The first defer went past 2026-11-18 10:00; the second only past that block.
    assert all(start >= Z(2026, 11, 18, 10) for _, start, _, _ in _planned(db, task))


def test_tomorrow_lands_on_the_next_study_day(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    clock.set(Z(2026, 11, 16, 8))
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))

    response = _defer(api, user, block, {"to": "tomorrow"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert [b["study_date"] for b in body["blocks"]] == ["2026-11-17"]
    # Not before tomorrow's planner start: wake-up 06:00 plus the hour's delay.
    assert _instant(body["blocks"][0]["starts_at"]) >= Z(2026, 11, 17, 7)
    assert body["blocks"][0]["pinned"] is False
    assert scalar(db, "SELECT reason FROM app.plan_versions WHERE id = %s", body["version_id"]) == (
        "defer"
    )


def test_tomorrow_before_waking_is_the_same_local_day(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    """At 05:00 the study day is still Sunday's, so tomorrow is Monday from 07:00."""
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 6), Z(2026, 11, 16, 7))
    response = _defer(api, user, block, {"to": "tomorrow"})
    assert response.status_code == 200, response.text
    start = _instant(response.json()["blocks"][0]["starts_at"])
    assert Z(2026, 11, 16, 7) <= start < Z(2026, 11, 16, 23)


def test_tomorrow_never_pulls_a_later_block_earlier(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    clock.set(Z(2026, 11, 16, 8))
    _, task = _setup(db, user)
    # Already on tomorrow's evening: "tomorrow" may only move it on, never earlier.
    block = insert_block(db, user.id, task, Z(2026, 11, 17, 17), Z(2026, 11, 17, 18))
    response = _defer(api, user, block, {"to": "tomorrow"})
    assert response.status_code == 200, response.text
    assert _instant(response.json()["blocks"][0]["starts_at"]) >= Z(2026, 11, 17, 18)


def test_tomorrow_skips_a_commitment(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    clock.set(Z(2026, 11, 16, 8))
    _commitment(db, user.id, 2, "06:00", "12:00")  # Tuesday morning
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    response = _defer(api, user, block, {"to": "tomorrow"})
    assert response.status_code == 200, response.text
    assert _instant(response.json()["blocks"][0]["starts_at"]) >= Z(2026, 11, 17, 12)


def test_tomorrow_after_the_exam_cannot_fit(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    clock.set(Z(2026, 11, 16, 8))
    _, task = _setup(db, user, exam_date="2026-11-17")
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    response = _defer(api, user, block, {"to": "tomorrow"})
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "placement_failed"
    assert [b[0] for b in _planned(db, task)] == [block]
    assert _versions(db) == 0


# --- at a chosen time ----------------------------------------------------------------------


def test_at_writes_a_pinned_block_of_the_same_length(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    _, task = _setup(db, user, minutes=90)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10, 30))

    response = _defer(api, user, block, {"to": "at", "starts_at": "2026-11-19T15:15:00Z"})
    assert response.status_code == 200, response.text
    body = response.json()
    rows = _planned(db, task)
    assert len(rows) == 1
    new_id, start, end, pinned = rows[0]
    assert new_id != block
    assert (start, end, pinned) == (Z(2026, 11, 19, 15, 15), Z(2026, 11, 19, 16, 45), True)
    assert [b["id"] for b in body["blocks"]] == [str(new_id)]
    assert body["blocks"][0]["pinned"] is True
    assert body["blocks"][0]["study_date"] == "2026-11-19"
    version = db.execute(
        "SELECT reason, task_id FROM app.plan_versions WHERE id = %s", (body["version_id"],)
    ).fetchone()
    assert version == ("defer_at", task)
    assert scalar(db, "SELECT plan_version_id FROM app.blocks WHERE id = %s", new_id) == UUID(
        body["version_id"]
    )


def test_at_renumbers_the_task_parts(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    _, task = _setup(db, user, minutes=120)
    first = insert_block(
        db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10), part_index=1, part_count=2
    )
    second = insert_block(
        db, user.id, task, Z(2026, 11, 17, 9), Z(2026, 11, 17, 10), part_index=2, part_count=2
    )
    response = _defer(api, user, first, {"to": "at", "starts_at": "2026-11-18T09:00:00Z"})
    assert response.status_code == 200, response.text
    parts = [(b["id"], b["part_index"], b["part_count"]) for b in response.json()["blocks"]]
    assert parts[0] == (str(second), 1, 2)
    assert parts[1][1:] == (2, 2)


def test_undo_of_at_brings_the_old_block_back(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    deferred = _defer(api, user, block, {"to": "at", "starts_at": "2026-11-17T15:00:00Z"})
    assert deferred.status_code == 200, deferred.text

    undone = api.post(
        "/plan/undo", json={"version_id": deferred.json()["version_id"]}, headers=user.headers
    )
    assert undone.status_code == 200, undone.text
    assert [(s, e, p) for _, s, e, p in _planned(db, task)] == [
        (Z(2026, 11, 16, 9), Z(2026, 11, 16, 10), False)
    ]


def test_at_a_started_block(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    clock.set(Z(2026, 11, 16, 9, 30))
    response = _defer(api, user, block, {"to": "at", "starts_at": "2026-11-16T20:00:00Z"})
    assert response.status_code == 200, response.text
    assert [(s, e, p) for _, s, e, p in _planned(db, task)] == [
        (Z(2026, 11, 16, 20), Z(2026, 11, 16, 21), True)
    ]


@pytest.mark.parametrize(
    "start",
    [
        pytest.param("2026-11-16T04:00:00Z", id="before_now"),
        pytest.param("2026-11-16T05:30:00Z", id="before_waking"),
        pytest.param("2026-11-16T22:30:00Z", id="past_sleep"),
        pytest.param("2026-11-19T03:00:00Z", id="asleep"),
        pytest.param("2026-11-25T09:00:00Z", id="exam_day"),
        pytest.param("2026-11-26T09:00:00Z", id="after_the_exam"),
        pytest.param("2026-11-17T09:00:30Z", id="not_a_whole_minute"),
    ],
)
def test_at_outside_a_study_day_is_422(
    api: TestClient, user: ApiUser, db: psycopg.Connection, start: str
) -> None:
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    response = _defer(api, user, block, {"to": "at", "starts_at": start})
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "outside_day"
    assert [b[0] for b in _planned(db, task)] == [block]
    assert _versions(db) == 0


def test_at_after_the_last_study_day_with_rest_days(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    set_profile(db, user.id, rest_days_before_exam=1)
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    rest_day = _defer(api, user, block, {"to": "at", "starts_at": "2026-11-24T09:00:00Z"})
    assert rest_day.status_code == 422, rest_day.text
    assert rest_day.json()["code"] == "outside_day"
    last = _defer(api, user, block, {"to": "at", "starts_at": "2026-11-23T21:00:00Z"})
    assert last.status_code == 200, last.text


def test_at_over_another_block_is_slot_taken(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam, task = _setup(db, user)
    other = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    neighbour = insert_block(db, user.id, other, Z(2026, 11, 17, 12), Z(2026, 11, 17, 13))
    response = _defer(api, user, block, {"to": "at", "starts_at": "2026-11-17T11:30:00Z"})
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "slot_taken"
    assert response.json()["blocked_by"] == str(neighbour)
    assert _versions(db) == 0
    # Touching it is allowed, like a move.
    touching = _defer(api, user, block, {"to": "at", "starts_at": "2026-11-17T11:00:00Z"})
    assert touching.status_code == 200, touching.text


def test_at_over_a_commitment_is_slot_busy(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    _commitment(db, user.id, 2, "14:00", "18:00")  # Tuesday
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    response = _defer(api, user, block, {"to": "at", "starts_at": "2026-11-17T13:30:00Z"})
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "slot_busy"
    assert [b[0] for b in _planned(db, task)] == [block]
    before = _defer(api, user, block, {"to": "at", "starts_at": "2026-11-17T13:00:00Z"})
    assert before.status_code == 200, before.text


def test_at_over_a_night_commitment_from_the_day_before(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    """A Monday night shift until 08:00 makes Tuesday 07:00 busy."""
    _commitment(db, user.id, MONDAY, "22:00", "08:00")
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    response = _defer(api, user, block, {"to": "at", "starts_at": "2026-11-17T07:00:00Z"})
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "slot_busy"


def test_at_over_an_event_is_slot_busy(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    _event(db, user.id, Z(2026, 11, 18, 18), Z(2026, 11, 18, 22))
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    response = _defer(api, user, block, {"to": "at", "starts_at": "2026-11-18T21:30:00Z"})
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "slot_busy"


def test_at_a_past_or_done_block_is_409(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    _, task = _setup(db, user, minutes=120)
    past = insert_block(db, user.id, task, Z(2026, 11, 15, 9), Z(2026, 11, 15, 10))
    done = insert_block(db, user.id, task, Z(2026, 11, 16, 6), Z(2026, 11, 16, 7), status="done")
    for block in (past, done):
        response = _defer(api, user, block, {"to": "at", "starts_at": "2026-11-17T15:00:00Z"})
        assert response.status_code == 409, response.text
        assert response.json()["code"] == "invalid_state"


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({"to": "at"}, id="at_without_starts_at"),
        pytest.param({"to": "at", "starts_at": None}, id="at_with_null_starts_at"),
        pytest.param({"starts_at": "2026-11-17T15:00:00Z"}, id="starts_at_without_at"),
        pytest.param(
            {"to": "tomorrow", "starts_at": "2026-11-17T15:00:00Z"}, id="tomorrow_with_starts_at"
        ),
        pytest.param(
            {"to": "tomorrow", "not_before": "2026-11-17T15:00:00Z"}, id="tomorrow_with_not_before"
        ),
        pytest.param(
            {"to": "at", "starts_at": "2026-11-17T15:00:00Z", "not_before": "2026-11-17T15:00:00Z"},
            id="at_with_not_before",
        ),
        pytest.param({"to": "later"}, id="unknown_choice"),
        pytest.param({"to": "at", "starts_at": "2026-11-17T15:00:00"}, id="naive_starts_at"),
        pytest.param({"to": "next", "extra": 1}, id="extra_field"),
    ],
)
def test_wrong_field_combinations_are_422(
    api: TestClient, user: ApiUser, db: psycopg.Connection, body: dict[str, Any]
) -> None:
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    response = _defer(api, user, block, body)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "validation_error"


def test_another_users_block_is_404(
    api: TestClient, user: ApiUser, make_api_user: MakeApiUser, db: psycopg.Connection
) -> None:
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    other = make_api_user()
    set_profile(db, other.id, **TEST_PROFILE)
    for body in ({"to": "tomorrow"}, {"to": "at", "starts_at": "2026-11-17T15:00:00Z"}):
        response = _defer(api, other, block, body)
        assert response.status_code == 404, response.text
    assert _slots(api, other, block, "2026-11-17").status_code == 404
    assert [b[0] for b in _planned(db, task)] == [block]


# --- slots of a study day ------------------------------------------------------------------


def test_slots_of_another_day_skip_busy_time_and_blocks(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam, task = _setup(db, user)
    other = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    insert_block(db, user.id, other, Z(2026, 11, 18, 12), Z(2026, 11, 18, 13))
    _commitment(db, user.id, 3, "16:00", "18:00")  # Wednesday
    _event(db, user.id, Z(2026, 11, 18, 20), Z(2026, 11, 18, 21))

    response = _slots(api, user, block, "2026-11-18")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["study_date"] == "2026-11-18"
    assert _instant(body["day_starts_at"]) == Z(2026, 11, 18, 6)
    assert _instant(body["day_ends_at"]) == Z(2026, 11, 18, 23)

    busy = [
        (Z(2026, 11, 18, 12), Z(2026, 11, 18, 13)),
        (Z(2026, 11, 18, 16), Z(2026, 11, 18, 18)),
        (Z(2026, 11, 18, 20), Z(2026, 11, 18, 21)),
    ]
    expected = []
    start = Z(2026, 11, 18, 6)
    while start <= Z(2026, 11, 18, 22):
        end = start + dt.timedelta(hours=1)
        if not any(b_start < end and start < b_end for b_start, b_end in busy):
            expected.append(start)
        start += dt.timedelta(minutes=15)
    assert [_instant(slot) for slot in body["slots"]] == expected

    # Every slot is a defer that succeeds.
    deferred = _defer(api, user, block, {"to": "at", "starts_at": body["slots"][-1]})
    assert deferred.status_code == 200, deferred.text


def test_slots_of_today_start_after_now(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    clock.set(Z(2026, 11, 16, 9, 20))  # the block has started: deferring it is allowed
    body = _slots(api, user, block, "2026-11-16").json()
    slots = [_instant(slot) for slot in body["slots"]]
    assert slots[0] == Z(2026, 11, 16, 9, 30)
    assert slots[-1] == Z(2026, 11, 16, 22)


def test_slots_end_at_the_exam_cutoff(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    """Without rest days studying ends at the exam day's midnight."""
    set_profile(db, user.id, sleep_time="01:00")
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    last = _slots(api, user, block, "2026-11-24").json()["slots"]
    assert _instant(last[-1]) == Z(2026, 11, 24, 23)
    normal = _slots(api, user, block, "2026-11-23").json()["slots"]
    assert _instant(normal[-1]) == Z(2026, 11, 24, 0)


@pytest.mark.parametrize(
    "date",
    [
        pytest.param("2026-11-14", id="before_today"),
        pytest.param("2026-11-25", id="exam_day"),
        pytest.param("2027-01-01", id="far_after"),
    ],
)
def test_slots_out_of_range_are_422(
    api: TestClient, user: ApiUser, db: psycopg.Connection, date: str
) -> None:
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    response = _slots(api, user, block, date)
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["code"] == "validation_error"
    assert body["errors"][0]["loc"] == ["query", "date"]


def test_slots_from_the_current_study_day(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    """At 05:00 Monday the study day is still Sunday's: Sunday is in range."""
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    response = _slots(api, user, block, "2026-11-15")
    assert response.status_code == 200, response.text
    # Sunday's waking hours (until 23:00 on the 15th) are over.
    assert response.json()["slots"] == []


def test_slots_with_a_bad_date_are_422(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    assert _slots(api, user, block, "tomorrow").status_code == 422
