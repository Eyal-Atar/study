"""S44: deferrals in a row, the split offer, the split, its undo and "Not now"."""

import datetime as dt
from collections.abc import Callable
from typing import Any
from uuid import UUID

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.domain.gamification import block_xp
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

# The audit's example (section 15): user content stays in the user's language.
TITLE = "תרגול: malloc ו-free"  # noqa: RUF001


@pytest.fixture
def user(make_api_user: MakeApiUser, db: psycopg.Connection, clock: FrozenClock) -> ApiUser:
    created = make_api_user()
    set_profile(db, created.id, **TEST_PROFILE)
    clock.set(NOW)
    return created


def _planned(db: psycopg.Connection, task: UUID) -> list[tuple[UUID, dt.datetime, dt.datetime]]:
    return [
        (row[0], row[1], row[2])
        for row in db.execute(
            "SELECT id, starts_at, ends_at FROM app.blocks "
            "WHERE task_id = %s AND status = 'planned' ORDER BY starts_at",
            (task,),
        ).fetchall()
    ]


def _next_block(db: psycopg.Connection, task: UUID) -> UUID:
    return _planned(db, task)[0][0]


def _defer(api: TestClient, user: ApiUser, db: psycopg.Connection, task: UUID) -> str:
    response = api.post(f"/blocks/{_next_block(db, task)}/defer", json={}, headers=user.headers)
    assert response.status_code == 200, response.text
    version: str = response.json()["version_id"]
    return version


def _offers(api: TestClient, user: ApiUser) -> list[dict[str, Any]]:
    response = api.get("/split-offers", headers=user.headers)
    assert response.status_code == 200, response.text
    offers: list[dict[str, Any]] = response.json()["offers"]
    return offers


def _split(api: TestClient, user: ApiUser, task: UUID, basis: str) -> Any:
    return api.post(f"/tasks/{task}/split", json={"basis": basis}, headers=user.headers)


def _dismiss(api: TestClient, user: ApiUser, task: UUID) -> Any:
    return api.post(f"/tasks/{task}/split/dismiss", headers=user.headers)


def _undo(api: TestClient, user: ApiUser, version_id: str) -> Any:
    return api.post("/plan/undo", json={"version_id": version_id}, headers=user.headers)


def _task_90(api: TestClient, user: ApiUser, db: psycopg.Connection, **kwargs: Any) -> UUID:
    exam = insert_exam(db, user.id, exam_date="2026-11-30")
    task = insert_task(db, user.id, exam, kind="practice", title=TITLE, **kwargs)
    replan_apply(api, user)
    return task


def _minutes(start: dt.datetime, end: dt.datetime) -> int:
    return int((end - start).total_seconds() // 60)


def test_two_deferrals_bring_no_offer_and_the_third_does(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    task = _task_90(api, user, db, minutes=90)
    _defer(api, user, db, task)
    _defer(api, user, db, task)
    assert _offers(api, user) == []
    _defer(api, user, db, task)
    (offer,) = _offers(api, user)
    ((block_id, _, _),) = _planned(db, task)
    assert offer["task_id"] == str(task)
    assert offer["task_title"] == TITLE
    assert offer["task_kind"] == "practice"
    assert offer["deferrals"] == 3
    assert offer["block"]["id"] == str(block_id)
    assert offer["block"]["minutes"] == 90
    assert offer["bite_minutes"] == 30
    assert [part["minutes"] for part in offer["parts"]] == [30, 30, 30]
    # One bite a day.
    assert len({part["starts_at"][:10] for part in offer["parts"]}) == 3
    assert offer["basis"]


def test_the_split_writes_the_parts_the_offer_showed(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    task = _task_90(api, user, db, minutes=90)
    for _ in range(3):
        _defer(api, user, db, task)
    (offer,) = _offers(api, user)
    response = _split(api, user, task, offer["basis"])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["task_id"] == str(task)
    assert body["bite_minutes"] == 30
    assert body["version_id"]
    planned = _planned(db, task)
    assert [(s, e) for _, s, e in planned] == [
        (dt.datetime.fromisoformat(p["starts_at"]), dt.datetime.fromisoformat(p["ends_at"]))
        for p in offer["parts"]
    ]
    assert [block["id"] for block in body["blocks"]] == [str(b) for b, _, _ in planned]
    assert scalar(db, "SELECT bite_minutes FROM app.tasks WHERE id = %s", task) == 30
    assert scalar(db, "SELECT estimated_minutes FROM app.tasks WHERE id = %s", task) == 90
    # The split starts the count over.
    assert _offers(api, user) == []
    task_out = api.get(f"/exams/{offer['exam_id']}/tasks", headers=user.headers)
    if task_out.status_code == 200:
        (listed,) = task_out.json()
        assert listed["bite_minutes"] == 30


def test_a_replan_after_the_split_keeps_the_bites(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    task = _task_90(api, user, db, minutes=90)
    for _ in range(3):
        _defer(api, user, db, task)
    assert _split(api, user, task, _offers(api, user)[0]["basis"]).status_code == 200
    db.execute("DELETE FROM app.blocks WHERE task_id = %s AND status = 'planned'", (task,))
    replan_apply(api, user)
    assert [_minutes(s, e) for _, s, e in _planned(db, task)] == [30, 30, 30]


def test_undo_of_the_split_brings_the_block_back_and_the_offer_with_it(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    task = _task_90(api, user, db, minutes=90)
    for _ in range(3):
        _defer(api, user, db, task)
    before = _planned(db, task)
    response = _split(api, user, task, _offers(api, user)[0]["basis"])
    undone = _undo(api, user, response.json()["version_id"])
    assert undone.status_code == 200, undone.text
    assert _planned(db, task) == before
    assert scalar(db, "SELECT bite_minutes FROM app.tasks WHERE id = %s", task) is None
    (offer,) = _offers(api, user)
    assert offer["deferrals"] == 3


def test_a_stale_basis_is_refused_and_nothing_is_written(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    task = _task_90(api, user, db, minutes=90)
    for _ in range(3):
        _defer(api, user, db, task)
    basis = _offers(api, user)[0]["basis"]
    db.execute("UPDATE app.tasks SET focus = 7 WHERE id = %s", (task,))
    before = _planned(db, task)
    response = _split(api, user, task, basis)
    assert response.status_code == 409
    assert response.json()["code"] == "stale_plan"
    assert _planned(db, task) == before
    assert scalar(db, "SELECT bite_minutes FROM app.tasks WHERE id = %s", task) is None


def test_split_and_dismiss_without_an_offer_are_refused(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    task = _task_90(api, user, db, minutes=90)
    _defer(api, user, db, task)
    _defer(api, user, db, task)
    basis = api.post("/plan/replan", json={"preview": True}, headers=user.headers).json()["basis"]
    response = _split(api, user, task, basis)
    assert response.status_code == 409
    assert response.json()["code"] == "no_split_offer"
    assert response.json()["title"] == "I don't have a split to offer for this task right now."
    assert _dismiss(api, user, task).json()["code"] == "no_split_offer"


def test_a_block_under_an_hour_gets_no_offer(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    task = _task_90(api, user, db, minutes=55)
    for _ in range(3):
        _defer(api, user, db, task)
    assert _offers(api, user) == []


def test_not_now_hides_the_offer_until_three_more_deferrals(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    task = _task_90(api, user, db, minutes=90)
    for _ in range(3):
        _defer(api, user, db, task)
    response = _dismiss(api, user, task)
    assert response.status_code == 204, response.text
    assert _offers(api, user) == []
    _defer(api, user, db, task)
    _defer(api, user, db, task)
    assert _offers(api, user) == []
    _defer(api, user, db, task)
    (offer,) = _offers(api, user)
    assert offer["deferrals"] == 3


def test_undo_of_a_deferral_takes_it_out_of_the_count(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    task = _task_90(api, user, db, minutes=90)
    _defer(api, user, db, task)
    _defer(api, user, db, task)
    last = _defer(api, user, db, task)
    assert len(_offers(api, user)) == 1
    assert _undo(api, user, last).status_code == 200
    assert _offers(api, user) == []


def test_a_replan_or_an_edit_does_not_count(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    task = _task_90(api, user, db, minutes=90)
    _defer(api, user, db, task)
    _defer(api, user, db, task)
    db.execute("DELETE FROM app.blocks WHERE task_id = %s AND status = 'planned'", (task,))
    replan_apply(api, user)
    patched = api.patch(f"/tasks/{task}", json={"estimated_minutes": 95}, headers=user.headers)
    assert patched.status_code == 200, patched.text
    assert _offers(api, user) == []


def test_defer_to_a_chosen_time_counts(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    task = _task_90(api, user, db, minutes=90)
    _defer(api, user, db, task)
    _defer(api, user, db, task)
    block = _next_block(db, task)
    slots = api.get(f"/blocks/{block}/slots", params={"date": "2026-11-25"}, headers=user.headers)
    assert slots.status_code == 200, slots.text
    starts_at = slots.json()["slots"][0]
    response = api.post(
        f"/blocks/{block}/defer", json={"to": "at", "starts_at": starts_at}, headers=user.headers
    )
    assert response.status_code == 200, response.text
    (offer,) = _offers(api, user)
    assert offer["deferrals"] == 3


def test_a_completed_block_of_the_task_starts_the_count_over(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    set_profile(db, user.id, daily_study_minutes=90)
    task = _task_90(api, user, db, minutes=180)
    _defer(api, user, db, task)
    _defer(api, user, db, task)
    done = api.post(f"/blocks/{_next_block(db, task)}/complete", headers=user.headers)
    assert done.status_code == 200, done.text
    _defer(api, user, db, task)
    _defer(api, user, db, task)
    assert _offers(api, user) == []
    _defer(api, user, db, task)
    (offer,) = _offers(api, user)
    assert offer["deferrals"] == 3


def test_uncomplete_takes_the_reset_back(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    set_profile(db, user.id, daily_study_minutes=90)
    task = _task_90(api, user, db, minutes=180)
    _defer(api, user, db, task)
    _defer(api, user, db, task)
    block = _next_block(db, task)
    assert api.post(f"/blocks/{block}/complete", headers=user.headers).status_code == 200
    _defer(api, user, db, task)
    assert _offers(api, user) == []
    assert api.post(f"/blocks/{block}/uncomplete", headers=user.headers).status_code == 200
    (offer,) = _offers(api, user)
    assert offer["deferrals"] == 3


def test_a_split_that_would_pass_a_dependent_task_is_not_offered(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = insert_exam(db, user.id, exam_date="2026-11-30")
    task = insert_task(db, user.id, exam, kind="practice", minutes=90)
    replan_apply(api, user)
    for _ in range(3):
        _defer(api, user, db, task)
    # A dependent with its block the next morning: three bites on three days would pass it.
    dependent = insert_task(db, user.id, exam, kind="practice", minutes=60, depends_on=task)
    insert_block(db, user.id, dependent, Z(2026, 11, 17, 7, 0), Z(2026, 11, 17, 8, 0))
    assert _offers(api, user) == []
    assert _planned(db, task)[0][1].date() == dt.date(2026, 11, 16)


def test_the_bites_of_a_split_task_earn_no_more_xp_than_one_block(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    # Focus 3 and 35-minute bites: block_xp rounds 17.5 up to 18 for each bite (54),
    # while the 105 minutes as one block earn round(52.5) = 52.
    task = _task_90(api, user, db, minutes=105, focus=3)
    for _ in range(3):
        _defer(api, user, db, task)
    (offer,) = _offers(api, user)
    assert offer["bite_minutes"] == 35
    assert _split(api, user, task, offer["basis"]).status_code == 200
    for block, _, _ in _planned(db, task):
        response = api.post(f"/blocks/{block}/complete", headers=user.headers)
        assert response.status_code == 200, response.text
    total = scalar(
        db,
        "SELECT sum(x.xp) FROM app.xp_events x JOIN app.blocks b ON b.id = x.block_id "
        "WHERE b.task_id = %s",
        task,
    )
    assert total == block_xp(3, 105) == 52


def test_the_offer_tells_how_many_minutes_it_places_again(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    task = _task_90(api, user, db, minutes=90)
    for _ in range(3):
        _defer(api, user, db, task)
    (offer,) = _offers(api, user)
    assert offer["split_minutes"] == 90 == sum(part["minutes"] for part in offer["parts"])


def test_a_split_after_the_offered_block_started_writes_nothing(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    task = _task_90(api, user, db, minutes=90)
    for _ in range(3):
        _defer(api, user, db, task)
    (offer,) = _offers(api, user)
    clock.set(dt.datetime.fromisoformat(offer["block"]["starts_at"]) + dt.timedelta(minutes=1))
    before = _planned(db, task)
    response = _split(api, user, task, offer["basis"])
    assert response.status_code == 409, response.text
    assert response.json()["code"] in ("stale_plan", "no_split_offer")
    assert _planned(db, task) == before
    assert scalar(db, "SELECT bite_minutes FROM app.tasks WHERE id = %s", task) is None


def test_the_split_cannot_be_undone_once_a_bite_was_done(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    task = _task_90(api, user, db, minutes=90)
    for _ in range(3):
        _defer(api, user, db, task)
    version = _split(api, user, task, _offers(api, user)[0]["basis"]).json()["version_id"]
    first = _next_block(db, task)
    assert api.post(f"/blocks/{first}/complete", headers=user.headers).status_code == 200
    planned = _planned(db, task)
    refused = _undo(api, user, version)
    assert refused.status_code == 409
    assert refused.json()["code"] == "invalid_state"
    assert _planned(db, task) == planned
    assert scalar(db, "SELECT bite_minutes FROM app.tasks WHERE id = %s", task) == 30
    # Taking the completion back makes the split undoable again.
    assert api.post(f"/blocks/{first}/uncomplete", headers=user.headers).status_code == 200
    assert _undo(api, user, version).status_code == 200
    assert scalar(db, "SELECT bite_minutes FROM app.tasks WHERE id = %s", task) is None
