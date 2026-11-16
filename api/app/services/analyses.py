"""Apply a reanalysis draft to its exam, or preview what applying it would do.

Applying replaces the exam's AI tasks that nothing was done in (`source = 'ai'`, todo, no
done block): they are soft-deleted with their open blocks, as deleting a task does (a
started block stays; a pinned one that has not started goes). The draft's tasks and
topics are written, and the whole board is replanned. All of it is one exam_reanalyzed
version, whose snapshot is the board before the change, so one undo brings it all back.

The preview runs the same apply in a transaction that is rolled back: what it shows is
exactly what the apply writes, and its basis (the board's fingerprint) makes sure the
board did not change between the two.
"""

import dataclasses
import datetime as dt
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from app.ai.schema import AnalysisOutput
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
from app.services.analysis import insert_analysis_tasks
from app.services.board import fingerprint, load_board
from app.services.plan_views import BlockView, blocks_by_id
from app.services.plan_writes import (
    VersionReason,
    changes,
    create_version,
    delete_planned,
    renumber,
    write_changes,
)
from app.services.profiles import Conn


@dataclass(frozen=True)
class ReplacedTask:
    id: UUID
    title: str


@dataclass(frozen=True)
class AddedTask:
    task_id: UUID
    title: str
    kind: str
    minutes: int
    reason: str | None


@dataclass(frozen=True)
class ReanalysisOutcome:
    replaced: tuple[ReplacedTask, ...]
    kept: int
    added: tuple[AddedTask, ...]
    added_blocks: tuple[PlannedBlock, ...]
    removed_blocks: tuple[BlockView, ...]
    unscheduled: tuple[Unscheduled, ...]
    shortfalls: tuple[ExamShortfall, ...]
    version_id: UUID | None


def _draft(conn: Conn, user_id: UUID, analysis_id: UUID) -> dict[str, Any]:
    """The user's analysis, which must still be a draft. The caller holds the user lock."""
    row = conn.execute(
        "SELECT id, exam_id, status, output, material_keys FROM app.analyses "
        "WHERE user_id = %s AND id = %s",
        (user_id, analysis_id),
    ).fetchone()
    if row is None:
        raise ApiError("not_found")
    if row["status"] != "draft":
        raise ApiError("invalid_state")
    return row


def _replaced_tasks(conn: Conn, user_id: UUID, exam_id: UUID) -> tuple[ReplacedTask, ...]:
    """The exam's live AI todo tasks without a done block: what the draft replaces."""
    rows = conn.execute(
        """
        SELECT t.id, t.title FROM app.tasks AS t
        WHERE t.user_id = %(user_id)s
          AND t.exam_id = %(exam_id)s
          AND t.source = 'ai'
          AND t.status = 'todo'
          AND t.deleted_at IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM app.blocks AS b
              WHERE b.user_id = %(user_id)s AND b.task_id = t.id AND b.status = 'done'
          )
        ORDER BY t.position NULLS LAST, t.created_at, t.id
        """,
        {"user_id": user_id, "exam_id": exam_id},
    ).fetchall()
    return tuple(ReplacedTask(id=row["id"], title=row["title"]) for row in rows)


def _live_task_count(conn: Conn, user_id: UUID, exam_id: UUID) -> int:
    row = conn.execute(
        "SELECT count(*) AS n FROM app.tasks "
        "WHERE user_id = %s AND exam_id = %s AND deleted_at IS NULL",
        (user_id, exam_id),
    ).fetchone()
    if row is None:
        raise RuntimeError("SELECT count(*) returned no row")
    count: int = row["n"]
    return count


def apply_analysis(
    conn: Conn,
    user_id: UUID,
    analysis_id: UUID,
    now: dt.datetime,
    *,
    basis: str | None = None,
) -> ReanalysisOutcome:
    """Apply a draft in the caller's transaction, as one exam_reanalyzed version.

    With `basis`, the board must still be the one it identifies (else stale_plan).
    """
    # The lock comes first: the draft's status is read and changed under it.
    board = load_board(conn, user_id, now, lock=True)
    draft = _draft(conn, user_id, analysis_id)
    if basis is not None and fingerprint(board) != basis:
        raise ApiError("stale_plan")
    exam_id: UUID = draft["exam_id"]
    exam = conn.execute(
        "SELECT exam_date FROM app.exams WHERE user_id = %s AND id = %s AND deleted_at IS NULL",
        (user_id, exam_id),
    ).fetchone()
    if exam is None:
        raise ApiError("not_found")
    if exam["exam_date"] < local_date(now, board.profile.timezone):
        raise ApiError("exam_in_past")

    replaced = _replaced_tasks(conn, user_id, exam_id)
    replaced_ids = [task.id for task in replaced]
    kept = _live_task_count(conn, user_id, exam_id) - len(replaced)

    version_id = create_version(
        conn,
        user_id,
        board,
        VersionReason.EXAM_REANALYZED,
        exam_id,
        None,
        None,
        analysis_id,
    )
    # The replaced tasks' blocks that have not started go, pinned too (as a task delete).
    start = start_minute(now)
    wanted = frozenset(replaced_ids)
    open_ids = [
        block.id
        for block in board.blocks
        if block.task_id in wanted
        and block.status is BlockStatus.PLANNED
        and block.starts_at >= start
    ]
    removed_open = blocks_by_id(conn, user_id, open_ids, board.profile, now)
    delete_planned(conn, user_id, open_ids)
    if replaced_ids:
        conn.execute(
            "UPDATE app.tasks SET deleted_at = %s WHERE user_id = %s AND id = ANY(%s)",
            (now, user_id, replaced_ids),
        )

    output = AnalysisOutput.model_validate(draft["output"])
    material_ids = {key: UUID(str(value)) for key, value in draft["material_keys"].items()}
    saved = insert_analysis_tasks(conn, user_id, exam_id, analysis_id, output, material_ids)
    conn.execute(
        "UPDATE app.analyses SET status = 'applied', applied_at = %s, replaced_task_ids = %s "
        "WHERE user_id = %s AND id = %s",
        (now, replaced_ids, user_id, analysis_id),
    )

    after = load_board(conn, user_id, now)
    result = replan(after.profile, after.exams, after.tasks, after.existing, now)
    # Read before write_changes deletes them.
    removed_planned = blocks_by_id(conn, user_id, result.removed, after.profile, now)
    diff = changes(after, result)
    write_changes(conn, user_id, diff, version_id)
    renumber(conn, user_id, now)

    removed = sorted(
        {view.id: view for view in (*removed_open, *removed_planned)}.values(),
        key=lambda view: (view.starts_at, view.id),
    )
    return ReanalysisOutcome(
        replaced=replaced,
        kept=kept,
        added=tuple(
            AddedTask(
                task_id=saved.task_ids[task.key],
                title=task.title,
                kind=task.kind,
                minutes=task.minutes,
                reason=task.reason or None,
            )
            for task in output.tasks
        ),
        added_blocks=diff.added,
        removed_blocks=tuple(removed),
        unscheduled=result.unscheduled,
        shortfalls=result.shortfalls,
        version_id=version_id,
    )


def preview_analysis(
    conn: Conn, user_id: UUID, analysis_id: UUID, now: dt.datetime
) -> tuple[ReanalysisOutcome, str]:
    """What applying the draft would do, and the basis of the board it was computed on.

    The apply runs in a savepoint that is always rolled back: nothing is written.
    """
    basis = fingerprint(load_board(conn, user_id, now, lock=True))
    with conn.transaction(force_rollback=True):
        outcome = apply_analysis(conn, user_id, analysis_id, now)
    return dataclasses.replace(outcome, version_id=None), basis


def apply_previewed(
    conn: Conn, user_id: UUID, analysis_id: UUID, now: dt.datetime, basis: str
) -> tuple[ReanalysisOutcome, str]:
    """Apply the draft if the board is still the previewed one; the basis after the write."""
    outcome = apply_analysis(conn, user_id, analysis_id, now, basis=basis)
    return outcome, fingerprint(load_board(conn, user_id, now))
