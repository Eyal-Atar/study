from uuid import UUID

from fastapi import APIRouter

from app.auth import AuthenticatedUser
from app.deps import DatabaseDep, Now, SettingsDep
from app.schemas.commitments import CommitmentOut
from app.schemas.timetables import (
    TimetableApply,
    TimetableApplyResponse,
    TimetableRegister,
    TimetableRegisterResponse,
)
from app.services import timetables as timetable_service

router = APIRouter()


@router.post("/timetables", status_code=202)
def post_timetable(
    body: TimetableRegister,
    user: AuthenticatedUser,
    database: DatabaseDep,
    now: Now,
    settings: SettingsDep,
) -> TimetableRegisterResponse:
    with database.transaction(user) as conn:
        job_id = timetable_service.register_timetable(
            conn, user.id, body.id, body.mime, body.size_bytes, now, settings
        )
    return TimetableRegisterResponse(job_id=job_id)


@router.post("/timetables/{job_id}/apply", status_code=201)
def post_apply_timetable(
    job_id: UUID,
    body: TimetableApply,
    user: AuthenticatedUser,
    database: DatabaseDep,
    now: Now,
) -> TimetableApplyResponse:
    with database.transaction(user) as conn:
        rows = timetable_service.apply_timetable(
            conn, user.id, job_id, body.items, body.valid_from, body.valid_until, now
        )
    return TimetableApplyResponse(
        commitments=[CommitmentOut.from_row(row) for row in rows], plan_affected=True
    )
