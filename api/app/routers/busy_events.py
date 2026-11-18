"""One-off busy events (S35): adding or moving one clears its time on the board, undoably."""

import datetime as dt
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Response

from app.auth import AuthenticatedUser
from app.deps import DatabaseDep, Now
from app.schemas.busy_events import (
    BusyEventIn,
    BusyEventListResponse,
    BusyEventOut,
    BusyEventPatch,
    BusyEventWriteResponse,
    UnplacedTaskOut,
)
from app.schemas.plan import BlockOut
from app.services import busy_events as event_service

router = APIRouter()


def _response(outcome: event_service.EventOutcome) -> BusyEventWriteResponse:
    return BusyEventWriteResponse(
        event=BusyEventOut.from_row(outcome.event),
        blocks=[BlockOut.model_validate(view) for view in outcome.blocks],
        unplaced=[UnplacedTaskOut.model_validate(item) for item in outcome.unplaced],
        version_id=outcome.version_id,
    )


@router.get("/busy-events")
def get_busy_events(
    user: AuthenticatedUser,
    database: DatabaseDep,
    now: Now,
    from_date: Annotated[dt.date | None, Query(alias="from")] = None,
    to_date: Annotated[dt.date | None, Query(alias="to")] = None,
) -> BusyEventListResponse:
    with database.transaction(user) as conn:
        rows = event_service.list_events(conn, user.id, now, from_date, to_date)
    return BusyEventListResponse(events=[BusyEventOut.from_row(row) for row in rows])


@router.post("/busy-events", status_code=201)
def post_busy_event(
    body: BusyEventIn, user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> BusyEventWriteResponse:
    with database.transaction(user) as conn:
        outcome = event_service.create_event(
            conn, user.id, now, body.title, body.starts_at, body.ends_at
        )
    return _response(outcome)


@router.patch("/busy-events/{event_id}")
def patch_busy_event(
    event_id: UUID, body: BusyEventPatch, user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> BusyEventWriteResponse:
    with database.transaction(user) as conn:
        outcome = event_service.update_event(
            conn, user.id, now, event_id, body.model_dump(exclude_unset=True)
        )
    return _response(outcome)


@router.delete("/busy-events/{event_id}", status_code=204)
def delete_busy_event(
    event_id: UUID, user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> Response:
    with database.transaction(user) as conn:
        event_service.delete_event(conn, user.id, now, event_id)
    return Response(status_code=204)
