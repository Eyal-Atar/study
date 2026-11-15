from typing import Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.domain.planner import TaskKind
from app.schemas.plan import AddedBlockOut, BlockOut, ShortfallOut, UnscheduledOut
from app.services.analyses import ReanalysisOutcome


class GenerationResponse(BaseModel):
    """The job that builds the plan; created is false when an active one was returned."""

    job_id: UUID
    created: bool


class ApplyAnalysisRequest(BaseModel):
    """A preview (the default), or an apply of the board the preview's basis identifies."""

    model_config = ConfigDict(extra="forbid")

    preview: bool = True
    basis: str | None = Field(default=None, min_length=1, max_length=128)

    @model_validator(mode="after")
    def _basis_to_apply(self) -> Self:
        if not self.preview and self.basis is None:
            raise ValueError("basis is required to apply an analysis")
        return self


class ReplacedTaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str


class AddedTaskOut(BaseModel):
    """A task the draft adds; in a preview its task_id exists only within the response."""

    model_config = ConfigDict(from_attributes=True)

    task_id: UUID
    title: str
    kind: TaskKind
    minutes: int


class ApplyAnalysisResponse(BaseModel):
    """What the draft replaces and adds and how the board changes; basis is the board after.

    In a preview, version_id is null and basis is the board the preview was computed on.
    """

    basis: str
    version_id: UUID | None
    replaced: list[ReplacedTaskOut]
    kept: int
    added: list[AddedTaskOut]
    added_blocks: list[AddedBlockOut]
    removed_blocks: list[BlockOut]
    unscheduled: list[UnscheduledOut]
    shortfalls: list[ShortfallOut]

    @classmethod
    def from_outcome(cls, outcome: ReanalysisOutcome, basis: str) -> Self:
        return cls(
            basis=basis,
            version_id=outcome.version_id,
            replaced=[ReplacedTaskOut.model_validate(task) for task in outcome.replaced],
            kept=outcome.kept,
            added=[AddedTaskOut.model_validate(task) for task in outcome.added],
            added_blocks=[
                AddedBlockOut(
                    task_id=block.task_id,
                    starts_at=block.interval.start,
                    ends_at=block.interval.end,
                    part_index=block.part_index,
                    part_count=block.part_count,
                )
                for block in outcome.added_blocks
            ],
            removed_blocks=[BlockOut.model_validate(view) for view in outcome.removed_blocks],
            unscheduled=[UnscheduledOut.model_validate(item) for item in outcome.unscheduled],
            shortfalls=[ShortfallOut.model_validate(item) for item in outcome.shortfalls],
        )
