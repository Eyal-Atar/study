"""Migration 0016: exam closure, Moed B, tasks.sitting and plan_versions.exam_before."""

import os
from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from alembic import command
from psycopg import errors
from psycopg.types.json import Jsonb

from app.auth import CurrentUser
from app.db.session import user_transaction
from tests.db.support import admin_database_url, alembic_config, create_database, drop_database

MakeUser = Callable[[], CurrentUser]


def _one(db: psycopg.Connection, query: str, params: Any = ()) -> Any:
    row = db.execute(query, params).fetchone()
    assert row is not None
    return row[0]


def _exam(db: psycopg.Connection, user_id: UUID, **columns: Any) -> UUID:
    values: dict[str, Any] = {"user_id": user_id, "name": "Algebra", "exam_date": "2027-01-20"}
    values.update(columns)
    names = ", ".join(values)
    placeholders = ", ".join(f"%({name})s" for name in values)
    exam: UUID = _one(
        db,
        f"INSERT INTO app.exams ({names}) VALUES ({placeholders}) RETURNING id",  # noqa: S608
        values,
    )
    return exam


def _task(db: psycopg.Connection, user_id: UUID, exam_id: UUID, sitting: int | None = None) -> UUID:
    if sitting is None:
        query = (
            "INSERT INTO app.tasks (user_id, exam_id, title, kind, estimated_minutes, source) "
            "VALUES (%s, %s, 'Chapter 1', 'learn', 60, 'user') RETURNING id"
        )
        params: tuple[Any, ...] = (user_id, exam_id)
    else:
        query = (
            "INSERT INTO app.tasks (user_id, exam_id, title, kind, estimated_minutes, source, "
            "sitting) VALUES (%s, %s, 'Chapter 1', 'learn', 60, 'user', %s) RETURNING id"
        )
        params = (user_id, exam_id, sitting)
    task: UUID = _one(db, query, params)
    return task


def _sitting(db: psycopg.Connection, task_id: UUID) -> int:
    return int(_one(db, "SELECT sitting FROM app.tasks WHERE id = %s", (task_id,)))


_SECOND_SITTING: dict[str, Any] = {"sitting": 2, "first_exam_date": "2027-01-10"}


# --- defaults --------------------------------------------------------------------------


def test_a_new_exam_is_an_open_first_sitting(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    exam = _exam(db, user.id)
    row = db.execute(
        "SELECT sitting, closure, closed_at, closure_notified_at, first_exam_date, first_grade, "
        "moed_b_notes, moed_b_topic_ids FROM app.exams WHERE id = %s",
        (exam,),
    ).fetchone()
    assert row == (1, None, None, None, None, None, None, [])


def test_valid_states_are_accepted(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    _exam(db, user.id, closure="done", closed_at="2027-01-20 17:00Z")
    _exam(db, user.id, closure="moed_b", closed_at="2027-01-20 17:00Z")
    _exam(
        db,
        user.id,
        **_SECOND_SITTING,
        first_grade=48,
        moed_b_notes="Induction",
        moed_b_topic_ids=[uuid4() for _ in range(50)],
    )
    _exam(db, user.id, **_SECOND_SITTING, closure="done", closed_at="2027-02-01 17:00Z")
    _exam(db, user.id, **_SECOND_SITTING, first_grade=0)
    _exam(db, user.id, **_SECOND_SITTING, first_grade=100, moed_b_notes="x" * 1000)


# --- checks ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "columns",
    [
        pytest.param({"sitting": 3}, id="sitting 3"),
        pytest.param({"sitting": 0}, id="sitting 0"),
        pytest.param({"closure": "failed", "closed_at": "2027-01-20 17:00Z"}, id="bad closure"),
        pytest.param({"closure": "done"}, id="closure without closed_at"),
        pytest.param({"closed_at": "2027-01-20 17:00Z"}, id="closed_at without closure"),
        pytest.param(
            {**_SECOND_SITTING, "closure": "moed_b", "closed_at": "2027-02-01 17:00Z"},
            id="moed_b at sitting 2",
        ),
        pytest.param({"first_exam_date": "2027-01-10"}, id="first_exam_date at sitting 1"),
        pytest.param({"sitting": 2}, id="sitting 2 without first_exam_date"),
        pytest.param({"first_grade": 80}, id="first_grade at sitting 1"),
        pytest.param({"moed_b_notes": "hard"}, id="notes at sitting 1"),
        pytest.param({"moed_b_topic_ids": [uuid4()]}, id="topics at sitting 1"),
        pytest.param({**_SECOND_SITTING, "first_grade": 101}, id="grade 101"),
        pytest.param({**_SECOND_SITTING, "first_grade": -1}, id="grade -1"),
        pytest.param({**_SECOND_SITTING, "moed_b_notes": "x" * 1001}, id="notes 1001 chars"),
        pytest.param({**_SECOND_SITTING, "moed_b_notes": ""}, id="empty notes"),
        pytest.param({**_SECOND_SITTING, "moed_b_notes": "   "}, id="blank notes"),
        pytest.param(
            {**_SECOND_SITTING, "moed_b_topic_ids": [uuid4() for _ in range(51)]},
            id="51 topics",
        ),
        pytest.param(
            {**_SECOND_SITTING, "moed_b_topic_ids": [uuid4(), None]}, id="a null topic id"
        ),
        pytest.param(
            {**_SECOND_SITTING, "moed_b_topic_ids": [[uuid4()], [uuid4()]]},
            id="two dimensions",
        ),
    ],
)
def test_invalid_states_are_rejected(
    db: psycopg.Connection, make_user: MakeUser, columns: dict[str, Any]
) -> None:
    user = make_user()
    with pytest.raises(errors.CheckViolation):
        _exam(db, user.id, **columns)


def test_topic_ids_are_not_null(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    with pytest.raises(errors.NotNullViolation):
        _exam(db, user.id, **_SECOND_SITTING, moed_b_topic_ids=None)


def test_tasks_sitting_is_checked(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    task = _task(db, user.id, _exam(db, user.id))
    with pytest.raises(errors.CheckViolation):
        db.execute("UPDATE app.tasks SET sitting = 3 WHERE id = %s", (task,))


# --- the sitting trigger ---------------------------------------------------------------


def test_a_new_task_takes_its_exams_sitting(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    first = _exam(db, user.id)
    second = _exam(db, user.id, **_SECOND_SITTING)
    assert _sitting(db, _task(db, user.id, first)) == 1
    assert _sitting(db, _task(db, user.id, second)) == 2
    assert _sitting(db, _task(db, user.id, second, sitting=1)) == 2
    assert _sitting(db, _task(db, user.id, first, sitting=2)) == 1


def test_a_task_keeps_its_sitting_when_the_exam_moves_on(
    db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    exam = _exam(db, user.id)
    old = _task(db, user.id, exam)
    db.execute(
        "UPDATE app.exams SET sitting = 2, first_exam_date = exam_date WHERE id = %s", (exam,)
    )
    assert _sitting(db, old) == 1
    assert _sitting(db, _task(db, user.id, exam)) == 2


def test_the_trigger_works_as_the_user_under_rls(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    with user_transaction(api_db, user) as conn:
        exam = _exam(conn, user.id, **_SECOND_SITTING)
        task = _task(conn, user.id, exam, sitting=1)
    assert _sitting(db, task) == 2


def test_another_users_exam_still_fails_the_foreign_key(
    db: psycopg.Connection, make_user: MakeUser
) -> None:
    owner, other = make_user(), make_user()
    exam = _exam(db, owner.id, **_SECOND_SITTING)
    with pytest.raises(errors.ForeignKeyViolation):
        _task(db, other.id, exam)


def test_the_trigger_function_is_an_invoker_with_an_empty_search_path(
    db: psycopg.Connection,
) -> None:
    row = db.execute(
        "SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'tasks_set_sitting'"
    ).fetchone()
    assert row == (False, ['search_path=""'])


# --- the closure scan index ------------------------------------------------------------


def test_the_closure_index_is_partial(db: psycopg.Connection) -> None:
    definition = _one(
        db, "SELECT indexdef FROM pg_indexes WHERE indexname = 'exams_closure_due_idx'"
    )
    assert definition == (
        "CREATE INDEX exams_closure_due_idx ON app.exams USING btree (exam_date) "
        "WHERE ((closure IS NULL) AND (closure_notified_at IS NULL) AND (deleted_at IS NULL))"
    )


# --- plan_versions.exam_before ---------------------------------------------------------


def _version(conn: psycopg.Connection, user_id: UUID, exam_id: UUID, before: Any) -> UUID:
    version: UUID = _one(
        conn,
        "INSERT INTO app.plan_versions (user_id, reason, snapshot, exam_id, exam_before) "
        "VALUES (%s, 'exam_closed', '{\"v\": 1, \"blocks\": []}', %s, %s) RETURNING id",
        (user_id, exam_id, before),
    )
    return version


def test_authenticated_may_insert_exam_before(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    exam = _exam(db, user.id)
    before = {"closure": None, "closed_at": None, "sitting": 1}
    with user_transaction(api_db, user) as conn:
        version = _version(conn, user.id, exam, Jsonb(before))
    assert _one(db, "SELECT exam_before FROM app.plan_versions WHERE id = %s", (version,)) == (
        before
    )


@pytest.mark.parametrize("before", ["[]", '"x"', "1", "null"])
def test_exam_before_must_be_an_object(
    db: psycopg.Connection, make_user: MakeUser, before: str
) -> None:
    user = make_user()
    exam = _exam(db, user.id)
    with pytest.raises(errors.CheckViolation):
        _version(db, user.id, exam, before)


def test_the_plan_versions_insert_grant_adds_exam_before(db: psycopg.Connection) -> None:
    assert _one(
        db,
        "SELECT array_agg(column_name::text ORDER BY column_name) "
        "FROM information_schema.column_privileges WHERE table_schema = 'app' "
        "AND table_name = 'plan_versions' AND grantee = 'authenticated' "
        "AND privilege_type = 'INSERT'",
    ) == sorted(
        [
            "user_id",
            "reason",
            "snapshot",
            "exam_id",
            "task_id",
            "task_before",
            "analysis_id",
            "block_id",
            "busy_event_id",
            "busy_event_before",
            "exam_before",
        ]
    )


# --- downgrade and upgrade -------------------------------------------------------------


def _columns(conn: psycopg.Connection, table: str, names: list[str]) -> list[str]:
    rows = conn.execute(
        "SELECT column_name::text FROM information_schema.columns "
        "WHERE table_schema = 'app' AND table_name = %s AND column_name = ANY(%s) "
        "ORDER BY column_name",
        (table, names),
    ).fetchall()
    return [row[0] for row in rows]


_EXAM_COLUMNS = [
    "sitting",
    "closure",
    "closed_at",
    "closure_notified_at",
    "first_exam_date",
    "first_grade",
    "moed_b_notes",
    "moed_b_topic_ids",
]


def test_downgrade_and_upgrade() -> None:
    admin_url = admin_database_url()
    name = f"{os.environ.get('STUDYFLOW_TEST_DB', 'studyflow_test')}_0016"
    url = create_database(admin_url, name)
    try:
        config = alembic_config(url)
        command.upgrade(config, "0016")
        with psycopg.connect(url, autocommit=True) as conn:
            user = _one(
                conn,
                "INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'a@example.com') "
                "RETURNING id",
            )
            exam = _exam(conn, user, **_SECOND_SITTING, first_grade=50)
            task = _task(conn, user, exam)
            assert _sitting(conn, task) == 2

            command.downgrade(config, "0013")
            assert _columns(conn, "exams", _EXAM_COLUMNS) == []
            assert _columns(conn, "tasks", ["sitting"]) == []
            assert _columns(conn, "plan_versions", ["exam_before"]) == []
            assert (
                _one(conn, "SELECT count(*) FROM pg_proc WHERE proname = 'tasks_set_sitting'") == 0
            )
            assert _one(conn, "SELECT to_regclass('app.exams_closure_due_idx')") is None
            assert "exam_before" not in _one(
                conn,
                "SELECT array_agg(column_name::text) FROM information_schema.column_privileges "
                "WHERE table_schema = 'app' AND table_name = 'plan_versions' "
                "AND grantee = 'authenticated' AND privilege_type = 'INSERT'",
            )
            assert _one(conn, "SELECT version_num FROM app.alembic_version") == "0013"
            # The exam and its task survive, as a plain exam.
            assert _one(conn, "SELECT count(*) FROM app.tasks WHERE id = %s", (task,)) == 1

            command.upgrade(config, "head")
            assert _columns(conn, "exams", _EXAM_COLUMNS) == sorted(_EXAM_COLUMNS)
            # Existing rows come back as first sittings.
            assert _one(conn, "SELECT sitting FROM app.exams WHERE id = %s", (exam,)) == 1
            assert _sitting(conn, task) == 1
    finally:
        drop_database(admin_url, name)
