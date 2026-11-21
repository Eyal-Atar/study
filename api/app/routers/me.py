from fastapi import APIRouter

from app.auth import AuthenticatedUser
from app.deps import DatabaseDep, Now
from app.domain.time import local_date, parse_timezone
from app.errors import ApiError
from app.schemas.me import NULLABLE, MePatch, MePatchResponse, MeResponse
from app.services.hobby import read_hobby, write_hobby
from app.services.profiles import ensure_profile, lock_user, update_profile

router = APIRouter()


@router.get("/me")
def get_me(user: AuthenticatedUser, database: DatabaseDep) -> MeResponse:
    with database.transaction(user) as conn:
        row = ensure_profile(conn, user.id)
        hobby = read_hobby(conn, user.id)
    return MeResponse.from_row(row, user.email, hobby)


@router.patch("/me")
def patch_me(
    body: MePatch, user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> MePatchResponse:
    if errors := body.hobby_errors():
        raise ApiError("validation_error", extra={"errors": errors})
    changes = body.model_dump(exclude_unset=True)
    # The hobby is stored as commitments since S35 (app.services.hobby), not in profiles.
    hobby_sent = bool(NULLABLE & changes.keys())
    hobby_start = changes.pop("hobby_start", None)
    hobby_minutes = changes.pop("hobby_minutes", None)
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
        if hobby_sent:
            hobby = (
                None
                if hobby_start is None or hobby_minutes is None
                else (hobby_start, hobby_minutes)
            )
            today = local_date(now, parse_timezone(row.timezone))
            plan_affected = write_hobby(conn, user.id, hobby, today, now) or plan_affected
        hobby_now = read_hobby(conn, user.id)
    return MePatchResponse(
        **MeResponse.from_row(row, user.email, hobby_now).model_dump(),
        plan_affected=plan_affected,
    )
