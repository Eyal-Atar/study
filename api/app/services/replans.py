"""Replan the whole board: a preview with a basis, and an apply that checks it."""

import datetime as dt
from dataclasses import dataclass
from uuid import UUID

from app.domain.planner import (
    ExamShortfall,
    PlannedBlock,
    PlanResult,
    Unscheduled,
    replan,
)
from app.errors import ApiError
from app.services.board import Board, fingerprint, load_board
from app.services.plan_views import BlockView, blocks_by_id
from app.services.plan_writes import VersionReason, apply_result, has_changes
from app.services.profiles import Conn, complete_onboarding


@dataclass(frozen=True)
class ReplanOutcome:
    basis: str
    changed: bool
    version_id: UUID | None
    added: tuple[PlannedBlock, ...]
    removed: tuple[BlockView, ...]
    unscheduled: tuple[Unscheduled, ...]
    shortfalls: tuple[ExamShortfall, ...]
    warnings: tuple[str, ...]


def _run(board: Board) -> PlanResult:
    return replan(board.profile, board.exams, board.tasks, board.existing, board.now)


def _outcome(
    basis: str,
    result: PlanResult,
    *,
    changed: bool,
    version_id: UUID | None,
    removed: tuple[BlockView, ...],
) -> ReplanOutcome:
    return ReplanOutcome(
        basis=basis,
        changed=changed,
        version_id=version_id,
        added=tuple(block for block in result.blocks if block.block_id is None),
        removed=removed,
        unscheduled=result.unscheduled,
        shortfalls=result.shortfalls,
        warnings=tuple(warning.code.value for warning in result.warnings),
    )


def preview_replan(conn: Conn, user_id: UUID, now: dt.datetime) -> ReplanOutcome:
    """What a replan would change, without writing; basis identifies the board it saw."""
    board = load_board(conn, user_id, now)
    result = _run(board)
    removed = blocks_by_id(conn, user_id, result.removed, board.profile, now)
    return _outcome(
        fingerprint(board),
        result,
        changed=has_changes(board, result),
        version_id=None,
        removed=removed,
    )


def apply_replan(conn: Conn, user_id: UUID, now: dt.datetime, basis: str) -> ReplanOutcome:
    """Replan again with the current time and write it, if the board is still the one previewed.

    The returned basis is the board after the write (reloaded), so a client can preview
    or apply again from it.
    """
    board = load_board(conn, user_id, now, lock=True)
    if fingerprint(board) != basis:
        raise ApiError("stale_plan")
    result = _run(board)
    # Read before apply_result deletes them.
    removed = blocks_by_id(conn, user_id, result.removed, board.profile, now)
    version_id = apply_result(conn, user_id, board, result, VersionReason.REPLAN)
    # An applied plan ends the onboarding, also when it changed nothing, but only when the
    # board has a task of a live exam (placed or not): an empty board is no plan yet.
    if board.tasks:
        complete_onboarding(conn, user_id, now)
    after = board if version_id is None else load_board(conn, user_id, now)
    return _outcome(
        fingerprint(after),
        result,
        changed=version_id is not None,
        version_id=version_id,
        removed=removed,
    )
