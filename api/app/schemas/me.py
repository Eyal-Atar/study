import datetime as dt
from typing import Annotated, Any, Final, Literal, Self
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

# The only fields of MePatch that may be null: the hobby, turned off.
NULLABLE: Final = frozenset({"hobby_start", "hobby_minutes"})


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
    study_start_delay_minutes: int
    hobby_start: str | None
    hobby_minutes: int | None

    @classmethod
    def from_row(
        cls, row: ProfileRow, email: str | None, hobby: tuple[dt.time, int] | None = None
    ) -> Self:
        """The profile; the hobby comes from the commitments (app.services.hobby, S35)."""
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
            study_start_delay_minutes=row.study_start_delay_minutes,
            hobby_start=None if hobby is None else hobby[0].strftime("%H:%M"),
            hobby_minutes=None if hobby is None else hobby[1],
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
    # Minutes before a block its reminder is sent: the four choices of the settings screen.
    notify_lead_minutes: Literal[0, 5, 10, 15] | None = None
    study_start_delay_minutes: Annotated[int, Field(ge=0, le=360)] | None = None
    # Sent together: both null turns the hobby off (checked in hobby_errors).
    hobby_start: WallTime | None = None
    hobby_minutes: Annotated[int, Field(ge=15, le=240)] | None = None

    @model_validator(mode="before")
    @classmethod
    def _no_nulls_and_not_empty(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if not data:
                raise ValueError("at least one field is required")
            if any(value is None for key, value in data.items() if key not in NULLABLE):
                raise ValueError("null is not a valid value")
        return data

    def hobby_errors(self) -> list[dict[str, object]]:
        """The hobby's two fields come together, both null or both set; else where it fails.

        A model validator would report the whole body, so this is the router's check.
        """
        sent = self.model_fields_set & NULLABLE
        if not sent:
            return []
        missing = sorted(NULLABLE - sent)
        if missing:
            return [{"loc": ["body", missing[0]], "type": "missing_hobby_field"}]
        if (self.hobby_start is None) != (self.hobby_minutes is None):
            null = "hobby_start" if self.hobby_start is None else "hobby_minutes"
            return [{"loc": ["body", null], "type": "hobby_half_off"}]
        return []

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
