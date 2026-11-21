"""Putting a task off again and again, and the split Archi offers for it (S44, audit 15).

The count is not stored: it is read from what the deferrals already write. Every deferral the
user asks for writes a plan version that names its task (`defer`, `defer_at`, and the morning
review's `review_moved`), and every completed block writes a row in `xp_events`. A task's
count is its versions of those reasons that were not undone and came after its reset point:
the latest of its last completed block, its last split that was not undone (a `task_split`
version) and its "Not now" (`tasks.split_dismissed_at`). So an undo takes a deferral (or a
split) out of the count by itself, an uncomplete takes its reset away with its XP row, and a
replan, a busy event or an edit that moves the block without being asked writes another
reason and is not counted. All the times compared come from the database clock.

At SPLIT_THRESHOLD the task has an offer: the planner's real placement of the task in bites
(Task.bite_minutes, one a day), computed from the board as it is. Its basis hashes the
board's fingerprint with what the offer shows (block, bite, parts), and `split_task` writes
only that same placement, else stale_plan.
"""

import dataclasses
import datetime as dt
import hashlib
import json
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from app.domain.planner import (
    BlockStatus,
    Interval,
    PlanResult,
    TaskKind,
    TaskStatus,
    place_task,
    start_minute,
)
from app.domain.planner.split import SPLIT_THRESHOLD, bite_for
from app.errors import ApiError
from app.services.blocks import task_live_blocks
from app.services.board import BlockRow, Board, fingerprint, load_board
from app.services.plan_views import BlockView
from app.services.plan_writes import VersionReason, apply_result
from app.services.profiles import Conn

# The versions that count as the user putting the task off.
DEFERRAL_REASONS: tuple[str, ...] = (
    VersionReason.DEFER.value,
    VersionReason.DEFER_AT.value,
    VersionReason.REVIEW_MOVED.value,
)


@dataclass(frozen=True)
class SplitPart:
    interval: Interval

    @property
    def minutes(self) -> int:
        return self.interval.minutes


@dataclass(frozen=True)
class SplitOffer:
    task_id: UUID
    exam_id: UUID
    title: str
    kind: TaskKind
    deferrals: int
    block: BlockRow  # the block the user keeps putting off: the task's next planned one
    bite_minutes: int
    parts: tuple[SplitPart, ...]  # the new blocks of the task, by time
    basis: str


@dataclass(frozen=True)
class SplitOutcome:
    task_id: UUID
    bite_minutes: int
    blocks: tuple[BlockView, ...]
    version_id: UUID


@dataclass(frozen=True)
class _Plan:
    bite: int
    result: PlanResult
    block: BlockRow


def deferral_counts(conn: Conn, user_id: UUID, task_ids: Collection[UUID]) -> dict[UUID, int]:
    """Each task's deferrals in a row: not undone and after its reset point (module doc)."""
    if not task_ids:
        return {}
    rows = conn.execute(
        """
        WITH reset AS (
            SELECT t.id,
                   greatest(
                       t.split_dismissed_at,
                       (SELECT max(x.created_at) FROM app.xp_events x
                        JOIN app.blocks b ON b.id = x.block_id AND b.user_id = x.user_id
                        WHERE x.user_id = %(user_id)s AND b.task_id = t.id),
                       (SELECT max(v.created_at) FROM app.plan_versions v
                        WHERE v.user_id = %(user_id)s AND v.task_id = t.id
                          AND v.reason = %(split)s AND v.undone_at IS NULL)
                   ) AS reset_at
            FROM app.tasks t
            WHERE t.user_id = %(user_id)s AND t.id = ANY(%(ids)s)
        )
        SELECT r.id,
               (SELECT count(*) FROM app.plan_versions v
                WHERE v.user_id = %(user_id)s AND v.task_id = r.id
                  AND v.reason = ANY(%(reasons)s) AND v.undone_at IS NULL
                  AND (r.reset_at IS NULL OR v.created_at > r.reset_at))::int AS deferrals
        FROM reset r
        """,
        {
            "user_id": user_id,
            "ids": list(task_ids),
            "split": VersionReason.TASK_SPLIT.value,
            "reasons": list(DEFERRAL_REASONS),
        },
    ).fetchall()
    return {row["id"]: row["deferrals"] for row in rows}


def _next_block(board: Board, task_id: UUID) -> BlockRow | None:
    start = start_minute(board.now)
    upcoming = [
        block
        for block in board.blocks
        if block.task_id == task_id
        and block.status is BlockStatus.PLANNED
        and block.starts_at >= start
    ]
    return min(upcoming, key=lambda block: (block.starts_at, block.id), default=None)


def _plan(board: Board, task_id: UUID) -> _Plan | None:
    """The split of the task the planner would make now, or None when there is none.

    None for a simulation (it never splits), a task with no planned block ahead, a block
    shorter than two shortest parts, a bite no smaller than the one the task already has,
    and a placement the planner cannot make (no days enough before the exam, a dependency).
    The task's planned blocks that have not started are released, pinned ones too: the split
    is the user's own word on this task. Its running and done blocks stay and count.
    """
    task = next((t for t in board.tasks if t.id == task_id), None)
    if task is None or task.status is not TaskStatus.TODO or task.kind is TaskKind.SIMULATION:
        return None
    block = _next_block(board, task_id)
    if block is None:
        return None
    bite = bite_for(block.interval.minutes)
    if bite is None or (task.bite_minutes is not None and bite >= task.bite_minutes):
        return None
    start = start_minute(board.now)
    release = [
        b.id
        for b in board.blocks
        if b.task_id == task_id and b.status is BlockStatus.PLANNED and b.starts_at >= start
    ]
    tasks = tuple(
        dataclasses.replace(t, bite_minutes=bite) if t.id == task_id else t for t in board.tasks
    )
    result = place_task(
        board.profile, board.exams, tasks, board.existing, task_id, board.now, release=release
    )
    new = [b for b in result.blocks if b.block_id is None]
    if result.unscheduled or not new:
        return None
    # The planner falls back to the task without its bite rather than lose it (plan.py);
    # such a placement is no split, so there is no offer.
    if any(b.interval.minutes >= block.interval.minutes for b in new):
        return None
    return _Plan(bite, result, block)


def _parts(plan: _Plan) -> tuple[SplitPart, ...]:
    return tuple(
        SplitPart(b.interval)
        for b in sorted(plan.result.blocks, key=lambda b: b.interval.start)
        if b.block_id is None
    )


def _offer_basis(board_basis: str, task_id: UUID, plan: _Plan) -> str:
    """SHA-256 of the board's fingerprint and of what the offer shows: its task, block,
    bite and parts. The fingerprint leaves `now` out, and the block, the bite and the parts
    all follow from `now` (a block that started is no longer the one put off), so the
    split checks that it would write exactly what the offer showed (review of S44)."""
    shown = [
        board_basis,
        str(task_id),
        str(plan.block.id),
        plan.bite,
        [[p.interval.start.isoformat(), p.interval.end.isoformat()] for p in _parts(plan)],
    ]
    return hashlib.sha256(json.dumps(shown, separators=(",", ":")).encode()).hexdigest()


def _titles(conn: Conn, user_id: UUID, task_ids: Sequence[UUID]) -> dict[UUID, dict[str, Any]]:
    rows = conn.execute(
        "SELECT id, exam_id, title, kind FROM app.tasks WHERE user_id = %s AND id = ANY(%s)",
        (user_id, list(task_ids)),
    ).fetchall()
    return {row["id"]: row for row in rows}


def _offerable(conn: Conn, user_id: UUID, board: Board) -> list[tuple[UUID, int, _Plan]]:
    todo = [t.id for t in board.tasks if t.status is TaskStatus.TODO]
    counts = deferral_counts(conn, user_id, todo)
    found: list[tuple[UUID, int, _Plan]] = []
    for task_id in todo:
        if counts.get(task_id, 0) < SPLIT_THRESHOLD:
            continue
        plan = _plan(board, task_id)
        if plan is not None:
            found.append((task_id, counts[task_id], plan))
    return found


def split_offers(conn: Conn, user_id: UUID, now: dt.datetime) -> tuple[SplitOffer, ...]:
    """Every task with an offer now, by the time of the block it keeps putting off."""
    board = load_board(conn, user_id, now)
    found = _offerable(conn, user_id, board)
    if not found:
        return ()
    board_basis = fingerprint(board)
    rows = _titles(conn, user_id, [task_id for task_id, _, _ in found])
    offers = [
        SplitOffer(
            task_id=task_id,
            exam_id=rows[task_id]["exam_id"],
            title=rows[task_id]["title"],
            kind=TaskKind(rows[task_id]["kind"]),
            deferrals=count,
            block=plan.block,
            bite_minutes=plan.bite,
            parts=_parts(plan),
            basis=_offer_basis(board_basis, task_id, plan),
        )
        for task_id, count, plan in found
    ]
    return tuple(sorted(offers, key=lambda offer: (offer.block.starts_at, offer.task_id)))


def _live_task(conn: Conn, user_id: UUID, task_id: UUID) -> dict[str, Any]:
    """The user's task that is not deleted, of an exam that is not deleted; else 404."""
    row: dict[str, Any] | None = conn.execute(
        "SELECT t.id, t.bite_minutes FROM app.tasks t "
        "JOIN app.exams e ON e.id = t.exam_id AND e.user_id = t.user_id "
        "WHERE t.user_id = %s AND t.id = %s AND t.deleted_at IS NULL AND e.deleted_at IS NULL",
        (user_id, task_id),
    ).fetchone()
    if row is None:
        raise ApiError("not_found")
    return row


def _offer_plan(conn: Conn, user_id: UUID, board: Board, task_id: UUID) -> _Plan:
    """The task's offer as the planner makes it now; no_split_offer when it has none."""
    if deferral_counts(conn, user_id, [task_id]).get(task_id, 0) < SPLIT_THRESHOLD:
        raise ApiError("no_split_offer")
    plan = _plan(board, task_id)
    if plan is None:
        raise ApiError("no_split_offer")
    return plan


def split_task(
    conn: Conn, user_id: UUID, task_id: UUID, basis: str, now: dt.datetime
) -> SplitOutcome:
    """Split the task as its offer showed, if the board is still the one the offer saw.

    One task_split version: its undo brings the old blocks back and puts bite_minutes back
    (task_before), and the count of the task starts over from the split until then.
    """
    board = load_board(conn, user_id, now, lock=True)
    row = _live_task(conn, user_id, task_id)
    plan = _offer_plan(conn, user_id, board, task_id)
    if _offer_basis(fingerprint(board), task_id, plan) != basis:
        raise ApiError("stale_plan")
    conn.execute(
        "UPDATE app.tasks SET bite_minutes = %s WHERE user_id = %s AND id = %s",
        (plan.bite, user_id, task_id),
    )
    version_id = apply_result(
        conn,
        user_id,
        board,
        plan.result,
        VersionReason.TASK_SPLIT,
        task_id=task_id,
        before={"bite_minutes": row["bite_minutes"]},
        always_version=True,
    )
    if version_id is None:  # always_version writes one
        raise RuntimeError("a task_split version was not written")
    blocks = task_live_blocks(conn, user_id, task_id, board.profile, now)
    return SplitOutcome(task_id, plan.bite, blocks, version_id)


def dismiss_offer(conn: Conn, user_id: UUID, task_id: UUID, now: dt.datetime) -> None:
    """ "Not now": the offer goes, and comes back only after SPLIT_THRESHOLD more deferrals."""
    board = load_board(conn, user_id, now, lock=True)
    _live_task(conn, user_id, task_id)
    _offer_plan(conn, user_id, board, task_id)
    conn.execute(
        "UPDATE app.tasks SET split_dismissed_at = clock_timestamp() "
        "WHERE user_id = %s AND id = %s",
        (user_id, task_id),
    )
