"""Migration 0018: app.xp_events gets a kind, and the first plan's XP row (S34 decision 8).

Every row before 0018 is a block's XP, so the default 'block' fills them. A 'first_plan'
row has no block and at most one per user (a partial unique index).
"""

import os
from collections.abc import Callable
from datetime import date
from uuid import UUID, uuid4

import psycopg
import pytest
from alembic import command
from alembic.script import ScriptDirectory

from app.auth import CurrentUser
from app.db.session import user_transaction
from tests.db.support import admin_database_url, alembic_config, create_database, drop_database

MakeUser = Callable[[], CurrentUser]

_DAY = date(2026, 11, 16)
_CHECKS = ("xp_events_kind_block", "xp_events_kind_check")


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


def _first_plan(db: psycopg.Connection, user_id: UUID, block_id: UUID | None = None) -> None:
    db.execute(
        "INSERT INTO app.xp_events (user_id, block_id, xp, study_date, kind) "
        "VALUES (%s, %s, 50, %s, 'first_plan')",
        (user_id, block_id, _DAY),
    )


def _kind_column(conn: psycopg.Connection) -> tuple[object, ...] | None:
    return conn.execute(
        "SELECT data_type, is_nullable, column_default FROM information_schema.columns "
        "WHERE table_schema = 'app' AND table_name = 'xp_events' AND column_name = 'kind'"
    ).fetchone()


def _checks(conn: psycopg.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT conname FROM pg_constraint WHERE conrelid = 'app.xp_events'::regclass "
        "AND conname LIKE 'xp_events_kind%' ORDER BY conname"
    ).fetchall()
    return [row[0] for row in rows]


def _index(conn: psycopg.Connection) -> tuple[object, ...] | None:
    return conn.execute(
        "SELECT indexdef FROM pg_indexes WHERE schemaname = 'app' "
        "AND indexname = 'xp_events_first_plan_key'"
    ).fetchone()


def test_one_head() -> None:
    # 0016 follows 0015, 0017 follows 0016 and 0018 follows 0017: one line, no branch.
    config = alembic_config(admin_database_url())
    assert ScriptDirectory.from_config(config).get_heads() == ["0018"]


def test_head_has_the_kind_column_its_checks_and_the_index(db: psycopg.Connection) -> None:
    assert _kind_column(db) == ("text", "NO", "'block'::text")
    assert _checks(db) == list(_CHECKS)
    constraints: dict[str, str] = dict(
        db.execute(
            "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint "
            "WHERE conrelid = 'app.xp_events'::regclass AND conname LIKE 'xp_events_kind%'"
        ).fetchall()
    )
    assert constraints["xp_events_kind_check"] == (
        "CHECK ((kind = ANY (ARRAY['block'::text, 'first_plan'::text])))"
    )
    assert constraints["xp_events_kind_block"] == (
        "CHECK (((kind = 'block'::text) OR (block_id IS NULL)))"
    )
    assert _index(db) == (
        "CREATE UNIQUE INDEX xp_events_first_plan_key ON app.xp_events USING btree (user_id) "
        "WHERE (kind = 'first_plan'::text)",
    )


def test_an_unknown_kind_is_rejected(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    _profile(db, user.id)
    with pytest.raises(psycopg.errors.CheckViolation, match="xp_events_kind_check"):
        db.execute(
            "INSERT INTO app.xp_events (user_id, xp, study_date, kind) "
            "VALUES (%s, 50, %s, 'bonus')",
            (user.id, _DAY),
        )


def test_a_first_plan_row_cannot_point_at_a_block(
    db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    _profile(db, user.id)
    block = _block(db, user.id)
    with pytest.raises(psycopg.errors.CheckViolation, match="xp_events_kind_block"):
        _first_plan(db, user.id, block)


def test_one_first_plan_row_per_user(db: psycopg.Connection, make_user: MakeUser) -> None:
    user, other = make_user(), make_user()
    _profile(db, user.id)
    _profile(db, other.id)
    _first_plan(db, user.id)
    with pytest.raises(psycopg.errors.UniqueViolation, match="xp_events_first_plan_key"):
        _first_plan(db, user.id)
    _first_plan(db, other.id)
    # Rows of blocks that are gone (block_id NULL, kind 'block') are not limited.
    for _ in range(2):
        db.execute(
            "INSERT INTO app.xp_events (user_id, xp, study_date) VALUES (%s, 10, %s)",
            (user.id, _DAY),
        )
    rows = db.execute(
        "SELECT kind, count(*) FROM app.xp_events WHERE user_id = %s GROUP BY kind ORDER BY kind",
        (user.id,),
    ).fetchall()
    assert rows == [("block", 2), ("first_plan", 1)]


def test_the_owner_inserts_a_kind_and_another_user_cannot(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    owner, other = make_user(), make_user()
    _profile(db, owner.id)
    _profile(db, other.id)
    with user_transaction(api_db, owner) as conn:
        conn.execute(
            "INSERT INTO app.xp_events (user_id, block_id, xp, study_date, kind) "
            "VALUES (%s, NULL, 50, %s, 'first_plan')",
            (owner.id, _DAY),
        )
        assert conn.execute("SELECT kind, xp FROM app.xp_events").fetchall() == [("first_plan", 50)]
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with user_transaction(api_db, other) as conn:
            conn.execute(
                "INSERT INTO app.xp_events (user_id, block_id, xp, study_date, kind) "
                "VALUES (%s, NULL, 50, %s, 'first_plan')",
                (owner.id, _DAY),
            )
    assert db.execute("SELECT user_id FROM app.xp_events").fetchall() == [(owner.id,)]


def test_upgrade_marks_existing_rows_as_blocks_and_downgrade_drops_the_first_plan() -> None:
    admin_url = admin_database_url()
    name = f"{os.environ.get('STUDYFLOW_TEST_DB', 'studyflow_test')}_0018"
    url = create_database(admin_url, name)
    try:
        config = alembic_config(url)
        command.upgrade(config, "0017")
        user_id = uuid4()
        with psycopg.connect(url, autocommit=True) as conn:
            assert _kind_column(conn) is None
            conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
            _profile(conn, user_id)
            block = _block(conn, user_id)
            conn.execute(
                "INSERT INTO app.xp_events (user_id, block_id, xp, study_date) "
                "VALUES (%s, %s, 50, %s), (%s, NULL, 20, %s)",
                (user_id, block, _DAY, user_id, _DAY),
            )

        command.upgrade(config, "0018")
        with psycopg.connect(url, autocommit=True) as conn:
            rows = conn.execute(
                "SELECT block_id, kind FROM app.xp_events ORDER BY xp DESC"
            ).fetchall()
            assert rows == [(block, "block"), (None, "block")]
            _first_plan(conn, user_id)

        command.downgrade(config, "0017")
        with psycopg.connect(url, autocommit=True) as conn:
            assert _kind_column(conn) is None
            assert _checks(conn) == []
            assert _index(conn) is None
            # The first plan's row goes; without a kind it would count as a block.
            rows = conn.execute(
                "SELECT block_id, xp FROM app.xp_events ORDER BY xp DESC"
            ).fetchall()
            assert rows == [(block, 50), (None, 20)]
            assert conn.execute(
                "SELECT count(*) FROM information_schema.column_privileges "
                "WHERE table_schema = 'app' AND table_name = 'xp_events' AND column_name = 'kind'"
            ).fetchone() == (0,)

        command.upgrade(config, "0018")
        with psycopg.connect(url, autocommit=True) as conn:
            assert _kind_column(conn) == ("text", "NO", "'block'::text")
            assert _checks(conn) == list(_CHECKS)
            assert conn.execute("SELECT version_num FROM app.alembic_version").fetchall() == [
                ("0018",)
            ]
    finally:
        drop_database(admin_url, name)
