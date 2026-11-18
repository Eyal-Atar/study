import datetime as dt
from collections.abc import Callable
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.domain.planner import BlockStatus
from app.services.board import BlockRow
from app.services.plan_views import block_state
from tests.api.factories import (
    NOW,
    TEST_PROFILE,
    Z,
    insert_block,
    insert_exam,
    insert_task,
    replan_apply,
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


def _row(start: dt.datetime, end: dt.datetime, status: BlockStatus) -> BlockRow:
    return BlockRow(
        id=uuid4(),
        task_id=uuid4(),
        starts_at=start,
        ends_at=end,
        part_index=1,
        part_count=1,
        pinned=False,
        status=status,
        plan_version_id=None,
    )


@pytest.mark.parametrize(
    ("start", "end", "status", "state"),
    [
        (Z(2026, 11, 16, 6, 0), Z(2026, 11, 16, 7, 0), BlockStatus.DONE, "done"),
        (Z(2026, 11, 15, 6, 0), Z(2026, 11, 15, 7, 0), BlockStatus.MISSED, "missed"),
        (Z(2026, 11, 15, 6, 0), Z(2026, 11, 15, 7, 0), BlockStatus.SKIPPED, "skipped"),
        (Z(2026, 11, 16, 3, 0), Z(2026, 11, 16, 4, 0), BlockStatus.PLANNED, "overdue"),
        (Z(2026, 11, 16, 4, 0), Z(2026, 11, 16, 5, 0), BlockStatus.PLANNED, "overdue"),
        (Z(2026, 11, 16, 4, 30), Z(2026, 11, 16, 5, 30), BlockStatus.PLANNED, "in_progress"),
        (Z(2026, 11, 16, 5, 0), Z(2026, 11, 16, 6, 0), BlockStatus.PLANNED, "in_progress"),
        (Z(2026, 11, 16, 6, 0), Z(2026, 11, 16, 7, 0), BlockStatus.PLANNED, "upcoming"),
    ],
)
def test_block_state(start: dt.datetime, end: dt.datetime, status: BlockStatus, state: str) -> None:
    assert block_state(_row(start, end, status), NOW) == state


def test_plan_range_by_study_date(api: TestClient, user: ApiUser, db: psycopg.Connection) -> None:
    set_profile(db, user.id, sleep_time="01:00")
    exam = insert_exam(db, user.id, exam_date="2026-11-25", name="אלגברה")
    task = insert_task(db, user.id, exam, title="פרק 1")
    late = insert_block(db, user.id, task, Z(2026, 11, 17, 0, 30), Z(2026, 11, 17, 1, 0))
    next_day = insert_block(db, user.id, task, Z(2026, 11, 17, 8, 0), Z(2026, 11, 17, 9, 0))

    response = api.get("/plan?from=2026-11-16&to=2026-11-16", headers=user.headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["from"] == "2026-11-16"
    assert body["to"] == "2026-11-16"
    assert [block["id"] for block in body["blocks"]] == [str(late)]
    assert body["blocks"][0] == {
        "id": str(late),
        "task_id": str(task),
        "exam_id": str(exam),
        "task_title": "פרק 1",
        "task_kind": "learn",
        "exam_name": "אלגברה",
        "starts_at": "2026-11-17T00:30:00Z",
        "ends_at": "2026-11-17T01:00:00Z",
        "study_date": "2026-11-16",
        "part_index": 1,
        "part_count": 1,
        "pinned": False,
        "status": "planned",
        "state": "upcoming",
    }
    default = api.get("/plan", headers=user.headers).json()
    assert (default["from"], default["to"]) == ("2026-11-15", "2026-11-21")
    assert [block["id"] for block in default["blocks"]] == [str(late), str(next_day)]

    ok = api.get("/plan?from=2026-11-16&to=2027-01-16", headers=user.headers)
    assert ok.status_code == 200
    too_long = api.get("/plan?from=2026-11-16&to=2027-01-17", headers=user.headers)
    assert too_long.status_code == 422
    backwards = api.get("/plan?from=2026-11-16&to=2026-11-15", headers=user.headers)
    assert backwards.status_code == 422


@pytest.mark.parametrize(
    ("query", "field"),
    [
        ("from=0001-01-01", "from"),
        ("from=0001-01-01&to=0001-01-02", "from"),
        ("from=9999-12-31", "from"),
        ("from=2026-11-16&to=9999-12-31", "to"),
        ("to=9999-12-31", "to"),
        ("from=2021-11-15&to=2021-11-20", "from"),
        ("from=2031-11-17", "from"),
    ],
)
def test_plan_range_must_be_within_five_years(
    api: TestClient, user: ApiUser, query: str, field: str
) -> None:
    response = api.get(f"/plan?{query}", headers=user.headers)
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["code"] == "validation_error"
    assert [error["loc"] for error in body["errors"]] == [["query", field]]


def test_plan_range_edges_are_allowed(api: TestClient, user: ApiUser) -> None:
    # Local today is 2026-11-16 (UTC); 1826 days either side.
    first = api.get("/plan?from=2021-11-16&to=2021-11-20", headers=user.headers)
    assert first.status_code == 200, first.text
    last = api.get("/plan?from=2031-11-10&to=2031-11-16", headers=user.headers)
    assert last.status_code == 200, last.text


@pytest.mark.parametrize(
    ("timezone", "date"), [("Asia/Jerusalem", "2026-11-17"), ("UTC", "2026-11-16")]
)
def test_today_follows_the_profile_timezone(
    api: TestClient,
    user: ApiUser,
    db: psycopg.Connection,
    clock: FrozenClock,
    timezone: str,
    date: str,
) -> None:
    set_profile(db, user.id, timezone=timezone, wake_time="08:00", sleep_time="23:00")
    clock.set(Z(2026, 11, 17, 6, 30))
    exam = insert_exam(db, user.id, exam_date="2026-11-25")
    task = insert_task(db, user.id, exam)
    block = insert_block(db, user.id, task, Z(2026, 11, 17, 7, 0), Z(2026, 11, 17, 8, 0))
    response = api.get("/today", headers=user.headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["date"] == date
    if timezone == "Asia/Jerusalem":
        assert [b["id"] for b in body["blocks"]] == [str(block)]
        assert body["planned_minutes"] == 60
        assert body["done_minutes"] == 0


def test_today_counts_planned_and_done_minutes(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    clock.set(Z(2026, 11, 16, 10, 0))  # after the wake-up at 06:00
    exam = insert_exam(db, user.id, exam_date="2026-11-25")
    task = insert_task(db, user.id, exam, minutes=240)
    insert_block(db, user.id, task, Z(2026, 11, 16, 6, 0), Z(2026, 11, 16, 6, 30), status="done")
    insert_block(db, user.id, task, Z(2026, 11, 16, 7, 0), Z(2026, 11, 16, 7, 45))
    insert_block(db, user.id, task, Z(2026, 11, 16, 8, 0), Z(2026, 11, 16, 9, 0), status="missed")
    insert_block(db, user.id, task, Z(2026, 11, 17, 8, 0), Z(2026, 11, 17, 9, 0))
    body = api.get("/today", headers=user.headers).json()
    assert body["date"] == "2026-11-16"
    assert len(body["blocks"]) == 3
    assert (body["planned_minutes"], body["done_minutes"]) == (45, 30)


def test_unplaced_and_undo_in_plan(api: TestClient, user: ApiUser, db: psycopg.Connection) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=120, title="חסרה")
    insert_block(db, user.id, task, Z(2026, 11, 16, 8, 0), Z(2026, 11, 16, 9, 0))
    body = api.get("/plan", headers=user.headers).json()
    assert body["unplaced"] == [
        {"task_id": str(task), "exam_id": str(exam), "title": "חסרה", "minutes": 60}
    ]
    assert body["undo"] is None

    applied = replan_apply(api, user)
    assert applied["version_id"] is not None
    body = api.get("/plan", headers=user.headers).json()
    assert body["unplaced"] == []
    assert body["undo"]["version_id"] == applied["version_id"]
    assert body["undo"]["reason"] == "replan"
    assert body["undo"]["created_at"].endswith("Z")


def test_deleted_task_blocks_are_hidden(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-25")
    task = insert_task(db, user.id, exam)
    insert_block(db, user.id, task, Z(2026, 11, 16, 8, 0), Z(2026, 11, 16, 9, 0))
    other_exam = insert_exam(db, user.id, exam_date="2026-11-25", deleted=True)
    of_deleted_exam = insert_task(db, user.id, other_exam)
    insert_block(db, user.id, of_deleted_exam, Z(2026, 11, 16, 10, 0), Z(2026, 11, 16, 11, 0))
    db.execute("UPDATE app.tasks SET deleted_at = now() WHERE id = %s", (task,))
    plan = api.get("/plan", headers=user.headers).json()
    today = api.get("/today", headers=user.headers).json()
    assert plan["blocks"] == []
    assert plan["unplaced"] == []
    assert today["blocks"] == []


def _commitment(
    db: psycopg.Connection, user_id: object, weekday: int, start: str, end: str, **extra: object
) -> str:
    row = db.execute(
        "INSERT INTO app.commitments (user_id, title, kind, weekday, start_time, end_time, "
        "valid_from, deleted_at) VALUES (%s, %s, %s, %s, %s, %s, '2026-11-01', %s) RETURNING id",
        (
            user_id,
            extra.get("title", "עבודה"),
            extra.get("kind", "work"),
            weekday,
            start,
            end,
            extra.get("deleted_at"),
        ),
    ).fetchone()
    assert row is not None
    return str(row[0])


def _busy_event(
    db: psycopg.Connection,
    user_id: object,
    start: dt.datetime,
    end: dt.datetime,
    title: str | None = None,
    deleted: bool = False,
) -> str:
    row = db.execute(
        "INSERT INTO app.busy_events (user_id, title, starts_at, ends_at, deleted_at) "
        "VALUES (%s, %s, %s, %s, %s) RETURNING id",
        (user_id, title, start, end, NOW if deleted else None),
    ).fetchone()
    assert row is not None
    return str(row[0])


def test_plan_and_today_return_the_busy_time_of_their_days(
    api: TestClient,
    user: ApiUser,
    db: psycopg.Connection,
    make_api_user: MakeApiUser,
    clock: FrozenClock,
) -> None:
    clock.set(Z(2026, 11, 16, 10, 0))  # awake: the study day is Monday 16
    monday = _commitment(db, user.id, 1, "16:00", "22:00")
    # Sunday night into Monday: the one starting on Sunday 22 is in the range (its waking
    # span); the one from Sunday 15 ends at 02:00 on Monday 16, before the waking hours.
    night = _commitment(db, user.id, 0, "22:00", "02:00", title="משמרת לילה", kind="other")
    _commitment(db, user.id, 2, "08:00", "09:00", deleted_at=NOW)
    event = _busy_event(db, user.id, Z(2026, 11, 17, 10), Z(2026, 11, 17, 11), title="רופא")
    untitled = _busy_event(db, user.id, Z(2026, 11, 18, 22, 30), Z(2026, 11, 19, 1))
    _busy_event(db, user.id, Z(2026, 11, 19, 3), Z(2026, 11, 19, 4))  # asleep: not shown
    _busy_event(db, user.id, Z(2026, 11, 20, 10), Z(2026, 11, 20, 11), deleted=True)
    other = make_api_user()
    _busy_event(db, other.id, Z(2026, 11, 17, 12), Z(2026, 11, 17, 13))
    _commitment(db, other.id, 1, "10:00", "11:00")

    body = api.get("/plan", headers=user.headers).json()

    assert body["busy"] == [
        {
            "source": "commitment",
            "id": monday,
            "title": "עבודה",
            "kind": "work",
            "starts_at": "2026-11-16T16:00:00Z",
            "ends_at": "2026-11-16T22:00:00Z",
        },
        {
            "source": "event",
            "id": event,
            "title": "רופא",
            "kind": None,
            "starts_at": "2026-11-17T10:00:00Z",
            "ends_at": "2026-11-17T11:00:00Z",
        },
        {
            "source": "event",
            "id": untitled,
            "title": None,
            "kind": None,
            "starts_at": "2026-11-18T22:30:00Z",
            "ends_at": "2026-11-19T01:00:00Z",
        },
        {
            "source": "commitment",
            "id": night,
            "title": "משמרת לילה",
            "kind": "other",
            "starts_at": "2026-11-22T22:00:00Z",
            "ends_at": "2026-11-23T02:00:00Z",
        },
    ]
    # The existing fields are unchanged.
    assert set(body) == {"from", "to", "blocks", "unplaced", "undo", "busy"}

    later = api.get("/plan?from=2026-11-23&to=2026-11-23", headers=user.headers).json()
    assert [(item["id"], item["starts_at"]) for item in later["busy"]] == [
        (monday, "2026-11-23T16:00:00Z")
    ]

    today = api.get("/today", headers=user.headers).json()
    assert [item["id"] for item in today["busy"]] == [monday]
    assert {"date", "blocks", "planned_minutes", "done_minutes", "day_starts_at"} < set(today)


def test_busy_time_follows_the_profile_timezone(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    set_profile(db, user.id, timezone="Asia/Jerusalem")
    clock.set(Z(2026, 11, 16, 10, 0))
    monday = _commitment(db, user.id, 1, "16:00", "22:00")

    today = api.get("/today", headers=user.headers).json()

    assert today["busy"] == [
        {
            "source": "commitment",
            "id": monday,
            "title": "עבודה",
            "kind": "work",
            "starts_at": "2026-11-16T14:00:00Z",
            "ends_at": "2026-11-16T20:00:00Z",
        }
    ]
