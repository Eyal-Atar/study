from collections.abc import Callable

import psycopg

from app.auth import CurrentUser
from app.db.pool import Database
from app.domain.planner import PlannedBlock, PlanResult
from app.services.board import load_board
from app.services.plan_writes import (
    VersionReason,
    apply_result,
    delete_open_blocks,
    renumber,
)
from tests.api.factories import (
    NOW,
    TEST_PROFILE,
    Z,
    insert_block,
    insert_exam,
    insert_task,
    scalar,
    set_profile,
)

MakeUser = Callable[[], CurrentUser]


def _user(make_user: MakeUser, db: psycopg.Connection) -> CurrentUser:
    user = make_user()
    set_profile(db, user.id, **TEST_PROFILE)
    return user


def test_apply_result_without_changes_writes_nothing(
    database: Database, make_user: MakeUser, db: psycopg.Connection
) -> None:
    user = _user(make_user, db)
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=60)
    insert_block(db, user.id, task, Z(2026, 11, 16, 8, 0), Z(2026, 11, 16, 9, 0))
    with database.transaction(user) as conn:
        board = load_board(conn, user.id, NOW, lock=True)
        same = PlanResult(
            blocks=tuple(
                PlannedBlock(
                    task_id=block.task_id,
                    interval=block.interval,
                    part_index=block.part_index,
                    part_count=block.part_count,
                    block_id=block.id,
                )
                for block in board.blocks
            ),
            removed=(),
            unscheduled=(),
            warnings=(),
            shortfalls=(),
        )
        assert apply_result(conn, user.id, board, same, VersionReason.REPLAN) is None
    assert scalar(db, "SELECT count(*) FROM app.plan_versions") == 0
    assert scalar(db, "SELECT count(*) FROM app.blocks WHERE plan_version_id IS NULL") == 1


def test_renumber_counts_live_blocks_only(
    database: Database, make_user: MakeUser, db: psycopg.Connection
) -> None:
    user = _user(make_user, db)
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=240)
    missed = insert_block(
        db, user.id, task, Z(2026, 11, 15, 8, 0), Z(2026, 11, 15, 9, 0), status="missed"
    )
    done = insert_block(
        db, user.id, task, Z(2026, 11, 15, 10, 0), Z(2026, 11, 15, 11, 0), status="done"
    )
    first = insert_block(db, user.id, task, Z(2026, 11, 16, 8, 0), Z(2026, 11, 16, 9, 0))
    second = insert_block(db, user.id, task, Z(2026, 11, 16, 10, 0), Z(2026, 11, 16, 11, 0))
    with database.transaction(user) as conn:
        renumber(conn, user.id, NOW)
    numbering = {
        row[0]: (row[1], row[2])
        for row in db.execute(
            "SELECT id, part_index, part_count FROM app.blocks WHERE task_id = %s", (task,)
        ).fetchall()
    }
    assert numbering == {missed: (1, 1), done: (1, 3), first: (2, 3), second: (3, 3)}


def test_delete_open_blocks_keeps_started_and_past(
    database: Database, make_user: MakeUser, db: psycopg.Connection
) -> None:
    user = _user(make_user, db)
    exam = insert_exam(db, user.id, exam_date="2026-11-20")
    task = insert_task(db, user.id, exam, minutes=240)
    past = insert_block(db, user.id, task, Z(2026, 11, 15, 8, 0), Z(2026, 11, 15, 9, 0))
    started = insert_block(db, user.id, task, Z(2026, 11, 16, 4, 30), Z(2026, 11, 16, 5, 30))
    insert_block(db, user.id, task, Z(2026, 11, 16, 8, 0), Z(2026, 11, 16, 9, 0), pinned=True)
    insert_block(db, user.id, task, Z(2026, 11, 16, 10, 0), Z(2026, 11, 16, 11, 0))
    with database.transaction(user) as conn:
        board = load_board(conn, user.id, NOW, lock=True)
        version = delete_open_blocks(
            conn, user.id, board, [task], VersionReason.TASK_DELETED, task_id=task
        )
    assert version is not None
    left = {row[0] for row in db.execute("SELECT id FROM app.blocks").fetchall()}
    assert left == {past, started}
    assert scalar(db, "SELECT reason FROM app.plan_versions WHERE id = %s", version) == (
        "task_deleted"
    )
    assert scalar(db, "SELECT task_id FROM app.plan_versions WHERE id = %s", version) == task
    with database.transaction(user) as conn:
        board = load_board(conn, user.id, NOW, lock=True)
        again = delete_open_blocks(conn, user.id, board, [task], VersionReason.TASK_DELETED)
    assert again is None
    assert scalar(db, "SELECT count(*) FROM app.plan_versions") == 1
