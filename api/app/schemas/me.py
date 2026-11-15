import datetime as dt
from typing import Annotated, Any, Self
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.domain.planner import StudyWindow
from app.domain.time import InvalidTimezoneError, parse_timezone
from app.schemas.text import NoNul
from app.services.profiles import ProfileRow


def _whole_minute(value: dt.time) -> dt.time:
    if value.tzinfo is not None or value.second or value.microsecond:
        raise ValueError("must be a whole minute, HH:MM")
    return value


WallTime = Annotated[dt.time, AfterValidator(_whole_minute)]


class MeResponse(BaseModel):
    id: UUID
    email: str | None
    display_name: str | None
    timezone: str
    wake_time: str
    sleep_time: str
    daily_study_minutes: int
    study_windows: list[StudyWindow]
    rest_days_before_exam: int
    notify_lead_minutes: int
    onboarding_completed_at: dt.datetime | None

    @classmethod
    def from_row(cls, row: ProfileRow, email: str | None) -> Self:
        return cls(
            id=row.id,
            email=email,
            display_name=row.display_name,
            timezone=row.timezone,
            wake_time=row.wake_time.strftime("%H:%M"),
            sleep_time=row.sleep_time.strftime("%H:%M"),
            daily_study_minutes=row.daily_study_minutes,
            study_windows=[StudyWindow(name) for name in row.study_windows],
            rest_days_before_exam=row.rest_days_before_exam,
            notify_lead_minutes=row.notify_lead_minutes,
            onboarding_completed_at=row.onboarding_completed_at,
        )


class MePatchResponse(MeResponse):
    plan_affected: bool


class MePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: (
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100), NoNul
        ]
        | None
    ) = None
    timezone: str | None = None
    wake_time: WallTime | None = None
    sleep_time: WallTime | None = None
    daily_study_minutes: Annotated[int, Field(ge=30, le=960)] | None = None
    study_windows: Annotated[list[StudyWindow], Field(min_length=1, max_length=4)] | None = None
    rest_days_before_exam: Annotated[int, Field(ge=0, le=14)] | None = None
    notify_lead_minutes: Annotated[int, Field(ge=0, le=120)] | None = None

    @model_validator(mode="before")
    @classmethod
    def _no_nulls_and_not_empty(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if not data:
                raise ValueError("at least one field is required")
            if any(value is None for value in data.values()):
                raise ValueError("null is not a valid value")
        return data

    @field_validator("timezone")
    @classmethod
    def _known_timezone(cls, value: str | None) -> str | None:
        # parse_timezone accepts only exact zoneinfo names, so the key is the name sent;
        # storing the key keeps the stored value canonical should that ever change.
        if value is None:
            return None
        try:
            return parse_timezone(value).key
        except InvalidTimezoneError as error:
            raise ValueError("unknown timezone") from error

    @field_validator("study_windows")
    @classmethod
    def _distinct_windows(cls, value: list[StudyWindow] | None) -> list[StudyWindow] | None:
        if value is not None and len(set(value)) != len(value):
            raise ValueError("windows must be distinct")
        return value
