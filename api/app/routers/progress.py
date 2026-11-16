"""The progress board (S19): GET /progress.

Read only: it computes the level, the streak and the recent days from the XP ledger, and
reads the badges that complete and uncomplete keep in step with it.
"""

from fastapi import APIRouter

from app.auth import AuthenticatedUser
from app.deps import DatabaseDep, Now
from app.schemas.progress import ProgressResponse
from app.services import gamification
from app.services.profiles import ensure_profile, to_planner_profile

router = APIRouter()


@router.get("/progress")
def get_progress(user: AuthenticatedUser, database: DatabaseDep, now: Now) -> ProgressResponse:
    with database.transaction(user) as conn:
        profile = to_planner_profile(ensure_profile(conn, user.id))
        view = gamification.progress(conn, user.id, profile, now)
    return ProgressResponse.from_view(view)
