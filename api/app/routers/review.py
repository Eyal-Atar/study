from uuid import UUID

from fastapi import APIRouter

from app.auth import AuthenticatedUser
from app.deps import DatabaseDep, Now
from app.schemas.review import (
    RescheduleRequest,
    RescheduleResponse,
    ReviewResponse,
    SkipResponse,
)
from app.services.review import reschedule_block, review_blocks, skip_block

router = APIRouter()


@router.get("/review")
def get_review(user: AuthenticatedUser, database: DatabaseDep, now: Now) -> ReviewResponse:
    with database.transaction(user) as conn:
        views = review_blocks(conn, user.id, now)
    return ReviewResponse.from_views(views)


@router.post("/blocks/{block_id}/reschedule")
def post_reschedule(
    block_id: UUID,
    user: AuthenticatedUser,
    database: DatabaseDep,
    now: Now,
    body: RescheduleRequest | None = None,
) -> RescheduleResponse:
    today_only = True if body is None else body.today_only
    with database.transaction(user) as conn:
        outcome = reschedule_block(conn, user.id, block_id, now, today_only=today_only)
    return RescheduleResponse.from_outcome(outcome)


@router.post("/blocks/{block_id}/skip")
def post_skip(
    block_id: UUID, user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> SkipResponse:
    with database.transaction(user) as conn:
        outcome = skip_block(conn, user.id, block_id, now)
    return SkipResponse.from_outcome(outcome)
