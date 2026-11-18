"""Migration 0013: exams.color_index, assigned by a trigger and stable for the exam's life."""

import os
import threading
from collections.abc import Callable
from uuid import UUID

import psycopg
import pytest
from alembic import command
from psycopg import errors

from app.auth import CurrentUser
from app.db.session import user_transaction
from tests.db.support import admin_database_url, alembic_config, create_database, drop_database

MakeUser = Callable[[], CurrentUser]


def _exam(db: psycopg.Connection, user_id: UUID, colour: int | None = None) -> UUID:
    if colour is None:
        row = db.execute(
            "INSERT INTO app.exams (user_id, name, exam_date) "
            "VALUES (%s, 'x', '2027-01-01') RETURNING id",
            (user_id,),
        ).fetchone()
    else:
        row = db.execute(
            "INSERT INTO app.exams (user_id, name, exam_date, color_index) "
            "VALUES (%s, 'x', '2027-01-01', %s) RETURNING id",
            (user_id, colour),
        ).fetchone()
    assert row is not None
    return row[0]  # type: ignore[no-any-return]


def _colour(db: psycopg.Connection, exam_id: UUID) -> int:
    row = db.execute("SELECT color_index FROM app.exams WHERE id = %s", (exam_id,)).fetchone()
    assert row is not None
    return int(row[0])


def _delete(db: psycopg.Connection, exam_id: UUID) -> None:
    db.execute("UPDATE app.exams SET deleted_at = now() WHERE id = %s", (exam_id,))


def test_new_exams_take_the_first_free_colour(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    exams = [_exam(db, user.id) for _ in range(3)]
    assert [_colour(db, e) for e in exams] == [0, 1, 2]


def test_a_deleted_exam_frees_its_colour_and_keeps_it(
    db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    zero, one, two = (_exam(db, user.id) for _ in range(3))
    _delete(db, one)
    fresh = _exam(db, user.id)
    assert _colour(db, fresh) == 1
    assert [_colour(db, e) for e in (zero, one, two)] == [0, 1, 2]


def test_when_all_eight_are_used_the_order_continues(
    db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    exams = [_exam(db, user.id) for _ in range(10)]
    assert [_colour(db, e) for e in exams] == [0, 1, 2, 3, 4, 5, 6, 7, 0, 1]


def test_colours_are_per_user(db: psycopg.Connection, make_user: MakeUser) -> None:
    a, b = make_user(), make_user()
    assert [_colour(db, _exam(db, a.id)) for _ in range(2)] == [0, 1]
    assert _colour(db, _exam(db, b.id)) == 0


def test_an_explicit_colour_is_kept(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    assert _colour(db, _exam(db, user.id, colour=5)) == 5


@pytest.mark.parametrize("value", [8, -1])
def test_the_range_is_checked(db: psycopg.Connection, make_user: MakeUser, value: int) -> None:
    user = make_user()
    with pytest.raises(errors.CheckViolation):
        _exam(db, user.id, colour=value)


def test_the_column_is_not_null(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    exam = _exam(db, user.id)
    with pytest.raises(errors.NotNullViolation):
        db.execute("UPDATE app.exams SET color_index = NULL WHERE id = %s", (exam,))


def test_the_trigger_works_as_the_user_under_rls(
    api_db: psycopg.Connection, db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    with user_transaction(api_db, user) as conn:
        conn.execute("INSERT INTO app.profiles (id) VALUES (%s)", (user.id,))
        ids = [_exam(conn, user.id) for _ in range(3)]
    assert [_colour(db, e) for e in ids] == [0, 1, 2]


def test_concurrent_inserts_get_different_colours(
    migrated_database_url: str, db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    first = psycopg.connect(migrated_database_url)
    second = psycopg.connect(migrated_database_url)
    try:
        first_id = _exam(first, user.id)  # the transaction stays open, holding the lock
        result: dict[str, UUID] = {}

        def insert_second() -> None:
            result["id"] = _exam(second, user.id)

        thread = threading.Thread(target=insert_second)
        thread.start()
        thread.join(timeout=1.0)
        assert thread.is_alive(), "the second insert must wait for the lock"
        first.commit()
        thread.join(timeout=10)
        assert not thread.is_alive()
        second.commit()
    finally:
        first.close()
        second.close()
    assert [_colour(db, first_id), _colour(db, result["id"])] == [0, 1]


def test_upgrade_fills_existing_exams_in_order() -> None:
    admin_url = admin_database_url()
    name = f"{os.environ.get('STUDYFLOW_TEST_DB', 'studyflow_test')}_0013"
    url = create_database(admin_url, name)
    try:
        config = alembic_config(url)
        command.upgrade(config, "0014")
        with psycopg.connect(url, autocommit=True) as conn:
            users: list[UUID] = []
            for i in range(2):
                row = conn.execute(
                    "INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), %s) "
                    "RETURNING id",
                    (f"u{i}@example.com",),
                ).fetchone()
                assert row is not None
                users.append(row[0])
            ids: dict[str, UUID] = {}
            # (label, user, created_at, deleted): user 0's deleted exam is the oldest.
            rows = [
                ("a_deleted", 0, "2026-01-01", True),
                ("a1", 0, "2026-02-01", False),
                ("a2", 0, "2026-03-01", False),
                ("b1", 1, "2026-02-01", False),
            ]
            for label, index, created, deleted in rows:
                row = conn.execute(
                    "INSERT INTO app.exams (user_id, name, exam_date, created_at, deleted_at) "
                    "VALUES (%s, %s, '2027-01-01', %s, CASE WHEN %s THEN now() END) "
                    "RETURNING id",
                    (users[index], label, created, deleted),
                ).fetchone()
                assert row is not None
                ids[label] = row[0]
            command.upgrade(config, "0013")
            assert {label: _colour(conn, exam_id) for label, exam_id in ids.items()} == {
                "a1": 0,
                "a2": 1,
                "a_deleted": 2,
                "b1": 0,
            }
            command.downgrade(config, "0014")
            assert conn.execute(
                "SELECT count(*) FROM information_schema.columns "
                "WHERE table_schema = 'app' AND table_name = 'exams' "
                "AND column_name = 'color_index'"
            ).fetchone() == (0,)
            assert conn.execute(
                "SELECT count(*) FROM pg_trigger WHERE tgname = 'exams_assign_color'"
            ).fetchone() == (0,)
            assert conn.execute(
                "SELECT count(*) FROM pg_proc WHERE proname = 'exams_assign_color'"
            ).fetchone() == (0,)
            assert conn.execute("SELECT version_num FROM app.alembic_version").fetchall() == [
                ("0014",)
            ]
    finally:
        drop_database(admin_url, name)
