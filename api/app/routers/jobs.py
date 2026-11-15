from uuid import UUID

from fastapi import APIRouter

from app.auth import AuthenticatedUser
from app.deps import DatabaseDep
from app.schemas.jobs import JobOut
from app.services import jobs as job_service

router = APIRouter()


@router.get("/jobs/{job_id}")
def get_job(job_id: UUID, user: AuthenticatedUser, database: DatabaseDep) -> JobOut:
    with database.transaction(user) as conn:
        job = job_service.read_job(conn, user.id, job_id)
    return JobOut(
        id=job.id,
        kind=job.kind,
        status=job.status,
        stage=job.stage,
        percent=job.percent,
        error=job.error,
        result=None if job.result is None else dict(job.result),
        created_at=job.created_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )
