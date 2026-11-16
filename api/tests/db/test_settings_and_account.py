"""Migration 0009: the settings preferences, materials.kind for the user, delete_account_data()."""

from collections.abc import Callable
from uuid import UUID, uuid4

import psycopg
import pytest

from app.auth import CurrentUser
from app.db.session import user_transaction

MakeUser = Callable[[], CurrentUser]

# Every table in app with a user column, and that column (profiles is keyed by id).
_USER_COLUMN = {
    "profiles": "id",
    "exams": "user_id",
    "tasks": "user_id",
    "blocks": "user_id",
    "plan_versions": "user_id",
    "materials": "user_id",
    "jobs": "user_id",
    "topics": "user_id",
    "analyses": "user_id",
    "ai_usage": "user_id",
    "xp_events": "user_id",
    "badges": "user_id",
}


def _one(db: psycopg.Connection, query: str, params: tuple[object, ...]) -> UUID:
    row = db.execute(query, params).fetchone()
    assert row is not None
    return row[0]  # type: ignore[no-any-return]


def _fill(db: psycopg.Connection, user_id: UUID) -> None:
    """One row of this user in every table of app."""
    db.execute("INSERT INTO app.profiles (id) VALUES (%s)", (user_id,))
    exam = _one(
        db,
        "INSERT INTO app.exams (user_id, name, exam_date) VALUES (%s, 'x', '2027-01-01') "
        "RETURNING id",
        (user_id,),
    )
    job = _one(
        db,
        "INSERT INTO app.jobs (user_id, kind, payload) VALUES (%s, 'generate_plan', '{}') "
        "RETURNING id",
        (user_id,),
    )
    analysis = _one(
        db,
        "INSERT INTO app.analyses (user_id, exam_id, job_id, status, output, applied_at) "
        "VALUES (%s, %s, %s, 'applied', '{}', now()) RETURNING id",
        (user_id, exam, job),
    )
    topic = _one(
        db,
        "INSERT INTO app.topics (user_id, exam_id, name, weight, position, analysis_id) "
        "VALUES (%s, %s, 'T', 3, 1, %s) RETURNING id",
        (user_id, exam, analysis),
    )
    material = uuid4()
    db.execute(
        "INSERT INTO app.materials (id, user_id, exam_id, storage_path, filename, kind, mime, "
        "size_bytes) VALUES (%s, %s, %s, %s, 'n.pdf', 'notes', 'application/pdf', 1000)",
        (material, user_id, exam, f"{user_id}/{exam}/{material}"),
    )
    task = _one(
        db,
        "INSERT INTO app.tasks (user_id, exam_id, title, kind, estimated_minutes, source, "
        "topic_id, material_id, analysis_id) "
        "VALUES (%s, %s, 'T', 'learn', 60, 'ai', %s, %s, %s) RETURNING id",
        (user_id, exam, topic, material, analysis),
    )
    version = _one(
        db,
        "INSERT INTO app.plan_versions (user_id, reason, snapshot) "
        "VALUES (%s, 'replan', '{\"v\": 1, \"blocks\": []}') RETURNING id",
        (user_id,),
    )
    block = _one(
        db,
        "INSERT INTO app.blocks (user_id, task_id, starts_at, ends_at, part_index, part_count, "
        "plan_version_id) VALUES (%s, %s, '2026-12-01T08:00Z', '2026-12-01T09:00Z', 1, 1, %s) "
        "RETURNING id",
        (user_id, task, version),
    )
    db.execute(
        "INSERT INTO app.xp_events (user_id, block_id, xp, study_date) "
        "VALUES (%s, %s, 50, '2026-12-01')",
        (user_id, block),
    )
    db.execute("INSERT INTO app.badges (user_id, badge_key) VALUES (%s, 'first_task')", (user_id,))
    db.execute(
        "INSERT INTO app.ai_usage (user_id, job_id, exam_id, model) VALUES (%s, %s, %s, 'm')",
        (user_id, job, exam),
    )


def _counts(db: psycopg.Connection, user_id: UUID) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table, column in _USER_COLUMN.items():
        row = db.execute(
            f"SELECT count(*) FROM app.{table} WHERE {column} = %s",  # noqa: S608 - constants
            (user_id,),
        ).fetchone()
        assert row is not None
        counts[table] = row[0]
    return counts


def test_the_table_list_covers_every_app_table(db: psycopg.Connection) -> None:
    rows = db.execute(
        "SELECT tablename FROM pg_tables "
        "WHERE schemaname = 'app' AND tablename <> 'alembic_version'"
    ).fetchall()
    assert {name for (name,) in rows} == set(_USER_COLUMN)


def test_delete_account_data_empties_only_the_callers_rows(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    owner, other = make_user(), make_user()
    _fill(db, owner.id)
    _fill(db, other.id)
    assert set(_counts(db, owner.id).values()) == {1}

    with user_transaction(api_db, owner) as conn:
        conn.execute("SELECT app.delete_account_data()")

    assert set(_counts(db, owner.id).values()) == {0}
    assert set(_counts(db, other.id).values()) == {1}
    # The user in Auth is the worker's to delete, not this function's.
    assert db.execute("SELECT count(*) FROM auth.users WHERE id = %s", (owner.id,)).fetchone() == (
        1,
    )


def test_delete_account_data_needs_a_user(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    _fill(db, user.id)
    db.execute("SET ROLE authenticated")
    try:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            db.execute("SELECT app.delete_account_data()")
    finally:
        db.execute("RESET ROLE")
    assert set(_counts(db, user.id).values()) == {1}


@pytest.mark.parametrize("role", ["anon", "service_role", "studyflow_api"])
def test_only_authenticated_may_call_delete_account_data(db: psycopg.Connection, role: str) -> None:
    allowed = db.execute(
        "SELECT has_function_privilege(%s, 'app.delete_account_data()', 'EXECUTE')", (role,)
    ).fetchone()
    assert allowed == (False,)
    allowed = db.execute(
        "SELECT has_function_privilege('authenticated', 'app.delete_account_data()', 'EXECUTE')"
    ).fetchone()
    assert allowed == (True,)


def test_the_user_may_change_a_materials_kind_and_nothing_else_new(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    _fill(db, user.id)
    with user_transaction(api_db, user) as conn:
        changed = conn.execute(
            "UPDATE app.materials SET kind = 'past_exam' WHERE user_id = %s RETURNING kind",
            (user.id,),
        ).fetchall()
    assert changed == [("past_exam",)]
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with user_transaction(api_db, user) as conn:
            conn.execute("UPDATE app.materials SET filename = 'other.pdf'")


def test_profile_preferences_defaults(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    db.execute("INSERT INTO app.profiles (id) VALUES (%s)", (user.id,))
    row = db.execute(
        "SELECT study_start_delay_minutes, hobby_start, hobby_minutes FROM app.profiles "
        "WHERE id = %s",
        (user.id,),
    ).fetchone()
    assert row == (60, None, None)


@pytest.mark.parametrize(
    "assignment",
    [
        "study_start_delay_minutes = -1",
        "study_start_delay_minutes = 361",
        "hobby_start = '18:00'",
        "hobby_minutes = 60",
        "hobby_start = '18:00', hobby_minutes = 10",
        "hobby_start = '18:00', hobby_minutes = 241",
        "hobby_start = '18:00:30', hobby_minutes = 60",
    ],
)
def test_profile_preferences_constraints(
    db: psycopg.Connection, make_user: MakeUser, assignment: str
) -> None:
    user = make_user()
    db.execute("INSERT INTO app.profiles (id) VALUES (%s)", (user.id,))
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute(
            f"UPDATE app.profiles SET {assignment} WHERE id = %s",  # noqa: S608 - parametrized
            (user.id,),
        )


def test_profile_preferences_accept_a_hobby(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    db.execute("INSERT INTO app.profiles (id) VALUES (%s)", (user.id,))
    db.execute(
        "UPDATE app.profiles SET hobby_start = '18:00', hobby_minutes = 90, "
        "study_start_delay_minutes = 0 WHERE id = %s",
        (user.id,),
    )
