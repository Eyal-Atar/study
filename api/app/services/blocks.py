"""Block actions: complete, uncomplete, defer and pin.

Each takes the user's lock first, since each changes the board (or reads it to place a
block), so two requests of one user run one after the other.
"""

import datetime as dt
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from app.domain.planner import (
    BlockStatus,
    Exam,
    Profile,
    Task,
    TaskKind,
    TaskStatus,
    UnscheduledReason,
    awake_span,
    is_complete,
    place_task,
    start_minute,
    study_date,
)
from app.domain.time import local_date
from app.errors import ApiError
from app.services import gamification
from app.services.board import BLOCK_COLUMNS, BlockRow, load_board, to_block_row
from app.services.gamification import ProgressChange
from app.services.plan_views import BlockView, blocks_by_id
from app.services.plan_writes import VersionReason, apply_result, renumber
from app.services.profiles import Conn, lock_user, to_planner_profile


@dataclass(frozen=True)
class CompleteOutcome:
    block: BlockView
    task_status: TaskStatus
    # XP, level and badges (S19), changed in the same transaction as the block.
    progress: ProgressChange


@dataclass(frozen=True)
class DeferOutcome:
    blocks: tuple[BlockView, ...]
    version_id: UUID | None


@dataclass(frozen=True)
class _Target:
    block: BlockRow
    task: Task
    exam: Exam


def _find(conn: Conn, user_id: UUID, block_id: UUID) -> _Target:
    """The user's block whose task and exam are not deleted, with its task; else 404."""
    row: dict[str, Any] | None = conn.execute(
        "SELECT "
        + ", ".join(f"b.{column.strip()}" for column in BLOCK_COLUMNS.split(","))
        + ", t.exam_id, t.kind, t.estimated_minutes, t.focus, t.depends_on_task_id, "
        "t.status AS task_status, e.exam_date, e.difficulty "
        "FROM app.blocks b "
        "JOIN app.tasks t ON t.id = b.task_id AND t.user_id = b.user_id "
        "JOIN app.exams e ON e.id = t.exam_id AND e.user_id = t.user_id "
        "WHERE b.user_id = %s AND b.id = %s AND t.deleted_at IS NULL AND e.deleted_at IS NULL",
        (user_id, block_id),
    ).fetchone()
    if row is None:
        raise ApiError("not_found")
    block = to_block_row(row)
    task = Task(
        id=block.task_id,
        exam_id=row["exam_id"],
        kind=TaskKind(row["kind"]),
        estimated_minutes=row["estimated_minutes"],
        focus=row["focus"],
        depends_on=row["depends_on_task_id"],
        status=TaskStatus(row["task_status"]),
    )
    exam = Exam(id=row["exam_id"], exam_date=row["exam_date"], difficulty=row["difficulty"])
    return _Target(block, task, exam)


def _view(
    conn: Conn, user_id: UUID, block_id: UUID, lock_row_profile: Any, now: dt.datetime
) -> BlockView:
    views = blocks_by_id(conn, user_id, [block_id], to_planner_profile(lock_row_profile), now)
    return views[0]


def _set_task_status(conn: Conn, user_id: UUID, task_id: UUID, status: TaskStatus) -> None:
    conn.execute(
        "UPDATE app.tasks SET status = %s WHERE user_id = %s AND id = %s",
        (status.value, user_id, task_id),
    )


def complete_block(conn: Conn, user_id: UUID, block_id: UUID, now: dt.datetime) -> CompleteOutcome:
    profile_row = lock_user(conn, user_id)
    target = _find(conn, user_id, block_id)
    task = target.task
    status = task.status
    if target.block.status is BlockStatus.DONE:
        progress = gamification.unchanged(conn, user_id)
    else:
        conn.execute(
            "UPDATE app.blocks SET status = 'done' WHERE user_id = %s AND id = %s",
            (user_id, block_id),
        )
        totals = conn.execute(
            "SELECT "
            "coalesce(sum(extract(epoch FROM ends_at - starts_at) / 60) "
            "FILTER (WHERE status = 'done'), 0)::int AS done_minutes, "
            "count(*) FILTER (WHERE status = 'planned' AND ends_at > %s) AS live_planned "
            "FROM app.blocks WHERE user_id = %s AND task_id = %s",
            (start_minute(now), user_id, task.id),
        ).fetchone()
        if totals is None:
            raise RuntimeError("an aggregate query returned no row")
        if (
            status is TaskStatus.TODO
            and totals["live_planned"] == 0
            and is_complete(task, totals["done_minutes"], has_live_block=True)
        ):
            status = TaskStatus.DONE
            _set_task_status(conn, user_id, task.id, status)
        renumber(conn, user_id, now)
        progress = gamification.record_completion(
            conn, user_id, to_planner_profile(profile_row), target.block, task.focus, now
        )
    return CompleteOutcome(_view(conn, user_id, block_id, profile_row, now), status, progress)


def uncomplete_block(
    conn: Conn, user_id: UUID, block_id: UUID, now: dt.datetime
) -> CompleteOutcome:
    profile_row = lock_user(conn, user_id)
    target = _find(conn, user_id, block_id)
    if target.block.status is not BlockStatus.DONE:
        raise ApiError("invalid_state")
    conn.execute(
        "UPDATE app.blocks SET status = 'planned' WHERE user_id = %s AND id = %s",
        (user_id, block_id),
    )
    status = target.task.status
    if status is TaskStatus.DONE:
        status = TaskStatus.TODO
        _set_task_status(conn, user_id, target.task.id, status)
    renumber(conn, user_id, now)
    progress = gamification.revoke_completion(conn, user_id, block_id)
    return CompleteOutcome(_view(conn, user_id, block_id, profile_row, now), status, progress)


def _placement_failed(reason: str, blocked_by: UUID | None) -> ApiError:
    return ApiError(
        "placement_failed",
        extra={"reason": reason, "blocked_by": None if blocked_by is None else str(blocked_by)},
    )


def task_live_blocks(
    conn: Conn, user_id: UUID, task_id: UUID, profile: Profile, now: dt.datetime
) -> tuple[BlockView, ...]:
    """The task's live blocks (done, or planned and not over), by time: a defer's answer."""
    live = conn.execute(
        "SELECT id FROM app.blocks WHERE user_id = %s AND task_id = %s "
        "AND (status = 'done' OR (status = 'planned' AND ends_at > %s))",
        (user_id, task_id, start_minute(now)),
    ).fetchall()
    return blocks_by_id(conn, user_id, [row["id"] for row in live], profile, now)


def require_deferrable(target: _Target, profile: Profile, now: dt.datetime) -> None:
    """A defer takes a planned block that is not over, of a task still on the board; else 409.

    A block that has started may be deferred (it is released whole). A task of a passed exam
    or a finished task is not on the board (load_board: a todo task of a live exam dated
    today or later; _find already left out deleted ones), and has nowhere to go.
    """
    block = target.block
    if block.status is not BlockStatus.PLANNED or block.ends_at <= start_minute(now):
        raise ApiError("invalid_state")
    if target.task.status is not TaskStatus.TODO or target.exam.exam_date < local_date(
        now, profile.timezone
    ):
        raise ApiError("invalid_state")


def defer_block(
    conn: Conn,
    user_id: UUID,
    block_id: UUID,
    now: dt.datetime,
    not_before: dt.datetime | None,
    *,
    tomorrow: bool = False,
) -> DeferOutcome:
    """Release the block and place its task again: after the block, after not_before, or
    (tomorrow) from the next study day's start, wake-up plus the start delay (S35)."""
    board = load_board(conn, user_id, now, lock=True)
    target = _find(conn, user_id, block_id)
    require_deferrable(target, board.profile, now)
    block = target.block
    task_id = target.task.id
    if tomorrow:
        span = awake_span(board.profile, study_date(board.profile, now) + dt.timedelta(days=1))
        if span is None:
            raise _placement_failed(UnscheduledReason.NO_STUDY_DAYS.value, None)
        # A block already on tomorrow (or later) is not pulled earlier or back to its place.
        not_before = max(span.start, block.ends_at)
    # Without a not_before, deferring means "after this block": the planner alone would put
    # the released block straight back into its own slot.
    result = place_task(
        board.profile,
        board.exams,
        board.tasks,
        board.existing,
        task_id,
        now,
        release=(block_id,),
        not_before=block.ends_at if not_before is None else not_before,
    )
    if not result.blocks and result.unscheduled:
        failure = result.unscheduled[0]
        raise _placement_failed(failure.reason.value, failure.blocked_by)
    version_id = apply_result(conn, user_id, board, result, VersionReason.DEFER, task_id=task_id)
    return DeferOutcome(task_live_blocks(conn, user_id, task_id, board.profile, now), version_id)


def pin_block(
    conn: Conn, user_id: UUID, block_id: UUID, pinned: bool, now: dt.datetime
) -> BlockView:
    profile_row = lock_user(conn, user_id)
    block = _find(conn, user_id, block_id).block
    if block.status is not BlockStatus.PLANNED or block.ends_at <= now:
        raise ApiError("invalid_state")
    conn.execute(
        "UPDATE app.blocks SET pinned = %s WHERE user_id = %s AND id = %s",
        (pinned, user_id, block_id),
    )
    return _view(conn, user_id, block_id, profile_row, now)
