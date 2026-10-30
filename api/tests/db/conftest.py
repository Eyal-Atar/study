from collections.abc import Callable, Iterator
from uuid import uuid4

import psycopg
import pytest
from alembic import command
from psycopg.conninfo import make_conninfo

from app.auth import CurrentUser
from tests.db.support import (
    admin_database_url,
    alembic_config,
    create_database,
    drop_database,
)


@pytest.fixture(scope="session")
def migrated_database_url() -> Iterator[str]:
    admin_url = admin_database_url()
    url = create_database(admin_url, "studyflow_test")
    try:
        command.upgrade(alembic_config(url), "head")
        yield url
    finally:
        drop_database(admin_url, "studyflow_test")


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
