"""Ownership between users on every endpoint (spec section 10: B gets 404 on A's rows).

A owns an exam, tasks, blocks, a plan version, a material, a job, an analysis draft and a
push subscription.
B calls every endpoint that takes an id (in the path or in the body) with A's ids: the
answer is 404 not_found, and every row of A is exactly what it was. The endpoints without
an id are checked to show only B's own rows. A route that is in neither list fails
test_every_route_is_covered.
"""

import datetime as dt
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

import jwt
import psycopg
import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from app.config import Settings
from app.main import create_app
from tests.ai.samples import valid_output_dict
from tests.api.factories import (
    NOW,
    TEST_PROFILE,
    Z,
    insert_block,
    register_material,
    replan_apply,
    replan_preview,
    scalar,
)
from tests.api.test_push import new_keys
from tests.fixtures_db import ApiUser, FrozenClock

MakeApiUser = Callable[[], ApiUser]
Dump = dict[str, list[tuple[Any, ...]]]

A_PUSH_ENDPOINT = "https://fcm.googleapis.com/fcm/send/a-device"

# Routes that are not part of the API surface under test.
EXCLUDED_PATHS = frozenset({"/health", "/docs", "/docs/oauth2-redirect", "/openapi.json", "/redoc"})


@dataclass(frozen=True)
class Ids:
    """A's rows, and B's own rows for the cases that mix the two."""

    a_exam: UUID
    a_task: UUID
    a_other_task: UUID
    a_block: UUID
    a_done_block: UUID
    a_version: UUID
    a_material: UUID
    a_job: UUID
    a_analysis: UUID
    a_topic: UUID
    a_push: UUID
    b_exam: UUID
    b_task: UUID


@dataclass(frozen=True)
class Case:
    name: str
    method: str
    route: str  # the route's path as registered, with FastAPI's parameter names
    path_params: Callable[[Ids], dict[str, UUID]]
    body: Callable[[Ids], dict[str, Any] | None]

    def url(self, ids: Ids) -> str:
        return self.route.format(**{k: str(v) for k, v in self.path_params(ids).items()})


def _none(_: Ids) -> dict[str, Any] | None:
    return None


def _no_params(_: Ids) -> dict[str, UUID]:
    return {}


def _new_task(exam: UUID, depends_on: UUID | None = None) -> dict[str, Any]:
    return {
        "exam_id": str(exam),
        "title": "משימה של ב",
        "kind": "learn",
        "estimated_minutes": 60,
        "depends_on_task_id": None if depends_on is None else str(depends_on),
    }


CASES: tuple[Case, ...] = (
    Case(
        "patch_exam",
        "PATCH",
        "/exams/{exam_id}",
        lambda i: {"exam_id": i.a_exam},
        lambda _: {"name": "נגנב", "exam_date": "2026-12-01", "difficulty": 5},
    ),
    Case("delete_exam", "DELETE", "/exams/{exam_id}", lambda i: {"exam_id": i.a_exam}, _none),
    Case(
        "list_exam_tasks", "GET", "/exams/{exam_id}/tasks", lambda i: {"exam_id": i.a_exam}, _none
    ),
    # S45: the exam is not B's, so the state check never runs.
    Case(
        "open_moed_b",
        "POST",
        "/exams/{exam_id}/moed-b",
        lambda i: {"exam_id": i.a_exam},
        lambda _: {"exam_date": "2026-12-20"},
    ),
    Case("create_task_in_a_exam", "POST", "/tasks", _no_params, lambda i: _new_task(i.a_exam)),
    Case(
        "create_task_depending_on_a_task",
        "POST",
        "/tasks",
        _no_params,
        lambda i: _new_task(i.b_exam, depends_on=i.a_task),
    ),
    Case(
        "patch_task",
        "PATCH",
        "/tasks/{task_id}",
        lambda i: {"task_id": i.a_task},
        lambda _: {"title": "נגנב", "estimated_minutes": 30, "status": "done"},
    ),
    Case(
        "patch_task_dependency",
        "PATCH",
        "/tasks/{task_id}",
        lambda i: {"task_id": i.a_task},
        lambda i: {"depends_on_task_id": str(i.a_other_task)},
    ),
    Case(
        "patch_own_task_depending_on_a_task",
        "PATCH",
        "/tasks/{task_id}",
        lambda i: {"task_id": i.b_task},
        lambda i: {"depends_on_task_id": str(i.a_task)},
    ),
    Case("delete_task", "DELETE", "/tasks/{task_id}", lambda i: {"task_id": i.a_task}, _none),
    Case(
        "complete_block",
        "POST",
        "/blocks/{block_id}/complete",
        lambda i: {"block_id": i.a_block},
        _none,
    ),
    Case(
        "uncomplete_block",
        "POST",
        "/blocks/{block_id}/uncomplete",
        lambda i: {"block_id": i.a_done_block},
        _none,
    ),
    Case(
        "uncomplete_planned_block",
        "POST",
        "/blocks/{block_id}/uncomplete",
        lambda i: {"block_id": i.a_block},
        _none,
    ),
    Case(
        "defer_block", "POST", "/blocks/{block_id}/defer", lambda i: {"block_id": i.a_block}, _none
    ),
    Case(
        "defer_block_not_before",
        "POST",
        "/blocks/{block_id}/defer",
        lambda i: {"block_id": i.a_block},
        lambda _: {"not_before": "2026-11-18T08:00:00Z"},
    ),
    Case(
        "pin_block",
        "PATCH",
        "/blocks/{block_id}",
        lambda i: {"block_id": i.a_block},
        lambda _: {"pinned": True},
    ),
    Case(
        "undo_a_version",
        "POST",
        "/plan/undo",
        _no_params,
        lambda i: {"version_id": str(i.a_version)},
    ),
    Case(
        "list_a_materials",
        "GET",
        "/exams/{exam_id}/materials",
        lambda i: {"exam_id": i.a_exam},
        _none,
    ),
    Case(
        "register_material_in_a_exam",
        "POST",
        "/exams/{exam_id}/materials",
        lambda i: {"exam_id": i.a_exam},
        lambda _: {
            "id": str(uuid4()),
            "filename": "נגנב.pdf",
            "kind": "past_exam",
            "mime": "application/pdf",
            "size_bytes": 1000,
        },
    ),
    Case(
        "delete_material",
        "DELETE",
        "/materials/{material_id}",
        lambda i: {"material_id": i.a_material},
        _none,
    ),
    Case(
        "change_material_kind",
        "PATCH",
        "/materials/{material_id}",
        lambda i: {"material_id": i.a_material},
        lambda _: {"kind": "solution"},
    ),
    Case(
        "list_exam_topics",
        "GET",
        "/exams/{exam_id}/topics",
        lambda i: {"exam_id": i.a_exam},
        _none,
    ),
    Case(
        "patch_topic",
        "PATCH",
        "/topics/{topic_id}",
        lambda i: {"topic_id": i.a_topic},
        lambda _: {"name": "נגנב", "weight": 5},
    ),
    Case(
        "create_task_in_a_topic",
        "POST",
        "/tasks",
        _no_params,
        lambda i: {**_new_task(i.b_exam), "topic_id": str(i.a_topic)},
    ),
    Case(
        "patch_own_task_into_a_topic",
        "PATCH",
        "/tasks/{task_id}",
        lambda i: {"task_id": i.b_task},
        lambda i: {"topic_id": str(i.a_topic)},
    ),
    Case("get_job", "GET", "/jobs/{job_id}", lambda i: {"job_id": i.a_job}, _none),
    Case(
        "reanalyze_a_exam",
        "POST",
        "/exams/{exam_id}/reanalyze",
        lambda i: {"exam_id": i.a_exam},
        _none,
    ),
    Case(
        "apply_a_analysis_preview",
        "POST",
        "/analyses/{analysis_id}/apply",
        lambda i: {"analysis_id": i.a_analysis},
        lambda _: {"preview": True},
    ),
    Case(
        "apply_a_analysis",
        "POST",
        "/analyses/{analysis_id}/apply",
        lambda i: {"analysis_id": i.a_analysis},
        lambda _: {"preview": False, "basis": "0" * 64},
    ),
    Case(
        "delete_push_subscription",
        "DELETE",
        "/push/subscriptions/{subscription_id}",
        lambda i: {"subscription_id": i.a_push},
        _none,
    ),
)

# Endpoints without an id of a row: test_lists_show_only_own_rows covers them.
WITHOUT_ID = frozenset(
    {
        ("GET", "/me"),
        ("PATCH", "/me"),
        ("GET", "/exams"),
        ("POST", "/exams"),
        ("GET", "/plan"),
        ("GET", "/today"),
        ("POST", "/plan/replan"),
        ("POST", "/plans/generate"),
        # S15: the caller's own account; test_lists_show_only_own_rows checks the export, and
        # tests/api/test_account.py that deleting B leaves A whole.
        ("GET", "/me/export"),
        ("DELETE", "/me"),
        # S19: the caller's own progress.
        ("GET", "/progress"),
        ("POST", "/push/subscriptions"),
    }
)


def _walk(routes: Iterable[Any]) -> Iterator[APIRoute]:
    """Every APIRoute, also inside included routers (FastAPI wraps them since 0.16x)."""
    for route in routes:
        if isinstance(route, APIRoute):
            yield route
        inner = getattr(route, "original_router", None)
        if inner is not None:
            yield from _walk(inner.routes)


def _routes(app: FastAPI) -> set[tuple[str, str]]:
    """(method, path) of every route: the OpenAPI paths, and the routes hidden from it."""
    found: set[tuple[str, str]] = {
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        for method in operations
    }
    # No router is included with a prefix, so a route's own path is its full path.
    for route in _walk(app.routes):
        found.update((method, route.path) for method in route.methods or ())
    return {(method, path) for method, path in found if path not in EXCLUDED_PATHS}


class _NoKeys:
    """A key source for listing routes only: no token is ever checked with it."""

    def get_signing_key_from_jwt(self, token: str) -> jwt.PyJWK:
        raise jwt.PyJWKClientError("no keys")


def _bare_app() -> FastAPI:
    settings = Settings(supabase_url="https://test-ref.supabase.co", _env_file=None)
    return create_app(settings, signing_keys=_NoKeys())


ALL_ROUTES = sorted(_routes(_bare_app()))


def dump(db: psycopg.Connection, user_id: UUID) -> Dump:
    """Every row of the user in the tables the API writes, read as the owner."""
    out: Dump = {}
    for table, column in (
        ("exams", "user_id"),
        ("tasks", "user_id"),
        ("blocks", "user_id"),
        ("plan_versions", "user_id"),
        ("profiles", "id"),
        ("materials", "user_id"),
        ("jobs", "user_id"),
        ("topics", "user_id"),
        ("analyses", "user_id"),
        ("xp_events", "user_id"),
        ("badges", "user_id"),
        ("push_subscriptions", "user_id"),
        ("commitments", "user_id"),
        ("busy_events", "user_id"),
    ):
        order = "badge_key" if table == "badges" else "id"
        out[table] = [
            tuple(row)
            for row in db.execute(
                f"SELECT * FROM app.{table} WHERE {column} = %s ORDER BY {order}",  # noqa: S608
                (user_id,),
            ).fetchall()
        ]
    return out


def _draft(db: psycopg.Connection, user_id: UUID, exam_id: UUID) -> UUID:
    """A reanalysis draft of the exam, written as the owner."""
    return UUID(
        str(
            scalar(
                db,
                "INSERT INTO app.analyses (user_id, exam_id, status, output) "
                "VALUES (%s, %s, 'draft', %s) RETURNING id",
                user_id,
                exam_id,
                Jsonb(valid_output_dict()),
            )
        )
    )


def _new_user(make_api_user: MakeApiUser, api: TestClient) -> ApiUser:
    user = make_api_user()
    response = api.patch("/me", json=TEST_PROFILE, headers=user.headers)
    assert response.status_code == 200, response.text
    return user


def _post_exam(api: TestClient, user: ApiUser, name: str = "מבחן") -> UUID:
    response = api.post(
        "/exams", json={"name": name, "exam_date": "2026-11-20"}, headers=user.headers
    )
    assert response.status_code == 201, response.text
    return UUID(response.json()["exam"]["id"])


def _post_task(api: TestClient, user: ApiUser, exam: UUID, minutes: int = 60) -> dict[str, Any]:
    response = api.post(
        "/tasks",
        json={
            "exam_id": str(exam),
            "title": "משימה",
            "kind": "learn",
            "estimated_minutes": minutes,
        },
        headers=user.headers,
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    assert body["placement"]["placed"] is True
    return body


def _post_push(api: TestClient, user: ApiUser, endpoint: str) -> UUID:
    response = api.post(
        "/push/subscriptions",
        json={"endpoint": endpoint, "keys": new_keys()},
        headers=user.headers,
    )
    assert response.status_code == 201, response.text
    return UUID(response.json()["id"])


@pytest.fixture
def world(
    api: TestClient, make_api_user: MakeApiUser, db: psycopg.Connection, clock: FrozenClock
) -> tuple[ApiUser, ApiUser, Ids]:
    """A with an exam, two placed tasks, a done block, a version and a material; B with its own."""
    clock.set(NOW)
    a = _new_user(make_api_user, api)
    b = _new_user(make_api_user, api)

    a_exam = _post_exam(api, a, "מבחן של א")
    a_task = _post_task(api, a, a_exam)
    a_other = _post_task(api, a, a_exam)
    # A done block in the past of the other task (Sunday, before NOW).
    a_done = insert_block(
        db, a.id, UUID(a_other["task"]["id"]), Z(2026, 11, 15, 9), Z(2026, 11, 15, 10)
    )
    db.execute("UPDATE app.blocks SET status = 'done' WHERE id = %s", (a_done,))
    # S19: A's XP for that block and a badge, which B must neither see nor change.
    db.execute(
        "INSERT INTO app.xp_events (user_id, block_id, xp, study_date) "
        "VALUES (%s, %s, 50, '2026-11-15')",
        (a.id, a_done),
    )
    db.execute("INSERT INTO app.badges (user_id, badge_key) VALUES (%s, 'first_task')", (a.id,))
    a_block = UUID(
        str(
            scalar(
                db,
                "SELECT id FROM app.blocks WHERE task_id = %s AND status = 'planned' "
                "ORDER BY starts_at LIMIT 1",
                a_task["task"]["id"],
            )
        )
    )
    a_version = UUID(a_other["version_id"])
    a_registered = register_material(api, a, a_exam)
    a_analysis = _draft(db, a.id, a_exam)
    a_topic = UUID(
        str(
            scalar(
                db,
                "INSERT INTO app.topics (user_id, exam_id, name, weight, position) "
                "VALUES (%s, %s, 'נושא של א', 3, 1) RETURNING id",
                a.id,
                a_exam,
            )
        )
    )
    a_push = _post_push(api, a, A_PUSH_ENDPOINT)

    b_exam = _post_exam(api, b, "מבחן של ב")
    b_task = _post_task(api, b, b_exam)
    ids = Ids(
        a_exam=a_exam,
        a_task=UUID(a_task["task"]["id"]),
        a_other_task=UUID(a_other["task"]["id"]),
        a_block=a_block,
        a_done_block=a_done,
        a_version=a_version,
        a_material=UUID(a_registered["material"]["id"]),
        a_job=UUID(a_registered["job_id"]),
        a_analysis=a_analysis,
        a_topic=a_topic,
        a_push=a_push,
        b_exam=b_exam,
        b_task=UUID(b_task["task"]["id"]),
    )
    return a, b, ids


@pytest.mark.parametrize("case", CASES, ids=[case.name for case in CASES])
def test_other_user_gets_404(
    api: TestClient,
    db: psycopg.Connection,
    world: tuple[ApiUser, ApiUser, Ids],
    case: Case,
) -> None:
    a, b, ids = world
    before = dump(db, a.id)
    b_before = dump(db, b.id)
    body = case.body(ids)
    response = api.request(case.method, case.url(ids), headers=b.headers, json=body)
    if case.route == "/plan/undo":
        assert response.status_code in (404, 409), response.text
        assert response.json()["code"] in ("not_found", "stale_plan", "nothing_to_undo")
    else:
        assert response.status_code == 404, response.text
        assert response.json()["code"] == "not_found"
    assert str(ids.a_exam) not in response.text
    assert dump(db, a.id) == before
    # A refused request writes nothing for B either (no half-written version or task).
    assert dump(db, b.id) == b_before


def test_undo_with_a_version_of_another_user_when_b_has_none(
    api: TestClient,
    db: psycopg.Connection,
    make_api_user: MakeApiUser,
    world: tuple[ApiUser, ApiUser, Ids],
) -> None:
    a, _, ids = world
    fresh = _new_user(make_api_user, api)
    before = dump(db, a.id)
    response = api.post(
        "/plan/undo", json={"version_id": str(ids.a_version)}, headers=fresh.headers
    )
    assert response.status_code in (404, 409), response.text
    assert dump(db, a.id) == before


def test_lists_show_only_own_rows(
    api: TestClient, db: psycopg.Connection, world: tuple[ApiUser, ApiUser, Ids]
) -> None:
    a, b, ids = world
    a_rows = dump(db, a.id)
    forbidden = {str(a.id)} | {
        str(row[0])
        for table in (
            "exams",
            "tasks",
            "blocks",
            "plan_versions",
            "materials",
            "jobs",
            "topics",
            "analyses",
            "push_subscriptions",
        )
        for row in a_rows[table]
    }
    assert {str(ids.a_exam), str(ids.a_task), str(ids.a_block), str(ids.a_version)} <= forbidden

    def assert_clean(response: Any) -> None:
        assert response.status_code in (200, 201), response.text
        leaked = {value for value in forbidden if value in response.text}
        assert not leaked, f"{response.request.method} {response.request.url}: {leaked}"

    exams = api.get("/exams", headers=b.headers)
    assert_clean(exams)
    assert [exam["id"] for exam in exams.json()] == [str(ids.b_exam)]
    plan = api.get("/plan", params={"from": "2026-11-14", "to": "2026-11-30"}, headers=b.headers)
    assert_clean(plan)
    assert plan.json()["blocks"], "B's own blocks are listed"
    assert {block["task_id"] for block in plan.json()["blocks"]} == {str(ids.b_task)}
    assert_clean(api.get("/plan", headers=b.headers))
    assert_clean(api.get("/today", headers=b.headers))
    assert_clean(api.get("/me/export", headers=b.headers))
    progress = api.get("/progress", headers=b.headers)
    assert_clean(progress)
    assert progress.json()["total_xp"] == 0
    assert not any(badge["earned"] for badge in progress.json()["badges"])
    me = api.get("/me", headers=b.headers)
    assert_clean(me)
    assert me.json()["id"] == str(b.id)
    assert_clean(api.patch("/me", json={"daily_study_minutes": 300}, headers=b.headers))
    assert_clean(
        api.post("/exams", json={"name": "עוד", "exam_date": "2026-11-25"}, headers=b.headers)
    )
    preview = api.post("/plan/replan", json={"preview": True}, headers=b.headers)
    assert_clean(preview)
    assert dump(db, a.id) == a_rows
    applied = api.post(
        "/plan/replan",
        json={"preview": False, "basis": preview.json()["basis"]},
        headers=b.headers,
    )
    assert_clean(applied)
    assert dump(db, a.id) == a_rows
    # B's generation takes B's exams only: every one of them, and none of A's.
    generated = api.post("/plans/generate", headers=b.headers)
    assert generated.status_code == 202, generated.text
    assert not {value for value in forbidden if value in generated.text}
    payload = scalar(db, "SELECT payload FROM app.jobs WHERE id = %s", generated.json()["job_id"])
    b_exams = {
        str(row[0])
        for row in db.execute(
            "SELECT id FROM app.exams WHERE user_id = %s AND deleted_at IS NULL", (b.id,)
        ).fetchall()
    }
    assert set(payload["exam_ids"]) == b_exams
    assert str(ids.b_exam) in b_exams
    assert dump(db, a.id) == a_rows
    # B's own browser: a new row for B, and A's subscription (another endpoint) stays.
    subscribed = api.post(
        "/push/subscriptions",
        json={"endpoint": "https://fcm.googleapis.com/fcm/send/b-device", "keys": new_keys()},
        headers=b.headers,
    )
    assert_clean(subscribed)
    assert dump(db, a.id) == a_rows


def test_users_do_not_block_each_other(
    api: TestClient, db: psycopg.Connection, make_api_user: MakeApiUser, clock: FrozenClock
) -> None:
    """Two users with the same plan get the same times: the overlap rule is per user."""
    clock.set(NOW)
    users = [_new_user(make_api_user, api) for _ in range(2)]
    times: list[list[tuple[dt.datetime, dt.datetime]]] = []
    for user in users:
        exam = _post_exam(api, user)
        _post_task(api, user, exam, minutes=90)
        replan_apply(api, user)
        times.append(
            [
                (row[0], row[1])
                for row in db.execute(
                    "SELECT starts_at, ends_at FROM app.blocks WHERE user_id = %s "
                    "ORDER BY starts_at",
                    (user.id,),
                ).fetchall()
            ]
        )
    assert times[0]
    assert times[0] == times[1]
    # And B's preview does not see A's blocks as taken.
    assert replan_preview(api, users[1])["changed"] is False


def test_every_route_is_covered(db_app: FastAPI) -> None:
    routes = _routes(db_app)
    in_cases = {(case.method, case.route) for case in CASES}
    assert in_cases <= routes, f"cases for routes that do not exist: {in_cases - routes}"
    assert WITHOUT_ID <= routes, f"listed routes that do not exist: {WITHOUT_ID - routes}"
    uncovered = routes - in_cases - WITHOUT_ID
    assert not uncovered, f"routes without an ownership test: {sorted(uncovered)}"
    with_path_id = {(method, path) for method, path in routes if "{" in path}
    assert with_path_id <= in_cases
    assert set(ALL_ROUTES) == routes


@pytest.mark.parametrize(("method", "path"), ALL_ROUTES, ids=[f"{m} {p}" for m, p in ALL_ROUTES])
def test_unauthenticated_everywhere(
    api: TestClient, db: psycopg.Connection, method: str, path: str
) -> None:
    rows_before = scalar(db, "SELECT count(*) FROM app.profiles")
    url = path.format(
        exam_id=uuid4(),
        task_id=uuid4(),
        block_id=uuid4(),
        material_id=uuid4(),
        job_id=uuid4(),
        analysis_id=uuid4(),
        topic_id=uuid4(),
        subscription_id=uuid4(),
        commitment_id=uuid4(),
        event_id=uuid4(),
    )
    for headers in ({}, {"Authorization": "Bearer not-a-token"}):
        response = api.request(method, url, headers=headers)
        assert response.status_code == 401, response.text
        assert response.json()["code"] == "unauthenticated"
    assert scalar(db, "SELECT count(*) FROM app.profiles") == rows_before


# S18: moving a block and the slots it can move to.
MOVE_CASES: tuple[Case, ...] = (
    Case(
        "move_block",
        "PATCH",
        "/blocks/{block_id}",
        lambda i: {"block_id": i.a_block},
        lambda _: {"starts_at": "2026-11-16T20:00:00Z"},
    ),
    Case(
        "block_slots", "GET", "/blocks/{block_id}/slots", lambda i: {"block_id": i.a_block}, _none
    ),
)
CASES = (*CASES, *MOVE_CASES)


@pytest.mark.parametrize("case", MOVE_CASES, ids=[case.name for case in MOVE_CASES])
def test_other_user_gets_404_on_moves(
    api: TestClient,
    db: psycopg.Connection,
    world: tuple[ApiUser, ApiUser, Ids],
    case: Case,
) -> None:
    test_other_user_gets_404(api, db, world, case)


# S18 Task A, the morning review. The new routes join CASES and WITHOUT_ID here, at the end of
# the file, so test_every_route_is_covered counts them; test_other_user_gets_404 was already
# parametrized above, so test_review_of_another_user_is_404 runs them on A's overdue block.
REVIEW_CASES: tuple[Case, ...] = (
    Case(
        "reschedule_block",
        "POST",
        "/blocks/{block_id}/reschedule",
        lambda i: {"block_id": i.a_block},
        _none,
    ),
    Case(
        "reschedule_block_anywhere",
        "POST",
        "/blocks/{block_id}/reschedule",
        lambda i: {"block_id": i.a_block},
        lambda _: {"today_only": False},
    ),
    Case("skip_block", "POST", "/blocks/{block_id}/skip", lambda i: {"block_id": i.a_block}, _none),
)
CASES = (*CASES, *REVIEW_CASES)
WITHOUT_ID = WITHOUT_ID | {("GET", "/review")}


@pytest.mark.parametrize("case", REVIEW_CASES, ids=[case.name for case in REVIEW_CASES])
def test_review_of_another_user_is_404(
    api: TestClient,
    db: psycopg.Connection,
    world: tuple[ApiUser, ApiUser, Ids],
    case: Case,
) -> None:
    a, b, ids = world
    # Sunday 11:00-12:00, before NOW: an overdue block of A's task, in A's review only.
    overdue = insert_block(db, a.id, ids.a_task, Z(2026, 11, 15, 11), Z(2026, 11, 15, 12))
    a_review = api.get("/review", headers=a.headers)
    assert [block["id"] for block in a_review.json()["blocks"]] == [str(overdue)]
    assert api.get("/review", headers=b.headers).json() == {"blocks": []}
    before = dump(db, a.id)
    b_before = dump(db, b.id)

    response = api.request(
        case.method, case.route.format(block_id=overdue), headers=b.headers, json=case.body(ids)
    )
    assert response.status_code == 404, response.text
    assert response.json()["code"] == "not_found"
    assert dump(db, a.id) == before
    assert dump(db, b.id) == b_before


# S35: commitments, busy events, free time, the defer choices and the timetable. A gets a
# commitment, a future busy event and a finished parse_timetable job; B calls every route that
# takes their ids. The routes without an id join WITHOUT_ID, and
# test_availability_lists_show_only_own_rows checks that B never sees A's rows in them.
A_COMMITMENT = {
    "title": "עבודה של א",
    "kind": "work",
    "weekday": 3,
    "start_time": "16:00",
    "end_time": "22:00",
}


@dataclass(frozen=True)
class AvailabilityIds:
    commitment: UUID
    event: UUID
    timetable_job: UUID


@pytest.fixture
def availability(
    api: TestClient, db: psycopg.Connection, world: tuple[ApiUser, ApiUser, Ids]
) -> AvailabilityIds:
    a, _, _ = world
    commitment = api.post("/commitments", json=A_COMMITMENT, headers=a.headers)
    assert commitment.status_code == 201, commitment.text
    event = api.post(
        "/busy-events",
        json={
            "title": "חתונה של א",
            "starts_at": "2026-11-19T17:00:00Z",
            "ends_at": "2026-11-19T21:00:00Z",
        },
        headers=a.headers,
    )
    assert event.status_code == 201, event.text
    upload = uuid4()
    job = UUID(
        str(
            scalar(
                db,
                "INSERT INTO app.jobs (user_id, kind, payload, status, result) "
                "VALUES (%s, 'parse_timetable', %s, 'done', %s) RETURNING id",
                a.id,
                Jsonb(
                    {
                        "upload_id": str(upload),
                        "storage_path": f"{a.id}/timetables/{upload}",
                        "mime": "image/png",
                    }
                ),
                Jsonb({"commitments": [], "model": "fake"}),
            )
        )
    )
    return AvailabilityIds(
        commitment=UUID(commitment.json()["commitment"]["id"]),
        event=UUID(event.json()["event"]["id"]),
        timetable_job=job,
    )


@dataclass(frozen=True)
class AvailabilityCase:
    name: str
    method: str
    route: str
    path_params: Callable[[Ids, AvailabilityIds], dict[str, UUID]]
    body: Callable[[Ids], dict[str, Any] | None]


AVAILABILITY_CASES: tuple[AvailabilityCase, ...] = (
    AvailabilityCase(
        "patch_commitment",
        "PATCH",
        "/commitments/{commitment_id}",
        lambda _, v: {"commitment_id": v.commitment},
        lambda _: {"end_time": "21:00"},
    ),
    AvailabilityCase(
        "delete_commitment",
        "DELETE",
        "/commitments/{commitment_id}",
        lambda _, v: {"commitment_id": v.commitment},
        _none,
    ),
    AvailabilityCase(
        "patch_busy_event",
        "PATCH",
        "/busy-events/{event_id}",
        lambda _, v: {"event_id": v.event},
        lambda _: {"ends_at": "2026-11-19T22:00:00Z"},
    ),
    AvailabilityCase(
        "delete_busy_event",
        "DELETE",
        "/busy-events/{event_id}",
        lambda _, v: {"event_id": v.event},
        _none,
    ),
    AvailabilityCase(
        "apply_timetable",
        "POST",
        "/timetables/{job_id}/apply",
        lambda _, v: {"job_id": v.timetable_job},
        lambda _: {"items": [A_COMMITMENT]},
    ),
    AvailabilityCase(
        "defer_block_tomorrow",
        "POST",
        "/blocks/{block_id}/defer",
        lambda i, _: {"block_id": i.a_block},
        lambda _: {"to": "tomorrow"},
    ),
    AvailabilityCase(
        "defer_block_at",
        "POST",
        "/blocks/{block_id}/defer",
        lambda i, _: {"block_id": i.a_block},
        lambda _: {"to": "at", "starts_at": "2026-11-17T08:00:00Z"},
    ),
    AvailabilityCase(
        "block_slots_of_a_day",
        "GET",
        "/blocks/{block_id}/slots?date=2026-11-17",
        lambda i, _: {"block_id": i.a_block},
        _none,
    ),
)
CASES = (
    *CASES,
    *(
        Case(case.name, case.method, case.route.split("?")[0], lambda _: {}, case.body)
        for case in AVAILABILITY_CASES
    ),
)
WITHOUT_ID = WITHOUT_ID | {
    ("GET", "/commitments"),
    ("POST", "/commitments"),
    ("GET", "/busy-events"),
    ("POST", "/busy-events"),
    ("POST", "/plan/free-time"),
    # The upload id is the caller's own: the path is built under the caller's folder.
    ("POST", "/timetables"),
}


@pytest.mark.parametrize("case", AVAILABILITY_CASES, ids=[c.name for c in AVAILABILITY_CASES])
def test_other_user_gets_404_on_availability(
    api: TestClient,
    db: psycopg.Connection,
    world: tuple[ApiUser, ApiUser, Ids],
    availability: AvailabilityIds,
    case: AvailabilityCase,
) -> None:
    a, b, ids = world
    before = dump(db, a.id)
    b_before = dump(db, b.id)
    url = case.route.format(**{k: str(v) for k, v in case.path_params(ids, availability).items()})
    response = api.request(case.method, url, headers=b.headers, json=case.body(ids))
    assert response.status_code == 404, response.text
    assert response.json()["code"] == "not_found"
    assert dump(db, a.id) == before
    assert dump(db, b.id) == b_before


def test_availability_lists_show_only_own_rows(
    api: TestClient,
    db: psycopg.Connection,
    world: tuple[ApiUser, ApiUser, Ids],
    availability: AvailabilityIds,
) -> None:
    a, b, _ = world
    forbidden = {
        str(availability.commitment),
        str(availability.event),
        str(availability.timetable_job),
        "עבודה של א",
        "חתונה של א",
    }
    a_rows = dump(db, a.id)

    def assert_clean(response: Any) -> None:
        assert response.status_code in (200, 201, 202, 409), response.text
        leaked = {value for value in forbidden if value in response.text}
        assert not leaked, f"{response.request.method} {response.request.url}: {leaked}"

    assert_clean(api.get("/commitments", headers=b.headers))
    assert api.get("/commitments", headers=b.headers).json() == {"commitments": []}
    assert_clean(api.get("/busy-events", headers=b.headers))
    assert api.get("/busy-events", headers=b.headers).json() == {"events": []}
    plan = api.get("/plan", params={"from": "2026-11-16", "to": "2026-11-22"}, headers=b.headers)
    assert_clean(plan)
    assert plan.json()["busy"] == []
    assert_clean(api.get("/today", headers=b.headers))
    assert_clean(api.get("/me/export", headers=b.headers))
    assert_clean(api.post("/plan/free-time", json={"minutes": 60}, headers=b.headers))
    assert_clean(
        api.post(
            "/commitments",
            json={**A_COMMITMENT, "title": "עבודה של ב"},
            headers=b.headers,
        )
    )
    assert_clean(
        api.post(
            "/busy-events",
            json={"starts_at": "2026-11-19T17:00:00Z", "ends_at": "2026-11-19T21:00:00Z"},
            headers=b.headers,
        )
    )
    # B registers its own upload under the same id as A's: B's folder, a new job of B's.
    upload = scalar(
        db, "SELECT payload->>'upload_id' FROM app.jobs WHERE id = %s", availability.timetable_job
    )
    registered = api.post(
        "/timetables",
        json={"id": upload, "mime": "image/png", "size_bytes": 1000},
        headers=b.headers,
    )
    assert_clean(registered)
    path = scalar(
        db,
        "SELECT payload->>'storage_path' FROM app.jobs WHERE id = %s",
        registered.json()["job_id"],
    )
    assert path == f"{b.id}/timetables/{upload}"
    assert dump(db, a.id) == a_rows


# S44: the split offer. A puts its task off three times, so A has a live offer; B calls split
# and dismiss with A's task (404, nothing changes), and B's own GET /split-offers shows none of
# A's rows. The routes join CASES and WITHOUT_ID here, at the end, for
# test_every_route_is_covered.
SPLIT_CASES: tuple[Case, ...] = (
    Case(
        "split_task",
        "POST",
        "/tasks/{task_id}/split",
        lambda i: {"task_id": i.a_task},
        lambda _: {"basis": "0" * 64},
    ),
    Case(
        "dismiss_split",
        "POST",
        "/tasks/{task_id}/split/dismiss",
        lambda i: {"task_id": i.a_task},
        _none,
    ),
)
CASES = (*CASES, *SPLIT_CASES)
WITHOUT_ID = WITHOUT_ID | {("GET", "/split-offers")}


def _a_has_an_offer(api: TestClient, db: psycopg.Connection, a: ApiUser, task: UUID) -> str:
    """Defer A's task three times; A's offer's basis."""
    for _ in range(3):
        block = scalar(
            db,
            "SELECT id FROM app.blocks WHERE task_id = %s AND status = 'planned' "
            "ORDER BY starts_at LIMIT 1",
            task,
        )
        response = api.post(f"/blocks/{block}/defer", json={}, headers=a.headers)
        assert response.status_code == 200, response.text
    offers = api.get("/split-offers", headers=a.headers).json()["offers"]
    assert [offer["task_id"] for offer in offers] == [str(task)]
    basis: str = offers[0]["basis"]
    return basis


@pytest.mark.parametrize("case", SPLIT_CASES, ids=[case.name for case in SPLIT_CASES])
def test_the_split_of_another_user_is_404(
    api: TestClient,
    db: psycopg.Connection,
    world: tuple[ApiUser, ApiUser, Ids],
    case: Case,
) -> None:
    a, b, ids = world
    db.execute("UPDATE app.tasks SET estimated_minutes = 90 WHERE id = %s", (ids.a_task,))
    db.execute(
        "UPDATE app.blocks SET ends_at = starts_at + interval '90 minutes' "
        "WHERE task_id = %s AND status = 'planned'",
        (ids.a_task,),
    )
    basis = _a_has_an_offer(api, db, a, ids.a_task)
    before = dump(db, a.id)
    b_before = dump(db, b.id)
    body = {"basis": basis} if case.name == "split_task" else None
    response = api.request(case.method, case.url(ids), headers=b.headers, json=body)
    assert response.status_code == 404, response.text
    assert response.json()["code"] == "not_found"
    assert dump(db, a.id) == before
    assert dump(db, b.id) == b_before
    offers = api.get("/split-offers", headers=b.headers)
    assert offers.status_code == 200
    assert offers.json() == {"offers": []}
    assert str(ids.a_task) not in offers.text
    # A's offer is still there.
    assert len(api.get("/split-offers", headers=a.headers).json()["offers"]) == 1
