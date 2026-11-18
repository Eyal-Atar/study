"""Weekly commitments (S35): no plan version; plan_affected tells the web to offer a replan."""

from uuid import UUID

from fastapi import APIRouter

from app.auth import AuthenticatedUser
from app.deps import DatabaseDep, Now
from app.schemas.commitments import (
    CommitmentDeleteResponse,
    CommitmentIn,
    CommitmentListResponse,
    CommitmentOut,
    CommitmentPatch,
    CommitmentWriteResponse,
)
from app.services import commitments as commitment_service

router = APIRouter()


@router.get("/commitments")
def get_commitments(user: AuthenticatedUser, database: DatabaseDep) -> CommitmentListResponse:
    with database.transaction(user) as conn:
        rows = commitment_service.list_commitments(conn, user.id)
    return CommitmentListResponse(commitments=[CommitmentOut.from_row(row) for row in rows])


@router.post("/commitments", status_code=201)
def post_commitment(
    body: CommitmentIn, user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> CommitmentWriteResponse:
    with database.transaction(user) as conn:
        row = commitment_service.create_commitment(conn, user.id, now, body)
    return CommitmentWriteResponse(commitment=CommitmentOut.from_row(row), plan_affected=True)


@router.patch("/commitments/{commitment_id}")
def patch_commitment(
    commitment_id: UUID, body: CommitmentPatch, user: AuthenticatedUser, database: DatabaseDep
) -> CommitmentWriteResponse:
    with database.transaction(user) as conn:
        row, plan_affected = commitment_service.update_commitment(
            conn, user.id, commitment_id, body.model_dump(exclude_unset=True)
        )
    return CommitmentWriteResponse(
        commitment=CommitmentOut.from_row(row), plan_affected=plan_affected
    )


@router.delete("/commitments/{commitment_id}")
def delete_commitment(
    commitment_id: UUID, user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> CommitmentDeleteResponse:
    with database.transaction(user) as conn:
        commitment_service.delete_commitment(conn, user.id, now, commitment_id)
    return CommitmentDeleteResponse(plan_affected=True)
