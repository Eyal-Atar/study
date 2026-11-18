import datetime as dt
import threading
import time
from collections.abc import Callable
from uuid import UUID

import psycopg

from app.auth import CurrentUser
from app.db.pool import Database
from app.domain.planner import BlockStatus
from app.services.board import Board, fingerprint, load_board

MakeUser = Callable[[], CurrentUser]
UTC = dt.UTC
NOW = dt.datetime(2026, 11, 15, 6, 0, tzinfo=UTC)  # 08:00 on 2026-11-15 in Jerusalem


def _board(database: Database, user: CurrentUser, now: dt.datetime = NOW) -> Board:
    with database.transaction(user) as conn:
        return load_board(conn, user.id, now)


def _exam(db: psycopg.Connection, user: CurrentUser, date: str, *, deleted: bool = False) -> UUID:
    row = db.execute(
        "INSERT INTO app.exams (user_id, name, exam_date, deleted_at) "
        "VALUES (%s, 'E', %s, %s) RETURNING id",
        (user.id, date, NOW if deleted else None),
    ).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def _task(
    db: psycopg.Connection,
    user: CurrentUser,
    exam_id: UUID,
    *,
    created_at: str = "2026-11-01 00:00Z",
    depends_on: UUID | None = None,
    deleted: bool = False,
    position: int | None = None,
) -> UUID:
    row = db.execute(
        "INSERT INTO app.tasks (user_id, exam_id, title, kind, estimated_minutes, source, "
        "depends_on_task_id, created_at, deleted_at, position) "
        "VALUES (%s, %s, 'T', 'learn', 60, 'user', %s, %s, %s, %s) RETURNING id",
        (user.id, exam_id, depends_on, created_at, NOW if deleted else None, position),
    ).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def _block(
    db: psycopg.Connection,
    user: CurrentUser,
    task_id: UUID,
    start: str,
    end: str,
    *,
    status: str = "planned",
    pinned: bool = False,
) -> UUID:
    row = db.execute(
        "INSERT INTO app.blocks (user_id, task_id, starts_at, ends_at, status, pinned) "
        "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
        (user.id, task_id, start, end, status, pinned),
    ).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def test_deleted_and_past_exams_are_left_out(
    database: Database, make_user: MakeUser, db: psycopg.Connection
) -> None:
    user = make_user()
    deleted = _exam(db, user, "2026-12-01", deleted=True)
    yesterday = _exam(db, user, "2026-11-14")
    today = _exam(db, user, "2026-11-15")
    future = _exam(db, user, "2026-12-20")
    for exam in (deleted, yesterday):
        _task(db, user, exam)
    kept = [_task(db, user, today), _task(db, user, future)]
    board = _board(database, user)
    assert {exam.id for exam in board.exams} == {today, future}
    assert {task.id for task in board.tasks} == set(kept)
    # 23:30 UTC on the 14th is already 01:30 on the 15th in Jerusalem (the default
    # timezone): the exam of the 14th is past by the local date, not the UTC one.
    late = _board(database, user, dt.datetime(2026, 11, 14, 23, 30, tzinfo=UTC))
    assert {exam.id for exam in late.exams} == {today, future}
    assert {task.id for task in late.tasks} == set(kept)


def test_tasks_keep_creation_order_and_drop_dangling_dependencies(
    database: Database, make_user: MakeUser, db: psycopg.Connection
) -> None:
    user = make_user()
    exam = _exam(db, user, "2026-12-20")
    gone = _task(db, user, exam, created_at="2026-11-01 00:00Z", deleted=True)
    third = _task(db, user, exam, created_at="2026-11-03 00:00Z")
    first = _task(db, user, exam, created_at="2026-11-01 01:00Z", depends_on=gone)
    second = _task(db, user, exam, created_at="2026-11-02 00:00Z", depends_on=first)
    board = _board(database, user)
    assert [task.id for task in board.tasks] == [first, second, third]
    assert [task.depends_on for task in board.tasks] == [None, first, None]


def test_tasks_are_ordered_by_position_then_creation(
    database: Database, make_user: MakeUser, db: psycopg.Connection
) -> None:
    user = make_user()
    exam = _exam(db, user, "2026-12-20")
    unplaced = _task(db, user, exam, created_at="2026-11-01 00:00Z")
    second = _task(db, user, exam, created_at="2026-11-02 00:00Z", position=2)
    first = _task(db, user, exam, created_at="2026-11-03 00:00Z", position=1)
    later = _task(db, user, exam, created_at="2026-11-04 00:00Z")
    board = _board(database, user)
    assert [task.id for task in board.tasks] == [first, second, unplaced, later]


def test_blocks_window_and_statuses(
    database: Database, make_user: MakeUser, db: psycopg.Connection
) -> None:
    user = make_user()
    exam = _exam(db, user, "2026-12-20")
    live = _task(db, user, exam)
    deleted = _task(db, user, exam, deleted=True)
    done_of_deleted = _block(
        db, user, deleted, "2026-11-14 18:00Z", "2026-11-14 19:00Z", status="done"
    )
    _block(db, user, live, "2026-11-12 08:00Z", "2026-11-12 09:00Z")  # planned, > 48h ago
    _block(db, user, live, "2026-11-14 08:00Z", "2026-11-14 09:00Z", status="missed")
    later = _block(db, user, live, "2026-11-16 08:00Z", "2026-11-16 09:00Z")
    earlier = _block(db, user, live, "2026-11-15 08:00Z", "2026-11-15 09:00Z")
    board = _board(database, user)
    assert [block.id for block in board.blocks] == [done_of_deleted, earlier, later]
    assert board.blocks[0].status is BlockStatus.DONE
    assert [b.id for b in board.existing] == [b.id for b in board.blocks]
    assert [b.id for b in board.snapshot_blocks] == [b.id for b in board.blocks]
    assert all(b.interval.start.tzinfo is dt.UTC for b in board.existing)
    assert all(b.interval.end.tzinfo is dt.UTC for b in board.snapshot_blocks)


def test_fingerprint_ignores_now_and_sees_changes(
    database: Database, make_user: MakeUser, db: psycopg.Connection
) -> None:
    user = make_user()
    exam = _exam(db, user, "2026-12-20")
    block = _block(db, user, _task(db, user, exam), "2026-11-16 08:00Z", "2026-11-16 09:00Z")
    first = fingerprint(_board(database, user))
    assert fingerprint(_board(database, user, NOW + dt.timedelta(hours=3))) == first
    db.execute("UPDATE app.blocks SET pinned = true WHERE id = %s", (block,))
    assert fingerprint(_board(database, user)) != first


def test_fingerprint_sees_commitments_and_busy_events(
    database: Database, make_user: MakeUser, db: psycopg.Connection
) -> None:
    user = make_user()
    db.execute("INSERT INTO app.profiles (id) VALUES (%s)", (user.id,))
    first = fingerprint(_board(database, user))
    db.execute(
        "INSERT INTO app.commitments (user_id, title, kind, weekday, start_time, end_time, "
        "valid_from) VALUES (%s, 'עבודה', 'work', 1, '16:00', '22:00', '2026-01-01') "
        "RETURNING id",
        (user.id,),
    )
    with_commitment = fingerprint(_board(database, user))
    assert with_commitment != first
    db.execute("UPDATE app.commitments SET end_time = '21:00' WHERE user_id = %s", (user.id,))
    changed = fingerprint(_board(database, user))
    assert changed not in (first, with_commitment)
    db.execute(
        "INSERT INTO app.busy_events (user_id, starts_at, ends_at) "
        "SELECT %s, m + interval '1 day', m + interval '1 day 2 hours' "
        "FROM date_trunc('minute', now()) AS m",
        (user.id,),
    )
    assert fingerprint(_board(database, user)) not in (first, with_commitment, changed)


def test_lock_serializes_two_transactions(
    database: Database, make_user: MakeUser, db: psycopg.Connection
) -> None:
    user = make_user()
    db.execute("INSERT INTO app.profiles (id) VALUES (%s)", (user.id,))
    barrier = threading.Barrier(2)

    def work() -> None:
        barrier.wait()
        with database.transaction(user) as conn:
            load_board(conn, user.id, NOW, lock=True)
            time.sleep(0.3)

    threads = [threading.Thread(target=work) for _ in range(2)]
    started = time.monotonic()
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert time.monotonic() - started >= 0.6


def test_done_blocks_of_loaded_tasks_count_whatever_their_age(
    database: Database, make_user: MakeUser, db: psycopg.Connection
) -> None:
    user = make_user()
    exam = _exam(db, user, "2026-12-20")
    task = _task(db, user, exam)
    db.execute("UPDATE app.tasks SET estimated_minutes = 120 WHERE id = %s", (task,))
    deleted = _task(db, user, exam, deleted=True)
    old_done = _block(db, user, task, "2026-11-12 08:00Z", "2026-11-12 09:00Z", status="done")
    _block(db, user, task, "2026-11-11 08:00Z", "2026-11-11 09:00Z", status="missed")
    _block(db, user, deleted, "2026-11-12 10:00Z", "2026-11-12 11:00Z", status="done")
    board = _board(database, user)
    assert [block.id for block in board.blocks] == [old_done]
