from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest

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


def _topic(db: psycopg.Connection, user_id: UUID, exam_id: UUID, **fields: Any) -> UUID:
    values: dict[str, Any] = {"name": "Topic", "weight": 3, "evidence": None, "position": 1}
    values.update(fields)
    row = db.execute(
        "INSERT INTO app.topics (user_id, exam_id, name, weight, evidence, position) "
        "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
        (
            user_id,
            exam_id,
            values["name"],
            values["weight"],
            values["evidence"],
            values["position"],
        ),
    ).fetchone()
    assert row is not None
    return row[0]  # type: ignore[no-any-return]


def _material(db: psycopg.Connection, user_id: UUID, exam_id: UUID) -> UUID:
    material_id = uuid4()
    db.execute(
        "INSERT INTO app.materials (id, user_id, exam_id, storage_path, filename, kind, mime, "
        "size_bytes) VALUES (%s, %s, %s, %s, 'n.pdf', 'notes', 'application/pdf', 1000)",
        (material_id, user_id, exam_id, f"{user_id}/{exam_id}/{material_id}"),
    )
    return material_id


def _task(db: psycopg.Connection, user_id: UUID, exam_id: UUID, **fields: Any) -> UUID:
    row = db.execute(
        "INSERT INTO app.tasks (user_id, exam_id, title, kind, estimated_minutes, source, "
        "topic_id, material_id, position) "
        "VALUES (%s, %s, 'T', 'learn', 60, 'user', %s, %s, %s) RETURNING id",
        (
            user_id,
            exam_id,
            fields.get("topic_id"),
            fields.get("material_id"),
            fields.get("position"),
        ),
    ).fetchone()
    assert row is not None
    return row[0]  # type: ignore[no-any-return]


def test_topic_rls_hides_other_users(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    owner, other = make_user(), make_user()
    exam = _exam(db, owner.id)
    topic = _topic(db, owner.id, exam)
    with user_transaction(api_db, owner) as conn:
        assert conn.execute("SELECT id FROM app.topics").fetchall() == [(topic,)]
    with user_transaction(api_db, other) as conn:
        assert conn.execute("SELECT id FROM app.topics").fetchall() == []
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with user_transaction(api_db, other) as conn:
            conn.execute(
                "INSERT INTO app.topics (user_id, exam_id, name, weight, position) "
                "VALUES (%s, %s, 'x', 1, 1)",
                (owner.id, exam),
            )


def test_task_cannot_point_to_a_topic_of_another_exam(
    db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    first, second = _exam(db, user.id), _exam(db, user.id)
    foreign = _topic(db, user.id, second)
    own = _topic(db, user.id, first)
    assert _task(db, user.id, first, topic_id=own)
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        _task(db, user.id, first, topic_id=foreign)


def test_task_cannot_point_to_a_material_of_another_exam(
    db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    first, second = _exam(db, user.id), _exam(db, user.id)
    foreign = _material(db, user.id, second)
    own = _material(db, user.id, first)
    assert _task(db, user.id, first, material_id=own)
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        _task(db, user.id, first, material_id=foreign)


def test_deleting_a_topic_or_material_keeps_the_task(
    db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    exam = _exam(db, user.id)
    topic = _topic(db, user.id, exam)
    material = _material(db, user.id, exam)
    task = _task(db, user.id, exam, topic_id=topic, material_id=material)
    db.execute("DELETE FROM app.topics WHERE id = %s", (topic,))
    row = db.execute(
        "SELECT topic_id, material_id, exam_id FROM app.tasks WHERE id = %s", (task,)
    ).fetchone()
    assert row == (None, material, exam)
    db.execute("DELETE FROM app.materials WHERE id = %s", (material,))
    row = db.execute(
        "SELECT topic_id, material_id, exam_id FROM app.tasks WHERE id = %s", (task,)
    ).fetchone()
    assert row == (None, None, exam)


@pytest.mark.parametrize(
    "fields",
    [
        {"weight": 0},
        {"weight": 6},
        {"name": ""},
        {"name": "   "},
        {"name": "x" * 121},
        {"evidence": "x" * 501},
        {"position": 0},
        {"position": 10001},
    ],
)
def test_topic_checks(db: psycopg.Connection, make_user: MakeUser, fields: dict[str, Any]) -> None:
    user = make_user()
    exam = _exam(db, user.id)
    with pytest.raises(psycopg.errors.CheckViolation):
        _topic(db, user.id, exam, **fields)
    assert _topic(db, user.id, exam, name="x" * 120, evidence="y" * 500, weight=5, position=10000)


def test_task_position_check(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    exam = _exam(db, user.id)
    with pytest.raises(psycopg.errors.CheckViolation):
        _task(db, user.id, exam, position=0)
    assert _task(db, user.id, exam, position=None)
    assert _task(db, user.id, exam, position=10000)
