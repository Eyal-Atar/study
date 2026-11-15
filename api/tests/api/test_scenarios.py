"""End-to-end scenarios through the API only (the database is used to create users).

Each scenario walks a user through several endpoints and checks, after every step, that
GET /plan and GET /today agree with each other and with the user's tasks: no overlaps,
every todo task either covered by its live blocks or listed in `unplaced`, and no block
of a deleted task.
"""

import datetime as dt
import itertools
import threading
from collections.abc import Callable, Iterable
from typing import Any
from zoneinfo import ZoneInfo

import psycopg
import pytest
from fastapi.testclient import TestClient

from tests.api.factories import NOW, TEST_PROFILE, Z, replan_apply, replan_preview
from tests.fixtures_db import ApiUser, FrozenClock

MakeApiUser = Callable[[], ApiUser]
JSON = dict[str, Any]


def _ok(response: Any, status: int = 200) -> Any:
    assert response.status_code == status, response.text
    return response.json()


def _time(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value)


def _onboard(api: TestClient, user: ApiUser, **profile: Any) -> JSON:
    _ok(api.get("/me", headers=user.headers))
    body: JSON = _ok(api.patch("/me", json={**TEST_PROFILE, **profile}, headers=user.headers))
    return body


def _exam(api: TestClient, user: ApiUser, name: str, date: str, difficulty: int = 3) -> str:
    body = _ok(
        api.post(
            "/exams",
            json={"name": name, "exam_date": date, "difficulty": difficulty},
            headers=user.headers,
        ),
        201,
    )
    assert body["plan_affected"] is True
    exam_id: str = body["exam"]["id"]
    return exam_id


def _task(
    api: TestClient,
    user: ApiUser,
    exam: str,
    title: str,
    kind: str = "learn",
    minutes: int = 60,
    depends_on: str | None = None,
    focus: int = 5,
) -> JSON:
    body: JSON = _ok(
        api.post(
            "/tasks",
            json={
                "exam_id": exam,
                "title": title,
                "kind": kind,
                "estimated_minutes": minutes,
                "focus": focus,
                "depends_on_task_id": depends_on,
            },
            headers=user.headers,
        ),
        201,
    )
    assert body["placement"]["placed"] in (True, False)
    return body


def _tasks(api: TestClient, user: ApiUser) -> list[JSON]:
    tasks: list[JSON] = []
    for exam in _ok(api.get("/exams", headers=user.headers)):
        tasks.extend(_ok(api.get(f"/exams/{exam['id']}/tasks", headers=user.headers)))
    return tasks


def _plan(api: TestClient, user: ApiUser, first: str, last: str) -> JSON:
    body: JSON = _ok(api.get("/plan", params={"from": first, "to": last}, headers=user.headers))
    return body


def _no_overlaps(blocks: Iterable[JSON]) -> None:
    live = sorted(
        (_time(b["starts_at"]), _time(b["ends_at"]), b["id"])
        for b in blocks
        if b["status"] in ("planned", "done")
    )
    for (_, end, first), (start, _, second) in itertools.pairwise(live):
        assert end <= start, f"blocks {first} and {second} overlap"


def check_consistent(
    api: TestClient,
    user: ApiUser,
    now: dt.datetime,
    first: str,
    last: str,
    deleted: Iterable[str] = (),
) -> JSON:
    """GET /plan over [first, last] and GET /today agree with the tasks; returns the plan."""
    plan = _plan(api, user, first, last)
    today = _ok(api.get("/today", headers=user.headers))
    blocks: list[JSON] = plan["blocks"]
    _no_overlaps(blocks)
    _no_overlaps(today["blocks"])

    by_id = {b["id"]: b for b in blocks}
    assert len(by_id) == len(blocks)
    for block in today["blocks"]:
        assert block["study_date"] == today["date"]
        if first <= today["date"] <= last:
            assert by_id.get(block["id"]) == block, "GET /today and GET /plan disagree"
    if first <= today["date"] <= last:
        assert {b["id"] for b in blocks if b["study_date"] == today["date"]} == {
            b["id"] for b in today["blocks"]
        }

    tasks = {t["id"]: t for t in _tasks(api, user)}
    gone = set(deleted)
    assert not gone & tasks.keys()
    for block in [*blocks, *today["blocks"]]:
        assert block["task_id"] not in gone, f"block {block['id']} of a deleted task"
        assert block["task_id"] in tasks, f"block {block['id']} of an unknown task"

    unplaced = {u["task_id"]: u for u in plan["unplaced"]}
    assert len(unplaced) == len(plan["unplaced"])
    start = now.replace(second=0, microsecond=0)
    if now != start:
        start += dt.timedelta(minutes=1)
    for task_id, task in tasks.items():
        live = [
            b
            for b in blocks
            if b["task_id"] == task_id
            and (
                b["status"] == "done" or (b["status"] == "planned" and _time(b["ends_at"]) > start)
            )
        ]
        minutes = sum(
            (_time(b["ends_at"]) - _time(b["starts_at"])) // dt.timedelta(minutes=1) for b in live
        )
        if task["status"] != "todo":
            assert task_id not in unplaced
            continue
        covered = minutes >= task["estimated_minutes"] or (task["kind"] == "simulation" and live)
        if covered:
            assert task_id not in unplaced, f"task {task['title']} is covered and unplaced"
        else:
            assert task_id in unplaced, f"task {task['title']} vanished: no blocks, not unplaced"
            assert unplaced[task_id]["minutes"] == task["estimated_minutes"] - minutes
    return plan


def _planned(plan: JSON) -> set[tuple[str, str, str, str]]:
    return {
        (b["id"], b["task_id"], b["starts_at"], b["ends_at"])
        for b in plan["blocks"]
        if b["status"] == "planned"
    }


@pytest.fixture
def user(make_api_user: MakeApiUser, clock: FrozenClock) -> ApiUser:
    clock.set(NOW)
    return make_api_user()


def test_onboarding_to_undo_to_defer(api: TestClient, user: ApiUser, clock: FrozenClock) -> None:
    me = _ok(api.get("/me", headers=user.headers))
    assert me["id"] == str(user.id)
    profile = _onboard(api, user, study_windows=["morning", "afternoon", "evening"])
    assert profile["timezone"] == "UTC"
    first, last = "2026-11-14", "2026-12-05"
    check_consistent(api, user, NOW, first, last)

    physics = _exam(api, user, "פיזיקה", "2026-11-24", difficulty=4)
    history = _exam(api, user, "היסטוריה", "2026-11-27")
    _task(api, user, physics, "קריאה", "learn", 90)
    _task(api, user, physics, "תרגול", "practice", 60, focus=8)
    sim = _task(api, user, physics, "סימולציה", "simulation", 120)
    _task(api, user, physics, "תחקיר", "simulation_review", 60, depends_on=sim["task"]["id"])
    _task(api, user, history, "חזרה", "review", 90)
    check_consistent(api, user, NOW, first, last)

    preview = replan_preview(api, user)
    applied = replan_apply(api, user, preview["basis"])
    assert applied["basis"] == preview["basis"]
    plan = check_consistent(api, user, NOW, first, last)
    assert plan["unplaced"] == [], "five small tasks fit in a week"
    blocks = sorted(plan["blocks"], key=lambda b: b["starts_at"])
    assert len({b["task_id"] for b in blocks}) == 5
    by_task = {b["task_id"]: b for b in blocks}
    sim_block = by_task[sim["task"]["id"]]
    review_block = next(b for b in blocks if b["task_kind"] == "simulation_review")
    assert sim_block["study_date"] < review_block["study_date"]

    # Complete the first block while it is in progress.
    first_block = blocks[0]
    clock.set(_time(first_block["starts_at"]) + dt.timedelta(minutes=10))
    done = _ok(api.post(f"/blocks/{first_block['id']}/complete", headers=user.headers))
    assert done["block"]["status"] == "done"
    plan = check_consistent(api, user, clock.now, first, last)

    # Defer a later block of the history exam, then undo the defer.
    target = next(
        b
        for b in sorted(plan["blocks"], key=lambda b: b["starts_at"])
        if b["status"] == "planned"
        and b["exam_id"] == history
        and _time(b["starts_at"]) > clock.now
    )
    before_defer = _planned(plan)
    deferred = _ok(api.post(f"/blocks/{target['id']}/defer", headers=user.headers))
    assert deferred["version_id"] is not None
    plan = check_consistent(api, user, clock.now, first, last)
    assert plan["undo"]["version_id"] == deferred["version_id"]
    assert plan["undo"]["reason"] == "defer"
    assert _planned(plan) != before_defer
    moved = [b for b in plan["blocks"] if b["task_id"] == target["task_id"]]
    assert all(_time(b["starts_at"]) >= _time(target["ends_at"]) for b in moved)
    others = {b for b in _planned(plan) if b[1] != target["task_id"]}
    assert others == {b for b in before_defer if b[1] != target["task_id"]}

    undone = _ok(
        api.post("/plan/undo", json={"version_id": deferred["version_id"]}, headers=user.headers)
    )
    assert undone["restored"] >= 1
    plan = check_consistent(api, user, clock.now, first, last)
    assert _planned(plan) == before_defer
    assert plan["undo"] is None or plan["undo"]["version_id"] != deferred["version_id"]
    # The completed block is still done.
    assert next(b for b in plan["blocks"] if b["id"] == first_block["id"])["status"] == "done"


def test_tasks_do_not_vanish(api: TestClient, user: ApiUser) -> None:
    _onboard(api, user)
    exam = _exam(api, user, "מבחן", "2026-11-23")
    created: list[JSON] = []
    for n in range(5):
        # The task after the middle one depends on it: deleting the middle frees it.
        depends_on = created[2]["task"]["id"] if n == 3 else None
        created.append(
            _task(api, user, exam, f"משימה {n}", minutes=60 + 15 * n, depends_on=depends_on)
        )
    replan_apply(api, user)
    first, last = "2026-11-15", "2026-11-30"
    plan = check_consistent(api, user, NOW, first, last)
    assert plan["unplaced"] == []
    ids = [body["task"]["id"] for body in created]

    def blocks_of(plan: JSON) -> dict[str, set[str]]:
        found: dict[str, set[str]] = {task: set() for task in ids}
        for block in plan["blocks"]:
            found[block["task_id"]].add(block["id"])
        return found

    before = blocks_of(plan)
    assert all(before.values())
    middle = ids[2]
    deleted = _ok(api.delete(f"/tasks/{middle}", headers=user.headers))
    assert deleted["version_id"] is not None
    check_consistent(api, user, NOW, first, last, deleted=[middle])

    replan_apply(api, user)
    plan = check_consistent(api, user, NOW, first, last, deleted=[middle])
    after = blocks_of(plan)
    assert after[middle] == set()
    unplaced = {u["task_id"] for u in plan["unplaced"]}
    for task in ids:
        if task == middle:
            continue
        assert after[task] or task in unplaced, f"task {task} vanished"
        assert after[task] == before[task], "a task the deletion did not touch moved"

    # The remaining tasks keep their titles and ids, in order (no index-based remapping).
    remaining = _ok(api.get(f"/exams/{exam}/tasks", headers=user.headers))
    assert [(t["id"], t["title"]) for t in remaining] == [
        (body["task"]["id"], body["task"]["title"])
        for body in created
        if body["task"]["id"] != middle
    ]


def test_second_device_timezone(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    # 04:30 UTC on Monday: 06:30 in Jerusalem (awake, Monday), 23:30 on Sunday in New York.
    clock.set(Z(2026, 11, 16, 4, 30))
    _onboard(api, user, timezone="Asia/Jerusalem")
    exam = _exam(api, user, "מבחן", "2026-11-22")
    _task(api, user, exam, "משימה", minutes=120)
    _task(api, user, exam, "עוד משימה", minutes=90)
    replan_apply(api, user)
    today = _ok(api.get("/today", headers=user.headers))
    assert today["date"] == "2026-11-16"

    def stored() -> list[tuple[Any, ...]]:
        return [
            tuple(row)
            for row in db.execute(
                "SELECT id, starts_at, ends_at, status, part_index, part_count FROM app.blocks "
                "WHERE user_id = %s ORDER BY id",
                (user.id,),
            ).fetchall()
        ]

    before = stored()
    assert before
    patched = _ok(api.patch("/me", json={"timezone": "America/New_York"}, headers=user.headers))
    assert patched["timezone"] == "America/New_York"
    assert patched["plan_affected"] is True

    today = _ok(api.get("/today", headers=user.headers))
    assert today["date"] == "2026-11-15"
    assert _ok(api.get("/me", headers=user.headers))["timezone"] == "America/New_York"
    plan = _ok(api.get("/plan", headers=user.headers))
    assert plan["from"] == "2026-11-15"
    ny = ZoneInfo("America/New_York")
    for block in plan["blocks"]:
        local = _time(block["starts_at"]).astimezone(ny)
        expected = local.date() if local.time() >= dt.time(6, 0) else local.date() - dt.timedelta(1)
        assert block["study_date"] == expected.isoformat()
        assert block["starts_at"].endswith("Z")
    assert stored() == before


def test_concurrent_requests_do_not_double_place(
    api: TestClient, user: ApiUser, clock: FrozenClock
) -> None:
    _onboard(api, user, daily_study_minutes=180)
    exam = _exam(api, user, "מבחן", "2026-11-19")
    results: list[Any] = []
    errors: list[BaseException] = []

    for round_ in range(4):
        barrier = threading.Barrier(2)

        def post(title: str, barrier: threading.Barrier = barrier) -> None:
            try:
                barrier.wait(5)
                results.append(
                    api.post(
                        "/tasks",
                        json={
                            "exam_id": exam,
                            "title": title,
                            "kind": "practice",
                            "estimated_minutes": 90,
                        },
                        headers=user.headers,
                    )
                )
            except BaseException as error:  # reported to the test thread
                errors.append(error)

        threads = [
            threading.Thread(target=post, args=(f"סבב {round_} משימה {n}",)) for n in range(2)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(20)
        assert not any(thread.is_alive() for thread in threads)

    assert errors == []
    assert len(results) == 8
    for response in results:
        assert response.status_code == 201, response.text
        assert response.json()["placement"]["placed"] in (True, False)
    plan = check_consistent(api, user, NOW, "2026-11-15", "2026-11-20")
    placed = {r.json()["task"]["id"] for r in results if r.json()["placement"]["placed"]}
    on_board = {b["task_id"] for b in plan["blocks"]}
    assert placed <= on_board
    # 180 minutes a day for three days hold at most 540 minutes; nothing is placed twice.
    for task_id in on_board:
        minutes = sum(
            (_time(b["ends_at"]) - _time(b["starts_at"])) // dt.timedelta(minutes=1)
            for b in plan["blocks"]
            if b["task_id"] == task_id
        )
        assert minutes == 90


def test_dst_week_in_jerusalem(api: TestClient, user: ApiUser, clock: FrozenClock) -> None:
    """Israel leaves summer time at 02:00 on Sunday 2026-10-25 (back to 01:00)."""
    tz = ZoneInfo("Asia/Jerusalem")
    clock.set(Z(2026, 10, 23, 5, 0))  # 08:00 on Friday, local summer time
    _onboard(
        api,
        user,
        timezone="Asia/Jerusalem",
        wake_time="06:00",
        sleep_time="02:00",
        study_windows=["evening", "night"],
        daily_study_minutes=600,
    )
    exam = _exam(api, user, "מבחן", "2026-10-30")
    for n in range(10):
        _task(api, user, exam, f"משימה {n}", minutes=120, focus=1 + n % 10)
    applied = replan_apply(api, user)
    assert applied["changed"] in (True, False)

    plan = check_consistent(api, user, clock.now, "2026-10-23", "2026-10-29")
    blocks = plan["blocks"]
    assert blocks
    tasks = _tasks(api, user)
    assert len(tasks) == 10
    whole = _plan(api, user, "2026-10-20", "2026-11-05")["blocks"]
    assert {b["id"] for b in whole} == {b["id"] for b in blocks}, "a block outside the week"

    def local(day: dt.date, hour: int) -> dt.datetime:
        return dt.datetime.combine(day, dt.time(hour), tz)

    offsets = set()
    for block in blocks:
        start, end = _time(block["starts_at"]), _time(block["ends_at"])
        day = dt.date.fromisoformat(block["study_date"])
        # Waking hours of the study day: 06:00 to 02:00 the next morning, local time.
        assert local(day, 6) <= start < local(day + dt.timedelta(1), 2), block
        # Inside the evening and night windows: 17:00 to 02:00 the next morning.
        assert local(day, 17) <= start, block
        assert end <= local(day + dt.timedelta(1), 2), block
        assert day <= dt.date(2026, 10, 29)
        offsets.add(start.astimezone(tz).utcoffset())
    assert offsets == {dt.timedelta(hours=3), dt.timedelta(hours=2)}, "the week crosses DST"
    # The night of the change (Saturday) is a study day of its own.
    assert any(b["study_date"] == "2026-10-24" for b in blocks)


def _together(calls: list[Callable[[], Any]]) -> list[Any]:
    """Run the calls at once, one thread each, and return their results in order."""
    barrier = threading.Barrier(len(calls))
    results: list[Any] = [None] * len(calls)
    errors: list[BaseException] = []

    def run(index: int) -> None:
        try:
            barrier.wait(5)
            results[index] = calls[index]()
        except BaseException as error:  # reported to the test thread
            errors.append(error)

    threads = [threading.Thread(target=run, args=(index,)) for index in range(len(calls))]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(20)
    assert not any(thread.is_alive() for thread in threads)
    assert errors == []
    return results


def test_concurrent_adds_then_undo_takes_back_the_last_one(api: TestClient, user: ApiUser) -> None:
    """The newest version is the one committed last, so undo never eats the other task."""
    _onboard(api, user)
    exam = _exam(api, user, "מבחן", "2026-11-25")
    first, last = "2026-11-15", "2026-11-30"
    for round_ in range(3):

        def add(title: str) -> Callable[[], Any]:
            body = {"exam_id": exam, "title": title, "kind": "learn", "estimated_minutes": 60}
            return lambda: api.post("/tasks", json=body, headers=user.headers)

        responses = _together([add(f"סבב {round_} א"), add(f"סבב {round_} ב")])
        bodies = [_ok(response, 201) for response in responses]
        assert all(body["placement"]["placed"] for body in bodies)
        plan = check_consistent(api, user, NOW, first, last)
        latest = plan["undo"]["version_id"]
        undone_body = next(body for body in bodies if body["version_id"] == latest)
        kept_body = next(body for body in bodies if body["version_id"] != latest)
        kept = kept_body["task"]["id"]
        kept_blocks = {b["id"] for b in plan["blocks"] if b["task_id"] == kept}

        _ok(api.post("/plan/undo", json={"version_id": latest}, headers=user.headers))
        plan = check_consistent(api, user, NOW, first, last, deleted=[undone_body["task"]["id"]])
        assert {b["id"] for b in plan["blocks"] if b["task_id"] == kept} == kept_blocks
        assert kept not in {u["task_id"] for u in plan["unplaced"]}


def test_first_requests_of_a_new_user_at_once(api: TestClient, user: ApiUser) -> None:
    """Every endpoint creates the profile on first use; doing so twice at once is fine."""
    calls: list[Callable[[], Any]] = [
        lambda: api.get("/me", headers=user.headers),
        lambda: api.get("/me", headers=user.headers),
        lambda: api.get("/today", headers=user.headers),
        lambda: api.get("/plan", headers=user.headers),
        lambda: api.patch("/me", json={"daily_study_minutes": 200}, headers=user.headers),
        lambda: api.post(
            "/exams", json={"name": "מבחן", "exam_date": "2026-11-25"}, headers=user.headers
        ),
        lambda: api.post("/plan/replan", json={"preview": True}, headers=user.headers),
    ]
    responses = _together(calls)
    assert [r.status_code for r in responses] == [200, 200, 200, 200, 200, 201, 200], [
        r.text for r in responses
    ]
    assert _ok(api.get("/me", headers=user.headers))["daily_study_minutes"] == 200
