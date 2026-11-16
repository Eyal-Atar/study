"""The morning review (S18): the blocks that ended without a mark, and what to do with them.

A review block is a planned block that is over (ends_at <= the current minute), of a todo
task of a live exam whose date has not passed. In the planner it is history: it takes no
time, and its minutes go back to the task. "Done" is the existing complete; "move" marks
it missed and places what the task now lacks (place_task, nothing released); "skip" skips
the task, as PATCH /tasks {status: skipped} does. Both write a version with the block's
id, so undo sets the block back to planned and it returns to the review.

Each action takes the user's lock first (load_board(lock=True)), like every board change.
"""

import datetime as dt
from dataclasses import dataclass
from typing import Final
from uuid import UUID

from app.domain.planner import (
    BlockStatus,
    TaskStatus,
    place_task,
    start_minute,
    study_date,
)
from app.domain.time import local_date
from app.errors import ApiError
from app.services.board import BLOCK_COLUMNS, BlockRow, Board, load_board, to_block_row
from app.services.plan_views import BlockView, blocks_by_id
from app.services.plan_writes import VersionReason, apply_result, delete_open_blocks
from app.services.profiles import Conn, ensure_profile, to_planner_profile

# The review holds the last seven study days, today included: an older block is history
# the next replan gives its minutes back to, and a long list of past decisions only weighs.
REVIEW_DAYS: Final = 7
# A study day starts at most a day before or after its local date; two days catch them all.
_QUERY_MARGIN: Final = dt.timedelta(days=2)
NO_TIME_TODAY: Final = "no_time_today"


@dataclass(frozen=True)
class RescheduleOutcome:
    blocks: tuple[BlockView, ...]
    version_id: UUID | None


@dataclass(frozen=True)
class SkipOutcome:
    task_status: TaskStatus
    version_id: UUID


def review_blocks(conn: Conn, user_id: UUID, now: dt.datetime) -> tuple[BlockView, ...]:
    """The review blocks of the last REVIEW_DAYS study days, by (starts_at, id)."""
    profile = to_planner_profile(ensure_profile(conn, user_id))
    today = study_date(profile, now)
    first = today - dt.timedelta(days=REVIEW_DAYS - 1)
    since = dt.datetime.combine(first, dt.time(), dt.UTC) - _QUERY_MARGIN
    rows = conn.execute(
        "SELECT b.id FROM app.blocks b "
        "JOIN app.tasks t ON t.id = b.task_id AND t.user_id = b.user_id "
        "JOIN app.exams e ON e.id = t.exam_id AND e.user_id = t.user_id "
        "WHERE b.user_id = %s AND b.status = 'planned' AND b.ends_at <= %s "
        "AND b.starts_at >= %s AND t.status = 'todo' AND t.deleted_at IS NULL "
        "AND e.deleted_at IS NULL AND e.exam_date >= %s",
        (user_id, start_minute(now), since, local_date(now, profile.timezone)),
    ).fetchall()
    views = blocks_by_id(conn, user_id, [row["id"] for row in rows], profile, now)
    return tuple(view for view in views if first <= view.study_date <= today)


def _review_block(conn: Conn, user_id: UUID, board: Board, block_id: UUID) -> BlockRow:
    """The user's block if it is a review block: 404 if not found, else invalid_state.

    The block is read from the table, not the board: the board holds only the last 48 hours.
    A block of a deleted task or exam is not found; one of a passed exam's task, or of a
    task that is not todo, is not on the board as todo.
    """
    row = conn.execute(
        "SELECT "  # noqa: S608 - a constant column list
        + ", ".join(f"b.{column.strip()}" for column in BLOCK_COLUMNS.split(","))
        + " FROM app.blocks b "
        "JOIN app.tasks t ON t.id = b.task_id AND t.user_id = b.user_id "
        "JOIN app.exams e ON e.id = t.exam_id AND e.user_id = t.user_id "
        "WHERE b.user_id = %s AND b.id = %s AND t.deleted_at IS NULL AND e.deleted_at IS NULL",
        (user_id, block_id),
    ).fetchone()
    if row is None:
        raise ApiError("not_found")
    block = to_block_row(row)
    if block.status is not BlockStatus.PLANNED or block.ends_at > start_minute(board.now):
        raise ApiError("invalid_state")
    if not any(t.id == block.task_id and t.status is TaskStatus.TODO for t in board.tasks):
        raise ApiError("invalid_state")
    return block


def _set_block_status(conn: Conn, user_id: UUID, block_id: UUID, status: BlockStatus) -> None:
    conn.execute(
        "UPDATE app.blocks SET status = %s WHERE user_id = %s AND id = %s",
        (status.value, user_id, block_id),
    )


def reschedule_block(
    conn: Conn, user_id: UUID, block_id: UUID, now: dt.datetime, *, today_only: bool
) -> RescheduleOutcome:
    """Mark the block missed and place what its task lacks from now, with a version.

    With today_only, a new block outside today's study day fails with placement_failed
    and reason no_time_today, and nothing is written. The version is written even when
    the task lacks nothing (a replan already placed its minutes), so undo can bring the
    block back to the review.
    """
    board = load_board(conn, user_id, now, lock=True)
    block = _review_block(conn, user_id, board, block_id)
    task_id = block.task_id
    result = place_task(board.profile, board.exams, board.tasks, board.existing, task_id, now)
    if result.unscheduled:
        failure = result.unscheduled[0]
        raise ApiError(
            "placement_failed",
            extra={
                "reason": failure.reason.value,
                "blocked_by": None if failure.blocked_by is None else str(failure.blocked_by),
            },
        )
    today = study_date(board.profile, now)
    added = [placed for placed in result.blocks if placed.block_id is None]
    if today_only and any(
        study_date(board.profile, placed.interval.start) != today for placed in added
    ):
        raise ApiError("placement_failed", extra={"reason": NO_TIME_TODAY, "blocked_by": None})
    _set_block_status(conn, user_id, block_id, BlockStatus.MISSED)
    version_id = apply_result(
        conn,
        user_id,
        board,
        result,
        VersionReason.REVIEW_MOVED,
        task_id=task_id,
        block_id=block_id,
        always_version=True,
    )
    live = conn.execute(
        "SELECT id FROM app.blocks WHERE user_id = %s AND task_id = %s "
        "AND (status = 'done' OR (status = 'planned' AND ends_at > %s))",
        (user_id, task_id, start_minute(now)),
    ).fetchall()
    blocks = blocks_by_id(conn, user_id, [row["id"] for row in live], board.profile, now)
    return RescheduleOutcome(blocks, version_id)


def skip_block(conn: Conn, user_id: UUID, block_id: UUID, now: dt.datetime) -> SkipOutcome:
    """Skip the block and its task, deleting the task's open blocks, with a version."""
    board = load_board(conn, user_id, now, lock=True)
    block = _review_block(conn, user_id, board, block_id)
    _set_block_status(conn, user_id, block_id, BlockStatus.SKIPPED)
    conn.execute(
        "UPDATE app.tasks SET status = 'skipped' WHERE user_id = %s AND id = %s",
        (user_id, block.task_id),
    )
    version_id = delete_open_blocks(
        conn,
        user_id,
        board,
        [block.task_id],
        VersionReason.REVIEW_SKIPPED,
        task_id=block.task_id,
        before={"status": TaskStatus.TODO.value},
        block_id=block_id,
        always_version=True,
    )
    if version_id is None:  # always_version writes one
        raise RuntimeError("a review_skipped version was not written")
    return SkipOutcome(TaskStatus.SKIPPED, version_id)
