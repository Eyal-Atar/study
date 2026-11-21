"""Exam closure (S45): the closures waiting for a decision, and closing an exam.

An exam's state is derived (app/domain/closure.py): only the decision (`exams.closure`) is
stored. Closing writes one plan version (exam_closed or exam_moed_b) holding the board as it
was and the exam's closure before (exam_before), deletes the exam's open blocks, and replans
the board without the exam, so the other exams get the time it freed. POST /plan/undo with
the version puts it all back in one step.
"""

import datetime as dt
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final
from uuid import UUID

from app.domain.closure import (
    ExamState,
    Outcome,
    closure_opens_at,
    closure_options,
    exam_state,
)
from app.domain.planner import (
    BlockStatus,
    ExamShortfall,
    PlannedBlock,
    Unscheduled,
    replan,
    start_minute,
)
from app.domain.time import local_date
from app.errors import ApiError
from app.services.board import load_board
from app.services.exam_stats import EMPTY, exam_stats
from app.services.plan_views import BlockView, blocks_by_id
from app.services.plan_writes import (
    VersionReason,
    changes,
    create_version,
    delete_planned,
    exam_before,
    renumber,
    write_changes,
)
from app.services.profiles import Conn, ensure_profile, to_planner_profile
from app.services.topics import current_topic_rows

type Row = Mapping[str, Any]

_EXAM_COLUMNS: Final = (
    "id, name, exam_date, difficulty, color_index, sitting, closure, closed_at, created_at"
)
# What a closure changes on the exam, and so what its version keeps to undo it.
_CLOSURE_FIELDS: Final = ("closure", "closed_at")


@dataclass(frozen=True)
class TopicItem:
    id: UUID
    name: str


@dataclass(frozen=True)
class ClosureItem:
    exam_id: UUID
    exam_name: str
    exam_date: dt.date
    color_index: int
    sitting: int
    state: ExamState
    options: tuple[Outcome, ...]
    opens_at: dt.datetime
    studied_minutes: int
    tasks_done: int
    tasks_total: int
    completion_percent: int
    topics: tuple[TopicItem, ...]


@dataclass(frozen=True)
class ClosureLists:
    pending: tuple[ClosureItem, ...]
    waiting: tuple[ClosureItem, ...]


@dataclass(frozen=True)
class ClosedExam:
    id: UUID
    name: str
    exam_date: dt.date
    difficulty: int
    color_index: int
    sitting: int
    state: ExamState
    closed_at: dt.datetime | None


@dataclass(frozen=True)
class BloomEvent:
    exam_id: UUID
    exam_name: str
    color_index: int
    kind: str = "course_bloomed"


@dataclass(frozen=True)
class CloseOutcome:
    exam: ClosedExam
    version_id: UUID
    event: BloomEvent | None
    added: tuple[PlannedBlock, ...]
    removed: tuple[BlockView, ...]
    unscheduled: tuple[Unscheduled, ...]
    shortfalls: tuple[ExamShortfall, ...]


def _topics(conn: Conn, user_id: UUID, exam_ids: Sequence[UUID]) -> dict[UUID, list[TopicItem]]:
    topics: dict[UUID, list[TopicItem]] = {}
    for row in current_topic_rows(conn, user_id, exam_ids, "tp.id, tp.exam_id, tp.name"):
        topics.setdefault(row["exam_id"], []).append(TopicItem(id=row["id"], name=row["name"]))
    return topics


def list_closures(conn: Conn, user_id: UUID, now: dt.datetime) -> ClosureLists:
    """The exams whose closure is open (pending) and those waiting for Moed B, with the
    numbers and topics the closure sheet shows, by exam date."""
    tz = to_planner_profile(ensure_profile(conn, user_id)).timezone
    today = local_date(now, tz)
    rows = conn.execute(
        f"SELECT {_EXAM_COLUMNS} FROM app.exams "  # noqa: S608 - a constant column list
        "WHERE user_id = %s AND deleted_at IS NULL "
        "AND ((closure IS NULL AND exam_date <= %s) OR closure = 'moed_b') "
        "ORDER BY exam_date, created_at, id",
        (user_id, today),
    ).fetchall()
    states = {row["id"]: exam_state(row["exam_date"], row["closure"], now, tz) for row in rows}
    rows = [
        row for row in rows if states[row["id"]] in (ExamState.PENDING, ExamState.WAITING_MOED_B)
    ]
    ids = [row["id"] for row in rows]
    stats = exam_stats(conn, user_id, ids)
    topics = _topics(conn, user_id, ids)
    items = [
        ClosureItem(
            exam_id=row["id"],
            exam_name=row["name"],
            exam_date=row["exam_date"],
            color_index=row["color_index"],
            sitting=row["sitting"],
            state=states[row["id"]],
            options=closure_options(states[row["id"]], row["sitting"]),
            opens_at=closure_opens_at(row["exam_date"], tz),
            studied_minutes=stats.get(row["id"], EMPTY).studied_minutes,
            tasks_done=stats.get(row["id"], EMPTY).tasks_done,
            tasks_total=stats.get(row["id"], EMPTY).tasks_total,
            completion_percent=stats.get(row["id"], EMPTY).completion_percent,
            topics=tuple(topics.get(row["id"], ())),
        )
        for row in rows
    ]
    return ClosureLists(
        pending=tuple(item for item in items if item.state is ExamState.PENDING),
        waiting=tuple(item for item in items if item.state is ExamState.WAITING_MOED_B),
    )


def _live_exam(conn: Conn, user_id: UUID, exam_id: UUID) -> Row:
    row = conn.execute(
        f"SELECT {_EXAM_COLUMNS} FROM app.exams "  # noqa: S608 - a constant column list
        "WHERE user_id = %s AND id = %s AND deleted_at IS NULL",
        (user_id, exam_id),
    ).fetchone()
    if row is None:
        raise ApiError("not_found")
    return row


def close_exam(
    conn: Conn, user_id: UUID, now: dt.datetime, exam_id: UUID, outcome: Outcome
) -> CloseOutcome:
    """Close a pending exam done or to wait for Moed B, or a waiting one done (else
    invalid_state), freeing its time for the other exams, in one undoable version."""
    board = load_board(conn, user_id, now, lock=True)
    tz = board.profile.timezone
    row = _live_exam(conn, user_id, exam_id)
    state = exam_state(row["exam_date"], row["closure"], now, tz)
    if outcome not in closure_options(state, row["sitting"]):
        raise ApiError("invalid_state")

    # Always a version, also when the board does not change: it carries the closure itself.
    version_id = create_version(
        conn,
        user_id,
        board,
        VersionReason.EXAM_CLOSED if outcome is Outcome.DONE else VersionReason.EXAM_MOED_B,
        exam_id,
        None,
        None,
        exam_before=exam_before(row, _CLOSURE_FIELDS),
    )
    conn.execute(
        "UPDATE app.exams SET closure = %s, closed_at = %s WHERE user_id = %s AND id = %s",
        (outcome.value, now, user_id, exam_id),
    )

    # The open blocks of every live task of the exam, of any sitting. board.tasks may not
    # hold them (an exam waiting for Moed B is already off the board), so ask the tasks.
    task_ids = {
        task["id"]
        for task in conn.execute(
            "SELECT id FROM app.tasks WHERE user_id = %s AND exam_id = %s AND deleted_at IS NULL",
            (user_id, exam_id),
        ).fetchall()
    }
    start = start_minute(now)
    open_ids = [
        block.id
        for block in board.blocks
        if block.task_id in task_ids
        and block.status is BlockStatus.PLANNED
        and block.starts_at >= start
    ]
    # Read before they are deleted.
    removed_own = blocks_by_id(conn, user_id, open_ids, board.profile, now)
    delete_planned(conn, user_id, open_ids)

    # The board without the exam: the other exams can take the time it freed.
    after = load_board(conn, user_id, now)
    result = replan(after.profile, after.exams, after.tasks, after.existing, now)
    removed_replan = blocks_by_id(conn, user_id, result.removed, after.profile, now)
    write_changes(conn, user_id, changes(after, result), version_id)
    renumber(conn, user_id, now)

    closed = _live_exam(conn, user_id, exam_id)
    exam = ClosedExam(
        id=closed["id"],
        name=closed["name"],
        exam_date=closed["exam_date"],
        difficulty=closed["difficulty"],
        color_index=closed["color_index"],
        sitting=closed["sitting"],
        state=exam_state(closed["exam_date"], closed["closure"], now, tz),
        closed_at=None if closed["closed_at"] is None else closed["closed_at"].astimezone(dt.UTC),
    )
    event = (
        BloomEvent(exam_id=exam.id, exam_name=exam.name, color_index=exam.color_index)
        if outcome is Outcome.DONE
        else None
    )
    removed = tuple(
        sorted([*removed_own, *removed_replan], key=lambda view: (view.starts_at, view.id))
    )
    return CloseOutcome(
        exam=exam,
        version_id=version_id,
        event=event,
        added=tuple(block for block in result.blocks if block.block_id is None),
        removed=removed,
        unscheduled=result.unscheduled,
        shortfalls=result.shortfalls,
    )
