"""The one place that writes planner results and plan versions, and undoes a version.

Every change to the board goes through `apply_result` (a planner result) or
`delete_open_blocks` (blocks of tasks that left the plan). Each saves the board as it
was before the change (a snapshot of the future planned blocks) in plan_versions, so
`undo_version` can bring it back.
"""

import datetime as dt
import logging
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any
from uuid import UUID

from psycopg.types.json import Jsonb

from app.domain.planner import (
    BlockStatus,
    PlannedBlock,
    PlanResult,
    SnapshotBlock,
    SnapshotError,
    TaskStatus,
    Unscheduled,
    parse_snapshot,
    place_task,
    snapshot,
    start_minute,
    undo,
)
from app.errors import ApiError
from app.services.board import (
    BLOCK_COLUMNS,
    BLOCK_LOOKBACK,
    Board,
    load_board,
    to_block_row,
    to_snapshot_block,
)
from app.services.profiles import Conn, lock_user

logger = logging.getLogger(__name__)


class VersionReason(StrEnum):
    REPLAN = "replan"
    DEFER = "defer"
    TASK_ADDED = "task_added"
    TASK_CHANGED = "task_changed"
    TASK_DELETED = "task_deleted"
    EXAM_DELETED = "exam_deleted"


@dataclass(frozen=True)
class VersionRow:
    id: UUID
    reason: str
    created_at: dt.datetime
    exam_id: UUID | None
    task_id: UUID | None
    snapshot: Any


@dataclass(frozen=True)
class UndoOutcome:
    restored: int
    deleted: int
    replaced: tuple[UUID, ...]
    unplaced: tuple[Unscheduled, ...]


@dataclass(frozen=True)
class _Changes:
    """What a planner result changes on the board it was computed from."""

    removed: tuple[UUID, ...]
    added: tuple[PlannedBlock, ...]
    renumbered: tuple[PlannedBlock, ...]

    def __bool__(self) -> bool:
        return bool(self.removed or self.added or self.renumbered)


def _changes(board: Board, result: PlanResult) -> _Changes:
    rows = {block.id: block for block in board.blocks}
    renumbered: list[PlannedBlock] = []
    for block in result.blocks:
        if block.block_id is None:
            continue
        row = rows[block.block_id]
        if (row.part_index, row.part_count) != (block.part_index, block.part_count):
            renumbered.append(block)
    return _Changes(
        removed=result.removed,
        added=tuple(block for block in result.blocks if block.block_id is None),
        renumbered=tuple(renumbered),
    )


def has_changes(board: Board, result: PlanResult) -> bool:
    """Whether apply_result would write anything for this result."""
    return bool(_changes(board, result))


def _create_version(
    conn: Conn,
    user_id: UUID,
    board: Board,
    reason: VersionReason,
    exam_id: UUID | None,
    task_id: UUID | None,
) -> UUID:
    row = conn.execute(
        "INSERT INTO app.plan_versions (user_id, reason, snapshot, exam_id, task_id) "
        "VALUES (%s, %s, %s, %s, %s) RETURNING id",
        (
            user_id,
            reason.value,
            Jsonb(snapshot(board.snapshot_blocks, board.now)),
            exam_id,
            task_id,
        ),
    ).fetchone()
    if row is None:
        raise RuntimeError("the new plan version is not visible to this user")
    version_id: UUID = row["id"]
    return version_id


def _write_changes(conn: Conn, user_id: UUID, changes: _Changes, version_id: UUID | None) -> None:
    """Delete, insert and renumber; written blocks get version_id (None keeps theirs)."""
    if changes.removed:
        conn.execute(
            "DELETE FROM app.blocks WHERE user_id = %s AND id = ANY(%s) AND status = 'planned'",
            (user_id, list(changes.removed)),
        )
    with conn.cursor() as cursor:
        if changes.added:
            cursor.executemany(
                "INSERT INTO app.blocks (user_id, task_id, starts_at, ends_at, part_index, "
                "part_count, plan_version_id) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                [
                    (
                        user_id,
                        block.task_id,
                        block.interval.start,
                        block.interval.end,
                        block.part_index,
                        block.part_count,
                        version_id,
                    )
                    for block in changes.added
                ],
            )
        if changes.renumbered:
            cursor.executemany(
                "UPDATE app.blocks SET part_index = %s, part_count = %s, "
                "plan_version_id = coalesce(%s::uuid, plan_version_id) "
                "WHERE user_id = %s AND id = %s",
                [
                    (block.part_index, block.part_count, version_id, user_id, block.block_id)
                    for block in changes.renumbered
                ],
            )


def apply_result(
    conn: Conn,
    user_id: UUID,
    board: Board,
    result: PlanResult,
    reason: VersionReason,
    *,
    exam_id: UUID | None = None,
    task_id: UUID | None = None,
) -> UUID | None:
    """Write a planner result computed from `board`, with a version; None if it changes nothing."""
    changes = _changes(board, result)
    if not changes:
        return None
    version_id = _create_version(conn, user_id, board, reason, exam_id, task_id)
    _write_changes(conn, user_id, changes, version_id)
    return version_id


def delete_open_blocks(
    conn: Conn,
    user_id: UUID,
    board: Board,
    task_ids: Collection[UUID],
    reason: VersionReason,
    *,
    exam_id: UUID | None = None,
    task_id: UUID | None = None,
) -> UUID | None:
    """Delete the tasks' planned blocks that have not started (pinned too), with a version."""
    start = start_minute(board.now)
    wanted = frozenset(task_ids)
    open_ids = [
        block.id
        for block in board.blocks
        if block.task_id in wanted
        and block.status is BlockStatus.PLANNED
        and block.starts_at >= start
    ]
    version_id = None
    if open_ids:
        version_id = _create_version(conn, user_id, board, reason, exam_id, task_id)
        conn.execute(
            "DELETE FROM app.blocks WHERE user_id = %s AND id = ANY(%s)",
            (user_id, open_ids),
        )
    renumber(conn, user_id, board.now)
    return version_id


def renumber(conn: Conn, user_id: UUID, now: dt.datetime) -> None:
    """Number each todo task's live blocks 1..n by (starts_at, id); only changed rows."""
    conn.execute(
        """
        WITH live AS (
            SELECT b.id,
                   row_number() OVER (PARTITION BY b.task_id ORDER BY b.starts_at, b.id)
                       AS part_index,
                   count(*) OVER (PARTITION BY b.task_id) AS part_count
            FROM app.blocks b
            JOIN app.tasks t ON t.id = b.task_id AND t.user_id = b.user_id
            WHERE b.user_id = %(user_id)s
              AND t.status = 'todo' AND t.deleted_at IS NULL
              AND (b.status = 'done' OR (b.status = 'planned' AND b.ends_at > %(start)s))
        )
        UPDATE app.blocks b
        SET part_index = live.part_index, part_count = live.part_count
        FROM live
        WHERE b.id = live.id AND b.user_id = %(user_id)s
          AND (b.part_index, b.part_count) IS DISTINCT FROM (live.part_index, live.part_count)
        """,
        {"user_id": user_id, "start": start_minute(now)},
    )


def _version_row(row: Mapping[str, Any]) -> VersionRow:
    return VersionRow(
        id=row["id"],
        reason=row["reason"],
        created_at=row["created_at"].astimezone(dt.UTC),
        exam_id=row["exam_id"],
        task_id=row["task_id"],
        snapshot=row["snapshot"],
    )


def latest_version(conn: Conn, user_id: UUID) -> VersionRow | None:
    """The newest version that was not undone."""
    row = conn.execute(
        "SELECT id, reason, created_at, exam_id, task_id, snapshot FROM app.plan_versions "
        "WHERE user_id = %s AND undone_at IS NULL "
        "ORDER BY created_at DESC, id DESC LIMIT 1",
        (user_id,),
    ).fetchone()
    return None if row is None else _version_row(row)


def _undo_side_effect(conn: Conn, user_id: UUID, version: VersionRow, now: dt.datetime) -> None:
    """Bring back a deleted exam or task, or delete a task that was added."""
    if version.reason == VersionReason.EXAM_DELETED and version.exam_id is not None:
        conn.execute(
            "UPDATE app.exams SET deleted_at = NULL WHERE user_id = %s AND id = %s",
            (user_id, version.exam_id),
        )
    elif version.reason == VersionReason.TASK_DELETED and version.task_id is not None:
        conn.execute(
            "UPDATE app.tasks SET deleted_at = NULL WHERE user_id = %s AND id = %s",
            (user_id, version.task_id),
        )
    elif version.reason == VersionReason.TASK_ADDED and version.task_id is not None:
        conn.execute(
            "UPDATE app.tasks SET deleted_at = %s "
            "WHERE user_id = %s AND id = %s AND deleted_at IS NULL",
            (now, user_id, version.task_id),
        )


def _current_blocks(
    conn: Conn, user_id: UUID, now: dt.datetime, saved: Sequence[SnapshotBlock]
) -> tuple[SnapshotBlock, ...]:
    """Every block of the user that ends after now - 48h or is in the snapshot."""
    rows = conn.execute(
        f"SELECT {BLOCK_COLUMNS} FROM app.blocks "  # noqa: S608 - a constant column list
        "WHERE user_id = %s AND (ends_at > %s OR id = ANY(%s)) ORDER BY starts_at, id",
        (user_id, now - BLOCK_LOOKBACK, [block.id for block in saved]),
    ).fetchall()
    return tuple(to_snapshot_block(to_block_row(row)) for row in rows)


def _sort_key(block: SnapshotBlock) -> tuple[dt.datetime, UUID]:
    return (block.interval.start, block.id)


def undo_version(conn: Conn, user_id: UUID, version_id: UUID, now: dt.datetime) -> UndoOutcome:
    """Undo the latest version that was not undone, as 7.6 step 6 describes."""
    lock_user(conn, user_id)
    version = latest_version(conn, user_id)
    if version is None:
        raise ApiError("nothing_to_undo")
    if version.id != version_id:
        raise ApiError("stale_plan")

    _undo_side_effect(conn, user_id, version, now)
    board = load_board(conn, user_id, now)
    try:
        saved = parse_snapshot(version.snapshot)
    except SnapshotError as error:
        logger.error("Plan version %s has an invalid snapshot: %s", version.id, error)
        raise ApiError("invalid_state") from error

    result = undo(saved, _current_blocks(conn, user_id, now, saved), now)
    # Only blocks of a todo task that is still in the plan come back (a done, deleted
    # or vanished task would fail the foreign key or plan what needs no time).
    todo = {task.id for task in board.tasks if task.status is TaskStatus.TODO}
    restore = [block for block in result.restore if block.task_id in todo]
    dropped = sorted(
        [*result.dropped, *(block for block in result.restore if block.task_id not in todo)],
        key=_sort_key,
    )

    if result.delete:
        conn.execute(
            "DELETE FROM app.blocks WHERE user_id = %s AND id = ANY(%s) AND status = 'planned'",
            (user_id, list(result.delete)),
        )
    if restore:
        with conn.cursor() as cursor:
            cursor.executemany(
                "INSERT INTO app.blocks (id, user_id, task_id, starts_at, ends_at, part_index, "
                "part_count, pinned) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                [
                    (
                        block.id,
                        user_id,
                        block.task_id,
                        block.interval.start,
                        block.interval.end,
                        block.part_index,
                        block.part_count,
                        block.pinned,
                    )
                    for block in restore
                ],
            )
    renumber(conn, user_id, now)

    replaced: list[UUID] = []
    unplaced: list[Unscheduled] = []
    for task_id in dict.fromkeys(block.task_id for block in dropped):
        if task_id not in todo:
            continue
        board = load_board(conn, user_id, now)
        placement = place_task(
            board.profile, board.exams, board.tasks, board.existing, task_id, now
        )
        if placement.unscheduled:
            unplaced.extend(placement.unscheduled)
            continue
        changes = _changes(board, placement)
        if changes:  # nothing to write when the task's live blocks already cover it
            _write_changes(conn, user_id, changes, None)
            replaced.append(task_id)

    conn.execute(
        "UPDATE app.plan_versions SET undone_at = now() WHERE user_id = %s AND id = %s",
        (user_id, version.id),
    )
    return UndoOutcome(
        restored=len(restore),
        deleted=len(result.delete),
        replaced=tuple(replaced),
        unplaced=tuple(unplaced),
    )
