"""One-off busy events (S35): GET/POST/PATCH/DELETE /busy-events.

Adding an event (or moving one) releases every planned block that overlaps it, pinned and
running ones too (a done block never), places the affected tasks again and always writes an
undoable version (plan decision 9). Deleting one moves nothing.
"""

import datetime as dt
from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4

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
    replan_apply,
    scalar,
    set_profile,
)
from tests.fixtures_db import ApiUser, FrozenClock

MakeApiUser = Callable[[], ApiUser]

Board = list[tuple[Any, ...]]


@pytest.fixture
def user(make_api_user: MakeApiUser, db: psycopg.Connection, clock: FrozenClock) -> ApiUser:
    created = make_api_user()
    set_profile(db, created.id, **TEST_PROFILE)
    clock.set(NOW)
    return created


def _iso(value: dt.datetime) -> str:
    return value.astimezone(dt.UTC).isoformat().replace("+00:00", "Z")


def _event(start: dt.datetime, end: dt.datetime, title: str | None = "חתונה") -> dict[str, Any]:
    return {"title": title, "starts_at": start.isoformat(), "ends_at": end.isoformat()}


def _post(api: TestClient, user: ApiUser, body: dict[str, Any]) -> Any:
    return api.post("/busy-events", json=body, headers=user.headers)


def _posted(api: TestClient, user: ApiUser, body: dict[str, Any]) -> dict[str, Any]:
    response = _post(api, user, body)
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def _patch(api: TestClient, user: ApiUser, event_id: str, body: dict[str, Any]) -> Any:
    return api.patch(f"/busy-events/{event_id}", json=body, headers=user.headers)


def _undo(api: TestClient, user: ApiUser, version_id: str) -> Any:
    return api.post("/plan/undo", json={"version_id": version_id}, headers=user.headers)


def _board(db: psycopg.Connection, user_id: UUID) -> Board:
    """Every block of the user, as the user sees it."""
    return db.execute(
        "SELECT id, task_id, starts_at, ends_at, part_index, part_count, pinned, status "
        "FROM app.blocks WHERE user_id = %s ORDER BY starts_at, id",
        (user_id,),
    ).fetchall()


def _live_planned(db: psycopg.Connection, user_id: UUID) -> list[tuple[dt.datetime, dt.datetime]]:
    return [
        (row[0], row[1])
        for row in db.execute(
            "SELECT starts_at, ends_at FROM app.blocks WHERE user_id = %s AND status = 'planned' "
            "AND ends_at > %s ORDER BY starts_at",
            (user_id, NOW),
        ).fetchall()
    ]


def _overlaps(a: tuple[dt.datetime, dt.datetime], b: tuple[dt.datetime, dt.datetime]) -> bool:
    return a[0] < b[1] and b[0] < a[1]


def _planned_board(api: TestClient, user: ApiUser, db: psycopg.Connection) -> UUID:
    """An exam on Friday with two tasks, planned; the exam's id."""
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    insert_task(db, user.id, exam, minutes=120, title="ראשונה")
    insert_task(db, user.id, exam, minutes=90, title="שנייה")
    replan_apply(api, user)
    return exam


# --- POST -----------------------------------------------------------------------------------


def test_post_saves_the_event_and_always_writes_a_version(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    body = _posted(api, user, _event(Z(2026, 11, 17, 18, 0), Z(2026, 11, 17, 23, 0)))

    assert set(body) == {"event", "blocks", "unplaced", "version_id"}
    event = body["event"]
    assert event == {
        "id": event["id"],
        "title": "חתונה",
        "starts_at": "2026-11-17T18:00:00Z",
        "ends_at": "2026-11-17T23:00:00Z",
        "created_at": event["created_at"],
    }
    assert body["blocks"] == []
    assert body["unplaced"] == []
    assert body["version_id"] is not None
    row = db.execute(
        "SELECT reason, busy_event_id, busy_event_before FROM app.plan_versions WHERE id = %s",
        (body["version_id"],),
    ).fetchone()
    assert row == ("busy_added", UUID(event["id"]), None)


def test_post_accepts_a_null_title_and_any_offset(api: TestClient, user: ApiUser) -> None:
    body = _posted(
        api,
        user,
        {"title": None, "starts_at": "2026-11-17T20:00:00+02:00", "ends_at": "2026-11-17T19:00Z"},
    )
    assert body["event"]["title"] is None
    assert body["event"]["starts_at"] == "2026-11-17T18:00:00Z"
    # The title may be left out.
    no_title = _posted(
        api, user, {"starts_at": "2026-11-18T10:00:00Z", "ends_at": "2026-11-18T11:00:00Z"}
    )
    assert no_title["event"]["title"] is None


def test_post_releases_the_overlapping_blocks_and_places_them_again(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    _planned_board(api, user, db)
    first = db.execute(
        "SELECT id, task_id, starts_at, ends_at FROM app.blocks WHERE user_id = %s "
        "ORDER BY starts_at LIMIT 1",
        (user.id,),
    ).fetchone()
    assert first is not None
    block_id, task_id, starts_at, ends_at = first
    taken = (starts_at, ends_at)

    body = _posted(api, user, _event(starts_at, ends_at))

    assert scalar(db, "SELECT count(*) FROM app.blocks WHERE id = %s", block_id) == 0
    assert body["unplaced"] == []
    assert body["blocks"]
    assert {block["task_id"] for block in body["blocks"]} == {str(task_id)}
    live = db.execute(
        "SELECT id FROM app.blocks WHERE user_id = %s AND task_id = %s AND status = 'planned'",
        (user.id, task_id),
    ).fetchall()
    assert sorted(block["id"] for block in body["blocks"]) == sorted(str(row[0]) for row in live)
    for interval in _live_planned(db, user.id):
        assert not _overlaps(interval, taken), interval
    minutes = scalar(
        db,
        "SELECT sum(extract(epoch FROM ends_at - starts_at) / 60)::int FROM app.blocks "
        "WHERE task_id = %s",
        task_id,
    )
    assert minutes == scalar(db, "SELECT estimated_minutes FROM app.tasks WHERE id = %s", task_id)
    parts = [(block["part_index"], block["part_count"]) for block in body["blocks"]]
    assert parts == [(index + 1, len(parts)) for index in range(len(parts))]


def test_a_pinned_block_is_released_and_a_done_block_is_not(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=120)
    done = insert_block(
        db,
        user.id,
        task,
        Z(2026, 11, 16, 3, 0),
        Z(2026, 11, 16, 4, 0),
        status="done",
        part_count=2,
    )
    pinned = insert_block(
        db,
        user.id,
        task,
        Z(2026, 11, 16, 9, 0),
        Z(2026, 11, 16, 10, 0),
        pinned=True,
        part_index=2,
        part_count=2,
    )

    body = _posted(api, user, _event(Z(2026, 11, 16, 3, 0), Z(2026, 11, 16, 11, 0)))

    assert scalar(db, "SELECT count(*) FROM app.blocks WHERE id = %s", pinned) == 0
    assert scalar(db, "SELECT status FROM app.blocks WHERE id = %s", done) == "done"
    ids = {block["id"] for block in body["blocks"]}
    assert str(done) in ids
    assert len(ids) == 2
    moved = next(block for block in body["blocks"] if block["id"] != str(done))
    assert moved["pinned"] is False
    assert moved["starts_at"] >= "2026-11-16T11:00:00Z"


def test_a_task_with_no_room_is_unplaced_and_loses_the_block_anyway(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-17")
    task = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 10, 0), Z(2026, 11, 16, 11, 0))

    # Busy from now until the exam day ends: no room left before the exam.
    body = _posted(api, user, _event(NOW, Z(2026, 11, 18, 0, 0)))

    assert scalar(db, "SELECT count(*) FROM app.blocks WHERE id = %s", block) == 0
    assert body["blocks"] == []
    (unplaced,) = body["unplaced"]
    assert set(unplaced) == {"task_id", "minutes", "reason"}
    assert unplaced["task_id"] == str(task)
    assert unplaced["minutes"] == 60
    assert isinstance(unplaced["reason"], str)
    plan = api.get("/plan", headers=user.headers).json()
    assert [item["task_id"] for item in plan["unplaced"]] == [str(task)]


def test_undo_of_busy_added_deletes_the_event_and_restores_the_board(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    _planned_board(api, user, db)
    before = _board(db, user.id)
    starts_at, ends_at = before[0][2], before[0][3]
    body = _posted(api, user, _event(starts_at, ends_at + dt.timedelta(hours=1)))
    assert _board(db, user.id) != before

    response = _undo(api, user, body["version_id"])

    assert response.status_code == 200, response.text
    assert _board(db, user.id) == before
    assert scalar(
        db, "SELECT deleted_at IS NOT NULL FROM app.busy_events WHERE id = %s", body["event"]["id"]
    )
    assert api.get("/busy-events", headers=user.headers).json() == {"events": []}


@pytest.mark.parametrize(
    "body",
    [
        # Naive datetimes.
        {"starts_at": "2026-11-17T10:00:00", "ends_at": "2026-11-17T11:00:00"},
        # Seconds.
        {"starts_at": "2026-11-17T10:00:30Z", "ends_at": "2026-11-17T11:00:00Z"},
        {"starts_at": "2026-11-17T10:00:00Z", "ends_at": "2026-11-17T11:00:00.5Z"},
        # Not after the start.
        {"starts_at": "2026-11-17T10:00:00Z", "ends_at": "2026-11-17T10:00:00Z"},
        {"starts_at": "2026-11-17T10:00:00Z", "ends_at": "2026-11-17T09:00:00Z"},
        # 14 days and a minute.
        {"starts_at": "2026-11-17T10:00:00Z", "ends_at": "2026-12-01T10:01:00Z"},
        # The title.
        {"title": "x\x00", "starts_at": "2026-11-17T10:00Z", "ends_at": "2026-11-17T11:00Z"},
        {"title": "א" * 101, "starts_at": "2026-11-17T10:00Z", "ends_at": "2026-11-17T11:00Z"},
        {"title": "  ", "starts_at": "2026-11-17T10:00Z", "ends_at": "2026-11-17T11:00Z"},
        # Missing or unknown fields.
        {"starts_at": "2026-11-17T10:00:00Z"},
        {"starts_at": "2026-11-17T10:00Z", "ends_at": "2026-11-17T11:00Z", "kind": "work"},
    ],
)
def test_post_refuses_invalid_bodies(
    api: TestClient, user: ApiUser, db: psycopg.Connection, body: dict[str, Any]
) -> None:
    response = _post(api, user, body)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "validation_error"
    assert scalar(db, "SELECT count(*) FROM app.busy_events") == 0
    assert scalar(db, "SELECT count(*) FROM app.plan_versions") == 0


def test_cross_field_errors_name_the_field(api: TestClient, user: ApiUser) -> None:
    same = _post(api, user, _event(Z(2026, 11, 17, 10), Z(2026, 11, 17, 10)))
    assert [(e["loc"], e["type"]) for e in same.json()["errors"]] == [
        (["body", "ends_at"], "not_after_starts_at")
    ]
    long = _post(api, user, _event(Z(2026, 11, 17, 10), Z(2026, 12, 1, 10, 1)))
    assert [(e["loc"], e["type"]) for e in long.json()["errors"]] == [
        (["body", "ends_at"], "too_long")
    ]


def test_fourteen_days_exactly_is_accepted(api: TestClient, user: ApiUser) -> None:
    _posted(api, user, _event(Z(2026, 11, 17, 10), Z(2026, 12, 1, 10)))


def test_an_event_that_already_ended_is_refused(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    response = _post(api, user, _event(Z(2026, 11, 16, 3, 0), NOW))
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "event_in_past"
    assert scalar(db, "SELECT count(*) FROM app.busy_events") == 0
    # One still going is fine.
    _posted(api, user, _event(Z(2026, 11, 16, 3, 0), NOW + dt.timedelta(minutes=1)))


def test_post_refuses_past_the_limit_of_future_events(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    with db.cursor() as cursor:
        cursor.executemany(
            "INSERT INTO app.busy_events (user_id, starts_at, ends_at) VALUES (%s, %s, %s)",
            [
                (
                    user.id,
                    Z(2026, 12, 1) + dt.timedelta(hours=index),
                    Z(2026, 12, 1) + dt.timedelta(hours=index, minutes=30),
                )
                for index in range(500)
            ],
        )
        # Ended and deleted events do not count.
        cursor.execute(
            "INSERT INTO app.busy_events (user_id, starts_at, ends_at) VALUES (%s, %s, %s)",
            (user.id, Z(2026, 11, 10), Z(2026, 11, 10, 1)),
        )
    response = _post(api, user, _event(Z(2026, 11, 17, 10), Z(2026, 11, 17, 11)))
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "too_many_events"
    assert response.json()["limit"] == 500

    db.execute(
        "UPDATE app.busy_events SET deleted_at = now() WHERE id = "
        "(SELECT id FROM app.busy_events WHERE user_id = %s AND ends_at > %s LIMIT 1)",
        (user.id, NOW),
    )
    _posted(api, user, _event(Z(2026, 11, 17, 10), Z(2026, 11, 17, 11)))


# --- GET ------------------------------------------------------------------------------------


def test_get_lists_live_events_overlapping_the_range(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    later = _posted(api, user, _event(Z(2026, 11, 20, 10), Z(2026, 11, 20, 11)))["event"]
    sooner = _posted(api, user, _event(Z(2026, 11, 16, 22), Z(2026, 11, 17, 2)))["event"]
    outside = _posted(api, user, _event(Z(2026, 11, 23, 0), Z(2026, 11, 23, 1)))["event"]
    gone = _posted(api, user, _event(Z(2026, 11, 18, 10), Z(2026, 11, 18, 11)))["event"]
    assert api.delete(f"/busy-events/{gone['id']}", headers=user.headers).status_code == 204

    # Default: today (Monday 16) and the next six days, Sunday 22 included.
    response = api.get("/busy-events", headers=user.headers)
    assert response.status_code == 200, response.text
    assert response.json() == {"events": [sooner, later]}

    ranged = api.get("/busy-events?from=2026-11-17&to=2026-11-23", headers=user.headers).json()
    assert [event["id"] for event in ranged["events"]] == [
        sooner["id"],
        later["id"],
        outside["id"],
    ]
    one_day = api.get("/busy-events?from=2026-11-20&to=2026-11-20", headers=user.headers).json()
    assert one_day == {"events": [later]}


def test_get_follows_the_profile_timezone(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    db.execute("UPDATE app.profiles SET timezone = 'Asia/Jerusalem' WHERE id = %s", (user.id,))
    # 23:30 UTC on the 19th is 01:30 on the 20th in Jerusalem.
    event = _posted(api, user, _event(Z(2026, 11, 19, 23, 30), Z(2026, 11, 20, 0, 0)))["event"]
    on_20 = api.get("/busy-events?from=2026-11-20&to=2026-11-20", headers=user.headers).json()
    assert on_20 == {"events": [event]}
    on_19 = api.get("/busy-events?from=2026-11-19&to=2026-11-19", headers=user.headers).json()
    assert on_19 == {"events": []}


@pytest.mark.parametrize(
    ("query", "kind"),
    [
        ("from=2026-11-20&to=2026-11-19", "before_from"),
        ("from=2026-11-01&to=2027-01-02", "range_too_long"),
        ("from=2040-01-01", "out_of_range"),
        ("from=nope", "date_from_datetime_parsing"),
    ],
)
def test_get_refuses_bad_ranges(api: TestClient, user: ApiUser, query: str, kind: str) -> None:
    response = api.get(f"/busy-events?{query}", headers=user.headers)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "validation_error"
    if kind != "date_from_datetime_parsing":
        assert [error["type"] for error in response.json()["errors"]] == [kind]


# --- PATCH ----------------------------------------------------------------------------------


def test_patch_of_the_title_only_writes_no_version(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    _planned_board(api, user, db)
    created = _posted(api, user, _event(Z(2026, 11, 19, 18), Z(2026, 11, 19, 23)))
    versions = scalar(db, "SELECT count(*) FROM app.plan_versions")
    before = _board(db, user.id)

    response = _patch(api, user, created["event"]["id"], {"title": None})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body == {
        "event": {**created["event"], "title": None},
        "blocks": [],
        "unplaced": [],
        "version_id": None,
    }
    assert scalar(db, "SELECT count(*) FROM app.plan_versions") == versions
    assert _board(db, user.id) == before


def test_patch_of_the_time_clears_the_new_interval_and_undo_restores_it(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    _planned_board(api, user, db)
    created = _posted(api, user, _event(Z(2026, 11, 19, 20), Z(2026, 11, 19, 23)))
    event_id = created["event"]["id"]
    before = _board(db, user.id)
    first = before[0]
    new_interval = (first[2], first[3])

    response = _patch(
        api,
        user,
        event_id,
        {"starts_at": first[2].isoformat(), "ends_at": first[3].isoformat()},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["event"]["starts_at"] == _iso(first[2])
    assert body["version_id"] is not None
    assert body["blocks"]
    row = db.execute(
        "SELECT reason, busy_event_id, busy_event_before FROM app.plan_versions WHERE id = %s",
        (body["version_id"],),
    ).fetchone()
    assert row == (
        "busy_changed",
        UUID(event_id),
        {
            "title": "חתונה",
            "starts_at": "2026-11-19T20:00:00+00:00",
            "ends_at": "2026-11-19T23:00:00+00:00",
        },
    )
    assert scalar(db, "SELECT count(*) FROM app.blocks WHERE id = %s", first[0]) == 0
    for interval in _live_planned(db, user.id):
        assert not _overlaps(interval, new_interval)

    undone = _undo(api, user, body["version_id"])

    assert undone.status_code == 200, undone.text
    assert _board(db, user.id) == before
    restored = db.execute(
        "SELECT title, starts_at, ends_at, deleted_at FROM app.busy_events WHERE id = %s",
        (event_id,),
    ).fetchone()
    assert restored == ("חתונה", Z(2026, 11, 19, 20), Z(2026, 11, 19, 23), None)


def test_blocks_over_the_old_interval_stay_when_the_event_moves(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    created = _posted(api, user, _event(Z(2026, 11, 17, 9), Z(2026, 11, 17, 10)))
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=60)
    # Written straight over the event: moving it away frees the time and moves nothing.
    block = insert_block(db, user.id, task, Z(2026, 11, 17, 9), Z(2026, 11, 17, 10))

    response = _patch(
        api,
        user,
        created["event"]["id"],
        {"starts_at": "2026-11-18T09:00:00Z", "ends_at": "2026-11-18T10:00:00Z"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["blocks"] == []
    assert scalar(db, "SELECT starts_at FROM app.blocks WHERE id = %s", block) == Z(2026, 11, 17, 9)


def test_patch_validates_the_merged_event(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    event = _posted(api, user, _event(Z(2026, 11, 17, 10), Z(2026, 11, 17, 12)))["event"]

    before_start = _patch(api, user, event["id"], {"ends_at": "2026-11-17T09:00:00Z"})
    assert before_start.status_code == 422
    assert [e["type"] for e in before_start.json()["errors"]] == ["not_after_starts_at"]
    too_long = _patch(api, user, event["id"], {"ends_at": "2026-12-01T10:01:00Z"})
    assert [e["type"] for e in too_long.json()["errors"]] == ["too_long"]
    for body in ({}, {"starts_at": None}, {"ends_at": "2026-11-17T12:00:30Z"}, {"x": 1}):
        assert _patch(api, user, event["id"], body).status_code == 422, body
    in_past = _patch(
        api,
        user,
        event["id"],
        {"starts_at": "2026-11-16T03:00:00Z", "ends_at": "2026-11-16T04:00:00Z"},
    )
    assert in_past.status_code == 422
    assert in_past.json()["code"] == "event_in_past"

    clock.set(Z(2026, 11, 17, 12, 0))
    ended = _patch(api, user, event["id"], {"title": "x"})
    assert ended.status_code == 409
    assert ended.json()["code"] == "invalid_state"


# --- DELETE ---------------------------------------------------------------------------------


def test_delete_is_soft_writes_no_version_and_moves_nothing(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    _planned_board(api, user, db)
    created = _posted(api, user, _event(Z(2026, 11, 19, 18), Z(2026, 11, 19, 23)))
    versions = scalar(db, "SELECT count(*) FROM app.plan_versions")
    before = _board(db, user.id)

    response = api.delete(f"/busy-events/{created['event']['id']}", headers=user.headers)

    assert response.status_code == 204, response.text
    assert response.content == b""
    assert scalar(
        db,
        "SELECT deleted_at IS NOT NULL FROM app.busy_events WHERE id = %s",
        created["event"]["id"],
    )
    assert scalar(db, "SELECT count(*) FROM app.plan_versions") == versions
    assert _board(db, user.id) == before
    again = api.delete(f"/busy-events/{created['event']['id']}", headers=user.headers)
    assert again.status_code == 404
    assert _patch(api, user, created["event"]["id"], {"title": "x"}).status_code == 404


def test_unknown_event_is_404(api: TestClient, user: ApiUser) -> None:
    unknown = uuid4()
    assert api.delete(f"/busy-events/{unknown}", headers=user.headers).status_code == 404
    assert _patch(api, user, str(unknown), {"title": "x"}).status_code == 404


# --- Ownership ------------------------------------------------------------------------------


def test_another_user_cannot_see_or_change_an_event(
    api: TestClient, user: ApiUser, make_api_user: MakeApiUser, db: psycopg.Connection
) -> None:
    event = _posted(api, user, _event(Z(2026, 11, 17, 10), Z(2026, 11, 17, 11)))["event"]
    other = make_api_user()
    before = db.execute("SELECT * FROM app.busy_events ORDER BY id").fetchall()

    assert api.get("/busy-events", headers=other.headers).json() == {"events": []}
    patched = api.patch(f"/busy-events/{event['id']}", json={"title": "x"}, headers=other.headers)
    assert patched.status_code == 404
    assert patched.json()["code"] == "not_found"
    moved = api.patch(
        f"/busy-events/{event['id']}",
        json={"starts_at": "2026-11-18T10:00:00Z", "ends_at": "2026-11-18T11:00:00Z"},
        headers=other.headers,
    )
    assert moved.status_code == 404
    assert api.delete(f"/busy-events/{event['id']}", headers=other.headers).status_code == 404

    assert db.execute("SELECT * FROM app.busy_events ORDER BY id").fetchall() == before
    assert scalar(db, "SELECT count(*) FROM app.plan_versions WHERE user_id = %s", other.id) == 0
