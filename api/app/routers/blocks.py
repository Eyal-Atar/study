from uuid import UUID

from fastapi import APIRouter

from app.auth import AuthenticatedUser
from app.deps import DatabaseDep, Now
from app.schemas.blocks import (
    CompleteResponse,
    DeferRequest,
    DeferResponse,
    PinRequest,
)
from app.schemas.plan import BlockOut
from app.services.blocks import (
    complete_block,
    defer_block,
    pin_block,
    uncomplete_block,
)

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
    not_before = None if body is None else body.not_before
    with database.transaction(user) as conn:
        outcome = defer_block(conn, user.id, block_id, now, not_before)
    return DeferResponse.from_outcome(outcome)


@router.patch("/blocks/{block_id}")
def patch_block(
    block_id: UUID, body: PinRequest, user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> BlockOut:
    with database.transaction(user) as conn:
        view = pin_block(conn, user.id, block_id, body.pinned, now)
    return BlockOut.model_validate(view)
