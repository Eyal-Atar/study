"""One-off busy events (S35): what /busy-events accepts and returns.

The checks mirror the CHECK constraints of app.busy_events (migration 0014): aware datetimes
on whole minutes, the start before the end, at most 14 days long, an optional title of
1-100 characters without NUL. Whether the event already ended depends on now, so the
service checks that (event_in_past).
"""

import datetime as dt
from typing import Annotated, Any, Final, Self
from uuid import UUID

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    StringConstraints,
    model_validator,
)

from app.schemas.plan import BlockOut
from app.schemas.text import NoNul

MAX_EVENT_LENGTH: Final = dt.timedelta(days=14)

EventTitle = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100), NoNul
]

# Fields of BusyEventPatch that may be sent as null: only the title (no title).
PATCH_NULLABLE: Final = frozenset({"title"})


def _whole_minute(value: dt.datetime) -> dt.datetime:
    if value.second or value.microsecond:
        raise ValueError("must be a whole minute")
    return value.astimezone(dt.UTC)


EventInstant = Annotated[AwareDatetime, AfterValidator(_whole_minute)]


def event_errors(starts_at: dt.datetime, ends_at: dt.datetime) -> list[dict[str, object]]:
    """Why starts_at..ends_at is not an event's time, as validation items on ends_at."""
    if ends_at <= starts_at:
        return [{"loc": ["body", "ends_at"], "type": "not_after_starts_at"}]
    if ends_at - starts_at > MAX_EVENT_LENGTH:
        return [{"loc": ["body", "ends_at"], "type": "too_long"}]
    return []


class BusyEventIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: EventTitle | None = None
    starts_at: EventInstant
    ends_at: EventInstant


class BusyEventPatch(BaseModel):
    """Any subset of the fields, at least one; only the title may be null."""

    model_config = ConfigDict(extra="forbid")

    title: EventTitle | None = None
    starts_at: EventInstant | None = None
    ends_at: EventInstant | None = None

    @model_validator(mode="before")
    @classmethod
    def _no_nulls_and_not_empty(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if not data:
                raise ValueError("at least one field is required")
            if any(value is None for key, value in data.items() if key not in PATCH_NULLABLE):
                raise ValueError("null is not a valid value")
        return data


class BusyEventOut(BaseModel):
    id: UUID
    title: str | None
    starts_at: dt.datetime
    ends_at: dt.datetime
    created_at: dt.datetime

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> Self:
        return cls(
            id=row["id"],
            title=row["title"],
            starts_at=row["starts_at"].astimezone(dt.UTC),
            ends_at=row["ends_at"].astimezone(dt.UTC),
            created_at=row["created_at"].astimezone(dt.UTC),
        )


class BusyEventListResponse(BaseModel):
    events: list[BusyEventOut]


class UnplacedTaskOut(BaseModel):
    """A task that lost its blocks under the event and found no room, and why."""

    model_config = ConfigDict(from_attributes=True)

    task_id: UUID
    minutes: int
    reason: str


class BusyEventWriteResponse(BaseModel):
    """POST and PATCH: the event, the live blocks of every task it moved, and the version.

    A PATCH that changes only the title moves nothing: blocks and unplaced are empty and
    version_id is null.
    """

    event: BusyEventOut
    blocks: list[BlockOut]
    unplaced: list[UnplacedTaskOut]
    version_id: UUID | None
