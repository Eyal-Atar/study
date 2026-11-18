import datetime as dt
from uuid import UUID

from fastapi import APIRouter

from app.auth import AuthenticatedUser
from app.deps import DatabaseDep, Now
from app.errors import ApiError
from app.schemas.blocks import (
    BlockPatch,
    CompleteResponse,
    DeferRequest,
    DeferResponse,
    SlotsResponse,
)
from app.schemas.plan import BlockOut
from app.services.blocks import (
    complete_block,
    defer_block,
    pin_block,
    uncomplete_block,
)
from app.services.moves import block_slots, defer_block_at, move_block

router = APIRouter()


@router.post("/blocks/{block_id}/complete")
def post_complete(
    block_id: UUID, user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> CompleteResponse:
    with database.transaction(user) as conn:
        outcome = complete_block(conn, user.id, block_id, now)
    return CompleteResponse.from_outcome(outcome)


@router.post("/blocks/{block_id}/uncomplete")
def post_uncomplete(
    block_id: UUID, user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> CompleteResponse:
    with database.transaction(user) as conn:
        outcome = uncomplete_block(conn, user.id, block_id, now)
    return CompleteResponse.from_outcome(outcome)


@router.post("/blocks/{block_id}/defer")
def post_defer(
    block_id: UUID,
    user: AuthenticatedUser,
    database: DatabaseDep,
    now: Now,
    body: DeferRequest | None = None,
) -> DeferResponse:
    body = DeferRequest() if body is None else body
    with database.transaction(user) as conn:
        if body.to == "at":
            if body.starts_at is None:  # DeferRequest requires it with to=at
                raise ApiError("validation_error")
            outcome = defer_block_at(conn, user.id, block_id, body.starts_at, now)
        else:
            outcome = defer_block(
                conn, user.id, block_id, now, body.not_before, tomorrow=body.to == "tomorrow"
            )
    return DeferResponse.from_outcome(outcome)


@router.patch("/blocks/{block_id}")
def patch_block(
    block_id: UUID, body: BlockPatch, user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> BlockOut:
    with database.transaction(user) as conn:
        if body.starts_at is not None:
            view = move_block(conn, user.id, block_id, body.starts_at, body.pinned, now)
        elif body.pinned is not None:
            view = pin_block(conn, user.id, block_id, body.pinned, now)
        else:  # BlockPatch requires one of the two
            raise ApiError("validation_error")
    return BlockOut.model_validate(view)


@router.get("/blocks/{block_id}/slots")
def get_slots(
    block_id: UUID,
    user: AuthenticatedUser,
    database: DatabaseDep,
    now: Now,
    date: dt.date | None = None,
) -> SlotsResponse:
    """Without date, where the block can move today; with date, where it can be deferred."""
    with database.transaction(user) as conn:
        view = block_slots(conn, user.id, block_id, now, date)
    return SlotsResponse.from_view(view)
