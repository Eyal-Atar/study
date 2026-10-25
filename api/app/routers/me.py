from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel

from app.auth import AuthenticatedUser

router = APIRouter()


class MeResponse(BaseModel):
    id: UUID
    email: str | None


@router.get("/me")
def me(user: AuthenticatedUser) -> MeResponse:
    return MeResponse(id=user.id, email=user.email)
