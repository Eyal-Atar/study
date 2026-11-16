"""The one place that writes planner results and plan versions, and undoes a version.

Every change to the board goes through `apply_result` (a planner result),
`delete_open_blocks` (blocks of tasks that left the plan), or `apply_analysis` in
app/services/analyses.py (a reanalysis, built from `create_version` and `write_changes`).
Each saves the board as it was before the change (a snapshot of the future planned
blocks) in plan_versions, so `undo_version` can bring it back. A `task_changed` version
also keeps the task's editable fields that the change touched, as they were
(`task_before`), so undo puts them back too.
"""

import datetime as dt
import logging
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any
from uuid import UUID

from psycopg import sql
from psycopg.types.json import Jsonb

from app.domain.planner import (
    BlockStatus,
    Interval,
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
    PLAN_GENERATED = "plan_generated"
    EXAM_REANALYZED = "exam_reanalyzed"
    REVIEW_MOVED = "review_moved"
    REVIEW_SKIPPED = "review_skipped"


# The morning review's versions: block_id is the past block they marked missed or skipped,
# which undo sets back to planned (no snapshot holds it: it is over).
REVIEW_REASONS = frozenset({VersionReason.REVIEW_MOVED, VersionReason.REVIEW_SKIPPED})


@dataclass(frozen=True)
class VersionRow:
    id: UUID
    reason: str
    created_at: dt.datetime
    exam_id: UUID | None
    task_id: UUID | None
    snapshot: Any
    task_before: Any = None
    analysis_id: UUID | None = None
    block_id: UUID | None = None


# The task fields a task_changed version keeps, as they were before the change.
TASK_BEFORE_FIELDS = (
    "title",
    "kind",
    "estimated_minutes",
    "focus",
    "depends_on_task_id",
    "status",
)


def _json_value(field: str, value: Any) -> Any:
    if field == "depends_on_task_id" and value is not None:
        return str(value)
    return value


def task_before(row: Mapping[str, Any], after: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """The fields of a task row that a task_changed version keeps, as JSON values.

    With `after` (the row once changed), only the fields whose value changed are kept, so
    undo puts back what this change did and leaves later edits (a new title, a status the
    user set since) as they are.
    """
    fields = [field for field in TASK_BEFORE_FIELDS if after is None or row[field] != after[field]]
    return {field: _json_value(field, row[field]) for field in fields}


@dataclass(frozen=True)
class UndoOutcome:
    restored: int
    deleted: int
    replaced: tuple[UUID, ...]
    unplaced: tuple[Unscheduled, ...]


@dataclass(frozen=True)
class Changes:
    """What a planner result changes on the board it was computed from."""

    removed: tuple[UUID, ...]
    added: tuple[PlannedBlock, ...]
    renumbered: tuple[PlannedBlock, ...]

    def __bool__(self) -> bool:
        return bool(self.removed or self.added or self.renumbered)


def changes(board: Board, result: PlanResult) -> Changes:
    rows = {block.id: block for block in board.blocks}
    renumbered: list[PlannedBlock] = []
    for block in result.blocks:
        if block.block_id is None:
            continue
        row = rows[block.block_id]
        if (row.part_index, row.part_count) != (block.part_index, block.part_count):
            renumbered.append(block)
    return Changes(
        removed=result.removed,
        added=tuple(block for block in result.blocks if block.block_id is None),
        renumbered=tuple(renumbered),
    )


def has_changes(board: Board, result: PlanResult) -> bool:
    """Whether apply_result would write anything for this result."""
    return bool(changes(board, result))


def create_version(
    conn: Conn,
    user_id: UUID,
    board: Board,
    reason: VersionReason,
    exam_id: UUID | None,
    task_id: UUID | None,
    before: Mapping[str, Any] | None,
    analysis_id: UUID | None = None,
    *,
    block_id: UUID | None = None,
) -> UUID:
    row = conn.execute(
        "INSERT INTO app.plan_versions (user_id, reason, snapshot, exam_id, task_id, "
        "task_before, analysis_id, block_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s) "
        "RETURNING id",
        (
            user_id,
            reason.value,
            Jsonb(snapshot(board.snapshot_blocks, board.now)),
            exam_id,
            task_id,
            None if before is None else Jsonb(dict(before)),
            analysis_id,
            block_id,
        ),
    ).fetchone()
    if row is None:
        raise RuntimeError("the new plan version is not visible to this user")
    version_id: UUID = row["id"]
    return version_id


def delete_planned(conn: Conn, user_id: UUID, ids: Collection[UUID]) -> None:
    """Delete the user's blocks with these ids that are still planned."""
    if ids:
        conn.execute(
            "DELETE FROM app.blocks WHERE user_id = %s AND id = ANY(%s) AND status = 'planned'",
            (user_id, list(ids)),
        )


def write_changes(conn: Conn, user_id: UUID, diff: Changes, version_id: UUID | None) -> None:
    """Delete, insert and renumber; written blocks get version_id (None keeps theirs)."""
    delete_planned(conn, user_id, diff.removed)
    with conn.cursor() as cursor:
        if diff.added:
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
                    for block in diff.added
                ],
            )
        if diff.renumbered:
            cursor.executemany(
                "UPDATE app.blocks SET part_index = %s, part_count = %s, "
                "plan_version_id = coalesce(%s::uuid, plan_version_id) "
                "WHERE user_id = %s AND id = %s",
                [
                    (block.part_index, block.part_count, version_id, user_id, block.block_id)
                    for block in diff.renumbered
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
    before: Mapping[str, Any] | None = None,
    analysis_id: UUID | None = None,
    block_id: UUID | None = None,
    always_version: bool = False,
) -> UUID | None:
    """Write a planner result computed from `board`, with a version; None if it changes nothing.

    `before` is the changed task's fields as they were (task_before), for a task_changed
    version; `analysis_id` is the analysis an exam_reanalyzed version applied; `block_id`
    is the past block a review version marked. With `always_version` the version is
    written even when the result changes nothing (a review must be undoable anyway).

    The caller holds the user lock: `board` was loaded with load_board(lock=True) in this
    same transaction, so nothing changed between the board and this write.
    """
    diff = changes(board, result)
    if not diff and not always_version:
        return None
    version_id = create_version(
        conn, user_id, board, reason, exam_id, task_id, before, analysis_id, block_id=block_id
    )
    write_changes(conn, user_id, diff, version_id)
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
    before: Mapping[str, Any] | None = None,
    block_id: UUID | None = None,
    always_version: bool = False,
) -> UUID | None:
    """Delete the tasks' planned blocks that have not started (pinned too), with a version.

    The version is written when blocks are deleted, or always with `always_version` (a
    delete of an exam or task, which undo must bring back even when it had no blocks).
    The caller holds the user lock: `board` was loaded with load_board(lock=True) in this
    same transaction, so its blocks are the ones in the database.
    """
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
    if open_ids or always_version:
        version_id = create_version(
            conn, user_id, board, reason, exam_id, task_id, before, block_id=block_id
        )
        delete_planned(conn, user_id, open_ids)
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
        task_before=row["task_before"],
        analysis_id=row["analysis_id"],
        block_id=row["block_id"],
    )


def latest_version(conn: Conn, user_id: UUID) -> VersionRow | None:
    """The newest version that was not undone."""
    row = conn.execute(
        "SELECT id, reason, created_at, exam_id, task_id, snapshot, task_before, analysis_id, "
        "block_id FROM app.plan_versions "
        "WHERE user_id = %s AND undone_at IS NULL "
        "ORDER BY created_at DESC, id DESC LIMIT 1",
        (user_id,),
    ).fetchone()
    return None if row is None else _version_row(row)


def _restorable_dependency(conn: Conn, user_id: UUID, task_id: UUID, target: object) -> UUID | None:
    """The saved dependency if its task is still live and it would make no cycle, else None."""
    if target is None:
        return None
    current: UUID | None = UUID(str(target))
    dependency = current
    seen: set[UUID] = set()
    while current is not None and current not in seen:
        if current == task_id:
            return None
        seen.add(current)
        row = conn.execute(
            "SELECT depends_on_task_id FROM app.tasks "
            "WHERE user_id = %s AND id = %s AND deleted_at IS NULL",
            (user_id, current),
        ).fetchone()
        if row is None:
            return None if current == dependency else dependency
        current = row["depends_on_task_id"]
    return dependency


def _restore_task(conn: Conn, user_id: UUID, task_id: UUID, before: Any) -> None:
    """Put a changed task's saved fields back as they were, if the task is still live.

    `before` holds only the fields the change touched (a version written before S14 holds
    all of TASK_BEFORE_FIELDS); any other key, or no key at all, is invalid.
    """
    try:
        if not isinstance(before, Mapping):
            raise TypeError("task_before must be an object")
        values = dict(before)
        if not values or not set(values) <= set(TASK_BEFORE_FIELDS):
            raise ValueError(f"fields must be a non-empty subset of {TASK_BEFORE_FIELDS}")
        if "depends_on_task_id" in values:
            values["depends_on_task_id"] = _restorable_dependency(
                conn, user_id, task_id, values["depends_on_task_id"]
            )
    except (KeyError, TypeError, ValueError) as error:
        raise SnapshotError(f"invalid task_before: {error}") from error
    fields = [field for field in TASK_BEFORE_FIELDS if field in values]
    assignments = sql.SQL(", ").join(
        sql.SQL("{} = {}").format(sql.Identifier(field), sql.Placeholder()) for field in fields
    )
    conn.execute(
        sql.SQL(
            "UPDATE app.tasks SET {} WHERE user_id = %s AND id = %s AND deleted_at IS NULL"
        ).format(assignments),
        [*(values[field] for field in fields), user_id, task_id],
    )


def _check_no_progress(conn: Conn, user_id: UUID, analysis_id: UUID, now: dt.datetime) -> None:
    """Refuse to undo an analysis once any of its tasks has progress (invalid_state).

    Progress is a task that is not todo, a done block, or a planned block that has started
    (starts_at < now < ends_at: the user is studying it). Completing a block writes no
    version, so the reanalysis can still be the latest version after the user studied one
    of its tasks; undoing it would delete that work.
    """
    row = conn.execute(
        """
        SELECT EXISTS (
            SELECT 1 FROM app.tasks AS t
            WHERE t.user_id = %(user_id)s
              AND t.analysis_id = %(analysis_id)s
              AND (
                  t.status <> 'todo'
                  OR EXISTS (
                      SELECT 1 FROM app.blocks AS b
                      WHERE b.user_id = %(user_id)s
                        AND b.task_id = t.id
                        AND (
                            b.status = 'done'
                            OR (
                                b.status = 'planned'
                                AND b.starts_at < %(now)s
                                AND b.ends_at > %(now)s
                            )
                        )
                  )
              )
        ) AS found
        """,
        {"user_id": user_id, "analysis_id": analysis_id, "now": now},
    ).fetchone()
    if row is not None and row["found"]:
        raise ApiError("invalid_state")


def _undo_side_effect(conn: Conn, user_id: UUID, version: VersionRow, now: dt.datetime) -> None:
    """Bring back a deleted exam or task or a changed task's fields, or delete an added task.

    An exam_reanalyzed version deletes the tasks its analysis added and the topics it wrote,
    brings back the tasks it replaced, and marks the analysis undone (it does not become a
    draft again). It is refused (invalid_state, nothing written) once any task of the
    analysis has progress (see _check_no_progress).

    A review version sets its past block back to planned if it is still missed or skipped
    (one marked done since stays done), so it returns to the review; a review_skipped
    version also puts the task's status back (task_before).
    """
    if version.reason in REVIEW_REASONS:
        if version.block_id is not None:
            conn.execute(
                "UPDATE app.blocks SET status = 'planned' "
                "WHERE user_id = %s AND id = %s AND status IN ('missed', 'skipped')",
                (user_id, version.block_id),
            )
        if (
            version.reason == VersionReason.REVIEW_SKIPPED
            and version.task_id is not None
            and version.task_before is not None
        ):
            _restore_task(conn, user_id, version.task_id, version.task_before)
        return
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
    elif (
        version.reason == VersionReason.TASK_CHANGED
        and version.task_id is not None
        and version.task_before is not None
    ):
        _restore_task(conn, user_id, version.task_id, version.task_before)
    elif version.reason == VersionReason.EXAM_REANALYZED and version.analysis_id is not None:
        _check_no_progress(conn, user_id, version.analysis_id, now)
        conn.execute(
            "UPDATE app.tasks SET deleted_at = %s "
            "WHERE user_id = %s AND analysis_id = %s AND deleted_at IS NULL",
            (now, user_id, version.analysis_id),
        )
        # Only the analysis's own (now deleted) tasks point at its topics; older topics stay.
        conn.execute(
            "DELETE FROM app.topics WHERE user_id = %s AND analysis_id = %s",
            (user_id, version.analysis_id),
        )
        conn.execute(
            "UPDATE app.tasks SET deleted_at = NULL "
            "WHERE user_id = %s AND id = ANY("
            "SELECT unnest(replaced_task_ids) FROM app.analyses WHERE user_id = %s AND id = %s)",
            (user_id, user_id, version.analysis_id),
        )
        conn.execute(
            "UPDATE app.analyses SET status = 'undone', undone_at = %s "
            "WHERE user_id = %s AND id = %s",
            (now, user_id, version.analysis_id),
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


def _identity(block: SnapshotBlock) -> tuple[UUID, UUID, Interval, BlockStatus]:
    return (block.id, block.task_id, block.interval, block.status)


def undo_version(conn: Conn, user_id: UUID, version_id: UUID, now: dt.datetime) -> UndoOutcome:
    """Undo the latest version that was not undone, as 7.6 step 6 describes."""
    lock_user(conn, user_id)
    version = latest_version(conn, user_id)
    if version is None:
        raise ApiError("nothing_to_undo")
    if version.id != version_id:
        raise ApiError("stale_plan")

    try:
        _undo_side_effect(conn, user_id, version, now)
        saved = parse_snapshot(version.snapshot)
    except SnapshotError as error:
        logger.error("Plan version %s has an invalid snapshot: %s", version.id, error)
        raise ApiError("invalid_state") from error
    board = load_board(conn, user_id, now)

    current = _current_blocks(conn, user_id, now, saved)
    result = undo(saved, current, now)
    # Only blocks of a todo task that is still in the plan come back (a done, deleted
    # or vanished task would fail the foreign key or plan what needs no time).
    todo = {task.id for task in board.tasks if task.status is TaskStatus.TODO}
    restore = [block for block in result.restore if block.task_id in todo]
    # A saved block that is still there unchanged (it has only started since) is where
    # it was: its task needs no new place for it.
    present = {_identity(block) for block in current}
    dropped = sorted(
        [
            *(block for block in result.dropped if _identity(block) not in present),
            *(block for block in result.restore if block.task_id not in todo),
        ],
        key=_sort_key,
    )

    delete_planned(conn, user_id, result.delete)
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
        diff = changes(board, placement)
        if diff:  # nothing to write when the task's live blocks already cover it
            write_changes(conn, user_id, diff, None)
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
