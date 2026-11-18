"""'I have time now' (S35): what POST /plan/free-time accepts and returns."""

import datetime as dt
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt

from app.domain.planner import MAX_FREE_TIME_MINUTES, MIN_FREE_TIME_MINUTES
from app.schemas.plan import BlockOut


class FreeTimeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    minutes: Annotated[StrictInt, Field(ge=MIN_FREE_TIME_MINUTES, le=MAX_FREE_TIME_MINUTES)]


class FreeTimeResponse(BaseModel):
    """The session [session_starts_at, session_ends_at), the tasks placed in it (in order),
    the live blocks of those tasks after the change (the session's are pinned), and the
    version to undo."""

    session_starts_at: dt.datetime
    session_ends_at: dt.datetime
    placed_task_ids: list[UUID]
    blocks: list[BlockOut]
    version_id: UUID | None
