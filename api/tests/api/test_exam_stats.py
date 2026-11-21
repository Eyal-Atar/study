from collections.abc import Callable

import psycopg

from app.auth import CurrentUser
from app.db.pool import Database
from app.services.exam_stats import EMPTY, exam_stats
from tests.api.factories import Z, insert_block, insert_exam, insert_task

MakeUser = Callable[[], CurrentUser]


def test_stats_count_only_the_current_sitting_and_live_tasks(
    db: psycopg.Connection, database: Database, make_user: MakeUser
) -> None:
    user = make_user()
    db.execute("INSERT INTO app.profiles (id) VALUES (%s)", (user.id,))
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    empty = insert_exam(db, user.id, exam_date="2026-11-25")
    done = insert_task(db, user.id, exam, minutes=90, status="done")
    insert_task(db, user.id, exam, minutes=30)  # todo
    insert_task(db, user.id, exam, minutes=200, status="skipped")  # out of the total
    deleted = insert_task(db, user.id, exam, minutes=60, status="done")
    db.execute("UPDATE app.tasks SET deleted_at = now() WHERE id = %s", (deleted,))
    insert_block(db, user.id, done, Z(2026, 11, 16, 9), Z(2026, 11, 16, 10, 30), status="done")
    insert_block(db, user.id, deleted, Z(2026, 11, 16, 11), Z(2026, 11, 16, 12), status="done")
    insert_block(db, user.id, done, Z(2026, 11, 17, 9), Z(2026, 11, 17, 10))  # planned

    with database.transaction(user) as conn:
        stats = exam_stats(conn, user.id, [exam, empty])
    assert stats[exam].studied_minutes == 90
    assert (stats[exam].tasks_done, stats[exam].tasks_total) == (1, 2)
    assert stats[exam].completion_percent == 75  # 90 of 120 estimated minutes
    assert stats[empty] == EMPTY

    # Moed B: the exam moves to sitting 2, and the Moed A work no longer counts.
    db.execute(
        "UPDATE app.exams SET sitting = 2, first_exam_date = exam_date, exam_date = '2027-01-20' "
        "WHERE id = %s",
        (exam,),
    )
    fresh = insert_task(db, user.id, exam, minutes=60, status="done")
    insert_block(db, user.id, fresh, Z(2026, 11, 18, 9), Z(2026, 11, 18, 9, 45), status="done")
    with database.transaction(user) as conn:
        again = exam_stats(conn, user.id, [exam])[exam]
    assert (again.studied_minutes, again.tasks_done, again.tasks_total) == (45, 1, 1)
    assert again.completion_percent == 100


def test_stats_of_another_users_exam_are_not_returned(
    db: psycopg.Connection, database: Database, make_user: MakeUser
) -> None:
    owner, other = make_user(), make_user()
    exam = insert_exam(db, owner.id, exam_date="2026-11-20")
    with database.transaction(other) as conn:
        assert exam_stats(conn, other.id, [exam]) == {}
        assert exam_stats(conn, other.id, []) == {}
