from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import psycopg
import pytest
from alembic import command
from psycopg.types.json import Jsonb

from app.auth import CurrentUser
from app.db.session import user_transaction
from tests.db.support import (
    admin_database_url,
    alembic_config,
    create_database,
    drop_database,
)

MakeUser = Callable[[], CurrentUser]

_SNAPSHOT = Jsonb({"v": 1, "blocks": []})


def _exam(conn: psycopg.Connection[Any], user: CurrentUser) -> UUID:
    row = conn.execute(
        "INSERT INTO app.exams (user_id, name, exam_date) VALUES (%s, 'Algebra', '2026-12-01') "
        "RETURNING id",
        (user.id,),
    ).fetchone()
    assert row is not None
    return row[0]  # type: ignore[no-any-return]


def _task(conn: psycopg.Connection[Any], user: CurrentUser, exam: UUID) -> UUID:
    row = conn.execute(
        "INSERT INTO app.tasks (user_id, exam_id, title, kind, estimated_minutes, source) "
        "VALUES (%s, %s, 'Chapter 1', 'learn', 60, 'user') RETURNING id",
        (user.id, exam),
    ).fetchone()
    assert row is not None
    return row[0]  # type: ignore[no-any-return]


def _insert_block(
    conn: psycopg.Connection[Any],
    user: CurrentUser,
    task: UUID,
    start: datetime,
    end: datetime,
) -> None:
    conn.execute(
        "INSERT INTO app.blocks (user_id, task_id, starts_at, ends_at) VALUES (%s, %s, %s, %s)",
        (user.id, task, start, end),
    )


def _version(conn: psycopg.Connection[Any], user: CurrentUser) -> UUID:
    row = conn.execute(
        "INSERT INTO app.plan_versions (user_id, reason, snapshot) VALUES (%s, 'replan', %s) "
        "RETURNING id",
        (user.id, _SNAPSHOT),
    ).fetchone()
    assert row is not None
    return row[0]  # type: ignore[no-any-return]


def test_block_times_must_be_whole_minutes(api_db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    start = datetime(2026, 11, 20, 7, 0, tzinfo=UTC)
    with user_transaction(api_db, user) as conn:
        task = _task(conn, user, _exam(conn, user))
    with pytest.raises(psycopg.errors.CheckViolation):
        with user_transaction(api_db, user) as conn:
            _insert_block(
                conn, user, task, start + timedelta(seconds=30), start + timedelta(hours=1)
            )
    with pytest.raises(psycopg.errors.CheckViolation):
        with user_transaction(api_db, user) as conn:
            _insert_block(conn, user, task, start, start + timedelta(hours=1, microseconds=1))
    with user_transaction(api_db, user) as conn:
        _insert_block(conn, user, task, start, start + timedelta(hours=1))
        assert conn.execute("SELECT count(*) FROM app.blocks").fetchone() == (1,)


@pytest.mark.parametrize("column", ["created_at", "undone_at"])
def test_authenticated_cannot_set_created_at_or_undone_at(
    api_db: psycopg.Connection, make_user: MakeUser, column: str
) -> None:
    user = make_user()
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with user_transaction(api_db, user) as conn:
            conn.execute(
                f"INSERT INTO app.plan_versions (user_id, reason, snapshot, {column}) "  # noqa: S608
                "VALUES (%s, 'replan', %s, now())",
                (user.id, _SNAPSHOT),
            )
    with user_transaction(api_db, user) as conn:
        _version(conn, user)
        assert conn.execute("SELECT count(*) FROM app.plan_versions").fetchone() == (1,)


def test_undone_at_is_set_once_to_now(api_db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    with user_transaction(api_db, user) as conn:
        fresh = _version(conn, user)
        undone = _version(conn, user)
    with user_transaction(api_db, user) as conn:
        row = conn.execute(
            "UPDATE app.plan_versions SET undone_at = '2000-01-01' WHERE id = %s "
            "RETURNING undone_at = now(), undone_at",
            (undone,),
        ).fetchone()
        assert row is not None
        assert row[0] is True
        assert row[1].year != 2000
    with pytest.raises(psycopg.errors.CheckViolation):
        with user_transaction(api_db, user) as conn:
            conn.execute("UPDATE app.plan_versions SET undone_at = now() WHERE id = %s", (undone,))
    with pytest.raises(psycopg.errors.CheckViolation):
        with user_transaction(api_db, user) as conn:
            conn.execute("UPDATE app.plan_versions SET undone_at = NULL WHERE id = %s", (fresh,))


def test_versions_in_one_transaction_get_increasing_created_at(
    api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    # created_at is the insert time, not the transaction start: versions are ordered by
    # when they were written (after the user lock), which is what undo relies on.
    user = make_user()
    with user_transaction(api_db, user) as conn:
        first = _version(conn, user)
        second = _version(conn, user)
        rows = dict(
            conn.execute(
                "SELECT id, created_at FROM app.plan_versions WHERE id = ANY(%s)",
                ([first, second],),
            ).fetchall()
        )
        started = conn.execute("SELECT now()").fetchone()
    assert started is not None
    assert started[0] < rows[first] < rows[second]


def test_version_links_to_own_exam_and_task_only(
    api_db: psycopg.Connection, db: psycopg.Connection, make_user: MakeUser
) -> None:
    a = make_user()
    b = make_user()
    with user_transaction(api_db, a) as conn:
        exam = _exam(conn, a)
        task = _task(conn, a, exam)
    with user_transaction(api_db, b) as conn:
        other_exam = _exam(conn, b)
        other_task = _task(conn, b, other_exam)
    insert = (
        "INSERT INTO app.plan_versions (user_id, reason, snapshot, exam_id, task_id) "
        "VALUES (%s, 'replan', %s, %s, %s)"
    )
    for exam_id, task_id in [(other_exam, None), (None, other_task)]:
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            with user_transaction(api_db, a) as conn:
                conn.execute(insert, (a.id, _SNAPSHOT, exam_id, task_id))
    with user_transaction(api_db, a) as conn:
        conn.execute(insert, (a.id, _SNAPSHOT, exam, task))
    db.execute("DELETE FROM app.exams WHERE id = %s", (exam,))
    assert db.execute("SELECT user_id, exam_id, task_id FROM app.plan_versions").fetchall() == [
        (a.id, None, None)
    ]


def test_downgrade_and_upgrade_again() -> None:
    admin_url = admin_database_url()
    name = "studyflow_api_hardening_test"
    url = create_database(admin_url, name)
    try:
        config = alembic_config(url)
        command.upgrade(config, "head")
        command.downgrade(config, "0003")
        with psycopg.connect(url, autocommit=True) as conn:
            assert conn.execute(
                "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'app' "
                "AND table_name = 'plan_versions' AND column_name IN ('exam_id', 'task_id')"
            ).fetchone() == (0,)
            assert conn.execute(
                "SELECT count(*) FROM pg_constraint WHERE conname = 'blocks_whole_minutes'"
            ).fetchone() == (0,)
            assert conn.execute(
                "SELECT count(*) FROM pg_trigger WHERE tgname = 'plan_versions_undo_once'"
            ).fetchone() == (0,)
            assert conn.execute(
                "SELECT has_table_privilege('authenticated', 'app.plan_versions', 'INSERT')"
            ).fetchone() == (True,)
            assert conn.execute(
                "SELECT column_default FROM information_schema.columns "
                "WHERE table_schema = 'app' AND table_name = 'plan_versions' "
                "AND column_name = 'created_at'"
            ).fetchone() == ("now()",)
        command.upgrade(config, "head")
        with psycopg.connect(url, autocommit=True) as conn:
            assert conn.execute(
                "SELECT count(*) FROM pg_trigger WHERE tgname = 'plan_versions_undo_once'"
            ).fetchone() == (1,)
            assert conn.execute(
                "SELECT has_table_privilege('authenticated', 'app.plan_versions', 'INSERT')"
            ).fetchone() == (False,)
    finally:
        drop_database(admin_url, name)
