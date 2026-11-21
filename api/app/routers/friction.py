from uuid import UUID

from fastapi import APIRouter, Response

from app.auth import AuthenticatedUser
from app.deps import DatabaseDep, Now
from app.schemas.friction import SplitOfferOut, SplitOffersResponse, SplitRequest, SplitResponse
from app.services.friction import dismiss_offer, split_offers, split_task

router = APIRouter()


@router.get("/split-offers")
def get_split_offers(
    user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> SplitOffersResponse:
    """The tasks the user put off 3 times in a row, each with the split the planner makes."""
    with database.transaction(user) as conn:
        offers = split_offers(conn, user.id, now)
    return SplitOffersResponse(offers=[SplitOfferOut.from_offer(offer) for offer in offers])


@router.post("/tasks/{task_id}/split")
def post_split(
    task_id: UUID, body: SplitRequest, user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> SplitResponse:
    with database.transaction(user) as conn:
        outcome = split_task(conn, user.id, task_id, body.basis, now)
    return SplitResponse.from_outcome(outcome)


@router.post("/tasks/{task_id}/split/dismiss", status_code=204)
def post_split_dismiss(
    task_id: UUID, user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> Response:
    """ "Not now": the offer comes back only after 3 more deferrals."""
    with database.transaction(user) as conn:
        dismiss_offer(conn, user.id, task_id, now)
    return Response(status_code=204)
