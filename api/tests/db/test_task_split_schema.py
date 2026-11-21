"""Migration 0015: tasks.bite_minutes (30-300 or NULL) and tasks.split_dismissed_at."""

from collections.abc import Callable
from uuid import UUID

import psycopg
import pytest
from psycopg import errors

from app.auth import CurrentUser

MakeUser = Callable[[], CurrentUser]


def _task(db: psycopg.Connection, user_id: UUID) -> UUID:
    exam = db.execute(
        "INSERT INTO app.exams (user_id, name, exam_date) VALUES (%s, 'x', '2027-01-01') "
        "RETURNING id",
        (user_id,),
    ).fetchone()
    assert exam is not None
    row = db.execute(
        "INSERT INTO app.tasks (user_id, exam_id, title, kind, estimated_minutes, source) "
        "VALUES (%s, %s, 't', 'practice', 90, 'user') "
        "RETURNING id, bite_minutes, split_dismissed_at",
        (user_id, exam[0]),
    ).fetchone()
    assert row is not None
    assert row[1] is None and row[2] is None
    return row[0]  # type: ignore[no-any-return]


@pytest.mark.parametrize("value", [30, 300])
def test_bite_minutes_takes_30_to_300(
    db: psycopg.Connection, make_user: MakeUser, value: int
) -> None:
    task = _task(db, make_user().id)
    db.execute("UPDATE app.tasks SET bite_minutes = %s WHERE id = %s", (value, task))


@pytest.mark.parametrize("value", [29, 301, 0])
def test_bite_minutes_out_of_range_is_refused(
    db: psycopg.Connection, make_user: MakeUser, value: int
) -> None:
    task = _task(db, make_user().id)
    with pytest.raises(errors.CheckViolation):
        db.execute("UPDATE app.tasks SET bite_minutes = %s WHERE id = %s", (value, task))


def test_the_version_index_exists(db: psycopg.Connection) -> None:
    row = db.execute(
        "SELECT indexdef FROM pg_indexes WHERE schemaname = 'app' "
        "AND indexname = 'plan_versions_user_task_idx'"
    ).fetchone()
    assert row is not None
    assert "(user_id, task_id, created_at)" in row[0]
