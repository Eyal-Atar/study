from uuid import UUID

from fastapi import APIRouter, Response

from app.auth import AuthenticatedUser
from app.deps import DatabaseDep, SettingsDep
from app.schemas.materials import (
    MaterialKindUpdate,
    MaterialOut,
    MaterialRegister,
    MaterialRegisterResponse,
)
from app.services import materials as material_service

router = APIRouter()


@router.get("/exams/{exam_id}/materials")
def get_materials(
    exam_id: UUID, user: AuthenticatedUser, database: DatabaseDep
) -> list[MaterialOut]:
    with database.transaction(user) as conn:
        rows = material_service.list_materials(conn, user.id, exam_id)
    return [MaterialOut.model_validate(row) for row in rows]


@router.post("/exams/{exam_id}/materials", status_code=201)
def post_material(
    exam_id: UUID,
    body: MaterialRegister,
    user: AuthenticatedUser,
    database: DatabaseDep,
    settings: SettingsDep,
) -> MaterialRegisterResponse:
    with database.transaction(user) as conn:
        row, job_id = material_service.register_material(
            conn,
            user.id,
            exam_id,
            material_id=body.id,
            filename=body.filename,
            kind=body.kind,
            mime=body.mime,
            size_bytes=body.size_bytes,
            settings=settings,
        )
    return MaterialRegisterResponse(material=MaterialOut.model_validate(row), job_id=job_id)


@router.delete("/materials/{material_id}", status_code=204, response_class=Response)
def delete_material(material_id: UUID, user: AuthenticatedUser, database: DatabaseDep) -> None:
    with database.transaction(user) as conn:
        material_service.delete_material(conn, user.id, material_id)


@router.patch("/materials/{material_id}")
def patch_material(
    material_id: UUID, body: MaterialKindUpdate, user: AuthenticatedUser, database: DatabaseDep
) -> MaterialOut:
    with database.transaction(user) as conn:
        row = material_service.update_kind(conn, user.id, material_id, body.kind)
    return MaterialOut.model_validate(row)
