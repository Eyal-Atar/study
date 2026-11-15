import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Query

from app.auth import AuthenticatedUser
from app.deps import DatabaseDep, Now
from app.schemas.plan import (
    PlanResponse,
    ReplanRequest,
    ReplanResponse,
    TodayResponse,
    UndoRequest,
    UndoResponse,
)
from app.services.plan_views import plan_view, today_view
from app.services.plan_writes import undo_version
from app.services.replans import apply_replan, preview_replan

router = APIRouter()


@router.get("/plan")
def get_plan(
    user: AuthenticatedUser,
    database: DatabaseDep,
    now: Now,
    from_date: Annotated[dt.date | None, Query(alias="from")] = None,
    to_date: Annotated[dt.date | None, Query(alias="to")] = None,
) -> PlanResponse:
    with database.transaction(user) as conn:
        view = plan_view(conn, user.id, now, from_date, to_date)
    return PlanResponse.from_view(view)


@router.get("/today")
def get_today(user: AuthenticatedUser, database: DatabaseDep, now: Now) -> TodayResponse:
    with database.transaction(user) as conn:
        view = today_view(conn, user.id, now)
    return TodayResponse.from_view(view)


@router.post("/plan/replan")
def post_replan(
    body: ReplanRequest, user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> ReplanResponse:
    with database.transaction(user) as conn:
        # ReplanRequest requires a basis whenever preview is false.
        if body.preview or body.basis is None:
            outcome = preview_replan(conn, user.id, now)
        else:
            outcome = apply_replan(conn, user.id, now, body.basis)
    return ReplanResponse.from_outcome(outcome)


@router.post("/plan/undo")
def post_undo(
    body: UndoRequest, user: AuthenticatedUser, database: DatabaseDep, now: Now
) -> UndoResponse:
    with database.transaction(user) as conn:
        outcome = undo_version(conn, user.id, body.version_id, now)
    return UndoResponse.from_outcome(outcome)
