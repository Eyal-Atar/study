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

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

from app.domain.planner import (
    BlockStatus,
    Interval,
    PlannedBlock,
    PlanResult,
    Profile,
    SnapshotBlock,
    SnapshotError,
    TaskStatus,
    Unscheduled,
    busy_intervals,
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
    BlockRow,
    Board,
    load_board,
    to_block_row,
    to_snapshot_block,
)
from app.services.profiles import Conn, lock_user

logger = logging.getLogger(__name__)

# The longest busy event (the CHECK of app.busy_events, migration 0014).
MAX_EVENT_LENGTH = dt.timedelta(days=14)


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
    BUSY_ADDED = "busy_added"
    BUSY_CHANGED = "busy_changed"
    FREE_TIME = "free_time"
    DEFER_AT = "defer_at"
    # S44: the user split a task they kept putting off; task_before holds its bite_minutes.
    TASK_SPLIT = "task_split"
    # S45: an exam closed done, closed to wait for Moed B, and a Moed B opened. Each keeps
    # the exam's fields it changed in exam_before, which undo puts back.
    EXAM_CLOSED = "exam_closed"
    EXAM_MOED_B = "exam_moed_b"
    MOED_B_OPENED = "moed_b_opened"


# The morning review's versions: block_id is the past block they marked missed or skipped,
# which undo sets back to planned (no snapshot holds it: it is over).
REVIEW_REASONS = frozenset({VersionReason.REVIEW_MOVED, VersionReason.REVIEW_SKIPPED})

# The versions that write pinned blocks of their own (S35): undo deletes those blocks, which
# would otherwise look like blocks the user pinned after the change (decision 12).
CREATES_PINNED = frozenset({VersionReason.FREE_TIME, VersionReason.DEFER_AT})


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
    # The event of a busy_added or busy_changed version, and (busy_changed) its fields before.
    busy_event_id: UUID | None = None
    busy_event_before: Any = None
    # The exam's fields before a closure or a Moed B opening (S45).
    exam_before: Any = None


# The fields a busy_changed version keeps in busy_event_before, as they were.
BUSY_EVENT_BEFORE_FIELDS = ("title", "starts_at", "ends_at")


# The exam fields a closure or Moed B version may keep in exam_before (S45): a closure keeps
# closure and closed_at, a Moed B opening keeps them all.
EXAM_BEFORE_FIELDS = (
    "exam_date",
    "sitting",
    "closure",
    "closed_at",
    "closure_notified_at",
    "first_exam_date",
    "first_grade",
    "moed_b_notes",
    "moed_b_topic_ids",
)

# The versions whose undo puts the exam's fields back from exam_before.
EXAM_BEFORE_REASONS = frozenset(
    {VersionReason.EXAM_CLOSED, VersionReason.EXAM_MOED_B, VersionReason.MOED_B_OPENED}
)


def _exam_json(value: Any) -> Any:
    if isinstance(value, dt.datetime):
        return value.astimezone(dt.UTC).isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, list | tuple):
        return [_exam_json(item) for item in value]
    return value


def exam_before(row: Mapping[str, Any], fields: Sequence[str]) -> dict[str, Any]:
    """The given fields of an exam row (EXAM_BEFORE_FIELDS or a subset) as JSON values.

    Dates and instants become ISO strings (instants in UTC, with their offset), UUIDs
    strings, so the result can be written as plan_versions.exam_before.
    """
    unknown = set(fields) - set(EXAM_BEFORE_FIELDS)
    if unknown:
        raise ValueError(f"Not exam_before fields: {sorted(unknown)}")
    return {field: _exam_json(row[field]) for field in fields}


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
    busy_event_id: UUID | None = None,
    busy_event_before: Mapping[str, Any] | None = None,
    exam_before: Mapping[str, Any] | None = None,
) -> UUID:
    row = conn.execute(
        "INSERT INTO app.plan_versions (user_id, reason, snapshot, exam_id, task_id, "
        "task_before, analysis_id, block_id, busy_event_id, busy_event_before, exam_before) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
        (
            user_id,
            reason.value,
            Jsonb(snapshot(board.snapshot_blocks, board.now)),
            exam_id,
            task_id,
            None if before is None else Jsonb(dict(before)),
            analysis_id,
            block_id,
            busy_event_id,
            None if busy_event_before is None else Jsonb(dict(busy_event_before)),
            None if exam_before is None else Jsonb(dict(exam_before)),
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
                "part_count, pinned, plan_version_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                [
                    (
                        user_id,
                        block.task_id,
                        block.interval.start,
                        block.interval.end,
                        block.part_index,
                        block.part_count,
                        block.pinned,
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
    busy_event_id: UUID | None = None,
    busy_event_before: Mapping[str, Any] | None = None,
    exam_before: Mapping[str, Any] | None = None,
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
        conn,
        user_id,
        board,
        reason,
        exam_id,
        task_id,
        before,
        analysis_id,
        block_id=block_id,
        busy_event_id=busy_event_id,
        busy_event_before=busy_event_before,
        exam_before=exam_before,
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
        busy_event_id=row["busy_event_id"],
        busy_event_before=row["busy_event_before"],
        exam_before=row["exam_before"],
    )


def latest_version(conn: Conn, user_id: UUID) -> VersionRow | None:
    """The newest version that was not undone."""
    row = conn.execute(
        "SELECT id, reason, created_at, exam_id, task_id, snapshot, task_before, analysis_id, "
        "block_id, busy_event_id, busy_event_before, exam_before FROM app.plan_versions "
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


def _check_no_bite_progress(
    conn: Conn, user_id: UUID, version: VersionRow, now: dt.datetime
) -> None:
    """Refuse to undo a split once the user studied the task since it (invalid_state).

    Progress is a block of the task completed after the split, or a block the split wrote
    that is running now. Completing writes no version, so the split can still be the latest
    one; undoing it would bring the old long block back on top of the bites already done,
    and the task would hold more minutes than it needs (review of S44).
    """
    row = conn.execute(
        """
        SELECT EXISTS (
            SELECT 1 FROM app.xp_events x
            JOIN app.blocks b ON b.id = x.block_id AND b.user_id = x.user_id
            WHERE x.user_id = %(user_id)s AND b.task_id = %(task_id)s
              AND x.created_at > %(created_at)s
        ) OR EXISTS (
            SELECT 1 FROM app.blocks b
            WHERE b.user_id = %(user_id)s AND b.task_id = %(task_id)s
              AND b.plan_version_id = %(version_id)s AND b.status IN ('planned', 'done')
              AND b.starts_at < %(now)s AND b.ends_at > %(now)s
        ) AS found
        """,
        {
            "user_id": user_id,
            "task_id": version.task_id,
            "created_at": version.created_at,
            "version_id": version.id,
            "now": now,
        },
    ).fetchone()
    if row is not None and row["found"]:
        raise ApiError("invalid_state")


def _restore_bite(conn: Conn, user_id: UUID, task_id: UUID, before: Any) -> None:
    """Put a split task's bite_minutes back (task_before of a task_split version).

    `before` must be exactly {"bite_minutes": null or an int 30-300}; anything else is
    invalid.
    """
    try:
        if not isinstance(before, Mapping) or set(before) != {"bite_minutes"}:
            raise ValueError("task_before must be exactly {bite_minutes}")
        bite = before["bite_minutes"]
        if bite is not None and (type(bite) is not int or not 30 <= bite <= 300):
            raise ValueError("bite_minutes must be null or an int 30-300")
    except ValueError as error:
        raise SnapshotError(f"invalid task_before: {error}") from error
    conn.execute(
        "UPDATE app.tasks SET bite_minutes = %s WHERE user_id = %s AND id = %s",
        (bite, user_id, task_id),
    )


def _parse_instant(value: Any) -> dt.datetime:
    """An aware ISO datetime on a whole minute, in UTC; anything else is a ValueError."""
    if not isinstance(value, str):
        raise TypeError("an instant must be an ISO string")
    instant = dt.datetime.fromisoformat(value)
    if instant.tzinfo is None or instant.utcoffset() is None:
        raise ValueError("an instant must carry its offset")
    if instant.second or instant.microsecond:
        raise ValueError("an instant must be a whole minute")
    return instant.astimezone(dt.UTC)


def _restore_event(conn: Conn, user_id: UUID, event_id: UUID, before: Any) -> None:
    """Put a moved busy event's time back (busy_event_before), if it is still live.

    `before` must hold exactly BUSY_EVENT_BEFORE_FIELDS: a title (a string or null) and two
    ISO instants that make a valid event; anything else is invalid.
    """
    try:
        if not isinstance(before, Mapping):
            raise TypeError("busy_event_before must be an object")
        if set(before) != set(BUSY_EVENT_BEFORE_FIELDS):
            raise ValueError(f"fields must be exactly {BUSY_EVENT_BEFORE_FIELDS}")
        title = before["title"]
        if title is not None and not isinstance(title, str):
            raise TypeError("title must be a string or null")
        starts_at = _parse_instant(before["starts_at"])
        ends_at = _parse_instant(before["ends_at"])
        if not starts_at < ends_at <= starts_at + MAX_EVENT_LENGTH:
            raise ValueError("starts_at..ends_at is not an event's time")
    except (KeyError, TypeError, ValueError) as error:
        raise SnapshotError(f"invalid busy_event_before: {error}") from error
    # Only the time comes back: a title edit writes no version, so a title changed after the
    # move is the user's latest word and stays (the saved title is still checked above).
    del title
    conn.execute(
        "UPDATE app.busy_events SET starts_at = %s, ends_at = %s "
        "WHERE user_id = %s AND id = %s AND deleted_at IS NULL",
        (starts_at, ends_at, user_id, event_id),
    )


def _parse_date(value: Any) -> dt.date:
    """A date as an ISO string (YYYY-MM-DD); anything else is a TypeError or ValueError."""
    if not isinstance(value, str) or len(value) != len("2026-11-16"):
        raise TypeError("a date must be an ISO string YYYY-MM-DD")
    return dt.date.fromisoformat(value)


def _parse_stamp(value: Any) -> dt.datetime | None:
    """Null, or an aware ISO datetime (any second), in UTC."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise TypeError("an instant must be an ISO string or null")
    instant = dt.datetime.fromisoformat(value)
    if instant.tzinfo is None or instant.utcoffset() is None:
        raise ValueError("an instant must carry its offset")
    return instant.astimezone(dt.UTC)


def _parse_int(value: Any, low: int, high: int) -> int:
    # bool is an int in Python, but true is no sitting or grade.
    if not isinstance(value, int) or isinstance(value, bool):
        raise TypeError("must be an integer")
    if not low <= value <= high:
        raise ValueError(f"must be between {low} and {high}")
    return value


def _parse_exam_field(field: str, value: Any) -> Any:
    if field == "exam_date":
        return _parse_date(value)
    if field == "first_exam_date":
        return None if value is None else _parse_date(value)
    if field == "sitting":
        return _parse_int(value, 1, 2)
    if field == "closure":
        if value is not None and value not in ("done", "moed_b"):
            raise ValueError("closure must be done, moed_b or null")
        return value
    if field in ("closed_at", "closure_notified_at"):
        return _parse_stamp(value)
    if field == "first_grade":
        return None if value is None else _parse_int(value, 0, 100)
    if field == "moed_b_notes":
        if value is not None and not isinstance(value, str):
            raise TypeError("moed_b_notes must be a string or null")
        return value
    if field == "moed_b_topic_ids":
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            raise TypeError("moed_b_topic_ids must be a list of UUID strings")
        return [UUID(item) for item in value]
    raise ValueError(f"unknown field {field!r}")


def _restore_exam(conn: Conn, user_id: UUID, exam_id: UUID, before: Any) -> None:
    """Put an exam's fields back from exam_before (S45), if the exam is still live.

    `before` holds a non-empty subset of EXAM_BEFORE_FIELDS, each in its JSON form; any
    other key, a malformed value, or values that break the exam's CHECKs together with the
    fields it does not hold, is invalid (SnapshotError, like _restore_event). One UPDATE
    sets them all, so the CHECKs see only the final row.
    """
    try:
        if not isinstance(before, Mapping):
            raise TypeError("exam_before must be an object")
        if not before or not set(before) <= set(EXAM_BEFORE_FIELDS):
            raise ValueError(f"fields must be a non-empty subset of {EXAM_BEFORE_FIELDS}")
        values = {field: _parse_exam_field(field, before[field]) for field in before}
    except (KeyError, TypeError, ValueError) as error:
        raise SnapshotError(f"invalid exam_before: {error}") from error
    fields = [field for field in EXAM_BEFORE_FIELDS if field in values]
    assignments = sql.SQL(", ").join(
        sql.SQL("{} = {}").format(sql.Identifier(field), sql.Placeholder()) for field in fields
    )
    try:
        # A savepoint, so a CHECK that fails leaves the transaction usable for the 409.
        with conn.transaction():
            conn.execute(
                sql.SQL(
                    "UPDATE app.exams SET {} WHERE user_id = %s AND id = %s AND deleted_at IS NULL"
                ).format(assignments),
                [*(values[field] for field in fields), user_id, exam_id],
            )
    except psycopg.errors.CheckViolation as error:
        raise SnapshotError(f"exam_before breaks the exam's checks: {error}") from error


def _check_no_moed_b_progress(conn: Conn, user_id: UUID, exam_id: UUID, now: dt.datetime) -> None:
    """Refuse to undo a Moed B opening once a task of the second sitting has progress.

    Progress as in _check_no_progress: a task that is not todo, a done block, or a planned
    block running now. Undoing would delete that work (plan S45, decision 7).
    """
    row = conn.execute(
        """
        SELECT EXISTS (
            SELECT 1 FROM app.tasks AS t
            WHERE t.user_id = %(user_id)s
              AND t.exam_id = %(exam_id)s
              AND t.sitting = 2
              AND t.deleted_at IS NULL
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
        {"user_id": user_id, "exam_id": exam_id, "now": now},
    ).fetchone()
    if row is not None and row["found"]:
        raise ApiError("invalid_state")


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

    A busy_added version deletes its event (soft, if still live); a busy_changed version puts
    the event's title and time back from busy_event_before. Both run before undo_version
    loads the board, so the restored blocks are checked against the event as it is after.

    A task_split version puts the task's bite_minutes back (task_before), before the board
    is loaded, so a task the undo places again is placed as it was before the split. It is
    refused (invalid_state, nothing written) once the task was studied since the split.

    A review version sets its past block back to planned if it is still missed or skipped
    (one marked done since stays done), so it returns to the review; a review_skipped
    version also puts the task's status back (task_before).

    An exam_closed or exam_moed_b version puts the exam's closure back from exam_before
    (S45). A moed_b_opened version is refused (invalid_state) once a task of the second
    sitting has progress; otherwise it deletes (soft) the second sitting's live tasks and
    puts the exam back from exam_before (sitting 1, its first date, waiting for Moed B).
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
    if version.reason == VersionReason.TASK_SPLIT and version.task_id is not None:
        _check_no_bite_progress(conn, user_id, version, now)
        _restore_bite(conn, user_id, version.task_id, version.task_before)
        return
    if version.reason in EXAM_BEFORE_REASONS:
        if version.exam_id is None or version.exam_before is None:
            return
        if version.reason == VersionReason.MOED_B_OPENED:
            _check_no_moed_b_progress(conn, user_id, version.exam_id, now)
            conn.execute(
                "UPDATE app.tasks SET deleted_at = %s "
                "WHERE user_id = %s AND exam_id = %s AND sitting = 2 AND deleted_at IS NULL",
                (now, user_id, version.exam_id),
            )
        _restore_exam(conn, user_id, version.exam_id, version.exam_before)
        return
    if version.reason == VersionReason.BUSY_ADDED and version.busy_event_id is not None:
        conn.execute(
            "UPDATE app.busy_events SET deleted_at = %s "
            "WHERE user_id = %s AND id = %s AND deleted_at IS NULL",
            (now, user_id, version.busy_event_id),
        )
    elif (
        version.reason == VersionReason.BUSY_CHANGED
        and version.busy_event_id is not None
        and version.busy_event_before is not None
    ):
        _restore_event(conn, user_id, version.busy_event_id, version.busy_event_before)
    elif version.reason == VersionReason.EXAM_DELETED and version.exam_id is not None:
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
) -> tuple[BlockRow, ...]:
    """Every block of the user that ends after now - 48h or is in the snapshot."""
    rows = conn.execute(
        f"SELECT {BLOCK_COLUMNS} FROM app.blocks "  # noqa: S608 - a constant column list
        "WHERE user_id = %s AND (ends_at > %s OR id = ANY(%s)) ORDER BY starts_at, id",
        (user_id, now - BLOCK_LOOKBACK, [block.id for block in saved]),
    ).fetchall()
    return tuple(to_block_row(row) for row in rows)


def _created_by(
    version: VersionRow,
    rows: Sequence[BlockRow],
    saved: Sequence[SnapshotBlock],
    now: dt.datetime,
) -> tuple[UUID, ...]:
    """The blocks a version that creates pinned blocks wrote itself, still planned and not
    over, also once started (plan decision 12); nothing for any other version.

    write_changes also stamps the version on the task's older blocks it only renumbered;
    those are in the snapshot, so they are not the version's own (review of S35).
    """
    if version.reason not in CREATES_PINNED:
        return ()
    start = start_minute(now)
    before = {block.id for block in saved}
    return tuple(
        row.id
        for row in rows
        if row.plan_version_id == version.id
        and row.id not in before
        and row.status is BlockStatus.PLANNED
        and row.ends_at > start
    )


def _on_restored_event(
    conn: Conn,
    user_id: UUID,
    version: VersionRow,
    rows: Sequence[BlockRow],
    deleted: Collection[UUID],
    now: dt.datetime,
) -> list[BlockRow]:
    """The planned blocks that stay but now sit on the event a busy_changed undo put back.

    A block moved into the time the event had freed (a move writes no version, so the event's
    undo is still the latest) would otherwise stay on busy time. Like adding an event, the
    undo releases it, pinned or running too, and its task is placed again (review of S35).
    """
    if version.reason != VersionReason.BUSY_CHANGED or version.busy_event_id is None:
        return []
    event = conn.execute(
        "SELECT starts_at, ends_at FROM app.busy_events "
        "WHERE user_id = %s AND id = %s AND deleted_at IS NULL",
        (user_id, version.busy_event_id),
    ).fetchone()
    if event is None:
        return []
    starts_at, ends_at = event["starts_at"], event["ends_at"]
    start = start_minute(now)
    return [
        row
        for row in rows
        if row.status is BlockStatus.PLANNED
        and row.ends_at > start
        and row.id not in deleted
        and row.starts_at < ends_at
        and starts_at < row.ends_at
    ]


def _on_busy_time(profile: Profile, blocks: Sequence[SnapshotBlock]) -> list[SnapshotBlock]:
    """The blocks that overlap a commitment or a busy event of the profile (decision 13)."""
    if not blocks:
        return []
    busy = busy_intervals(
        profile,
        min(block.interval.start for block in blocks),
        max(block.interval.end for block in blocks),
    )
    return [
        block
        for block in blocks
        if any(block.interval.start < span.end and span.start < block.interval.end for span in busy)
    ]


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

    rows = _current_blocks(conn, user_id, now, saved)
    current = tuple(to_snapshot_block(row) for row in rows)
    result = undo(saved, current, now, created=_created_by(version, rows, saved, now))
    on_event = _on_restored_event(conn, user_id, version, rows, result.delete, now)
    on_event_ids = {row.id for row in on_event}
    # Only blocks of a todo task that is still in the plan come back (a done, deleted
    # or vanished task would fail the foreign key or plan what needs no time).
    todo = {task.id for task in board.tasks if task.status is TaskStatus.TODO}
    # A block that would come back onto taken time (a commitment or event added since) is
    # not restored: its task is placed again instead (decision 13).
    on_busy = _on_busy_time(
        board.profile, [block for block in result.restore if block.task_id in todo]
    )
    restore = [block for block in result.restore if block.task_id in todo and block not in on_busy]
    # A saved block that is still there unchanged (it has only started since) is where
    # it was: its task needs no new place for it.
    present = {_identity(block) for block in current}
    dropped = sorted(
        [
            *(block for block in result.dropped if _identity(block) not in present),
            *(block for block in result.restore if block.task_id not in todo),
            *on_busy,
            *(to_snapshot_block(row) for row in on_event),
        ],
        key=_sort_key,
    )

    delete_planned(conn, user_id, [*result.delete, *on_event_ids])
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
