from uuid import UUID

from fastapi import APIRouter

from app.auth import AuthenticatedUser
from app.deps import DatabaseDep, Now, SettingsDep
from app.schemas.generation import (
    ApplyAnalysisRequest,
    ApplyAnalysisResponse,
    GenerationResponse,
)
from app.services import analyses as analyses_service
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


@router.post("/analyses/{analysis_id}/apply")
def post_apply_analysis(
    analysis_id: UUID,
    body: ApplyAnalysisRequest,
    user: AuthenticatedUser,
    database: DatabaseDep,
    now: Now,
) -> ApplyAnalysisResponse:
    with database.transaction(user) as conn:
        # ApplyAnalysisRequest requires a basis whenever preview is false.
        if body.preview or body.basis is None:
            outcome, basis = analyses_service.preview_analysis(conn, user.id, analysis_id, now)
        else:
            outcome, basis = analyses_service.apply_previewed(
                conn, user.id, analysis_id, now, body.basis
            )
    return ApplyAnalysisResponse.from_outcome(outcome, basis)
