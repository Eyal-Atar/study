from collections.abc import Callable
from datetime import UTC, datetime, time, timedelta
from typing import Any
from uuid import UUID

import psycopg
import pytest

from app.auth import CurrentUser

MakeUser = Callable[[], CurrentUser]

_APP_TABLES_SQL = """
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
"""

_START = datetime(2026, 11, 1, 9, 0, tzinfo=UTC)


def _app_tables(db: psycopg.Connection) -> list[str]:
    return [row[0] for row in db.execute(_APP_TABLES_SQL).fetchall()]


def _insert_exam(db: psycopg.Connection, user_id: UUID) -> UUID:
    row = db.execute(
        "INSERT INTO app.exams (user_id, name, exam_date) VALUES (%s, 'Algebra', '2026-12-01') "
        "RETURNING id",
        (user_id,),
    ).fetchone()
    assert row is not None
    return row[0]  # type: ignore[no-any-return]


def _insert_task(
    db: psycopg.Connection, user_id: UUID, exam_id: UUID, depends_on: UUID | None = None
) -> UUID:
    row = db.execute(
        "INSERT INTO app.tasks (user_id, exam_id, title, kind, estimated_minutes, source, "
        "depends_on_task_id) VALUES (%s, %s, 'Chapter 1', 'learn', 60, 'user', %s) RETURNING id",
        (user_id, exam_id, depends_on),
    ).fetchone()
    assert row is not None
    return row[0]  # type: ignore[no-any-return]


def _insert_block(db: psycopg.Connection, user_id: UUID, task_id: UUID) -> None:
    db.execute(
        "INSERT INTO app.blocks (user_id, task_id, starts_at, ends_at) VALUES (%s, %s, %s, %s)",
        (user_id, task_id, _START, _START + timedelta(hours=1)),
    )


def _count(db: psycopg.Connection, table: str) -> int:
    row = db.execute(f"SELECT count(*) FROM app.{table}").fetchone()  # noqa: S608
    assert row is not None
    return int(row[0])


def test_core_tables_exist(db: psycopg.Connection) -> None:
    assert _app_tables(db) == [
        "ai_usage",
        "alembic_version",
        "analyses",
        "badges",
        "blocks",
        "exams",
        "jobs",
        "materials",
        "plan_versions",
        "profiles",
        "push_subscriptions",
        "tasks",
        "topics",
        "xp_events",
    ]


def test_every_app_table_has_rls_and_an_owner_policy(db: psycopg.Connection) -> None:
    tables = [t for t in _app_tables(db) if t != "alembic_version"]
    assert tables
    for table in tables:
        rls = db.execute(
            "SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(%s)",
            (f"app.{table}",),
        ).fetchone()
        assert rls == (True,), table
        policies = db.execute(
            "SELECT roles::text[], qual, with_check FROM pg_policies "
            "WHERE schemaname = 'app' AND tablename = %s",
            (table,),
        ).fetchall()
        assert policies, table
        assert all(row[0] == ["authenticated"] for row in policies), table
        # A policy such as USING (true) would expose every user's rows.
        for _roles, qual, with_check in policies:
            for expression in (qual, with_check):
                assert expression is None or "auth.uid()" in expression, (table, expression)
            assert qual is not None or with_check is not None, table


def test_app_views_are_security_invokers_and_there_are_no_materialized_views(
    db: psycopg.Connection,
) -> None:
    # A view runs with its owner's rights and bypasses RLS unless security_invoker is on;
    # a materialized view cannot enforce RLS at all.
    views = db.execute(
        "SELECT c.relname, c.relkind, coalesce(c.reloptions, '{}') FROM pg_class c "
        "JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = 'app' AND c.relkind IN ('v', 'm')"
    ).fetchall()
    for name, kind, options in views:
        assert kind == "v", f"materialized view app.{name}"
        assert "security_invoker=true" in options, f"view app.{name} bypasses RLS"


def test_only_authenticated_has_table_privileges(db: psycopg.Connection) -> None:
    # TRUNCATE ignores RLS, so every privilege counts, not only the CRUD ones.
    privileges = ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER")
    authenticated_grants = {
        "profiles": {"SELECT", "INSERT", "UPDATE"},
        "exams": {"SELECT", "INSERT", "UPDATE", "DELETE"},
        "tasks": {"SELECT", "INSERT", "UPDATE", "DELETE"},
        "blocks": {"SELECT", "INSERT", "UPDATE", "DELETE"},
        # INSERT and UPDATE are granted on columns only (migration 0004), so they are not
        # table privileges.
        "plan_versions": {"SELECT"},
        # INSERT and UPDATE are granted on columns only (migration 0005).
        "materials": {"SELECT", "DELETE"},
        "jobs": {"SELECT"},
        "topics": {"SELECT", "INSERT", "UPDATE", "DELETE"},
        # The worker writes analyses on behalf of the user and the API applies them;
        # ai_usage is written only by the worker as the schema owner.
        # UPDATE is granted on columns only (migration 0008).
        "analyses": {"SELECT", "INSERT"},
        "ai_usage": {"SELECT"},
        # INSERT is granted on columns only, and there is no UPDATE (migration 0011).
        "xp_events": {"SELECT", "DELETE"},
        "badges": {"SELECT", "DELETE"},
        # INSERT and UPDATE are granted on columns only (migration 0010).
        "push_subscriptions": {"SELECT", "DELETE"},
    }
    for table in _app_tables(db):
        for role in ("anon", "studyflow_api", "service_role"):
            for privilege in privileges:
                allowed = db.execute(
                    "SELECT has_table_privilege(%s, %s, %s)", (role, f"app.{table}", privilege)
                ).fetchone()
                assert allowed == (False,), (role, table, privilege)
        for privilege in privileges:
            allowed = db.execute(
                "SELECT has_table_privilege('authenticated', %s, %s)",
                (f"app.{table}", privilege),
            ).fetchone()
            expected = privilege in authenticated_grants.get(table, set())
            assert allowed == (expected,), (table, privilege)


def test_profile_defaults(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    db.execute("INSERT INTO app.profiles (id) VALUES (%s)", (user.id,))
    row = db.execute(
        "SELECT timezone, wake_time, sleep_time, daily_study_minutes, study_windows, "
        "rest_days_before_exam, notify_lead_minutes, onboarding_completed_at "
        "FROM app.profiles WHERE id = %s",
        (user.id,),
    ).fetchone()
    assert row == (
        "Asia/Jerusalem",
        time(8),
        time(23),
        240,
        ["morning", "afternoon"],
        1,
        0,
        None,
    )


def _exam(difficulty: int = 3, name: str = "Algebra") -> Callable[[psycopg.Connection, UUID], Any]:
    def run(db: psycopg.Connection, user_id: UUID) -> Any:
        return db.execute(
            "INSERT INTO app.exams (user_id, name, exam_date, difficulty) "
            "VALUES (%s, %s, '2026-12-01', %s)",
            (user_id, name, difficulty),
        )

    return run


def _task(**overrides: Any) -> Callable[[psycopg.Connection, UUID], Any]:
    def run(db: psycopg.Connection, user_id: UUID) -> Any:
        exam_id = _insert_exam(db, user_id)
        values: dict[str, Any] = {"kind": "learn", "estimated_minutes": 60, **overrides}
        return db.execute(
            "INSERT INTO app.tasks (user_id, exam_id, title, kind, estimated_minutes, source) "
            "VALUES (%s, %s, 'Chapter 1', %s, %s, 'user')",
            (user_id, exam_id, values["kind"], values["estimated_minutes"]),
        )

    return run


def _self_dependent_task(db: psycopg.Connection, user_id: UUID) -> Any:
    exam_id = _insert_exam(db, user_id)
    task_id = _insert_task(db, user_id, exam_id)
    return db.execute("UPDATE app.tasks SET depends_on_task_id = id WHERE id = %s", (task_id,))


def _block(**overrides: Any) -> Callable[[psycopg.Connection, UUID], Any]:
    def run(db: psycopg.Connection, user_id: UUID) -> Any:
        exam_id = _insert_exam(db, user_id)
        task_id = _insert_task(db, user_id, exam_id)
        values: dict[str, Any] = {
            "starts_at": _START,
            "ends_at": _START + timedelta(hours=1),
            "part_index": 1,
            "part_count": 1,
            **overrides,
        }
        return db.execute(
            "INSERT INTO app.blocks (user_id, task_id, starts_at, ends_at, part_index, "
            "part_count) VALUES (%s, %s, %s, %s, %s, %s)",
            (
                user_id,
                task_id,
                values["starts_at"],
                values["ends_at"],
                values["part_index"],
                values["part_count"],
            ),
        )

    return run


def _profile(column: str, value: Any) -> Callable[[psycopg.Connection, UUID], Any]:
    def run(db: psycopg.Connection, user_id: UUID) -> Any:
        return db.execute(
            f"INSERT INTO app.profiles (id, {column}) VALUES (%s, %s)",  # noqa: S608
            (user_id, value),
        )

    return run


def _same_wake_and_sleep(db: psycopg.Connection, user_id: UUID) -> Any:
    return db.execute(
        "INSERT INTO app.profiles (id, wake_time, sleep_time) VALUES (%s, '07:00', '07:00')",
        (user_id,),
    )


@pytest.mark.parametrize(
    "run",
    [
        pytest.param(_exam(difficulty=0), id="difficulty-0"),
        pytest.param(_exam(difficulty=6), id="difficulty-6"),
        pytest.param(_exam(name="   "), id="blank-name"),
        pytest.param(_task(kind="reading"), id="kind-reading"),
        pytest.param(_task(estimated_minutes=0), id="estimated-minutes-0"),
        pytest.param(_self_dependent_task, id="self-dependent-task"),
        pytest.param(_block(ends_at=_START), id="ends-at-equals-starts-at"),
        pytest.param(_block(part_index=3, part_count=2), id="part-index-above-count"),
        pytest.param(_profile("study_windows", ["dawn"]), id="study-windows-unknown"),
        pytest.param(_profile("study_windows", []), id="study-windows-empty"),
        pytest.param(
            lambda db, user_id: db.execute(
                "INSERT INTO app.profiles (id, study_windows) VALUES (%s, '{{morning},{night}}')",
                (user_id,),
            ),
            id="study-windows-two-dimensional",
        ),
        pytest.param(_same_wake_and_sleep, id="wake-equals-sleep"),
    ],
)
def test_constraints_reject_invalid_rows(
    db: psycopg.Connection,
    make_user: MakeUser,
    run: Callable[[psycopg.Connection, UUID], Any],
) -> None:
    user = make_user()
    with pytest.raises(psycopg.errors.CheckViolation):
        run(db, user.id)


def test_deleting_a_user_deletes_their_data(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    db.execute("INSERT INTO app.profiles (id) VALUES (%s)", (user.id,))
    exam_id = _insert_exam(db, user.id)
    task_id = _insert_task(db, user.id, exam_id)
    _insert_block(db, user.id, task_id)
    for table in ("profiles", "exams", "tasks", "blocks"):
        assert _count(db, table) == 1

    db.execute("DELETE FROM auth.users WHERE id = %s", (user.id,))

    for table in ("profiles", "exams", "tasks", "blocks"):
        assert _count(db, table) == 0


def test_deleting_a_task_unlinks_its_dependents(
    db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    exam_id = _insert_exam(db, user.id)
    first = _insert_task(db, user.id, exam_id)
    second = _insert_task(db, user.id, exam_id, depends_on=first)

    db.execute("DELETE FROM app.tasks WHERE id = %s", (first,))

    row = db.execute(
        "SELECT depends_on_task_id, user_id FROM app.tasks WHERE id = %s", (second,)
    ).fetchone()
    assert row == (None, user.id)


def test_deleting_an_exam_deletes_its_tasks_and_blocks(
    db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    exam_id = _insert_exam(db, user.id)
    task_id = _insert_task(db, user.id, exam_id)
    _insert_block(db, user.id, task_id)

    db.execute("DELETE FROM app.exams WHERE id = %s", (exam_id,))

    assert _count(db, "tasks") == 0
    assert _count(db, "blocks") == 0
