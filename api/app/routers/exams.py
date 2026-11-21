from uuid import UUID

from fastapi import APIRouter

from app.auth import AuthenticatedUser
from app.deps import DatabaseDep, Now
from app.schemas.exams import (
    ExamCreate,
    ExamDeleteResponse,
    ExamOut,
    ExamPatch,
    ExamResponse,
)
from app.schemas.tasks import TaskListItem
from app.services import exams as exam_service
from app.services import tasks as task_service

router = APIRouter()


@router.get("/exams")
def get_exams(user: AuthenticatedUser, database: DatabaseDep, now: Now) -> list[ExamOut]:
    with database.transaction(user) as conn:
        rows = exam_service.list_exams(conn, user.id, now)
    return [ExamOut.model_validate(row) for row in rows]


@router.post("/exams", status_code=201)
def post_exam(
    body: ExamCreate, user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> ExamResponse:
    with database.transaction(user) as conn:
        row = exam_service.create_exam(
            conn, user.id, now, body.name, body.exam_date, body.difficulty
        )
    return ExamResponse(exam=ExamOut.model_validate(row), plan_affected=True)


@router.patch("/exams/{exam_id}")
def patch_exam(
    exam_id: UUID, body: ExamPatch, user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> ExamResponse:
    with database.transaction(user) as conn:
        row, plan_affected = exam_service.update_exam(
            conn, user.id, now, exam_id, body.model_dump(exclude_unset=True)
        )
    return ExamResponse(exam=ExamOut.model_validate(row), plan_affected=plan_affected)


@router.delete("/exams/{exam_id}")
def delete_exam(
    exam_id: UUID, user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> ExamDeleteResponse:
    with database.transaction(user) as conn:
        version_id = exam_service.delete_exam(conn, user.id, now, exam_id)
    return ExamDeleteResponse(version_id=version_id, plan_affected=True)


@router.get("/exams/{exam_id}/tasks")
def get_exam_tasks(
    exam_id: UUID, user: AuthenticatedUser, database: DatabaseDep
) -> list[TaskListItem]:
    with database.transaction(user) as conn:
        rows = task_service.list_tasks(conn, user.id, exam_id)
    return [TaskListItem.model_validate(row) for row in rows]
