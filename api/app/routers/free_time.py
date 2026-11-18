"""'I have time now' (S35): POST /plan/free-time."""

from fastapi import APIRouter

from app.auth import AuthenticatedUser
from app.deps import DatabaseDep, Now
from app.schemas.free_time import FreeTimeRequest, FreeTimeResponse
from app.schemas.plan import BlockOut
from app.services.free_time import use_free_time

router = APIRouter()


@router.post("/plan/free-time")
def post_free_time(
    body: FreeTimeRequest, user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> FreeTimeResponse:
    with database.transaction(user) as conn:
        outcome = use_free_time(conn, user.id, now, body.minutes)
    return FreeTimeResponse(
        session_starts_at=outcome.session.start,
        session_ends_at=outcome.session.end,
        placed_task_ids=list(outcome.placed),
        blocks=[BlockOut.model_validate(view) for view in outcome.blocks],
        version_id=outcome.version_id,
    )
