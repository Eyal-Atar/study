from uuid import UUID

from fastapi import APIRouter

from app.auth import AuthenticatedUser
from app.deps import DatabaseDep, Now
from app.schemas.tasks import (
    Placement,
    TaskCreate,
    TaskCreateResponse,
    TaskDeleteResponse,
    TaskOut,
    TaskPatch,
    TaskPatchResponse,
)
from app.services import tasks as task_service

router = APIRouter()


@router.post("/tasks", status_code=201)
def post_task(
    body: TaskCreate, user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> TaskCreateResponse:
    with database.transaction(user) as conn:
        row, outcome, version_id = task_service.create_task(conn, user.id, now, body.model_dump())
    return TaskCreateResponse(
        task=TaskOut.model_validate(row),
        placement=Placement.model_validate(outcome),
        version_id=version_id,
    )


@router.patch("/tasks/{task_id}")
def patch_task(
    task_id: UUID, body: TaskPatch, user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> TaskPatchResponse:
    with database.transaction(user) as conn:
        row, outcome, version_id = task_service.update_task(
            conn, user.id, now, task_id, body.model_dump(exclude_unset=True)
        )
    return TaskPatchResponse(
        task=TaskOut.model_validate(row),
        placement=None if outcome is None else Placement.model_validate(outcome),
        version_id=version_id,
    )


@router.delete("/tasks/{task_id}")
def delete_task(
    task_id: UUID, user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> TaskDeleteResponse:
    with database.transaction(user) as conn:
        version_id = task_service.delete_task(conn, user.id, now, task_id)
    return TaskDeleteResponse(version_id=version_id)
