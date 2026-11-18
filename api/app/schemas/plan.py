import datetime as dt
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.domain.planner import BlockStatus, TaskKind, Unscheduled
from app.services.plan_views import BlockView, BusyView, PlanView, TodayView
from app.services.plan_writes import UndoOutcome
from app.services.replans import ReplanOutcome


class BlockOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    task_id: UUID
    exam_id: UUID
    task_title: str
    task_kind: TaskKind
    exam_name: str
    starts_at: dt.datetime
    ends_at: dt.datetime
    study_date: dt.date
    part_index: int
    part_count: int
    pinned: bool
    status: BlockStatus
    state: str


def _blocks(views: tuple[BlockView, ...]) -> list[BlockOut]:
    return [BlockOut.model_validate(view) for view in views]


class UnplacedOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    task_id: UUID
    exam_id: UUID
    title: str
    minutes: int


class BusyOut(BaseModel):
    """Taken time on the calendar (S35): a commitment's occurrence or a busy event."""

    model_config = ConfigDict(from_attributes=True)

    source: Literal["commitment", "event"]
    id: UUID
    title: str | None
    kind: Literal["work", "class", "other"] | None
    starts_at: dt.datetime
    ends_at: dt.datetime


def _busy(views: tuple[BusyView, ...]) -> list[BusyOut]:
    return [BusyOut.model_validate(view) for view in views]


class UndoInfo(BaseModel):
    version_id: UUID
    reason: str
    created_at: dt.datetime


class PlanResponse(BaseModel):
    model_config = ConfigDict(serialize_by_alias=True)

    from_date: dt.date = Field(serialization_alias="from")
    to_date: dt.date = Field(serialization_alias="to")
    blocks: list[BlockOut]
    unplaced: list[UnplacedOut]
    undo: UndoInfo | None
    # Commitment occurrences and busy events over the waking hours of the range's days.
    busy: list[BusyOut]

    @classmethod
    def from_view(cls, view: PlanView) -> Self:
        version = view.undo
        return cls(
            from_date=view.from_date,
            to_date=view.to_date,
            blocks=_blocks(view.blocks),
            unplaced=[UnplacedOut.model_validate(item) for item in view.unplaced],
            undo=None
            if version is None
            else UndoInfo(
                version_id=version.id, reason=version.reason, created_at=version.created_at
            ),
            busy=_busy(view.busy),
        )


class TodayResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    date: dt.date
    blocks: list[BlockOut]
    planned_minutes: int
    done_minutes: int
    # The waking hours of the study day (UTC instants), the span a block can be moved within.
    day_starts_at: dt.datetime | None
    day_ends_at: dt.datetime | None
    # Commitment occurrences and busy events over the day's waking hours.
    busy: list[BusyOut]

    @classmethod
    def from_view(cls, view: TodayView) -> Self:
        return cls(
            date=view.date,
            blocks=_blocks(view.blocks),
            planned_minutes=view.planned_minutes,
            done_minutes=view.done_minutes,
            day_starts_at=None if view.day is None else view.day.start,
            day_ends_at=None if view.day is None else view.day.end,
            busy=_busy(view.busy),
        )


class ReplanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    preview: bool = True
    basis: str | None = Field(default=None, min_length=1, max_length=128)

    @model_validator(mode="after")
    def _basis_to_apply(self) -> Self:
        if not self.preview and self.basis is None:
            raise ValueError("basis is required to apply a replan")
        return self


class AddedBlockOut(BaseModel):
    task_id: UUID
    starts_at: dt.datetime
    ends_at: dt.datetime
    part_index: int
    part_count: int


class UnscheduledOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    task_id: UUID
    minutes: int
    reason: str
    blocked_by: UUID | None


def _unscheduled(items: tuple[Unscheduled, ...]) -> list[UnscheduledOut]:
    return [UnscheduledOut.model_validate(item) for item in items]


class ShortfallOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    exam_id: UUID
    minutes: int
    daily_minutes: int | None


class ReplanResponse(BaseModel):
    basis: str
    changed: bool
    version_id: UUID | None
    added: list[AddedBlockOut]
    removed: list[BlockOut]
    unscheduled: list[UnscheduledOut]
    shortfalls: list[ShortfallOut]
    warnings: list[str]

    @classmethod
    def from_outcome(cls, outcome: ReplanOutcome) -> Self:
        return cls(
            basis=outcome.basis,
            changed=outcome.changed,
            version_id=outcome.version_id,
            added=[
                AddedBlockOut(
                    task_id=block.task_id,
                    starts_at=block.interval.start,
                    ends_at=block.interval.end,
                    part_index=block.part_index,
                    part_count=block.part_count,
                )
                for block in outcome.added
            ],
            removed=_blocks(outcome.removed),
            unscheduled=_unscheduled(outcome.unscheduled),
            shortfalls=[ShortfallOut.model_validate(item) for item in outcome.shortfalls],
            warnings=list(outcome.warnings),
        )


class UndoRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version_id: UUID


class UndoResponse(BaseModel):
    restored: int
    deleted: int
    replaced: list[UUID]
    unplaced: list[UnscheduledOut]

    @classmethod
    def from_outcome(cls, outcome: UndoOutcome) -> Self:
        return cls(
            restored=outcome.restored,
            deleted=outcome.deleted,
            replaced=list(outcome.replaced),
            unplaced=_unscheduled(outcome.unplaced),
        )
