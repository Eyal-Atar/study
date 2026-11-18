"""A timetable photo (S35): its registration, and the approval of what Claude read from it."""

import datetime as dt
from typing import Annotated, Final, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.commitments import CommitmentIn, CommitmentOut

MAX_APPLY_ITEMS: Final = 60


class TimetableRegister(BaseModel):
    """A file the browser has uploaded to timetable_path(user, id); the path is never sent."""

    model_config = ConfigDict(extra="forbid")

    id: UUID
    mime: Literal["image/jpeg", "image/png", "application/pdf"]
    size_bytes: Annotated[int, Field(ge=1)]


class TimetableRegisterResponse(BaseModel):
    """The parse_timetable job; GET /jobs/{id} gives its result.commitments when done."""

    job_id: UUID


class TimetableApply(BaseModel):
    """The items the user kept, possibly edited; each is checked like POST /commitments.

    valid_from and valid_until, when sent, apply to every item that has none of its own
    (e.g. the semester's last day); a null valid_until is the same as none (no end).
    """

    model_config = ConfigDict(extra="forbid")

    items: Annotated[list[CommitmentIn], Field(min_length=1, max_length=MAX_APPLY_ITEMS)]
    valid_from: dt.date | None = None
    valid_until: dt.date | None = None


class TimetableApplyResponse(BaseModel):
    """The new commitments; plan_affected is always true (the web offers POST /plan/replan)."""

    commitments: list[CommitmentOut]
    plan_affected: bool
