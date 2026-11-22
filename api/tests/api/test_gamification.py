"""XP, levels, the study-day streak and badges through the API (S19).

The roadmap gate: marking a block done gives its XP once only. complete and uncomplete
change the ledger (app.xp_events) and the badges in the same transaction as the block;
GET /progress computes everything else from them.
"""

import datetime as dt
import threading
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
    scalar,
    set_profile,
)
from tests.fixtures_db import ApiUser, FrozenClock

MakeApiUser = Callable[[], ApiUser]

JERUSALEM = {**TEST_PROFILE, "timezone": "Asia/Jerusalem"}


@pytest.fixture
def user(make_api_user: MakeApiUser, db: psycopg.Connection, clock: FrozenClock) -> ApiUser:
    created = make_api_user()
    set_profile(db, created.id, **TEST_PROFILE)
    # 10:30 on Monday the 16th: after the 09:00 blocks most tests mark done, so they count
    # for the 16th (a block marked before it starts counts for the day it was marked).
    clock.set(NOW.replace(hour=10, minute=30))
    return created


def _task(db: psycopg.Connection, user: ApiUser, *, focus: int = 5, minutes: int = 600) -> UUID:
    exam = insert_exam(db, user.id, exam_date="2027-06-30")
    return insert_task(db, user.id, exam, minutes=minutes, focus=focus)


def _block(
    db: psycopg.Connection, user: ApiUser, starts: dt.datetime, minutes: int = 60, **kw: Any
) -> UUID:
    task = kw.pop("task", None) or _task(db, user, **kw)
    return insert_block(db, user.id, task, starts, starts + dt.timedelta(minutes=minutes))


def _act(api: TestClient, user: ApiUser, block: UUID, action: str) -> dict[str, Any]:
    response = api.post(f"/blocks/{block}/{action}", headers=user.headers)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _progress(api: TestClient, user: ApiUser) -> dict[str, Any]:
    response = api.get("/progress", headers=user.headers)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _ledger(db: psycopg.Connection, user: ApiUser) -> list[tuple[Any, ...]]:
    return db.execute(
        "SELECT block_id, xp, study_date FROM app.xp_events WHERE user_id = %s "
        "ORDER BY study_date, created_at",
        (user.id,),
    ).fetchall()


def _badges(db: psycopg.Connection, user: ApiUser) -> set[str]:
    rows = db.execute("SELECT badge_key FROM app.badges WHERE user_id = %s", (user.id,))
    return {row[0] for row in rows.fetchall()}


def _seed_xp(db: psycopg.Connection, user: ApiUser, xp: int, day: str = "2026-11-01") -> None:
    """XP from the past, as a ledger row whose block is gone (block_id NULL)."""
    db.execute(
        "INSERT INTO app.xp_events (user_id, block_id, xp, study_date) VALUES (%s, NULL, %s, %s)",
        (user.id, xp, day),
    )


# --- once only ------------------------------------------------------------------------------


def test_complete_gives_the_blocks_xp_once(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    block = _block(db, user, Z(2026, 11, 16, 9), focus=5)

    first = _act(api, user, block, "complete")["progress"]
    second = _act(api, user, block, "complete")["progress"]

    assert first == {
        "xp_change": 50,
        "total_xp": 50,
        "level": 1,
        "level_up": False,
        "badges_earned": ["first_task"],
        "badges_lost": [],
    }
    assert second == {**first, "xp_change": 0, "badges_earned": []}
    assert _ledger(db, user) == [(block, 50, dt.date(2026, 11, 16))]


def test_two_completes_at_once_give_the_xp_once(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    block = _block(db, user, Z(2026, 11, 16, 9), focus=8, minutes=90)
    start = threading.Barrier(2)
    answers: list[dict[str, Any]] = []

    def complete() -> None:
        start.wait()
        answers.append(_act(api, user, block, "complete")["progress"])

    threads = [threading.Thread(target=complete) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert len(answers) == 2
    assert sorted(answer["xp_change"] for answer in answers) == [0, 120]
    assert {answer["total_xp"] for answer in answers} == {120}
    assert _ledger(db, user) == [(block, 120, dt.date(2026, 11, 16))]


def test_uncomplete_takes_the_xp_back_and_complete_gives_it_again(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    block = _block(db, user, Z(2026, 11, 16, 9), focus=5)
    _act(api, user, block, "complete")

    undone = _act(api, user, block, "uncomplete")["progress"]
    assert undone == {
        "xp_change": -50,
        "total_xp": 0,
        "level": 1,
        "level_up": False,
        "badges_earned": [],
        "badges_lost": ["first_task"],
    }
    assert _ledger(db, user) == []
    assert _badges(db, user) == set()

    again = _act(api, user, block, "complete")["progress"]
    assert again["xp_change"] == 50
    assert again["total_xp"] == 50
    assert again["badges_earned"] == ["first_task"]
    assert len(_ledger(db, user)) == 1


def test_the_xp_follows_the_formula(api: TestClient, db: psycopg.Connection, user: ApiUser) -> None:
    # round(focus * max(minutes, 15) / 6): 10 min at focus 3 counts as 15 → round(7.5) = 8.
    short = _block(db, user, Z(2026, 11, 16, 9), minutes=10, focus=3)
    long = _block(db, user, Z(2026, 11, 16, 10), minutes=150, focus=10)

    assert _act(api, user, short, "complete")["progress"]["xp_change"] == 8
    assert _act(api, user, long, "complete")["progress"]["xp_change"] == 250


def test_a_missed_block_marked_done_earns_xp(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    task = _task(db, user)
    block = insert_block(
        db, user.id, task, Z(2026, 11, 15, 9), Z(2026, 11, 15, 10), status="missed"
    )

    assert _act(api, user, block, "complete")["progress"]["xp_change"] == 50


def test_a_block_done_before_s19_earns_nothing_until_it_is_marked_again(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    task = _task(db, user)
    block = insert_block(db, user.id, task, Z(2026, 11, 15, 9), Z(2026, 11, 15, 10), status="done")

    assert _act(api, user, block, "complete")["progress"]["xp_change"] == 0
    assert _act(api, user, block, "uncomplete")["progress"]["xp_change"] == 0
    assert _act(api, user, block, "complete")["progress"]["xp_change"] == 50


# --- levels ---------------------------------------------------------------------------------


def test_crossing_1000_xp_is_a_level_up_and_undo_takes_it_back(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    _seed_xp(db, user, 980)
    block = _block(db, user, Z(2026, 11, 16, 9), focus=5)

    up = _act(api, user, block, "complete")["progress"]
    assert (up["total_xp"], up["level"], up["level_up"]) == (1030, 2, True)
    assert "xp_1000" in up["badges_earned"]
    progress = _progress(api, user)
    assert (progress["level"], progress["level_start_xp"], progress["next_level_xp"]) == (
        2,
        1000,
        2000,
    )

    down = _act(api, user, block, "uncomplete")["progress"]
    assert (down["total_xp"], down["level"], down["level_up"]) == (980, 1, False)
    assert "xp_1000" in down["badges_lost"]


def test_the_level_stops_at_50(api: TestClient, db: psycopg.Connection, user: ApiUser) -> None:
    _seed_xp(db, user, 75_000)

    progress = _progress(api, user)

    assert (progress["level"], progress["max_level"]) == (50, 50)
    assert (progress["level_start_xp"], progress["next_level_xp"]) == (49_000, None)


# --- the streak -----------------------------------------------------------------------------


def _complete_at(
    api: TestClient,
    db: psycopg.Connection,
    user: ApiUser,
    clock: FrozenClock,
    starts: dt.datetime,
    minutes: int = 60,
) -> None:
    """Complete a block as it ends (the usual case: marked done right after)."""
    block = _block(db, user, starts, minutes)
    clock.set(starts + dt.timedelta(minutes=minutes))
    _act(api, user, block, "complete")


def test_the_streak_counts_study_days_and_a_day_without_study_ends_it(
    api: TestClient, db: psycopg.Connection, user: ApiUser, clock: FrozenClock
) -> None:
    for day in (10, 11, 13, 14, 15):
        _complete_at(api, db, user, clock, Z(2026, 11, day, 9))
    _complete_at(api, db, user, clock, Z(2026, 11, 15, 14))  # a second block, same day

    clock.set(Z(2026, 11, 16, 8))
    alive = _progress(api, user)["streak"]
    # Nothing yet today: the streak of 13-15 is still alive until today ends.
    assert alive == {"current": 3, "longest": 3, "studied_today": False, "today": "2026-11-16"}

    _complete_at(api, db, user, clock, Z(2026, 11, 16, 9))
    assert _progress(api, user)["streak"] == {
        "current": 4,
        "longest": 4,
        "studied_today": True,
        "today": "2026-11-16",
    }

    clock.set(Z(2026, 11, 18, 8))  # the 17th had no study
    assert _progress(api, user)["streak"] == {
        "current": 0,
        "longest": 4,
        "studied_today": False,
        "today": "2026-11-18",
    }


def test_the_streak_uses_the_users_timezone_and_the_study_day(
    api: TestClient, db: psycopg.Connection, user: ApiUser, clock: FrozenClock
) -> None:
    # Jerusalem is UTC+2 in November. The user sleeps at 02:00, so a block at 00:30 local
    # time belongs to the study day before, as "today" shows it.
    set_profile(db, user.id, **{**JERUSALEM, "sleep_time": "02:00", "wake_time": "08:00"})
    _complete_at(api, db, user, clock, Z(2026, 11, 15, 22, 30))  # 00:30 on the 16th, local

    assert _ledger(db, user)[0][2] == dt.date(2026, 11, 15)
    # 23:00 UTC on the 15th is 01:00 on the 16th local: still the study day of the 15th.
    clock.set(Z(2026, 11, 15, 23))
    assert _progress(api, user)["streak"]["today"] == "2026-11-15"
    assert _progress(api, user)["streak"]["studied_today"] is True


def test_the_local_day_decides_not_the_utc_day(
    api: TestClient, db: psycopg.Connection, user: ApiUser, clock: FrozenClock
) -> None:
    # Awake all day, so the study day is the local date: 22:30 UTC on the 14th is 00:30 on
    # the 15th in Jerusalem (UTC+2), and the block counts for the 15th, not the UTC 14th.
    set_profile(db, user.id, **{**JERUSALEM, "wake_time": "00:00", "sleep_time": "23:59"})
    _complete_at(api, db, user, clock, Z(2026, 11, 14, 22, 30), minutes=30)

    assert _ledger(db, user)[0][2] == dt.date(2026, 11, 15)


@pytest.mark.parametrize(
    ("days", "label"),
    [
        # Summer time ends at 02:00 on Sunday 2026-10-25 (a 25-hour day).
        ((dt.date(2026, 10, 24), dt.date(2026, 10, 25), dt.date(2026, 10, 26)), "winter"),
        # Summer time starts at 02:00 on Friday 2026-03-27 (a 23-hour day).
        ((dt.date(2026, 3, 26), dt.date(2026, 3, 27), dt.date(2026, 3, 28)), "summer"),
    ],
)
def test_the_streak_runs_through_a_clock_change(
    api: TestClient,
    db: psycopg.Connection,
    user: ApiUser,
    clock: FrozenClock,
    days: tuple[dt.date, ...],
    label: str,
) -> None:
    set_profile(db, user.id, **{**JERUSALEM, "sleep_time": "02:00", "wake_time": "08:00"})
    for day in days:
        # 00:30-01:30 local, the night after `day` (sleep at 02:00): on the change night it
        # ends where the hour repeats (winter) or where the gap starts (summer). It counts
        # for `day`.
        local = dt.datetime.combine(day + dt.timedelta(days=1), dt.time(0, 30))
        starts = local.replace(tzinfo=ZoneInfo("Asia/Jerusalem")).astimezone(dt.UTC)
        _complete_at(api, db, user, clock, starts)

    assert [row[2] for row in _ledger(db, user)] == list(days), label
    assert _progress(api, user)["streak"]["current"] == 3
    assert _progress(api, user)["streak"]["longest"] == 3


def test_a_block_in_the_repeated_hour_counts_for_the_evening_before(
    api: TestClient, db: psycopg.Connection, user: ApiUser, clock: FrozenClock
) -> None:
    # On 2026-10-25 Jerusalem goes from 02:00 summer time back to 01:00: 01:30 happens
    # twice. 23:30 UTC on the 24th is the second 01:30 (UTC+2), still before the 02:00 bedtime.
    set_profile(db, user.id, **{**JERUSALEM, "sleep_time": "02:00", "wake_time": "08:00"})
    _complete_at(api, db, user, clock, Z(2026, 10, 24, 23, 30), minutes=20)

    assert _ledger(db, user)[0][2] == dt.date(2026, 10, 24)


def test_a_block_marked_late_counts_for_its_own_day(
    api: TestClient, db: psycopg.Connection, user: ApiUser, clock: FrozenClock
) -> None:
    block = _block(db, user, Z(2026, 11, 14, 9))
    clock.set(Z(2026, 11, 16, 7))  # forgot to mark it; marked two days later

    _act(api, user, block, "complete")

    assert _ledger(db, user)[0][2] == dt.date(2026, 11, 14)


def test_a_block_marked_early_counts_for_today_not_its_future_day(
    api: TestClient, db: psycopg.Connection, user: ApiUser, clock: FrozenClock
) -> None:
    block = _block(db, user, Z(2026, 11, 18, 9))
    clock.set(Z(2026, 11, 16, 9))

    _act(api, user, block, "complete")

    assert _ledger(db, user)[0][2] == dt.date(2026, 11, 16)
    assert _progress(api, user)["streak"]["studied_today"] is True


def test_a_new_timezone_does_not_move_days_already_counted(
    api: TestClient, db: psycopg.Connection, user: ApiUser, clock: FrozenClock
) -> None:
    _complete_at(api, db, user, clock, Z(2026, 11, 15, 9))
    _complete_at(api, db, user, clock, Z(2026, 11, 16, 9))
    set_profile(db, user.id, timezone="Pacific/Kiritimati")  # UTC+14

    assert [row[2] for row in _ledger(db, user)] == [dt.date(2026, 11, 15), dt.date(2026, 11, 16)]
    assert _progress(api, user)["streak"]["longest"] == 2


def test_progress_lists_the_last_14_days_with_their_xp(
    api: TestClient, db: psycopg.Connection, user: ApiUser, clock: FrozenClock
) -> None:
    _seed_xp(db, user, 500, day="2026-11-02")  # outside the 14 days
    _complete_at(api, db, user, clock, Z(2026, 11, 3, 9))
    _complete_at(api, db, user, clock, Z(2026, 11, 16, 9))
    _complete_at(api, db, user, clock, Z(2026, 11, 16, 11), minutes=30)

    days = _progress(api, user)["days"]

    assert [day["date"] for day in days] == [f"2026-11-{n:02d}" for n in range(3, 17)]
    assert days[0]["xp"] == 50
    assert days[-1]["xp"] == 75
    assert sum(day["xp"] for day in days) == 125


# --- badges ---------------------------------------------------------------------------------


def test_a_new_user_has_nothing_yet(api: TestClient, user: ApiUser) -> None:
    progress = _progress(api, user)

    assert progress["total_xp"] == 0
    assert progress["level"] == 1
    assert (progress["level_start_xp"], progress["next_level_xp"]) == (0, 1000)
    assert progress["blocks_done"] == 0
    assert progress["streak"] == {
        "current": 0,
        "longest": 0,
        "studied_today": False,
        "today": "2026-11-16",
    }
    assert len(progress["days"]) == 14
    assert len(progress["badges"]) == 18
    assert not any(badge["earned"] for badge in progress["badges"])
    assert progress["badges"][0] == {
        "key": "first_task",
        "group": "first",
        "threshold": 1,
        "earned": False,
        "earned_at": None,
    }


def test_badges_follow_the_ledger(
    api: TestClient, db: psycopg.Connection, user: ApiUser, clock: FrozenClock
) -> None:
    task = _task(db, user, minutes=600)
    blocks = [
        insert_block(
            db,
            user.id,
            task,
            Z(2026, 11, 16, 6) + dt.timedelta(minutes=40 * n),
            Z(2026, 11, 16, 6) + dt.timedelta(minutes=40 * n + 30),
        )
        for n in range(10)
    ]
    clock.set(Z(2026, 11, 16, 20))
    earned: list[str] = []
    for block in blocks:
        earned += _act(api, user, block, "complete")["progress"]["badges_earned"]
    assert earned == ["first_task", "task_master_10"]

    lost = _act(api, user, blocks[0], "uncomplete")["progress"]["badges_lost"]
    assert lost == ["task_master_10"]
    assert _badges(db, user) == {"first_task"}

    progress = _progress(api, user)
    by_key = {badge["key"]: badge for badge in progress["badges"]}
    assert by_key["first_task"]["earned"] is True
    assert by_key["first_task"]["earned_at"] is not None
    assert by_key["task_master_10"]["earned"] is False
    assert progress["blocks_done"] == 9


def test_a_streak_badge_stays_after_the_streak_ends(
    api: TestClient, db: psycopg.Connection, user: ApiUser, clock: FrozenClock
) -> None:
    for day in range(1, 8):
        _complete_at(api, db, user, clock, Z(2026, 11, day, 9))
    assert "iron_will_7" in _badges(db, user)

    clock.set(Z(2026, 11, 16, 9))  # a week without study
    _complete_at(api, db, user, clock, Z(2026, 11, 16, 10))

    assert "iron_will_7" in _badges(db, user)
    assert _progress(api, user)["streak"]["current"] == 1


# --- ownership ------------------------------------------------------------------------------


def test_another_user_sees_and_changes_none_of_it(
    api: TestClient, db: psycopg.Connection, user: ApiUser, make_api_user: MakeApiUser
) -> None:
    block = _block(db, user, Z(2026, 11, 16, 9))
    _act(api, user, block, "complete")
    other = make_api_user()
    set_profile(db, other.id, **TEST_PROFILE)

    assert api.post(f"/blocks/{block}/uncomplete", headers=other.headers).status_code == 404
    assert api.post(f"/blocks/{block}/complete", headers=other.headers).status_code == 404
    theirs = _progress(api, other)

    assert theirs["total_xp"] == 0
    assert not any(badge["earned"] for badge in theirs["badges"])
    assert scalar(db, "SELECT count(*) FROM app.xp_events WHERE user_id = %s", other.id) == 0
    assert _ledger(db, user) == [(block, 50, dt.date(2026, 11, 16))]
    assert _badges(db, user) == {"first_task"}


def test_progress_needs_a_token(api: TestClient) -> None:
    assert api.get("/progress").status_code == 401


# --- S34 decision 8: the first plan's XP is XP, not a block or a study day ------------------


def _first_plan_xp(db: psycopg.Connection, user: ApiUser, day: str = "2026-11-16") -> None:
    db.execute(
        "INSERT INTO app.xp_events (user_id, block_id, xp, study_date, kind) "
        "VALUES (%s, NULL, 50, %s, 'first_plan')",
        (user.id, day),
    )


def test_the_first_plan_xp_counts_in_the_total_only(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    _first_plan_xp(db, user)

    progress = _progress(api, user)

    assert progress["total_xp"] == 50
    assert progress["blocks_done"] == 0
    assert progress["streak"] == {
        "current": 0,
        "longest": 0,
        "studied_today": False,
        "today": "2026-11-16",
    }
    assert [day["xp"] for day in progress["days"]] == [0] * 14
    first_task = next(badge for badge in progress["badges"] if badge["key"] == "first_task")
    assert first_task["earned"] is False


def test_a_block_after_the_first_plan_adds_to_it_and_its_undo_keeps_it(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    _first_plan_xp(db, user)
    block = _block(db, user, Z(2026, 11, 16, 9), focus=5)

    done = _act(api, user, block, "complete")["progress"]

    assert done["xp_change"] == 50
    assert done["total_xp"] == 100
    assert done["badges_earned"] == ["first_task"]
    progress = _progress(api, user)
    assert progress["blocks_done"] == 1
    assert progress["streak"]["current"] == 1
    assert progress["days"][-1]["xp"] == 50  # the block's, not the plan's

    undone = _act(api, user, block, "uncomplete")["progress"]

    assert undone["total_xp"] == 50
    assert undone["badges_lost"] == ["first_task"]
    assert _progress(api, user)["blocks_done"] == 0
    assert (
        scalar(
            db,
            "SELECT count(*) FROM app.xp_events WHERE user_id = %s AND kind = 'first_plan'",
            user.id,
        )
        == 1
    )


def test_a_completed_block_is_written_as_a_block(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    block = _block(db, user, Z(2026, 11, 16, 9), focus=5)
    _act(api, user, block, "complete")

    assert scalar(db, "SELECT kind FROM app.xp_events WHERE block_id = %s", block) == "block"
