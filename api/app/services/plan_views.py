"""Reading the plan: blocks by study day, what is not placed, and what can be undone.

Nothing here writes to the board or runs the planner.
"""

import datetime as dt
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from typing import Any, Final
from uuid import UUID

from app.domain.planner import (
    BlockStatus,
    Profile,
    TaskKind,
    TaskStatus,
    is_complete,
    start_minute,
    study_date,
)
from app.errors import ApiError
from app.services.board import BLOCK_COLUMNS, BlockRow, load_board, to_block_row
from app.services.plan_writes import VersionRow, latest_version
from app.services.profiles import Conn, ensure_profile, to_planner_profile

MAX_RANGE_DAYS: Final = 62
DEFAULT_RANGE_DAYS: Final = 7
# A study day starts at most a day before or after its local date (a wake-up after
# midnight, a sleep time after midnight), so a margin of two days catches every block.
_QUERY_MARGIN: Final = dt.timedelta(days=2)

_BLOCK_QUERY: Final = (
    "SELECT "
    + ", ".join(f"b.{column.strip()}" for column in BLOCK_COLUMNS.split(","))
    + ", t.exam_id, t.title AS task_title, t.kind AS task_kind, e.name AS exam_name "
    "FROM app.blocks b "
    "JOIN app.tasks t ON t.id = b.task_id AND t.user_id = b.user_id "
    "JOIN app.exams e ON e.id = t.exam_id AND e.user_id = t.user_id "
    "WHERE b.user_id = %s "
)


@dataclass(frozen=True)
class BlockView:
    id: UUID
    task_id: UUID
    exam_id: UUID
    task_title: str
    task_kind: TaskKind
    exam_name: str
    starts_at: dt.datetime
    ends_at: dt.datetime
    study_date: dt.date
    part_index: int
    part_count: int
    pinned: bool
    status: BlockStatus
    state: str


@dataclass(frozen=True)
class UnplacedTask:
    task_id: UUID
    exam_id: UUID
    title: str
    minutes: int


@dataclass(frozen=True)
class PlanView:
    from_date: dt.date
    to_date: dt.date
    blocks: tuple[BlockView, ...]
    unplaced: tuple[UnplacedTask, ...]
    undo: VersionRow | None


@dataclass(frozen=True)
class TodayView:
    date: dt.date
    blocks: tuple[BlockView, ...]
    planned_minutes: int
    done_minutes: int


def block_state(row: BlockRow, now: dt.datetime) -> str:
    """done, missed or skipped by status; a planned block is overdue, in_progress or upcoming."""
    if row.status is not BlockStatus.PLANNED:
        return row.status.value
    if row.ends_at <= now:
        return "overdue"
    if row.starts_at <= now:
        return "in_progress"
    return "upcoming"


def _view(row: Mapping[str, Any], profile: Profile, now: dt.datetime) -> BlockView:
    block = to_block_row(row)
    return BlockView(
        id=block.id,
        task_id=block.task_id,
        exam_id=row["exam_id"],
        task_title=row["task_title"],
        task_kind=TaskKind(row["task_kind"]),
        exam_name=row["exam_name"],
        starts_at=block.starts_at,
        ends_at=block.ends_at,
        study_date=study_date(profile, block.starts_at),
        part_index=block.part_index,
        part_count=block.part_count,
        pinned=block.pinned,
        status=block.status,
        state=block_state(block, now),
    )


def blocks_by_id(
    conn: Conn, user_id: UUID, ids: Collection[UUID], profile: Profile, now: dt.datetime
) -> tuple[BlockView, ...]:
    """The given blocks, deleted tasks and exams included, by (starts_at, id)."""
    if not ids:
        return ()
    rows = conn.execute(
        _BLOCK_QUERY + "AND b.id = ANY(%s) ORDER BY b.starts_at, b.id",
        (user_id, list(ids)),
    ).fetchall()
    return tuple(_view(row, profile, now) for row in rows)


def _blocks_in_days(
    conn: Conn,
    user_id: UUID,
    profile: Profile,
    now: dt.datetime,
    first: dt.date,
    last: dt.date,
) -> tuple[BlockView, ...]:
    """The blocks whose start belongs to a study day in [first, last], of live tasks."""
    since = dt.datetime.combine(first, dt.time(), dt.UTC) - _QUERY_MARGIN
    until = dt.datetime.combine(last, dt.time(), dt.UTC) + _QUERY_MARGIN
    rows = conn.execute(
        _BLOCK_QUERY + "AND t.deleted_at IS NULL AND e.deleted_at IS NULL "
        "AND b.starts_at >= %s AND b.starts_at < %s ORDER BY b.starts_at, b.id",
        (user_id, since, until),
    ).fetchall()
    views = (_view(row, profile, now) for row in rows)
    return tuple(view for view in views if first <= view.study_date <= last)


def _invalid_range(field: str, kind: str) -> ApiError:
    return ApiError("validation_error", extra={"errors": [{"loc": ["query", field], "type": kind}]})


def _unplaced(conn: Conn, user_id: UUID, now: dt.datetime) -> tuple[UnplacedTask, ...]:
    """Todo tasks whose live blocks (done, or planned and not over) do not cover them."""
    board = load_board(conn, user_id, now)
    start = start_minute(now)
    live: dict[UUID, int] = {}
    with_block: set[UUID] = set()
    for block in board.blocks:
        if block.status is BlockStatus.DONE or block.ends_at > start:
            live[block.task_id] = live.get(block.task_id, 0) + block.interval.minutes
            with_block.add(block.task_id)
    missing = [
        (task, task.estimated_minutes - live.get(task.id, 0))
        for task in board.tasks
        if task.status is TaskStatus.TODO
        and not is_complete(task, live.get(task.id, 0), has_live_block=task.id in with_block)
    ]
    if not missing:
        return ()
    titles = {
        row["id"]: row["title"]
        for row in conn.execute(
            "SELECT id, title FROM app.tasks WHERE user_id = %s AND id = ANY(%s)",
            (user_id, [task.id for task, _ in missing]),
        ).fetchall()
    }
    return tuple(
        UnplacedTask(task_id=task.id, exam_id=task.exam_id, title=titles[task.id], minutes=left)
        for task, left in missing
    )


def plan_view(
    conn: Conn,
    user_id: UUID,
    now: dt.datetime,
    from_date: dt.date | None,
    to_date: dt.date | None,
) -> PlanView:
    """The blocks of study days from_date..to_date (default: today and the next six)."""
    profile = to_planner_profile(ensure_profile(conn, user_id))
    first = from_date if from_date is not None else study_date(profile, now)
    last = to_date if to_date is not None else first + dt.timedelta(days=DEFAULT_RANGE_DAYS - 1)
    if last < first:
        raise _invalid_range("to", "before_from")
    if (last - first).days + 1 > MAX_RANGE_DAYS:
        raise _invalid_range("to", "range_too_long")
    return PlanView(
        from_date=first,
        to_date=last,
        blocks=_blocks_in_days(conn, user_id, profile, now, first, last),
        unplaced=_unplaced(conn, user_id, now),
        undo=latest_version(conn, user_id),
    )


def today_view(conn: Conn, user_id: UUID, now: dt.datetime) -> TodayView:
    """Today's study day in the profile's timezone, with its planned and done minutes."""
    profile = to_planner_profile(ensure_profile(conn, user_id))
    today = study_date(profile, now)
    blocks = _blocks_in_days(conn, user_id, profile, now, today, today)

    def minutes(status: BlockStatus) -> int:
        return sum(
            (block.ends_at - block.starts_at) // dt.timedelta(minutes=1)
            for block in blocks
            if block.status is status
        )

    return TodayView(
        date=today,
        blocks=blocks,
        planned_minutes=minutes(BlockStatus.PLANNED),
        done_minutes=minutes(BlockStatus.DONE),
    )
