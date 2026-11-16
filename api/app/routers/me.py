from fastapi import APIRouter

from app.auth import AuthenticatedUser
from app.deps import DatabaseDep
from app.errors import ApiError
from app.schemas.me import MePatch, MePatchResponse, MeResponse
from app.services.profiles import ensure_profile, lock_user, update_profile

router = APIRouter()


@router.get("/me")
def get_me(user: AuthenticatedUser, database: DatabaseDep) -> MeResponse:
    with database.transaction(user) as conn:
        row = ensure_profile(conn, user.id)
    return MeResponse.from_row(row, user.email)


@router.patch("/me")
def patch_me(body: MePatch, user: AuthenticatedUser, database: DatabaseDep) -> MePatchResponse:
    if errors := body.hobby_errors():
        raise ApiError("validation_error", extra={"errors": errors})
    changes = body.model_dump(exclude_unset=True)
    with database.transaction(user) as conn:
        current = lock_user(conn, user.id)
        wake = changes.get("wake_time", current.wake_time)
        sleep = changes.get("sleep_time", current.sleep_time)
        if wake == sleep:
            raise ApiError(
                "validation_error",
                extra={"errors": [{"loc": ["body", "sleep_time"], "type": "same_as_wake_time"}]},
            )
        row, plan_affected = update_profile(conn, user.id, changes)
    return MePatchResponse(
        **MeResponse.from_row(row, user.email).model_dump(), plan_affected=plan_affected
    )
