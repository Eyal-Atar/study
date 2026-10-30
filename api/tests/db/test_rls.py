from collections.abc import Callable
from uuid import UUID

import psycopg
import pytest
from psycopg.conninfo import make_conninfo

from app.auth import CurrentUser
from app.db.session import user_transaction

TABLES = ("profiles", "exams", "tasks", "blocks")
# profiles has no DELETE grant: a profile goes only together with the account.
DELETABLE_TABLES = ("exams", "tasks", "blocks")


def seed(api_db: psycopg.Connection, user: CurrentUser) -> dict[str, UUID]:
    """Create a profile, exam, task and block for user; return their ids by table."""
    with user_transaction(api_db, user) as conn:
        conn.execute("INSERT INTO app.profiles (id) VALUES (%s)", (user.id,))
        exam_id = conn.execute(
            "INSERT INTO app.exams (user_id, name, exam_date) "
            "VALUES (%s, 'Calculus', '2027-03-26') RETURNING id",
            (user.id,),
        ).fetchone()
        assert exam_id is not None
        task_id = conn.execute(
            "INSERT INTO app.tasks (user_id, exam_id, title, kind, estimated_minutes, source) "
            "VALUES (%s, %s, 'Limits', 'learn', 60, 'user') RETURNING id",
            (user.id, exam_id[0]),
        ).fetchone()
        assert task_id is not None
        block_id = conn.execute(
            "INSERT INTO app.blocks (user_id, task_id, starts_at, ends_at) "
            "VALUES (%s, %s, '2027-03-20 08:00Z', '2027-03-20 09:00Z') RETURNING id",
            (user.id, task_id[0]),
        ).fetchone()
        assert block_id is not None
    return {
        "profiles": user.id,
        "exams": exam_id[0],
        "tasks": task_id[0],
        "blocks": block_id[0],
    }


def count(conn: psycopg.Connection, table: str) -> int:
    row = conn.execute(f"SELECT count(*) FROM app.{table}").fetchone()  # noqa: S608
    assert row is not None
    return int(row[0])


def test_user_sees_only_their_own_rows(
    api_db: psycopg.Connection, make_user: Callable[[], CurrentUser]
) -> None:
    a = make_user()
    b = make_user()
    seed(api_db, a)
    with user_transaction(api_db, a) as conn:
        assert [count(conn, t) for t in TABLES] == [1, 1, 1, 1]
    with user_transaction(api_db, b) as conn:
        assert [count(conn, t) for t in TABLES] == [0, 0, 0, 0]


def test_user_cannot_update_or_delete_rows_of_another_user(
    api_db: psycopg.Connection, db: psycopg.Connection, make_user: Callable[[], CurrentUser]
) -> None:
    a = make_user()
    b = make_user()
    ids = seed(api_db, a)
    key = {"profiles": "id"}
    sets = {
        "profiles": "display_name = 'x'",
        "exams": "name = 'x'",
        "tasks": "title = 'x'",
        "blocks": "pinned = true",
    }
    with user_transaction(api_db, b) as conn:
        for table in TABLES:
            column = key.get(table, "id")
            cur = conn.execute(
                f"UPDATE app.{table} SET {sets[table]} WHERE {column} = %s",  # noqa: S608
                (ids[table],),
            )
            assert cur.rowcount == 0, table
        for table in DELETABLE_TABLES:
            cur = conn.execute(f"DELETE FROM app.{table} WHERE id = %s", (ids[table],))  # noqa: S608
            assert cur.rowcount == 0, table
    assert db.execute("SELECT display_name FROM app.profiles").fetchall() == [(None,)]
    assert db.execute("SELECT name FROM app.exams").fetchall() == [("Calculus",)]
    assert db.execute("SELECT title FROM app.tasks").fetchall() == [("Limits",)]
    assert db.execute("SELECT pinned FROM app.blocks").fetchall() == [(False,)]


def test_user_cannot_insert_rows_for_another_user(
    api_db: psycopg.Connection, make_user: Callable[[], CurrentUser]
) -> None:
    a = make_user()
    b = make_user()
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="row-level security"):
        with user_transaction(api_db, b) as conn:
            conn.execute(
                "INSERT INTO app.exams (user_id, name, exam_date) VALUES (%s, 'x', '2027-01-01')",
                (a.id,),
            )
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="row-level security"):
        with user_transaction(api_db, b) as conn:
            conn.execute("INSERT INTO app.profiles (id) VALUES (%s)", (a.id,))


def test_user_cannot_link_to_a_row_of_another_user(
    api_db: psycopg.Connection, make_user: Callable[[], CurrentUser]
) -> None:
    a = make_user()
    b = make_user()
    ids = seed(api_db, a)
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        with user_transaction(api_db, b) as conn:
            conn.execute(
                "INSERT INTO app.tasks (user_id, exam_id, title, kind, estimated_minutes, source) "
                "VALUES (%s, %s, 'x', 'learn', 30, 'user')",
                (b.id, ids["exams"]),
            )
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        with user_transaction(api_db, b) as conn:
            conn.execute(
                "INSERT INTO app.blocks (user_id, task_id, starts_at, ends_at) "
                "VALUES (%s, %s, '2027-03-20 08:00Z', '2027-03-20 09:00Z')",
                (b.id, ids["tasks"]),
            )


def test_user_cannot_depend_on_a_task_of_another_user(
    api_db: psycopg.Connection, make_user: Callable[[], CurrentUser]
) -> None:
    a = make_user()
    b = make_user()
    ids = seed(api_db, a)
    seed(api_db, b)
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        with user_transaction(api_db, b) as conn:
            exam = conn.execute("SELECT id FROM app.exams").fetchone()
            assert exam is not None
            conn.execute(
                "INSERT INTO app.tasks (user_id, exam_id, title, kind, estimated_minutes, "
                "source, depends_on_task_id) VALUES (%s, %s, 'x', 'learn', 30, 'user', %s)",
                (b.id, exam[0], ids["tasks"]),
            )


def test_user_cannot_hand_their_exam_to_another_user(
    api_db: psycopg.Connection, make_user: Callable[[], CurrentUser]
) -> None:
    a = make_user()
    b = make_user()
    ids_b = seed(api_db, b)
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="row-level security"):
        with user_transaction(api_db, b) as conn:
            conn.execute("UPDATE app.exams SET user_id = %s WHERE id = %s", (a.id, ids_b["exams"]))


def test_user_cannot_move_their_task_to_an_exam_of_another_user(
    api_db: psycopg.Connection, make_user: Callable[[], CurrentUser]
) -> None:
    a = make_user()
    b = make_user()
    ids_a = seed(api_db, a)
    ids_b = seed(api_db, b)
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        with user_transaction(api_db, b) as conn:
            conn.execute(
                "UPDATE app.tasks SET exam_id = %s WHERE id = %s",
                (ids_a["exams"], ids_b["tasks"]),
            )


def test_session_level_subject_cannot_override_the_user(
    api_db: psycopg.Connection, make_user: Callable[[], CurrentUser]
) -> None:
    a = make_user()
    b = make_user()
    seed(api_db, a)
    # What a pooled connection could carry over from earlier use.
    api_db.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(a.id),))
    try:
        with user_transaction(api_db, b) as conn:
            row = conn.execute("select auth.uid()").fetchone()
            assert row == (b.id,)
            assert count(conn, "exams") == 0
    finally:
        api_db.execute("select set_config('request.jwt.claim.sub', '', false)")


def test_api_role_without_user_transaction_is_denied(api_db: psycopg.Connection) -> None:
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        api_db.execute("select count(*) from app.exams")


def test_user_transaction_sets_role_identity_and_utc(
    api_db: psycopg.Connection, make_user: Callable[[], CurrentUser]
) -> None:
    a = make_user()
    with user_transaction(api_db, a) as conn:
        row = conn.execute(
            "select current_user, auth.uid(), current_setting('TimeZone')"
        ).fetchone()
        assert row == ("authenticated", a.id, "UTC")
    after = api_db.execute("select current_user, current_setting('request.jwt.claims', true)")
    user, claims = after.fetchone() or (None, None)
    assert user == "studyflow_api"
    assert claims in (None, "")


def test_error_inside_user_transaction_rolls_back_and_resets(
    api_db: psycopg.Connection, db: psycopg.Connection, make_user: Callable[[], CurrentUser]
) -> None:
    a = make_user()
    with pytest.raises(RuntimeError, match="boom"):
        with user_transaction(api_db, a) as conn:
            conn.execute(
                "INSERT INTO app.exams (user_id, name, exam_date) VALUES (%s, 'x', '2027-01-01')",
                (a.id,),
            )
            raise RuntimeError("boom")
    assert db.execute("SELECT count(*) FROM app.exams").fetchone() == (0,)
    assert api_db.execute("select current_user").fetchone() == ("studyflow_api",)
    with user_transaction(api_db, a) as conn:
        assert conn.execute("select current_user").fetchone() == ("authenticated",)


def test_user_transaction_refuses_a_connection_inside_a_transaction(
    migrated_database_url: str, make_user: Callable[[], CurrentUser]
) -> None:
    a = make_user()
    url = make_conninfo(migrated_database_url, user="studyflow_api")
    with psycopg.connect(url, autocommit=False) as conn:
        conn.execute("select 1")
        with pytest.raises(RuntimeError):
            with user_transaction(conn, a):
                pytest.fail("the block must not run")
        assert conn.execute("select current_user").fetchone() == ("studyflow_api",)
