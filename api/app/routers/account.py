"""The account (S15): GET /me/export and DELETE /me."""

from typing import Any, Final

from fastapi import APIRouter, Response
from pydantic import TypeAdapter

from app.auth import AuthenticatedUser
from app.deps import DatabaseDep, Now
from app.schemas.account import DeleteAccountResponse
from app.schemas.me import MeResponse
from app.services import account as account_service

router = APIRouter()

# Pydantic's JSON mode for the whole file: UUIDs, dates and datetimes in one format, the
# same one the other responses use.
_EXPORT_JSON: Final = TypeAdapter(dict[str, Any])


@router.get(
    "/me/export",
    response_class=Response,
    responses={200: {"content": {"application/json": {}}, "description": "The export file"}},
)
def get_export(user: AuthenticatedUser, database: DatabaseDep, now: Now) -> Response:
    with database.transaction(user) as conn:
        profile, tables = account_service.export_account(conn, user.id)
    body = {
        "format": account_service.EXPORT_FORMAT,
        "version": account_service.EXPORT_VERSION,
        "exported_at": now,
        # The fields of GET /me (the email from the token), and when the profile was made.
        "profile": {
            **MeResponse.from_row(profile, user.email).model_dump(),
            "created_at": profile.created_at,
        },
        **tables,
    }
    filename = account_service.export_filename(profile, now)
    return Response(
        content=_EXPORT_JSON.dump_json(body),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/me", status_code=202)
def delete_me(user: AuthenticatedUser, database: DatabaseDep) -> DeleteAccountResponse:
    with database.transaction(user) as conn:
        job_id = account_service.delete_account(conn, user.id)
    return DeleteAccountResponse(job_id=job_id)
