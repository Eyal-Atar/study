"""Database fixtures shared by tests/db and tests/api (registered in tests/conftest.py)."""

import os
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from alembic import command
from fastapi import FastAPI
from fastapi.testclient import TestClient
from psycopg.conninfo import make_conninfo

from app.auth import CurrentUser
from app.config import Settings
from app.db.pool import Database
from app.main import create_app
from tests.db.support import (
    admin_database_url,
    alembic_config,
    create_database,
    drop_database,
)
from tests.tokens import StaticKeys, TokenFactory, bearer


@pytest.fixture(scope="session")
def migrated_database_url() -> Iterator[str]:
    admin_url = admin_database_url()
    # STUDYFLOW_TEST_DB lets two test runs share the local cluster without dropping
    # each other's database (tests/db/test_migrations.py still must not run alongside them).
    name = os.environ.get("STUDYFLOW_TEST_DB", "studyflow_test")
    url = create_database(admin_url, name)
    try:
        command.upgrade(alembic_config(url), "head")
        yield url
    finally:
        drop_database(admin_url, name)


@pytest.fixture
def db(migrated_database_url: str) -> Iterator[psycopg.Connection]:
    with psycopg.connect(migrated_database_url, autocommit=True) as conn:
        conn.execute("TRUNCATE auth.users CASCADE")
        yield conn


@pytest.fixture
def api_db(migrated_database_url: str) -> Iterator[psycopg.Connection]:
    url = make_conninfo(migrated_database_url, user="studyflow_api")
    with psycopg.connect(url, autocommit=True) as conn:
        yield conn


@pytest.fixture
def make_user(db: psycopg.Connection) -> Callable[[], CurrentUser]:
    def make() -> CurrentUser:
        user_id = uuid4()
        email = f"{user_id}@example.com"
        db.execute("INSERT INTO auth.users (id, email) VALUES (%s, %s)", (user_id, email))
        claims = {
            "sub": str(user_id),
            "role": "authenticated",
            "aud": "authenticated",
            "email": email,
        }
        return CurrentUser(id=user_id, email=email, claims=claims)

    return make


@pytest.fixture(scope="session")
def database(migrated_database_url: str) -> Iterator[Database]:
    """The API's pool, connected as studyflow_api to the migrated test database."""
    pool = Database(make_conninfo(migrated_database_url, user="studyflow_api"))
    pool.open()
    try:
        yield pool
    finally:
        pool.close()


class FrozenClock:
    """A clock that only moves when the test says so."""

    def __init__(self, now: datetime | None = None) -> None:
        self.now = now if now is not None else datetime(2026, 11, 15, 6, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now

    def set(self, value: datetime) -> None:
        self.now = value

    def advance(self, **kwargs: float) -> None:
        self.now += timedelta(**kwargs)


@pytest.fixture
def clock() -> FrozenClock:
    return FrozenClock()


@pytest.fixture
def db_app(
    settings: Settings,
    jwks: dict[str, Any],
    database: Database,
    clock: FrozenClock,
    db: psycopg.Connection,
) -> FastAPI:
    # Depends on db so that every test starts from empty tables.
    return create_app(settings, signing_keys=StaticKeys(jwks), database=database, clock=clock)


@pytest.fixture
def api(db_app: FastAPI) -> TestClient:
    return TestClient(db_app, raise_server_exceptions=False)


@dataclass(frozen=True)
class ApiUser:
    id: UUID
    headers: dict[str, str]


@pytest.fixture
def make_api_user(db: psycopg.Connection, make_token: TokenFactory) -> Callable[[], ApiUser]:
    def make() -> ApiUser:
        user_id = uuid4()
        db.execute(
            "INSERT INTO auth.users (id, email) VALUES (%s, %s)",
            (user_id, f"{user_id}@example.com"),
        )
        return ApiUser(id=user_id, headers=bearer(make_token(sub=str(user_id))))

    return make
