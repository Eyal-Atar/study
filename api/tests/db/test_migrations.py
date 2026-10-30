import os
from uuid import uuid4

import psycopg
import pytest
from alembic import command
from alembic.script import ScriptDirectory

from tests.db.support import (
    DEFAULT_TEST_DATABASE_URL,
    alembic_config,
    create_database,
    drop_database,
    require_local_database_url,
)


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://localhost:5432/postgres",
        "postgresql://127.0.0.1/x",
        "postgresql://[::1]/x",
        "postgresql:///x?host=/tmp",
    ],
)
def test_require_local_database_url_accepts_local_urls(url: str) -> None:
    assert require_local_database_url(url) == url


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://postgres.vxcotmpomtgdrmsvvjku:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
        "postgresql://db.vxcotmpomtgdrmsvvjku.supabase.co/postgres",
        "postgresql://10.0.0.5/postgres",
    ],
)
def test_require_local_database_url_rejects_remote_urls(url: str) -> None:
    with pytest.raises(ValueError, match="Refusing"):
        require_local_database_url(url)


def test_auth_uid_reads_sub_from_jwt_claims(db: psycopg.Connection) -> None:
    user_id = uuid4()
    with db.transaction():
        assert db.execute("SELECT auth.uid()").fetchone() == (None,)
        db.execute(
            "SELECT set_config('request.jwt.claims', %s, true)", (f'{{"sub": "{user_id}"}}',)
        )
        assert db.execute("SELECT auth.uid()").fetchone() == (user_id,)


def test_version_table_lives_in_app(db: psycopg.Connection, migrated_database_url: str) -> None:
    head = ScriptDirectory.from_config(alembic_config(migrated_database_url)).get_current_head()
    assert db.execute("SELECT version_num FROM app.alembic_version").fetchall() == [(head,)]


def test_api_role_can_only_become_authenticated(db: psycopg.Connection) -> None:
    role = db.execute(
        "SELECT rolcanlogin, rolinherit, rolbypassrls, rolsuper FROM pg_roles "
        "WHERE rolname = 'studyflow_api'"
    ).fetchone()
    assert role == (True, False, False, False)
    member, set_option, inherits, app_usage = db.execute(
        "SELECT pg_has_role('studyflow_api', 'authenticated', 'MEMBER'), "
        "pg_has_role('studyflow_api', 'authenticated', 'SET'), "
        "pg_has_role('studyflow_api', 'authenticated', 'USAGE'), "
        "has_schema_privilege('studyflow_api', 'app', 'USAGE')"
    ).fetchone()  # type: ignore[misc]
    assert member is True
    assert set_option is True
    assert inherits is False
    assert app_usage is False


def test_only_authenticated_may_use_the_app_schema(db: psycopg.Connection) -> None:
    for role, expected in [("authenticated", True), ("anon", False), ("service_role", False)]:
        row = db.execute("SELECT has_schema_privilege(%s, 'app', 'USAGE')", (role,)).fetchone()
        assert row == (expected,), role
    public_usage = db.execute(
        "SELECT count(*) FROM pg_namespace, aclexplode(nspacl) AS acl "
        "WHERE nspname = 'app' AND acl.grantee = 0 AND acl.privilege_type = 'USAGE'"
    ).fetchone()
    assert public_usage == (0,)


def test_migrations_round_trip() -> None:
    admin_url = require_local_database_url(
        os.environ.get("TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL)
    )
    name = "studyflow_migrations_test"
    url = create_database(admin_url, name)
    try:
        config = alembic_config(url)
        head = ScriptDirectory.from_config(config).get_current_head()
        command.upgrade(config, "head")
        command.downgrade(config, "base")
        with psycopg.connect(url, autocommit=True) as conn:
            tables = conn.execute(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'app'"
            ).fetchall()
            assert tables == [("alembic_version",)]
            assert conn.execute("SELECT count(*) FROM app.alembic_version").fetchone() == (0,)
            assert conn.execute(
                "SELECT has_schema_privilege('authenticated', 'app', 'USAGE'), "
                "pg_has_role('studyflow_api', 'authenticated', 'MEMBER')"
            ).fetchone() == (False, False)
        command.upgrade(config, "head")
        with psycopg.connect(url, autocommit=True) as conn:
            version = conn.execute("SELECT version_num FROM app.alembic_version").fetchall()
            assert version == [(head,)]
    finally:
        drop_database(admin_url, name)
