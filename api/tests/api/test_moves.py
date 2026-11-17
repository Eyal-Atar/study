"""Moving a block (PATCH /blocks/{id} with starts_at) and the slots it can move to (S18)."""

import datetime as dt
from collections.abc import Callable
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

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


def _move(api: TestClient, user: ApiUser, block: UUID, **body: Any) -> Any:
    payload = {
        key: value.isoformat() if isinstance(value, dt.datetime) else value
        for key, value in body.items()
    }
    return api.patch(f"/blocks/{block}", json=payload, headers=user.headers)


def _slots(api: TestClient, user: ApiUser, block: UUID) -> Any:
    return api.get(f"/blocks/{block}/slots", headers=user.headers)


def _row(db: psycopg.Connection, block: UUID) -> tuple[dt.datetime, dt.datetime, bool, str]:
    row = db.execute(
        "SELECT starts_at, ends_at, pinned, status FROM app.blocks WHERE id = %s", (block,)
    ).fetchone()
    assert row is not None
    return (row[0], row[1], row[2], row[3])


def _instant(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value)


def _setup(db: psycopg.Connection, user: ApiUser, minutes: int = 60) -> tuple[UUID, UUID]:
    exam = insert_exam(db, user.id, exam_date="2026-11-25")
    return exam, insert_task(db, user.id, exam, minutes=minutes)


def test_move_to_free_space_pins_the_block(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))

    response = _move(api, user, block, starts_at=Z(2026, 11, 16, 14))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == str(block)
    assert _instant(body["starts_at"]) == Z(2026, 11, 16, 14)
    assert _instant(body["ends_at"]) == Z(2026, 11, 16, 15)
    assert body["pinned"] is True
    assert body["study_date"] == "2026-11-16"
    assert _row(db, block) == (Z(2026, 11, 16, 14), Z(2026, 11, 16, 15), True, "planned")
    # A move writes no plan version: its undo is the reverse PATCH.
    assert db.execute("SELECT count(*) FROM app.plan_versions").fetchone() == (0,)


def test_move_with_pinned_false(api: TestClient, user: ApiUser, db: psycopg.Connection) -> None:
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    response = _move(api, user, block, starts_at=Z(2026, 11, 16, 14), pinned=False)
    assert response.status_code == 200, response.text
    assert response.json()["pinned"] is False
    assert _row(db, block)[:3] == (Z(2026, 11, 16, 14), Z(2026, 11, 16, 15), False)


def test_same_start_only_pins(api: TestClient, user: ApiUser, db: psycopg.Connection) -> None:
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    response = _move(api, user, block, starts_at=Z(2026, 11, 16, 9))
    assert response.status_code == 200, response.text
    assert _row(db, block) == (Z(2026, 11, 16, 9), Z(2026, 11, 16, 10), True, "planned")


def test_move_next_to_a_neighbour_leaves_it_alone(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam, task = _setup(db, user)
    other = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    neighbour = insert_block(db, user.id, other, Z(2026, 11, 16, 12), Z(2026, 11, 16, 13))
    before = _row(db, neighbour)

    after = _move(api, user, block, starts_at=Z(2026, 11, 16, 13))
    assert after.status_code == 200, after.text
    assert _row(db, neighbour) == before

    ahead = _move(api, user, block, starts_at=Z(2026, 11, 16, 11))
    assert ahead.status_code == 200, ahead.text
    assert _row(db, block)[:2] == (Z(2026, 11, 16, 11), Z(2026, 11, 16, 12))
    assert _row(db, neighbour) == before


def test_overlap_is_slot_taken(api: TestClient, user: ApiUser, db: psycopg.Connection) -> None:
    exam, task = _setup(db, user)
    other = insert_task(db, user.id, exam, minutes=120)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    neighbour = insert_block(db, user.id, other, Z(2026, 11, 16, 12), Z(2026, 11, 16, 13))
    done = insert_block(db, user.id, other, Z(2026, 11, 16, 15), Z(2026, 11, 16, 16), status="done")
    missed = insert_block(
        db, user.id, other, Z(2026, 11, 16, 17), Z(2026, 11, 16, 18), status="missed"
    )
    before = _row(db, block)

    for start, blocker in ((Z(2026, 11, 16, 12, 30), neighbour), (Z(2026, 11, 16, 14, 1), done)):
        response = _move(api, user, block, starts_at=start)
        assert response.status_code == 409, response.text
        problem = response.json()
        assert problem["code"] == "slot_taken"
        assert problem["blocked_by"] == str(blocker)
        assert _row(db, block) == before

    # A missed block is history: it takes no time.
    over_missed = _move(api, user, block, starts_at=Z(2026, 11, 16, 17, 30))
    assert over_missed.status_code == 200, over_missed.text
    assert _row(db, missed)[3] == "missed"


def test_a_started_or_done_block_cannot_move(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    _, task = _setup(db, user, minutes=180)
    started = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    done = insert_block(db, user.id, task, Z(2026, 11, 16, 11), Z(2026, 11, 16, 12), status="done")
    clock.set(Z(2026, 11, 16, 9))  # the block starts right now
    for block in (started, done):
        before = _row(db, block)
        response = _move(api, user, block, starts_at=Z(2026, 11, 16, 15))
        assert response.status_code == 409, response.text
        assert response.json()["code"] == "invalid_state"
        assert _row(db, block) == before
        slots = _slots(api, user, block)
        assert slots.status_code == 409, slots.text
        assert slots.json()["code"] == "invalid_state"


@pytest.mark.parametrize(
    "start",
    [
        pytest.param(Z(2026, 11, 16, 8, 0), id="before_now"),
        pytest.param(Z(2026, 11, 16, 22, 30), id="after_sleep"),
        pytest.param(Z(2026, 11, 17, 9, 0), id="other_study_day"),
        pytest.param(Z(2026, 11, 15, 22, 0), id="previous_study_day"),
        pytest.param(Z(2026, 11, 16, 14, 0) + dt.timedelta(seconds=30), id="not_a_whole_minute"),
    ],
)
def test_outside_the_day_is_422(
    api: TestClient,
    user: ApiUser,
    db: psycopg.Connection,
    clock: FrozenClock,
    start: dt.datetime,
) -> None:
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 12), Z(2026, 11, 16, 13))
    clock.set(Z(2026, 11, 16, 8, 0) + dt.timedelta(seconds=30))
    before = _row(db, block)
    response = _move(api, user, block, starts_at=start)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "outside_day"
    assert _row(db, block) == before


def test_the_edges_of_the_day_fit(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 12), Z(2026, 11, 16, 13))
    clock.set(Z(2026, 11, 16, 8, 0) + dt.timedelta(seconds=30))
    # The first whole minute after now, and an end exactly at sleep_time.
    for start in (Z(2026, 11, 16, 8, 1), Z(2026, 11, 16, 22, 0)):
        response = _move(api, user, block, starts_at=start)
        assert response.status_code == 200, response.text


def test_move_before_wake_is_422_even_without_the_delay(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    """The waking hours, not the planner's start delay, bound a move."""
    set_profile(db, user.id, study_start_delay_minutes=120)
    clock.set(Z(2026, 11, 16, 4))
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 12), Z(2026, 11, 16, 13))
    early = _move(api, user, block, starts_at=Z(2026, 11, 16, 5, 30))
    assert early.status_code == 422, early.text
    assert early.json()["code"] == "outside_day"
    at_wake = _move(api, user, block, starts_at=Z(2026, 11, 16, 6))
    assert at_wake.status_code == 200, at_wake.text


def test_move_past_midnight_when_sleep_is_after_midnight(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    set_profile(db, user.id, sleep_time="01:00")
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 21), Z(2026, 11, 16, 22))
    response = _move(api, user, block, starts_at=Z(2026, 11, 17, 0))
    assert response.status_code == 200, response.text
    assert response.json()["study_date"] == "2026-11-16"
    late = _move(api, user, block, starts_at=Z(2026, 11, 17, 0, 15))
    assert late.status_code == 422, late.text


def test_undo_moves_back_off_the_grid_and_unpinned(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9, 5), Z(2026, 11, 16, 10, 5))
    moved = _move(api, user, block, starts_at=Z(2026, 11, 16, 14))
    assert moved.status_code == 200, moved.text

    back = _move(api, user, block, starts_at=Z(2026, 11, 16, 9, 5), pinned=False)
    assert back.status_code == 200, back.text
    assert back.json()["pinned"] is False
    assert _row(db, block) == (Z(2026, 11, 16, 9, 5), Z(2026, 11, 16, 10, 5), False, "planned")


def test_swapping_two_parts_renumbers_them(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    _, task = _setup(db, user, minutes=120)
    first = insert_block(
        db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10), part_index=1, part_count=2
    )
    second = insert_block(
        db, user.id, task, Z(2026, 11, 16, 14), Z(2026, 11, 16, 15), part_index=2, part_count=2
    )
    response = _move(api, user, first, starts_at=Z(2026, 11, 16, 16))
    assert response.status_code == 200, response.text
    assert (response.json()["part_index"], response.json()["part_count"]) == (2, 2)
    parts = db.execute(
        "SELECT id, part_index FROM app.blocks WHERE task_id = %s ORDER BY part_index", (task,)
    ).fetchall()
    assert parts == [(second, 1), (first, 2)]


def test_replan_after_a_move_keeps_the_block(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    _, task = _setup(db, user)
    replan_apply(api, user)
    block = db.execute("SELECT id FROM app.blocks WHERE task_id = %s", (task,)).fetchone()
    assert block is not None
    moved = _move(api, user, block[0], starts_at=Z(2026, 11, 16, 15, 15))
    assert moved.status_code == 200, moved.text

    replan_apply(api, user)
    rows = db.execute(
        "SELECT id, starts_at, ends_at, pinned FROM app.blocks "
        "WHERE task_id = %s AND status = 'planned'",
        (task,),
    ).fetchall()
    assert rows == [(block[0], Z(2026, 11, 16, 15, 15), Z(2026, 11, 16, 16, 15), True)]


def test_slots_on_the_grid_skip_taken_and_past(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    exam, task = _setup(db, user)
    other = insert_task(db, user.id, exam, minutes=60)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10))
    insert_block(db, user.id, other, Z(2026, 11, 16, 12), Z(2026, 11, 16, 13))
    clock.set(Z(2026, 11, 16, 8, 7))

    response = _slots(api, user, block)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["study_date"] == "2026-11-16"
    assert _instant(body["day_starts_at"]) == Z(2026, 11, 16, 6)
    assert _instant(body["day_ends_at"]) == Z(2026, 11, 16, 23)

    step = dt.timedelta(minutes=15)
    expected = []
    start = Z(2026, 11, 16, 8, 15)
    while start <= Z(2026, 11, 16, 22):
        taken = Z(2026, 11, 16, 11) < start < Z(2026, 11, 16, 13)
        if start != Z(2026, 11, 16, 9) and not taken:
            expected.append(start)
        start += step
    assert [_instant(slot) for slot in body["slots"]] == expected

    # Every slot is a move that succeeds.
    for slot in (expected[0], expected[-1], Z(2026, 11, 16, 11), Z(2026, 11, 16, 13)):
        moved = _move(api, user, block, starts_at=slot)
        assert moved.status_code == 200, moved.text


def test_slots_follow_the_local_wall_clock(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    tz = ZoneInfo("Asia/Kathmandu")  # +05:45
    set_profile(db, user.id, timezone="Asia/Kathmandu")
    clock.set(Z(2026, 11, 15, 18))  # 23:45 local, the night before
    _, task = _setup(db, user, minutes=45)
    local_10 = dt.datetime(2026, 11, 16, 10, tzinfo=tz).astimezone(dt.UTC)
    block = insert_block(db, user.id, task, local_10, local_10 + dt.timedelta(minutes=45))

    body = _slots(api, user, block).json()
    assert body["study_date"] == "2026-11-16"
    slots = [_instant(slot).astimezone(tz) for slot in body["slots"]]
    assert all(slot.minute % 15 == 0 and slot.second == 0 for slot in slots)
    assert slots[0] == dt.datetime(2026, 11, 16, 6, tzinfo=tz)
    assert slots[-1] == dt.datetime(2026, 11, 16, 22, 15, tzinfo=tz)
    # 06:00 to 22:15 every 15 minutes, without 10:00 itself.
    assert len(slots) == (22 * 4 + 1) - (6 * 4) + 1 - 1
    assert dt.datetime(2026, 11, 16, 10, tzinfo=tz) not in slots
    assert _instant(body["day_starts_at"]) == dt.datetime(2026, 11, 16, 6, tzinfo=tz)


def test_slots_on_a_clock_change_day(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    """On the night clocks fall back the grid keeps to the local clock in both offsets."""
    tz = ZoneInfo("America/New_York")
    set_profile(db, user.id, timezone="America/New_York", wake_time="06:00", sleep_time="03:00")
    clock.set(Z(2026, 10, 31, 12))
    exam = insert_exam(db, user.id, exam_date="2026-11-10")
    task = insert_task(db, user.id, exam, minutes=60)
    start = dt.datetime(2026, 10, 31, 20, tzinfo=tz).astimezone(dt.UTC)
    block = insert_block(db, user.id, task, start, start + dt.timedelta(hours=1))

    body = _slots(api, user, block).json()
    slots = [_instant(slot) for slot in body["slots"]]
    assert all(slot.astimezone(tz).minute % 15 == 0 for slot in slots)
    # 01:00 local happens twice: once at -04:00 and once at -05:00.
    assert Z(2026, 11, 1, 5) in slots
    assert Z(2026, 11, 1, 6) in slots
    # The last start ends at 03:00 local (-05:00), 08:00 UTC.
    assert slots[-1] == Z(2026, 11, 1, 7)
    assert slots == sorted(set(slots))


def test_today_has_the_day_bounds(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    early = api.get("/today", headers=user.headers).json()  # 05:00, before the wake-up
    assert early["date"] == "2026-11-15"
    assert _instant(early["day_starts_at"]) == Z(2026, 11, 15, 6)
    assert _instant(early["day_ends_at"]) == Z(2026, 11, 15, 23)

    clock.set(Z(2026, 11, 16, 10))
    body = api.get("/today", headers=user.headers).json()
    assert _instant(body["day_starts_at"]) == Z(2026, 11, 16, 6)
    assert _instant(body["day_ends_at"]) == Z(2026, 11, 16, 23)

    set_profile(db, user.id, sleep_time="01:00")
    clock.set(Z(2026, 11, 17, 0, 30))  # still the 16th's study day
    late = api.get("/today", headers=user.headers).json()
    assert late["date"] == "2026-11-16"
    assert _instant(late["day_starts_at"]) == Z(2026, 11, 16, 6)
    assert _instant(late["day_ends_at"]) == Z(2026, 11, 17, 1)


def test_a_move_to_the_current_minute_is_refused(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    """At 10:00:30 a block moved to 10:00 would already be running: not before now."""
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 12), Z(2026, 11, 16, 13))
    clock.set(Z(2026, 11, 16, 10, 0) + dt.timedelta(seconds=30))

    slots = _slots(api, user, block)
    assert slots.status_code == 200, slots.text
    assert _instant(slots.json()["slots"][0]) == Z(2026, 11, 16, 10, 15)

    response = _move(api, user, block, starts_at=Z(2026, 11, 16, 10, 0))
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "outside_day"
    assert _move(api, user, block, starts_at=Z(2026, 11, 16, 10, 1)).status_code == 200


def test_a_move_to_now_on_a_whole_minute_fits(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    """At exactly 10:00 the block may start at 10:00, and 10:00 is a slot."""
    _, task = _setup(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 16, 12), Z(2026, 11, 16, 13))
    clock.set(Z(2026, 11, 16, 10))

    slots = _slots(api, user, block)
    assert _instant(slots.json()["slots"][0]) == Z(2026, 11, 16, 10)
    response = _move(api, user, block, starts_at=Z(2026, 11, 16, 10))
    assert response.status_code == 200, response.text
