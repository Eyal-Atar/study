from collections.abc import Callable
from typing import Any
from uuid import UUID

import psycopg
import pytest
from psycopg.types.json import Jsonb

from app.auth import CurrentUser
from app.db.session import user_transaction

MakeUser = Callable[[], CurrentUser]


def _exam(db: psycopg.Connection, user_id: UUID) -> UUID:
    row = db.execute(
        "INSERT INTO app.exams (user_id, name, exam_date) VALUES (%s, 'x', '2027-01-01') "
        "RETURNING id",
        (user_id,),
    ).fetchone()
    assert row is not None
    return row[0]  # type: ignore[no-any-return]


def _job(db: psycopg.Connection, user_id: UUID) -> UUID:
    row = db.execute(
        "INSERT INTO app.jobs (user_id, kind, payload) VALUES (%s, 'generate_plan', '{}') "
        "RETURNING id",
        (user_id,),
    ).fetchone()
    assert row is not None
    return row[0]  # type: ignore[no-any-return]


def _analysis(db: psycopg.Connection, user_id: UUID, exam_id: UUID, **fields: Any) -> UUID:
    values: dict[str, Any] = {
        "status": "draft",
        "error": None,
        "output": Jsonb({"topics": []}),
        "job_id": None,
        **fields,
    }
    row = db.execute(
        "INSERT INTO app.analyses (user_id, exam_id, job_id, status, error, output) "
        "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
        (
            user_id,
            exam_id,
            values["job_id"],
            values["status"],
            values["error"],
            values["output"],
        ),
    ).fetchone()
    assert row is not None
    return row[0]  # type: ignore[no-any-return]


def _usage(db: psycopg.Connection, user_id: UUID, **fields: Any) -> UUID:
    values: dict[str, Any] = {
        "job_id": None,
        "exam_id": None,
        "model": "test-model",
        "input_tokens": 1,
        "output_tokens": 2,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        **fields,
    }
    row = db.execute(
        "INSERT INTO app.ai_usage (user_id, job_id, exam_id, model, input_tokens, "
        "output_tokens, cache_creation_input_tokens, cache_read_input_tokens) "
        "VALUES (%(user_id)s, %(job_id)s, %(exam_id)s, %(model)s, %(input_tokens)s, "
        "%(output_tokens)s, %(cache_creation_input_tokens)s, %(cache_read_input_tokens)s) "
        "RETURNING id",
        {"user_id": user_id, **values},
    ).fetchone()
    assert row is not None
    return row[0]  # type: ignore[no-any-return]


def _task(db: psycopg.Connection, user_id: UUID, exam_id: UUID, analysis_id: UUID | None) -> UUID:
    row = db.execute(
        "INSERT INTO app.tasks (user_id, exam_id, title, kind, estimated_minutes, source, "
        "analysis_id) VALUES (%s, %s, 'T', 'learn', 60, 'ai', %s) RETURNING id",
        (user_id, exam_id, analysis_id),
    ).fetchone()
    assert row is not None
    return row[0]  # type: ignore[no-any-return]


def test_analysis_round_trip_and_defaults(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    exam = _exam(db, user.id)
    job = _job(db, user.id)
    analysis = _analysis(db, user.id, exam, job_id=job)
    row = db.execute(
        "SELECT status, material_keys, replaced_task_ids, warnings, dropped, applied_at, "
        "undone_at, created_at IS NOT NULL FROM app.analyses WHERE id = %s",
        (analysis,),
    ).fetchone()
    assert row == ("draft", {}, [], None, None, None, None, True)
    db.execute(
        "UPDATE app.analyses SET warnings = %s, dropped = %s, material_keys = %s, "
        "total_minutes = 600, budget_minutes = 700, status = 'applied', applied_at = now() "
        "WHERE id = %s",
        (["w"], ["d"], Jsonb({"M1": str(job)}), analysis),
    )
    row = db.execute(
        "SELECT status, warnings, dropped, total_minutes, budget_minutes FROM app.analyses "
        "WHERE id = %s",
        (analysis,),
    ).fetchone()
    assert row == ("applied", ["w"], ["d"], 600, 700)


@pytest.mark.parametrize(
    "fields",
    [
        {"status": "bogus"},
        {"status": "failed", "error": None, "output": None},
        {"status": "failed", "error": "Bad Slug", "output": None},
        {"status": "draft", "output": None},
        {"status": "applied", "output": None},
        {"status": "draft", "error": "analysis_invalid"},
        {"status": "undone", "error": "analysis_invalid"},
        {"output": Jsonb([1])},
    ],
)
def test_analysis_checks(
    db: psycopg.Connection, make_user: MakeUser, fields: dict[str, Any]
) -> None:
    user = make_user()
    exam = _exam(db, user.id)
    with pytest.raises(psycopg.errors.CheckViolation):
        _analysis(db, user.id, exam, **fields)
    assert _analysis(db, user.id, exam, status="failed", error="analysis_invalid", output=None)
    assert _analysis(db, user.id, exam, status="superseded", output=None)
    assert _analysis(db, user.id, exam, status="undone", output=None)


@pytest.mark.parametrize(
    "assignment",
    [
        "total_minutes = -1",
        "budget_minutes = -1",
        "budget_minutes = 100001",
        "material_keys = '[]'::jsonb",
        "warnings = (SELECT array_agg('w'::text) FROM generate_series(1, 21))",
        "dropped = (SELECT array_agg('d'::text) FROM generate_series(1, 151))",
        "warnings = '{{a},{b}}'",
    ],
)
def test_analysis_column_limits(
    db: psycopg.Connection, make_user: MakeUser, assignment: str
) -> None:
    user = make_user()
    exam = _exam(db, user.id)
    analysis = _analysis(db, user.id, exam)
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute(f"UPDATE app.analyses SET {assignment} WHERE id = %s", (analysis,))  # noqa: S608
    db.execute(
        "UPDATE app.analyses SET budget_minutes = 100000, "
        "warnings = (SELECT array_agg('w'::text) FROM generate_series(1, 20)), "
        "dropped = (SELECT array_agg('d'::text) FROM generate_series(1, 150)) WHERE id = %s",
        (analysis,),
    )


def test_analysis_output_size_limit(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    exam = _exam(db, user.id)
    # Random-ish text so TOAST compression cannot shrink it below the limit.
    big = db.execute(
        "SELECT string_agg(md5(i::text), '') FROM generate_series(1, 40000) i"
    ).fetchone()
    assert big is not None
    with pytest.raises(psycopg.errors.CheckViolation):
        _analysis(db, user.id, exam, output=Jsonb({"x": big[0]}))


def test_analyses_rls_hides_and_blocks_other_users(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    owner, other = make_user(), make_user()
    exam = _exam(db, owner.id)
    analysis = _analysis(db, owner.id, exam)
    with user_transaction(api_db, owner) as conn:
        assert conn.execute("SELECT id FROM app.analyses").fetchall() == [(analysis,)]
    with user_transaction(api_db, other) as conn:
        assert conn.execute("SELECT id FROM app.analyses").fetchall() == []
        assert (
            conn.execute(
                "UPDATE app.analyses SET status = 'superseded' WHERE id = %s", (analysis,)
            ).rowcount
            == 0
        )
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with user_transaction(api_db, other) as conn:
            conn.execute(
                "INSERT INTO app.analyses (user_id, exam_id, status, output) "
                "VALUES (%s, %s, 'draft', '{}')",
                (owner.id, exam),
            )


def test_authenticated_can_insert_and_update_but_not_delete_analyses(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    exam = _exam(db, user.id)
    with user_transaction(api_db, user) as conn:
        row = conn.execute(
            "INSERT INTO app.analyses (user_id, exam_id, status, output) "
            "VALUES (%s, %s, 'draft', '{}') RETURNING id",
            (user.id, exam),
        ).fetchone()
        assert row is not None
        conn.execute("UPDATE app.analyses SET status = 'applied' WHERE id = %s", (row[0],))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with user_transaction(api_db, user) as conn:
            conn.execute("DELETE FROM app.analyses WHERE id = %s", (row[0],))


def test_analysis_composite_foreign_keys(db: psycopg.Connection, make_user: MakeUser) -> None:
    first, second = make_user(), make_user()
    exam = _exam(db, first.id)
    job = _job(db, second.id)
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        _analysis(db, second.id, exam)
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        _analysis(db, first.id, exam, job_id=job)


def test_deleting_a_job_keeps_the_analysis_and_the_usage(
    db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    exam = _exam(db, user.id)
    job = _job(db, user.id)
    analysis = _analysis(db, user.id, exam, job_id=job)
    usage = _usage(db, user.id, job_id=job)
    db.execute("DELETE FROM app.jobs WHERE id = %s", (job,))
    assert db.execute(
        "SELECT job_id, user_id, exam_id FROM app.analyses WHERE id = %s", (analysis,)
    ).fetchone() == (None, user.id, exam)
    assert db.execute(
        "SELECT job_id, user_id FROM app.ai_usage WHERE id = %s", (usage,)
    ).fetchone() == (
        None,
        user.id,
    )


def test_deleting_an_exam_deletes_its_analyses(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    exam = _exam(db, user.id)
    _analysis(db, user.id, exam)
    db.execute("DELETE FROM app.exams WHERE id = %s", (exam,))
    assert db.execute("SELECT count(*) FROM app.analyses").fetchone() == (0,)


def test_ai_usage_round_trip_and_survives_exam_delete(
    db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    exam = _exam(db, user.id)
    usage = _usage(db, user.id, exam_id=exam)
    db.execute("DELETE FROM app.exams WHERE id = %s", (exam,))
    row = db.execute(
        "SELECT exam_id, model, input_tokens, output_tokens, cache_creation_input_tokens, "
        "cache_read_input_tokens, created_at IS NOT NULL FROM app.ai_usage WHERE id = %s",
        (usage,),
    ).fetchone()
    assert row == (exam, "test-model", 1, 2, 0, 0, True)
    db.execute("DELETE FROM auth.users WHERE id = %s", (user.id,))
    assert db.execute("SELECT count(*) FROM app.ai_usage").fetchone() == (0,)


@pytest.mark.parametrize(
    "fields",
    [
        {"model": ""},
        {"model": "x" * 101},
        {"input_tokens": -1},
        {"output_tokens": -1},
        {"cache_creation_input_tokens": -1},
        {"cache_read_input_tokens": -1},
    ],
)
def test_ai_usage_checks(
    db: psycopg.Connection, make_user: MakeUser, fields: dict[str, Any]
) -> None:
    user = make_user()
    with pytest.raises(psycopg.errors.CheckViolation):
        _usage(db, user.id, **fields)
    assert _usage(db, user.id, model="x" * 100)


def test_ai_usage_rls_and_read_only_for_authenticated(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    owner, other = make_user(), make_user()
    usage = _usage(db, owner.id)
    with user_transaction(api_db, owner) as conn:
        assert conn.execute("SELECT id FROM app.ai_usage").fetchall() == [(usage,)]
    with user_transaction(api_db, other) as conn:
        assert conn.execute("SELECT id FROM app.ai_usage").fetchall() == []
    for sql in (
        "INSERT INTO app.ai_usage (user_id, model) VALUES (%s, 'm')",
        "UPDATE app.ai_usage SET model = 'm' WHERE user_id = %s",
        "DELETE FROM app.ai_usage WHERE user_id = %s",
    ):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with user_transaction(api_db, owner) as conn:
                conn.execute(sql, (owner.id,))


def test_task_and_topic_analysis_link_is_same_user_only(
    db: psycopg.Connection, make_user: MakeUser
) -> None:
    first, second = make_user(), make_user()
    exam1, exam2 = _exam(db, first.id), _exam(db, second.id)
    analysis = _analysis(db, first.id, exam1)
    assert _task(db, first.id, exam1, analysis)
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        _task(db, second.id, exam2, analysis)
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        db.execute(
            "INSERT INTO app.topics (user_id, exam_id, name, weight, position, analysis_id) "
            "VALUES (%s, %s, 'T', 1, 1, %s)",
            (second.id, exam2, analysis),
        )


def test_deleting_an_analysis_keeps_tasks_and_topics(
    db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    exam = _exam(db, user.id)
    analysis = _analysis(db, user.id, exam)
    task = _task(db, user.id, exam, analysis)
    topic = db.execute(
        "INSERT INTO app.topics (user_id, exam_id, name, weight, position, analysis_id) "
        "VALUES (%s, %s, 'T', 1, 1, %s) RETURNING id",
        (user.id, exam, analysis),
    ).fetchone()
    assert topic is not None
    db.execute("DELETE FROM app.analyses WHERE id = %s", (analysis,))
    assert db.execute(
        "SELECT analysis_id, exam_id, user_id FROM app.tasks WHERE id = %s", (task,)
    ).fetchone() == (None, exam, user.id)
    assert db.execute(
        "SELECT analysis_id, exam_id, user_id FROM app.topics WHERE id = %s", (topic[0],)
    ).fetchone() == (None, exam, user.id)


def test_plan_version_analysis_link_and_insert_grant(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    user, other = make_user(), make_user()
    exam = _exam(db, user.id)
    analysis = _analysis(db, user.id, exam)
    with user_transaction(api_db, user) as conn:
        row = conn.execute(
            "INSERT INTO app.plan_versions (user_id, reason, snapshot, analysis_id) "
            "VALUES (%s, 'exam_reanalyzed', %s, %s) RETURNING id",
            (user.id, Jsonb({"v": 1, "blocks": []}), analysis),
        ).fetchone()
        assert row is not None
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        db.execute(
            "INSERT INTO app.plan_versions (user_id, reason, snapshot, analysis_id) "
            "VALUES (%s, 'x', %s, %s)",
            (other.id, Jsonb({"v": 1, "blocks": []}), analysis),
        )
    db.execute("DELETE FROM app.analyses WHERE id = %s", (analysis,))
    assert db.execute(
        "SELECT analysis_id FROM app.plan_versions WHERE id = %s", (row[0],)
    ).fetchone() == (None,)


def test_authenticated_can_update_only_the_lifecycle_columns_of_analyses(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    exam = _exam(db, user.id)
    analysis = _analysis(db, user.id, exam)
    with user_transaction(api_db, user) as conn:
        conn.execute(
            "UPDATE app.analyses SET status = 'applied', applied_at = now(), "
            "undone_at = NULL, replaced_task_ids = '{}' WHERE id = %s",
            (analysis,),
        )
    for column, value in (("output", "'{}'::jsonb"), ("error", "'x'"), ("warnings", "'{a}'")):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with user_transaction(api_db, user) as conn:
                conn.execute(
                    f"UPDATE app.analyses SET {column} = {value} WHERE id = %s",  # noqa: S608
                    (analysis,),
                )
