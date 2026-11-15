"""Ownership between users on every endpoint (spec section 10: B gets 404 on A's rows).

A owns an exam, tasks, blocks, a plan version, a material and a job. B calls every
endpoint that takes an id (in the path or in the body) with A's ids: the answer is 404
not_found, and every row of A is exactly what it was. The endpoints without an id are
checked to show only B's own rows. A route that is in neither list fails
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

from app.config import Settings
from app.main import create_app
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
from tests.fixtures_db import ApiUser, FrozenClock

MakeApiUser = Callable[[], ApiUser]
Dump = dict[str, list[tuple[Any, ...]]]

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
    Case("get_job", "GET", "/jobs/{job_id}", lambda i: {"job_id": i.a_job}, _none),
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
    ):
        out[table] = [
            tuple(row)
            for row in db.execute(
                f"SELECT * FROM app.{table} WHERE {column} = %s ORDER BY id",  # noqa: S608
                (user_id,),
            ).fetchall()
        ]
    return out


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
        for table in ("exams", "tasks", "blocks", "plan_versions", "materials", "jobs")
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
        exam_id=uuid4(), task_id=uuid4(), block_id=uuid4(), material_id=uuid4(), job_id=uuid4()
    )
    for headers in ({}, {"Authorization": "Bearer not-a-token"}):
        response = api.request(method, url, headers=headers)
        assert response.status_code == 401, response.text
        assert response.json()["code"] == "unauthenticated"
    assert scalar(db, "SELECT count(*) FROM app.profiles") == rows_before
