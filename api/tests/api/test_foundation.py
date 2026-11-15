from collections.abc import Callable
from datetime import datetime
from uuid import UUID

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from psycopg.conninfo import make_conninfo

from app.auth import CurrentUser
from app.config import Settings
from app.db.pool import Database
from app.deps import DatabaseDep, Now
from app.errors import ApiError
from app.main import create_app
from tests.fixtures_db import ApiUser, FrozenClock
from tests.tokens import StaticKeys

ORIGIN = "http://localhost:5173"
MakeUser = Callable[[], CurrentUser]


@pytest.fixture
def settings() -> Settings:
    return Settings(
        supabase_url="https://test-ref.supabase.co", cors_origins=[ORIGIN], _env_file=None
    )


def test_transaction_sets_role_claims_timezone_and_timeout(
    database: Database, make_user: MakeUser
) -> None:
    user = make_user()
    with database.transaction(user) as conn:
        row = conn.execute(
            "select current_user as role, auth.uid() as uid, "
            "current_setting('TimeZone') as tz, current_setting('statement_timeout') as timeout"
        ).fetchone()
    assert row == {"role": "authenticated", "uid": user.id, "tz": "UTC", "timeout": "5s"}


def test_transaction_commits_on_exit_and_rolls_back_on_error(
    database: Database, make_user: MakeUser, db: psycopg.Connection
) -> None:
    committed, rolled_back = make_user(), make_user()
    with database.transaction(committed) as conn:
        conn.execute("INSERT INTO app.profiles (id) VALUES (%s)", (committed.id,))
    assert db.execute("select id from app.profiles where id = %s", (committed.id,)).fetchone()

    with pytest.raises(RuntimeError, match="boom"):
        with database.transaction(rolled_back) as conn:
            conn.execute("INSERT INTO app.profiles (id) VALUES (%s)", (rolled_back.id,))
            raise RuntimeError("boom")
    assert (
        db.execute("select id from app.profiles where id = %s", (rolled_back.id,)).fetchone()
        is None
    )


def test_settings_do_not_leak_between_transactions(
    migrated_database_url: str, make_user: MakeUser
) -> None:
    first, second = make_user(), make_user()
    single = Database(make_conninfo(migrated_database_url, user="studyflow_api"), max_size=1)
    single.open()
    try:
        for user in (first, second):
            with single.transaction(user) as conn:
                row = conn.execute("select auth.uid() as uid").fetchone()
            assert row == {"uid": user.id}
            with single._pool.connection() as conn:  # the same, only, connection
                leaked = conn.execute(
                    "select current_setting('request.jwt.claim.sub', true)"
                ).fetchone()
                assert leaked == {"current_setting": ""} or leaked == {"current_setting": None}
                state = conn.execute(
                    "select current_user as role, "
                    "current_setting('request.jwt.claims', true) as claims"
                ).fetchone()
                assert state is not None
                assert state["role"] == "studyflow_api"
                assert state["claims"] in ("", None)
    finally:
        single.close()


def _app_with(api_app: FastAPI, path: str, endpoint: Callable[..., object]) -> TestClient:
    api_app.add_api_route(path, endpoint)
    return TestClient(api_app, raise_server_exceptions=False)


def test_statement_timeout_becomes_503(
    db_app: FastAPI, make_api_user: Callable[[], ApiUser]
) -> None:
    user = make_api_user()

    def slow(database: DatabaseDep) -> None:
        with database.transaction(_user(user.id)) as conn:
            conn.execute("select pg_sleep(6)")

    response = _app_with(db_app, "/test/slow", slow).get("/test/slow", headers={"Origin": ORIGIN})
    assert response.status_code == 503
    assert response.json()["code"] == "database_unavailable"
    assert response.headers["access-control-allow-origin"] == ORIGIN


def _user(user_id: UUID) -> CurrentUser:
    return CurrentUser(id=user_id, email=None, claims={"sub": str(user_id)})


def test_exclusion_violation_becomes_409(
    db_app: FastAPI, make_api_user: Callable[[], ApiUser]
) -> None:
    user = make_api_user()

    def overlapping(database: DatabaseDep) -> None:
        with database.transaction(_user(user.id)) as conn:
            conn.execute("INSERT INTO app.profiles (id) VALUES (%s)", (user.id,))
            exam = conn.execute(
                "INSERT INTO app.exams (user_id, name, exam_date) "
                "VALUES (%s, 'E', '2027-03-26') RETURNING id",
                (user.id,),
            ).fetchone()
            assert exam is not None
            task = conn.execute(
                "INSERT INTO app.tasks (user_id, exam_id, title, kind, estimated_minutes, source) "
                "VALUES (%s, %s, 'T', 'learn', 60, 'user') RETURNING id",
                (user.id, exam["id"]),
            ).fetchone()
            assert task is not None
            for start, end in (("08:00", "09:00"), ("08:30", "09:30")):
                conn.execute(
                    "INSERT INTO app.blocks (user_id, task_id, starts_at, ends_at) "
                    "VALUES (%s, %s, %s, %s)",
                    (user.id, task["id"], f"2027-03-20 {start}Z", f"2027-03-20 {end}Z"),
                )

    response = _app_with(db_app, "/test/overlap", overlapping).get("/test/overlap")
    assert response.status_code == 409
    assert response.json()["code"] == "plan_conflict"


def test_unhandled_error_is_500_with_cors_headers(app: FastAPI) -> None:
    def boom() -> None:
        raise RuntimeError("secret")

    response = _app_with(app, "/test/boom", boom).get("/test/boom", headers={"Origin": ORIGIN})
    assert response.status_code == 500
    assert response.json()["code"] == "internal_error"
    assert response.headers["access-control-allow-origin"] == ORIGIN
    assert response.headers["content-type"] == "application/problem+json"
    assert "secret" not in response.text


def test_no_database_is_503(settings: Settings, jwks: dict[str, object]) -> None:
    assert settings.database_url is None
    app = create_app(settings, signing_keys=StaticKeys(jwks))

    def needs_database(database: DatabaseDep) -> None: ...

    response = _app_with(app, "/test/db", needs_database).get("/test/db")
    assert response.status_code == 503
    assert response.json()["code"] == "database_unavailable"


def test_api_error_extra_fields(app: FastAPI) -> None:
    def fail() -> None:
        raise ApiError("placement_failed", extra={"reason": "not_enough_time", "code": "evil"})

    response = _app_with(app, "/test/extra", fail).get("/test/extra")
    assert response.status_code == 409
    body = response.json()
    assert body["reason"] == "not_enough_time"
    assert body["code"] == "placement_failed"


def test_clock_is_injected(db_app: FastAPI, clock: FrozenClock) -> None:
    def current(now: Now) -> dict[str, str]:
        return {"now": now.isoformat()}

    client = _app_with(db_app, "/test/now", current)
    assert client.get("/test/now").json() == {"now": "2026-11-15T06:00:00+00:00"}
    clock.advance(hours=2)
    assert client.get("/test/now").json() == {"now": "2026-11-15T08:00:00+00:00"}
    assert isinstance(clock.now, datetime)
