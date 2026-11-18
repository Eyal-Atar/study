"""The user's board as the planner sees it, and a fingerprint to detect changes."""

import datetime as dt
import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass
from functools import cached_property
from typing import Any
from uuid import UUID

from app.domain.planner import (
    BlockStatus,
    Exam,
    ExistingBlock,
    Interval,
    Profile,
    SnapshotBlock,
    Task,
    TaskKind,
    TaskStatus,
)
from app.domain.time import local_date
from app.services.availability import planner_profile
from app.services.profiles import (
    Conn,
    ProfileRow,
    ensure_profile,
    lock_user,
)

BLOCK_LOOKBACK = dt.timedelta(hours=48)


@dataclass(frozen=True)
class BlockRow:
    id: UUID
    task_id: UUID
    starts_at: dt.datetime
    ends_at: dt.datetime
    part_index: int
    part_count: int
    pinned: bool
    status: BlockStatus
    plan_version_id: UUID | None

    @property
    def interval(self) -> Interval:
        return Interval(self.starts_at.astimezone(dt.UTC), self.ends_at.astimezone(dt.UTC))


@dataclass(frozen=True)
class Board:
    profile_row: ProfileRow
    profile: Profile
    exams: tuple[Exam, ...]
    tasks: tuple[Task, ...]
    blocks: tuple[BlockRow, ...]
    now: dt.datetime

    @cached_property
    def existing(self) -> tuple[ExistingBlock, ...]:
        return tuple(
            ExistingBlock(
                id=block.id,
                task_id=block.task_id,
                interval=block.interval,
                status=block.status,
                pinned=block.pinned,
            )
            for block in self.blocks
        )

    @cached_property
    def snapshot_blocks(self) -> tuple[SnapshotBlock, ...]:
        return tuple(to_snapshot_block(block) for block in self.blocks)


# The columns to_block_row reads, for every query that maps blocks.
BLOCK_COLUMNS = (
    "id, task_id, starts_at, ends_at, part_index, part_count, pinned, status, plan_version_id"
)


def to_block_row(row: Mapping[str, Any]) -> BlockRow:
    """A row of app.blocks (BLOCK_COLUMNS, possibly more) as a BlockRow, in UTC."""
    return BlockRow(
        id=row["id"],
        task_id=row["task_id"],
        starts_at=row["starts_at"].astimezone(dt.UTC),
        ends_at=row["ends_at"].astimezone(dt.UTC),
        part_index=row["part_index"],
        part_count=row["part_count"],
        pinned=row["pinned"],
        status=BlockStatus(row["status"]),
        plan_version_id=row["plan_version_id"],
    )


def to_snapshot_block(block: BlockRow) -> SnapshotBlock:
    return SnapshotBlock(
        id=block.id,
        task_id=block.task_id,
        interval=block.interval,
        part_index=block.part_index,
        part_count=block.part_count,
        pinned=block.pinned,
        status=block.status,
    )


def load_board(conn: Conn, user_id: UUID, now: dt.datetime, *, lock: bool = False) -> Board:
    profile_row = lock_user(conn, user_id) if lock else ensure_profile(conn, user_id)
    profile = planner_profile(conn, user_id, profile_row, now)
    today = local_date(now, profile.timezone)

    exams = tuple(
        Exam(id=row["id"], exam_date=row["exam_date"], difficulty=row["difficulty"])
        for row in conn.execute(
            "SELECT id, exam_date, difficulty FROM app.exams "
            "WHERE user_id = %s AND deleted_at IS NULL AND exam_date >= %s "
            "ORDER BY exam_date, id",
            (user_id, today),
        ).fetchall()
    )

    task_rows = conn.execute(
        "SELECT id, exam_id, kind, estimated_minutes, focus, depends_on_task_id, status "
        "FROM app.tasks "
        "WHERE user_id = %s AND deleted_at IS NULL AND exam_id = ANY(%s) "
        "ORDER BY position NULLS LAST, created_at, id",
        (user_id, [exam.id for exam in exams]),
    ).fetchall()
    task_ids = {row["id"] for row in task_rows}
    tasks = tuple(
        Task(
            id=row["id"],
            exam_id=row["exam_id"],
            kind=TaskKind(row["kind"]),
            estimated_minutes=row["estimated_minutes"],
            focus=row["focus"],
            depends_on=row["depends_on_task_id"] if row["depends_on_task_id"] in task_ids else None,
            status=TaskStatus(row["status"]),
        )
        for row in task_rows
    )

    # The recent planned and done blocks of every task, and the done blocks of the
    # loaded tasks whatever their age: those are what the task has already done.
    blocks = tuple(
        to_block_row(row)
        for row in conn.execute(
            f"SELECT {BLOCK_COLUMNS} FROM app.blocks "  # noqa: S608 - a constant column list
            "WHERE user_id = %s AND ("
            "(status IN ('planned', 'done') AND ends_at > %s) "
            "OR (status = 'done' AND task_id = ANY(%s))"
            ") ORDER BY starts_at, id",
            (user_id, now - BLOCK_LOOKBACK, list(task_ids)),
        ).fetchall()
    )
    return Board(
        profile_row=profile_row,
        profile=profile,
        exams=exams,
        tasks=tasks,
        blocks=blocks,
        now=now,
    )


def fingerprint(board: Board) -> str:
    """SHA-256 of the planner's input (everything but `now`), for detecting a stale preview.

    The board's blocks are those ending after now - 48h (and older done blocks of its
    tasks), so a block that leaves that window between a preview and its apply changes
    the fingerprint with nothing else changed: the apply then fails with stale_plan. That
    is rare (a preview held open across a block's end + 48h) and safe (nothing is
    written; the client previews again).
    """
    profile = board.profile
    payload = {
        "profile": {
            "timezone": profile.timezone.key,
            "wake_time": profile.wake_time.isoformat(),
            "sleep_time": profile.sleep_time.isoformat(),
            "daily_study_minutes": profile.daily_study_minutes,
            "study_windows": sorted(window.value for window in profile.study_windows),
            "rest_days_before_exam": profile.rest_days_before_exam,
            "study_start_delay": profile.study_start_delay.total_seconds(),
            "commitments": [
                [
                    c.weekday,
                    c.start.isoformat(),
                    c.end.isoformat(),
                    c.valid_from.isoformat(),
                    None if c.valid_until is None else c.valid_until.isoformat(),
                ]
                for c in profile.commitments
            ],
            "busy": [[b.start.isoformat(), b.end.isoformat()] for b in profile.busy],
        },
        "exams": [
            {"id": str(e.id), "date": e.exam_date.isoformat(), "difficulty": e.difficulty}
            for e in board.exams
        ],
        "tasks": [
            {
                "id": str(t.id),
                "exam_id": str(t.exam_id),
                "kind": t.kind.value,
                "estimated_minutes": t.estimated_minutes,
                "focus": t.focus,
                "depends_on": None if t.depends_on is None else str(t.depends_on),
                "status": t.status.value,
            }
            for t in board.tasks
        ],
        "blocks": [
            {
                "id": str(b.id),
                "task_id": str(b.task_id),
                "starts_at": b.starts_at.isoformat(),
                "ends_at": b.ends_at.isoformat(),
                "part_index": b.part_index,
                "part_count": b.part_count,
                "pinned": b.pinned,
                "status": b.status.value,
            }
            for b in board.blocks
        ],
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()
