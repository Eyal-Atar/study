from collections.abc import Callable
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import psycopg

from app.auth import CurrentUser
from app.db.session import user_transaction
from app.domain.time import local_span

JLM = ZoneInfo("Asia/Jerusalem")


def make_task(conn: psycopg.Connection, user: CurrentUser) -> object:
    exam = conn.execute(
        "INSERT INTO app.exams (user_id, name, exam_date) VALUES (%s, 'x', '2027-03-26') "
        "RETURNING id",
        (user.id,),
    ).fetchone()
    assert exam is not None
    task = conn.execute(
        "INSERT INTO app.tasks (user_id, exam_id, title, kind, estimated_minutes, source) "
        "VALUES (%s, %s, 't', 'learn', 60, 'user') RETURNING id",
        (user.id, exam[0]),
    ).fetchone()
    assert task is not None
    return task[0]


def insert_block(
    conn: psycopg.Connection,
    user: CurrentUser,
    task_id: object,
    starts_at: datetime,
    ends_at: datetime,
) -> None:
    conn.execute(
        "INSERT INTO app.blocks (user_id, task_id, starts_at, ends_at) VALUES (%s, %s, %s, %s)",
        (user.id, task_id, starts_at, ends_at),
    )


def test_both_occurrences_of_a_repeated_hour_are_kept_apart(
    api_db: psycopg.Connection, make_user: Callable[[], CurrentUser]
) -> None:
    user = make_user()
    first = datetime(2026, 10, 25, 1, 30, tzinfo=JLM)
    second = datetime(2026, 10, 25, 1, 30, fold=1, tzinfo=JLM)
    with user_transaction(api_db, user) as conn:
        task_id = make_task(conn, user)
        insert_block(conn, user, task_id, first, first + timedelta(minutes=30))
        insert_block(conn, user, task_id, second, second + timedelta(minutes=30))
    with user_transaction(api_db, user) as conn:
        rows = conn.execute("SELECT starts_at FROM app.blocks ORDER BY starts_at").fetchall()
    starts = [row[0] for row in rows]
    assert starts == [
        datetime(2026, 10, 24, 22, 30, tzinfo=UTC),
        datetime(2026, 10, 24, 23, 30, tzinfo=UTC),
    ]
    assert [s.utcoffset() for s in starts] == [timedelta(0), timedelta(0)]


def test_instants_do_not_depend_on_the_session_timezone(
    api_db: psycopg.Connection, db: psycopg.Connection, make_user: Callable[[], CurrentUser]
) -> None:
    user = make_user()
    instant = datetime(2027, 3, 26, 0, 30, tzinfo=UTC)
    with user_transaction(api_db, user) as conn:
        insert_block(conn, user, make_task(conn, user), instant, instant + timedelta(hours=1))
    db.execute("SET TIME ZONE 'America/New_York'")
    row = db.execute("SELECT starts_at FROM app.blocks").fetchone()
    assert row is not None
    assert row[0] == instant


def test_exam_date_is_a_calendar_date_everywhere(
    api_db: psycopg.Connection, db: psycopg.Connection, make_user: Callable[[], CurrentUser]
) -> None:
    user = make_user()
    with user_transaction(api_db, user) as conn:
        conn.execute(
            "INSERT INTO app.exams (user_id, name, exam_date) VALUES (%s, 'x', %s)",
            (user.id, date(2027, 3, 26)),
        )
    for zone in ("Pacific/Kiritimati", "Pacific/Pago_Pago"):
        db.execute(f"SET TIME ZONE '{zone}'")
        row = db.execute("SELECT exam_date FROM app.exams").fetchone()
        assert row == (date(2027, 3, 26),), zone


def test_a_block_across_the_fall_back_night_lasts_5_hours(
    api_db: psycopg.Connection, make_user: Callable[[], CurrentUser]
) -> None:
    user = make_user()
    start, end = local_span(date(2026, 10, 24), time(23), time(3), JLM)
    with user_transaction(api_db, user) as conn:
        insert_block(conn, user, make_task(conn, user), start, end)
        row = conn.execute("SELECT ends_at - starts_at FROM app.blocks").fetchone()
    assert row == (timedelta(hours=5),)
