"""Migration 0011: the XP ledger (xp_events) and earned badges (badges)."""

import os
from collections.abc import Callable
from datetime import date
from uuid import UUID

import psycopg
import pytest
from alembic import command

from app.auth import CurrentUser
from app.db.session import user_transaction
from tests.db.support import admin_database_url, alembic_config, create_database, drop_database

MakeUser = Callable[[], CurrentUser]

_DAY = date(2026, 11, 16)


def _one(db: psycopg.Connection, query: str, params: tuple[object, ...]) -> UUID:
    row = db.execute(query, params).fetchone()
    assert row is not None
    return row[0]  # type: ignore[no-any-return]


def _profile(db: psycopg.Connection, user_id: UUID) -> None:
    db.execute("INSERT INTO app.profiles (id) VALUES (%s)", (user_id,))


def _block(db: psycopg.Connection, user_id: UUID) -> UUID:
    exam = _one(
        db,
        "INSERT INTO app.exams (user_id, name, exam_date) VALUES (%s, 'x', '2027-01-01') "
        "RETURNING id",
        (user_id,),
    )
    task = _one(
        db,
        "INSERT INTO app.tasks (user_id, exam_id, title, kind, estimated_minutes, source) "
        "VALUES (%s, %s, 'T', 'learn', 60, 'user') RETURNING id",
        (user_id, exam),
    )
    return _one(
        db,
        "INSERT INTO app.blocks (user_id, task_id, starts_at, ends_at, status) "
        "VALUES (%s, %s, '2026-11-16T08:00Z', '2026-11-16T09:00Z', 'done') RETURNING id",
        (user_id, task),
    )


def _xp(db: psycopg.Connection, user_id: UUID, block_id: UUID | None, xp: int = 50) -> UUID:
    return _one(
        db,
        "INSERT INTO app.xp_events (user_id, block_id, xp, study_date) "
        "VALUES (%s, %s, %s, %s) RETURNING id",
        (user_id, block_id, xp, _DAY),
    )


def _badge(db: psycopg.Connection, user_id: UUID, key: str = "first_task") -> None:
    db.execute("INSERT INTO app.badges (user_id, badge_key) VALUES (%s, %s)", (user_id, key))


def _owner_with_rows(db: psycopg.Connection, make_user: MakeUser) -> tuple[CurrentUser, UUID]:
    user = make_user()
    _profile(db, user.id)
    event = _xp(db, user.id, _block(db, user.id))
    _badge(db, user.id)
    return user, event


def test_columns(db: psycopg.Connection) -> None:
    rows = db.execute(
        "SELECT table_name, column_name, data_type, is_nullable, column_default "
        "FROM information_schema.columns "
        "WHERE table_schema = 'app' AND table_name IN ('xp_events', 'badges') "
        "ORDER BY table_name, ordinal_position"
    ).fetchall()
    assert rows == [
        ("badges", "user_id", "uuid", "NO", None),
        ("badges", "badge_key", "text", "NO", None),
        ("badges", "earned_at", "timestamp with time zone", "NO", "clock_timestamp()"),
        ("xp_events", "id", "uuid", "NO", "gen_random_uuid()"),
        ("xp_events", "user_id", "uuid", "NO", None),
        ("xp_events", "block_id", "uuid", "YES", None),
        ("xp_events", "xp", "integer", "NO", None),
        ("xp_events", "study_date", "date", "NO", None),
        ("xp_events", "created_at", "timestamp with time zone", "NO", "clock_timestamp()"),
        # 0018 (S34): the row's kind, after the columns of 0011.
        ("xp_events", "kind", "text", "NO", "'block'::text"),
    ]


def test_constraints_and_index(db: psycopg.Connection) -> None:
    constraints: dict[str, str] = dict(
        db.execute(
            "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint "
            "WHERE conrelid IN ('app.xp_events'::regclass, 'app.badges'::regclass) "
            "OR conname = 'blocks_id_user_id_key'"
        ).fetchall()
    )
    assert constraints["blocks_id_user_id_key"] == "UNIQUE (id, user_id)"
    assert constraints["xp_events_pkey"] == "PRIMARY KEY (id)"
    assert constraints["xp_events_block_id_key"] == "UNIQUE (block_id)"
    assert constraints["xp_events_user_id_fkey"] == (
        "FOREIGN KEY (user_id) REFERENCES app.profiles(id) ON DELETE CASCADE"
    )
    assert constraints["xp_events_block_fkey"] == (
        "FOREIGN KEY (block_id, user_id) REFERENCES app.blocks(id, user_id) "
        "ON DELETE SET NULL (block_id)"
    )
    assert constraints["badges_pkey"] == "PRIMARY KEY (user_id, badge_key)"
    assert constraints["badges_user_id_fkey"] == (
        "FOREIGN KEY (user_id) REFERENCES app.profiles(id) ON DELETE CASCADE"
    )
    index = db.execute(
        "SELECT indexdef FROM pg_indexes WHERE schemaname = 'app' "
        "AND indexname = 'xp_events_user_study_date_idx'"
    ).fetchone()
    assert index == (
        "CREATE INDEX xp_events_user_study_date_idx ON app.xp_events "
        "USING btree (user_id, study_date)",
    )


def test_a_block_earns_xp_only_once(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    _profile(db, user.id)
    block = _block(db, user.id)
    _xp(db, user.id, block)
    with pytest.raises(psycopg.errors.UniqueViolation):
        _xp(db, user.id, block)
    # Rows whose block is gone (NULL) do not collide.
    _xp(db, user.id, None)
    _xp(db, user.id, None)


def test_xp_cannot_point_at_another_users_block(
    db: psycopg.Connection, make_user: MakeUser
) -> None:
    owner, other = make_user(), make_user()
    _profile(db, owner.id)
    _profile(db, other.id)
    block = _block(db, owner.id)
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        _xp(db, other.id, block)


def test_deleting_a_block_keeps_its_xp(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    _profile(db, user.id)
    block = _block(db, user.id)
    event = _xp(db, user.id, block, xp=70)
    # As the user, who has no UPDATE on xp_events: the SET NULL still applies.
    with user_transaction(api_db, user) as conn:
        conn.execute("DELETE FROM app.blocks WHERE id = %s", (block,))
    row = db.execute(
        "SELECT user_id, block_id, xp FROM app.xp_events WHERE id = %s", (event,)
    ).fetchone()
    assert row == (user.id, None, 70)


@pytest.mark.parametrize("xp", [-1, 100001])
def test_xp_range(db: psycopg.Connection, make_user: MakeUser, xp: int) -> None:
    user = make_user()
    _profile(db, user.id)
    with pytest.raises(psycopg.errors.CheckViolation):
        _xp(db, user.id, None, xp=xp)


@pytest.mark.parametrize("xp", [0, 100000])
def test_xp_range_bounds_are_allowed(db: psycopg.Connection, make_user: MakeUser, xp: int) -> None:
    user = make_user()
    _profile(db, user.id)
    _xp(db, user.id, None, xp=xp)


@pytest.mark.parametrize(
    "key", ["", "First_task", "1st", "_x", "first-task", "a b", "x" * 41, "תג"]
)
def test_badge_key_must_be_a_slug(db: psycopg.Connection, make_user: MakeUser, key: str) -> None:
    user = make_user()
    _profile(db, user.id)
    with pytest.raises(psycopg.errors.CheckViolation):
        _badge(db, user.id, key)


def test_badge_key_slugs_are_allowed_once(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    _profile(db, user.id)
    _badge(db, user.id, "task_master_10")
    _badge(db, user.id, "x" * 40)
    with pytest.raises(psycopg.errors.UniqueViolation):
        _badge(db, user.id, "task_master_10")


def test_the_owner_reads_inserts_and_deletes(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    _profile(db, user.id)
    block = _block(db, user.id)
    with user_transaction(api_db, user) as conn:
        conn.execute(
            "INSERT INTO app.xp_events (user_id, block_id, xp, study_date) VALUES (%s, %s, 50, %s)",
            (user.id, block, _DAY),
        )
        conn.execute(
            "INSERT INTO app.badges (user_id, badge_key) VALUES (%s, 'first_task')", (user.id,)
        )
        assert conn.execute("SELECT block_id, xp FROM app.xp_events").fetchall() == [(block, 50)]
        assert conn.execute("SELECT badge_key FROM app.badges").fetchall() == [("first_task",)]
        assert conn.execute("DELETE FROM app.xp_events WHERE user_id = %s", (user.id,)).rowcount
        assert conn.execute("DELETE FROM app.badges WHERE user_id = %s", (user.id,)).rowcount


def test_another_user_neither_sees_nor_deletes(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    owner, event = _owner_with_rows(db, make_user)
    other = make_user()
    _profile(db, other.id)
    with user_transaction(api_db, other) as conn:
        assert conn.execute("SELECT id FROM app.xp_events").fetchall() == []
        assert conn.execute("SELECT badge_key FROM app.badges").fetchall() == []
        assert conn.execute("DELETE FROM app.xp_events").rowcount == 0
        assert conn.execute("DELETE FROM app.badges").rowcount == 0
    assert db.execute("SELECT id FROM app.xp_events").fetchall() == [(event,)]
    assert db.execute("SELECT user_id FROM app.badges").fetchall() == [(owner.id,)]


@pytest.mark.parametrize(
    "query",
    [
        "INSERT INTO app.xp_events (user_id, block_id, xp, study_date) "
        "VALUES (%s, NULL, 50, '2026-11-16')",
        "INSERT INTO app.badges (user_id, badge_key) VALUES (%s, 'first_task')",
    ],
)
def test_another_user_cannot_insert_for_the_owner(
    db: psycopg.Connection,
    api_db: psycopg.Connection,
    make_user: MakeUser,
    query: str,
) -> None:
    owner, other = make_user(), make_user()
    _profile(db, owner.id)
    _profile(db, other.id)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with user_transaction(api_db, other) as conn:
            conn.execute(query, (owner.id,))


@pytest.mark.parametrize(
    "query",
    [
        "UPDATE app.xp_events SET xp = 100000",
        "UPDATE app.xp_events SET study_date = '2026-11-17'",
        "UPDATE app.badges SET earned_at = now()",
        "INSERT INTO app.xp_events (id, user_id, xp, study_date) "
        "VALUES (gen_random_uuid(), %(user)s, 1, '2026-11-16')",
        "INSERT INTO app.xp_events (user_id, xp, study_date, created_at) "
        "VALUES (%(user)s, 1, '2026-11-16', now())",
        "INSERT INTO app.badges (user_id, badge_key, earned_at) "
        "VALUES (%(user)s, 'xp_1000', now())",
    ],
)
def test_the_owner_cannot_update_or_write_server_columns(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser, query: str
) -> None:
    user, _event = _owner_with_rows(db, make_user)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with user_transaction(api_db, user) as conn:
            conn.execute(query, {"user": user.id})


def test_column_grants(db: psycopg.Connection) -> None:
    rows = db.execute(
        "SELECT table_name, column_name, privilege_type "
        "FROM information_schema.column_privileges "
        "WHERE table_schema = 'app' AND table_name IN ('xp_events', 'badges') "
        "AND grantee = 'authenticated' AND privilege_type IN ('INSERT', 'UPDATE') "
        "ORDER BY 1, 2, 3"
    ).fetchall()
    assert rows == [
        ("badges", "badge_key", "INSERT"),
        ("badges", "user_id", "INSERT"),
        ("xp_events", "block_id", "INSERT"),
        ("xp_events", "kind", "INSERT"),
        ("xp_events", "study_date", "INSERT"),
        ("xp_events", "user_id", "INSERT"),
        ("xp_events", "xp", "INSERT"),
    ]


def test_deleting_the_profile_deletes_xp_and_badges(
    db: psycopg.Connection, make_user: MakeUser
) -> None:
    owner, _event = _owner_with_rows(db, make_user)
    other, _other_event = _owner_with_rows(db, make_user)
    db.execute("DELETE FROM app.profiles WHERE id = %s", (owner.id,))
    for table in ("xp_events", "badges"):
        rows = db.execute(f"SELECT DISTINCT user_id FROM app.{table}").fetchall()  # noqa: S608
        assert rows == [(other.id,)], table


def test_downgrade_to_0009_and_back() -> None:
    admin_url = admin_database_url()
    name = f"{os.environ.get('STUDYFLOW_TEST_DB', 'studyflow_test')}_0011"
    url = create_database(admin_url, name)
    try:
        config = alembic_config(url)
        command.upgrade(config, "0011")
        command.downgrade(config, "0009")
        with psycopg.connect(url, autocommit=True) as conn:
            assert conn.execute(
                "SELECT to_regclass('app.xp_events'), to_regclass('app.badges')"
            ).fetchone() == (None, None)
            assert conn.execute(
                "SELECT count(*) FROM pg_constraint WHERE conname = 'blocks_id_user_id_key'"
            ).fetchone() == (0,)
            assert conn.execute("SELECT version_num FROM app.alembic_version").fetchall() == [
                ("0009",)
            ]
        command.upgrade(config, "0011")
        with psycopg.connect(url, autocommit=True) as conn:
            assert conn.execute("SELECT version_num FROM app.alembic_version").fetchall() == [
                ("0011",)
            ]
    finally:
        drop_database(admin_url, name)
