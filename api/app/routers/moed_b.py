"""Moed B: opening a focused second sitting of a closed exam (S45)."""

from uuid import UUID

from fastapi import APIRouter

from app.auth import AuthenticatedUser
from app.deps import DatabaseDep, Now
from app.schemas.moed_b import MoedBRequest, MoedBResponse
from app.services import moed_b as moed_b_service

router = APIRouter()


@router.post("/exams/{exam_id}/moed-b")
def post_moed_b(
    exam_id: UUID, body: MoedBRequest, user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> MoedBResponse:
    with database.transaction(user) as conn:
        outcome = moed_b_service.open_moed_b(
            conn,
            user.id,
            now,
            exam_id,
            body.exam_date,
            body.grade,
            body.hard_topic_ids,
            body.hard_notes,
        )
    return MoedBResponse.from_outcome(outcome)
