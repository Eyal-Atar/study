from uuid import UUID

from fastapi import APIRouter

from app.auth import AuthenticatedUser
from app.deps import DatabaseDep, Now, SettingsDep
from app.schemas.generation import GenerationResponse
from app.services import generation as generation_service

router = APIRouter()


@router.post("/plans/generate", status_code=202)
def post_generate(
    user: AuthenticatedUser, database: DatabaseDep, now: Now, settings: SettingsDep
) -> GenerationResponse:
    with database.transaction(user) as conn:
        request = generation_service.request_generation(conn, user.id, now, settings)
    return GenerationResponse(job_id=request.job_id, created=request.created)


@router.post("/exams/{exam_id}/reanalyze", status_code=202)
def post_reanalyze(
    exam_id: UUID, user: AuthenticatedUser, database: DatabaseDep, now: Now, settings: SettingsDep
) -> GenerationResponse:
    with database.transaction(user) as conn:
        request = generation_service.request_reanalysis(conn, user.id, exam_id, now, settings)
    return GenerationResponse(job_id=request.job_id, created=request.created)
