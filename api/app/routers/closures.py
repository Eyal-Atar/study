"""Exam closure: the pending closures and closing an exam (S45)."""

from uuid import UUID

from fastapi import APIRouter

from app.auth import AuthenticatedUser
from app.deps import DatabaseDep, Now
from app.domain.closure import Outcome
from app.schemas.closures import CloseRequest, CloseResponse, ClosureListResponse
from app.services import closures as closure_service

router = APIRouter()


@router.get("/closures")
def get_closures(user: AuthenticatedUser, database: DatabaseDep, now: Now) -> ClosureListResponse:
    with database.transaction(user) as conn:
        lists = closure_service.list_closures(conn, user.id, now)
    return ClosureListResponse.from_lists(lists)


@router.post("/exams/{exam_id}/close")
def post_close(
    exam_id: UUID, body: CloseRequest, user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> CloseResponse:
    with database.transaction(user) as conn:
        outcome = closure_service.close_exam(conn, user.id, now, exam_id, Outcome(body.outcome))
    return CloseResponse.from_outcome(outcome)
