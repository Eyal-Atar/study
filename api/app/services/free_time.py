"""'I have time now' (S35, plan decision 10): the next tasks in line, placed from now on.

The domain's free_time fills [start_minute(now), + minutes) with the next tasks in the
planner's order, pinned, outside the study windows and the daily budget but never over busy
time, and releases the placed tasks' candidate blocks. Here it runs on the locked board and
its result is written with a free_time version; undo deletes the blocks that version wrote
(CREATES_PINNED) and brings the board back. A failure writes nothing.
"""

import datetime as dt
from dataclasses import dataclass
from uuid import UUID

from app.domain.planner import Interval, PlanResult, free_time, start_minute
from app.errors import ApiError
from app.services.board import load_board
from app.services.plan_views import BlockView, blocks_by_id
from app.services.plan_writes import VersionReason, apply_result, renumber
from app.services.profiles import Conn


@dataclass(frozen=True)
class FreeTimeOutcome:
    session: Interval
    placed: tuple[UUID, ...]
    blocks: tuple[BlockView, ...]
    version_id: UUID | None


def use_free_time(conn: Conn, user_id: UUID, now: dt.datetime, minutes: int) -> FreeTimeOutcome:
    """Place the next tasks in the coming `minutes`; 409 nothing_to_place / no_free_time."""
    board = load_board(conn, user_id, now, lock=True)
    result = free_time(board.profile, board.exams, board.tasks, board.existing, now, minutes)
    if result.failure is not None:
        raise ApiError(result.failure.value)
    version_id = apply_result(
        conn,
        user_id,
        board,
        PlanResult(
            blocks=result.blocks,
            removed=result.removed,
            unscheduled=(),
            warnings=(),
            shortfalls=(),
        ),
        VersionReason.FREE_TIME,
    )
    renumber(conn, user_id, now)
    live = conn.execute(
        "SELECT id FROM app.blocks WHERE user_id = %s AND task_id = ANY(%s) "
        "AND (status = 'done' OR (status = 'planned' AND ends_at > %s))",
        (user_id, list(result.placed), start_minute(now)),
    ).fetchall()
    blocks = blocks_by_id(conn, user_id, [row["id"] for row in live], board.profile, now)
    return FreeTimeOutcome(
        session=result.session, placed=result.placed, blocks=blocks, version_id=version_id
    )
