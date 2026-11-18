"""Weekly commitments (S35): what POST /commitments and the timetable approval accept and return.

The checks mirror the CHECK constraints of app.commitments (migration 0014) and the planner's
Commitment, so a body that passes is one the database and the planner accept: weekday 0-6
with 0 = Sunday, whole-minute wall times that differ, at least 15 minutes long on the wall
clock (an end before the start crosses midnight), valid_until on or after valid_from.
"""

import datetime as dt
from typing import Annotated, Any, Final, Literal, Self
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from app.domain.planner import MIN_COMMITMENT_MINUTES
from app.schemas.text import NoNul

CommitmentKind = Literal["work", "class", "other"]
CommitmentTitle = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100), NoNul
]
Weekday = Annotated[int, Field(ge=0, le=6)]

# Fields of CommitmentPatch that may be sent as null: only valid_until (no end date).
PATCH_NULLABLE: Final = frozenset({"valid_until"})


def _whole_minute(value: dt.time) -> dt.time:
    if value.tzinfo is not None or value.second or value.microsecond:
        raise ValueError("must be a whole minute, HH:MM")
    return value


WallTime = Annotated[dt.time, AfterValidator(_whole_minute)]


def wall_minutes(start: dt.time, end: dt.time) -> int:
    """The length on the wall clock; an end at or before the start is on the next day."""
    minutes = (end.hour * 60 + end.minute) - (start.hour * 60 + start.minute)
    return minutes % (24 * 60)


def time_errors(start: dt.time, end: dt.time) -> list[dict[str, object]]:
    """Why start..end is not a commitment's time, as validation items on end_time."""
    if start == end:
        return [{"loc": ["body", "end_time"], "type": "same_as_start_time"}]
    if wall_minutes(start, end) < MIN_COMMITMENT_MINUTES:
        return [{"loc": ["body", "end_time"], "type": "too_short"}]
    return []


def validity_errors(valid_from: dt.date, valid_until: dt.date | None) -> list[dict[str, object]]:
    if valid_until is not None and valid_until < valid_from:
        return [{"loc": ["body", "valid_until"], "type": "before_valid_from"}]
    return []


class CommitmentIn(BaseModel):
    """A new commitment. valid_from defaults to the profile's local today."""

    model_config = ConfigDict(extra="forbid")

    title: CommitmentTitle
    kind: CommitmentKind
    weekday: Weekday
    start_time: WallTime
    end_time: WallTime
    valid_from: dt.date | None = None
    valid_until: dt.date | None = None

    def errors(self, today: dt.date) -> list[dict[str, object]]:
        """Cross-field errors once valid_from is known (the caller's local today if absent)."""
        return [
            *time_errors(self.start_time, self.end_time),
            *validity_errors(self.valid_from or today, self.valid_until),
        ]


class CommitmentPatch(BaseModel):
    """Any subset of the fields, at least one; only valid_until may be null."""

    model_config = ConfigDict(extra="forbid")

    title: CommitmentTitle | None = None
    kind: CommitmentKind | None = None
    weekday: Weekday | None = None
    start_time: WallTime | None = None
    end_time: WallTime | None = None
    valid_from: dt.date | None = None
    valid_until: dt.date | None = None

    @model_validator(mode="before")
    @classmethod
    def _no_nulls_and_not_empty(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if not data:
                raise ValueError("at least one field is required")
            if any(value is None for key, value in data.items() if key not in PATCH_NULLABLE):
                raise ValueError("null is not a valid value")
        return data


class CommitmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    kind: CommitmentKind
    weekday: int
    start_time: str
    end_time: str
    valid_from: dt.date
    valid_until: dt.date | None
    source_job_id: UUID | None
    created_at: dt.datetime

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> Self:
        return cls(
            id=row["id"],
            title=row["title"],
            kind=row["kind"],
            weekday=row["weekday"],
            start_time=row["start_time"].strftime("%H:%M"),
            end_time=row["end_time"].strftime("%H:%M"),
            valid_from=row["valid_from"],
            valid_until=row["valid_until"],
            source_job_id=row["source_job_id"],
            created_at=row["created_at"],
        )


class CommitmentListResponse(BaseModel):
    commitments: list[CommitmentOut]


class CommitmentWriteResponse(BaseModel):
    """POST and PATCH: the commitment, and whether the web should offer a replan."""

    commitment: CommitmentOut
    plan_affected: bool


class CommitmentDeleteResponse(BaseModel):
    plan_affected: bool
