import datetime as dt
from typing import Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, model_validator

from app.schemas.plan import BlockOut
from app.schemas.progress import ProgressChangeOut
from app.services.blocks import CompleteOutcome, DeferOutcome
from app.services.moves import SlotsView


class CompleteResponse(BaseModel):
    block: BlockOut
    task_status: str
    progress: ProgressChangeOut

    @classmethod
    def from_outcome(cls, outcome: CompleteOutcome) -> CompleteResponse:
        return cls(
            block=BlockOut.model_validate(outcome.block),
            task_status=outcome.task_status.value,
            progress=ProgressChangeOut.from_change(outcome.progress),
        )


class DeferRequest(BaseModel):
    """Where to defer to (S35): the next free slot (the default), tomorrow, or a chosen time.

    not_before goes only with "next" (the S09 body), starts_at with "at" and only with it.
    """

    model_config = ConfigDict(extra="forbid")

    to: Literal["next", "tomorrow", "at"] = "next"
    not_before: AwareDatetime | None = None
    starts_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def _fields_of_the_choice(self) -> Self:
        if self.not_before is not None and self.to != "next":
            raise ValueError("not_before goes only with to=next")
        if (self.starts_at is not None) != (self.to == "at"):
            raise ValueError("starts_at is required with to=at, and only with it")
        return self


class DeferResponse(BaseModel):
    blocks: list[BlockOut]
    version_id: UUID | None

    @classmethod
    def from_outcome(cls, outcome: DeferOutcome) -> DeferResponse:
        return cls(
            blocks=[BlockOut.model_validate(view) for view in outcome.blocks],
            version_id=outcome.version_id,
        )


class BlockPatch(BaseModel):
    """Pin or unpin, move (starts_at, pinned by default), or both; at least one field."""

    model_config = ConfigDict(extra="forbid")

    pinned: bool | None = None
    starts_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def _something_to_change(self) -> Self:
        if self.pinned is None and self.starts_at is None:
            raise ValueError("pinned or starts_at is required")
        return self


class SlotsResponse(BaseModel):
    study_date: dt.date
    day_starts_at: dt.datetime | None
    day_ends_at: dt.datetime | None
    slots: list[dt.datetime]

    @classmethod
    def from_view(cls, view: SlotsView) -> Self:
        return cls(
            study_date=view.study_date,
            day_starts_at=None if view.day is None else view.day.start,
            day_ends_at=None if view.day is None else view.day.end,
            slots=list(view.slots),
        )
