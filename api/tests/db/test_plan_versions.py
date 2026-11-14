import json
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import psycopg
import pytest
from alembic import command
from psycopg.types.json import Jsonb

from app.auth import CurrentUser
from app.db.session import user_transaction
from app.domain.planner import (
    BlockStatus,
    Interval,
    SnapshotBlock,
    parse_snapshot,
    snapshot,
    undo,
)
from tests.db.support import (
    admin_database_url,
    alembic_config,
    create_database,
    drop_database,
)

MakeUser = Callable[[], CurrentUser]

_VALID_SNAPSHOT = Jsonb({"v": 1, "blocks": []})


def _at(day: int, hour: int) -> datetime:
    return datetime(2026, 11, day, hour, 0, tzinfo=UTC)


def _task(conn: psycopg.Connection[Any], user: CurrentUser) -> UUID:
    exam = conn.execute(
        "INSERT INTO app.exams (user_id, name, exam_date) VALUES (%s, 'Algebra', '2026-12-01') "
        "RETURNING id",
        (user.id,),
    ).fetchone()
    assert exam is not None
    task = conn.execute(
        "INSERT INTO app.tasks (user_id, exam_id, title, kind, estimated_minutes, source) "
        "VALUES (%s, %s, 'Chapter 1', 'learn', 60, 'user') RETURNING id",
        (user.id, exam[0]),
    ).fetchone()
    assert task is not None
    return task[0]  # type: ignore[no-any-return]


def _block(
    conn: psycopg.Connection[Any],
    user: CurrentUser,
    task_id: UUID,
    start: datetime,
    end: datetime,
    status: str = "planned",
) -> UUID:
    row = conn.execute(
        "INSERT INTO app.blocks (user_id, task_id, starts_at, ends_at, status) "
        "VALUES (%s, %s, %s, %s, %s) RETURNING id",
        (user.id, task_id, start, end, status),
    ).fetchone()
    assert row is not None
    return row[0]  # type: ignore[no-any-return]


def _version(conn: psycopg.Connection[Any], user: CurrentUser) -> UUID:
    row = conn.execute(
        "INSERT INTO app.plan_versions (user_id, reason, snapshot) VALUES (%s, 'replan', %s) "
        "RETURNING id",
        (user.id, _VALID_SNAPSHOT),
    ).fetchone()
    assert row is not None
    return row[0]  # type: ignore[no-any-return]


def test_overlapping_live_blocks_are_rejected_at_commit(
    api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    with pytest.raises(psycopg.errors.ExclusionViolation):
        with user_transaction(api_db, user) as conn:
            task = _task(conn, user)
            _block(conn, user, task, _at(20, 7), _at(20, 9))
            _block(conn, user, task, _at(20, 8), _at(20, 10))


def test_touching_blocks_are_allowed(api_db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    with user_transaction(api_db, user) as conn:
        task = _task(conn, user)
        _block(conn, user, task, _at(20, 7), _at(20, 8))
        _block(conn, user, task, _at(20, 8), _at(20, 9))


@pytest.mark.parametrize("status", ["missed", "skipped"])
def test_missed_and_skipped_blocks_may_overlap(
    api_db: psycopg.Connection, make_user: MakeUser, status: str
) -> None:
    user = make_user()
    with user_transaction(api_db, user) as conn:
        task = _task(conn, user)
        _block(conn, user, task, _at(20, 7), _at(20, 9))
        _block(conn, user, task, _at(20, 8), _at(20, 10), status=status)
        _block(conn, user, task, _at(20, 8), _at(20, 10), status=status)


def test_two_users_may_overlap(api_db: psycopg.Connection, make_user: MakeUser) -> None:
    for user in (make_user(), make_user()):
        with user_transaction(api_db, user) as conn:
            _block(conn, user, _task(conn, user), _at(20, 7), _at(20, 8))


def test_blocks_can_swap_places_in_one_transaction(
    api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    with user_transaction(api_db, user) as conn:
        task = _task(conn, user)
        first = _block(conn, user, task, _at(20, 7), _at(20, 8))
        second = _block(conn, user, task, _at(20, 8), _at(20, 10))
    with user_transaction(api_db, user) as conn:
        conn.execute(
            "UPDATE app.blocks SET starts_at = %s, ends_at = %s WHERE id = %s",
            (_at(20, 8), _at(20, 10), first),
        )
        conn.execute(
            "UPDATE app.blocks SET starts_at = %s, ends_at = %s WHERE id = %s",
            (_at(20, 7), _at(20, 8), second),
        )
    with user_transaction(api_db, user) as conn:
        rows = conn.execute("SELECT id, starts_at FROM app.blocks ORDER BY starts_at").fetchall()
    assert rows == [(second, _at(20, 7)), (first, _at(20, 8))]


def test_a_version_belongs_to_its_user(api_db: psycopg.Connection, make_user: MakeUser) -> None:
    a = make_user()
    b = make_user()
    with user_transaction(api_db, a) as conn:
        version = _version(conn, a)
    with user_transaction(api_db, b) as conn:
        assert conn.execute("SELECT count(*) FROM app.plan_versions").fetchone() == (0,)
        cur = conn.execute(
            "UPDATE app.plan_versions SET undone_at = now() WHERE id = %s", (version,)
        )
        assert cur.rowcount == 0
    with user_transaction(api_db, a) as conn:
        row = conn.execute("SELECT undone_at FROM app.plan_versions").fetchone()
    assert row == (None,)
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="row-level security"):
        with user_transaction(api_db, b) as conn:
            _version(conn, a)


def test_a_block_cannot_point_at_another_users_version(
    api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    a = make_user()
    b = make_user()
    with user_transaction(api_db, a) as conn:
        version = _version(conn, a)
    with user_transaction(api_db, b) as conn:
        task = _task(conn, b)
        block = _block(conn, b, task, _at(20, 7), _at(20, 8))
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        with user_transaction(api_db, b) as conn:
            conn.execute(
                "UPDATE app.blocks SET plan_version_id = %s WHERE id = %s", (version, block)
            )


def test_deleting_a_version_keeps_its_blocks(
    api_db: psycopg.Connection, db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    with user_transaction(api_db, user) as conn:
        version = _version(conn, user)
        task = _task(conn, user)
        block = _block(conn, user, task, _at(20, 7), _at(20, 8))
        conn.execute("UPDATE app.blocks SET plan_version_id = %s WHERE id = %s", (version, block))
    assert db.execute("SELECT plan_version_id FROM app.blocks").fetchone() == (version,)
    db.execute("DELETE FROM app.plan_versions WHERE id = %s", (version,))
    assert db.execute("SELECT plan_version_id, user_id FROM app.blocks").fetchall() == [
        (None, user.id)
    ]


def test_authenticated_cannot_delete_or_rewrite_a_version(
    api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    with user_transaction(api_db, user) as conn:
        version = _version(conn, user)
    statements = [
        ("DELETE FROM app.plan_versions WHERE id = %s", (version,)),
        ("UPDATE app.plan_versions SET reason = 'other' WHERE id = %s", (version,)),
        (
            "UPDATE app.plan_versions SET snapshot = %s WHERE id = %s",
            (_VALID_SNAPSHOT, version),
        ),
    ]
    for statement, params in statements:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with user_transaction(api_db, user) as conn:
                conn.execute(statement, params)
    with user_transaction(api_db, user) as conn:
        cur = conn.execute(
            "UPDATE app.plan_versions SET undone_at = now() WHERE id = %s", (version,)
        )
        assert cur.rowcount == 1


@pytest.mark.parametrize("reason", ["", "Replan", "a b", "a" * 41])
def test_reason_is_checked(api_db: psycopg.Connection, make_user: MakeUser, reason: str) -> None:
    user = make_user()
    with pytest.raises(psycopg.errors.CheckViolation):
        with user_transaction(api_db, user) as conn:
            conn.execute(
                "INSERT INTO app.plan_versions (user_id, reason, snapshot) VALUES (%s, %s, %s)",
                (user.id, reason, _VALID_SNAPSHOT),
            )


@pytest.mark.parametrize(
    "document",
    ["[]", "{}", '{"v": "1", "blocks": []}', '{"v": 1, "blocks": {}}'],
)
def test_snapshot_is_checked(
    api_db: psycopg.Connection, make_user: MakeUser, document: str
) -> None:
    user = make_user()
    with pytest.raises(psycopg.errors.CheckViolation):
        with user_transaction(api_db, user) as conn:
            conn.execute(
                "INSERT INTO app.plan_versions (user_id, reason, snapshot) "
                "VALUES (%s, 'replan', %s::jsonb)",
                (user.id, document),
            )


def _current(conn: psycopg.Connection[Any]) -> list[SnapshotBlock]:
    rows = conn.execute(
        "SELECT id, task_id, starts_at, ends_at, part_index, part_count, pinned, status "
        "FROM app.blocks"
    ).fetchall()
    return [
        SnapshotBlock(
            id=id_,
            task_id=task_id,
            interval=Interval(starts_at.astimezone(UTC), ends_at.astimezone(UTC)),
            part_index=part_index,
            part_count=part_count,
            pinned=pinned,
            status=BlockStatus(status),
        )
        for id_, task_id, starts_at, ends_at, part_index, part_count, pinned, status in rows
    ]


_BLOCK_ROWS = (
    "SELECT id, task_id, starts_at, ends_at, part_index, part_count, pinned, status "
    "FROM app.blocks ORDER BY starts_at"
)


def test_a_change_and_its_undo_round_trip(api_db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    now = _at(14, 8)
    with user_transaction(api_db, user) as conn:
        task = _task(conn, user)
        a = _block(conn, user, task, _at(20, 7), _at(20, 8))
        b = _block(conn, user, task, _at(20, 9), _at(20, 10))
        c = _block(conn, user, task, _at(20, 11), _at(20, 12))
        conn.execute("UPDATE app.blocks SET pinned = true WHERE id = %s", (c,))
        before = conn.execute(_BLOCK_ROWS).fetchall()
        saved = snapshot(_current(conn), now)
        version = conn.execute(
            "INSERT INTO app.plan_versions (user_id, reason, snapshot) "
            "VALUES (%s, 'replan', %s) RETURNING id",
            (user.id, Jsonb(saved)),
        ).fetchone()
        assert version is not None
    assert len(before) == 3

    # The change: a and b go, d takes a's slot, e is new.
    with user_transaction(api_db, user) as conn:
        conn.execute("DELETE FROM app.blocks WHERE id IN (%s, %s)", (a, b))
        d = _block(conn, user, task, _at(20, 7), _at(20, 8))
        e = _block(conn, user, task, _at(20, 13), _at(20, 14))
        conn.execute(
            "UPDATE app.blocks SET plan_version_id = %s WHERE id IN (%s, %s)",
            (version[0], d, e),
        )
        assert len(conn.execute(_BLOCK_ROWS).fetchall()) == 3

    with user_transaction(api_db, user) as conn:
        stored = conn.execute(
            "SELECT snapshot FROM app.plan_versions WHERE id = %s AND undone_at IS NULL",
            (version[0],),
        ).fetchone()
        assert stored is not None
        result = undo(parse_snapshot(json.loads(json.dumps(stored[0]))), _current(conn), now)
        assert set(result.delete) == {d, e}
        assert {block.id for block in result.restore} == {a, b}
        conn.execute("DELETE FROM app.blocks WHERE id = ANY(%s)", (list(result.delete),))
        for block in result.restore:
            conn.execute(
                "INSERT INTO app.blocks (id, user_id, task_id, starts_at, ends_at, part_index, "
                "part_count, pinned, status) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'planned')",
                (
                    block.id,
                    user.id,
                    block.task_id,
                    block.interval.start,
                    block.interval.end,
                    block.part_index,
                    block.part_count,
                    block.pinned,
                ),
            )
        conn.execute("UPDATE app.plan_versions SET undone_at = now() WHERE id = %s", (version[0],))

    with user_transaction(api_db, user) as conn:
        # c was never touched by the change, so undo leaves it alone (it is not in delete or
        # restore), and the calendar is back to what it was.
        assert conn.execute(_BLOCK_ROWS).fetchall() == before
        row = conn.execute("SELECT undone_at IS NOT NULL FROM app.plan_versions").fetchone()
        assert row == (True,)


def test_downgrade_removes_what_0003_added() -> None:
    admin_url = admin_database_url()
    name = "studyflow_plan_versions_test"
    url = create_database(admin_url, name)
    try:
        config = alembic_config(url)
        command.upgrade(config, "head")
        command.downgrade(config, "0002")
        with psycopg.connect(url, autocommit=True) as conn:
            assert conn.execute("SELECT to_regclass('app.plan_versions')").fetchone() == (None,)
            assert conn.execute(
                "SELECT count(*) FROM information_schema.columns "
                "WHERE table_schema = 'app' AND table_name = 'blocks' "
                "AND column_name = 'plan_version_id'"
            ).fetchone() == (0,)
            assert conn.execute(
                "SELECT count(*) FROM pg_constraint WHERE conname IN "
                "('blocks_no_overlap', 'blocks_plan_version_fkey')"
            ).fetchone() == (0,)
        command.upgrade(config, "head")
        with psycopg.connect(url, autocommit=True) as conn:
            assert conn.execute("SELECT to_regclass('app.plan_versions')").fetchone() is not None
            assert conn.execute(
                "SELECT count(*) FROM pg_constraint WHERE conname = 'blocks_no_overlap'"
            ).fetchone() == (1,)
    finally:
        drop_database(admin_url, name)
