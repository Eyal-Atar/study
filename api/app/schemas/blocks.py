from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict

from app.schemas.plan import BlockOut
from app.schemas.progress import ProgressChangeOut
from app.services.blocks import CompleteOutcome, DeferOutcome


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
    model_config = ConfigDict(extra="forbid")

    not_before: AwareDatetime | None = None


class DeferResponse(BaseModel):
    blocks: list[BlockOut]
    version_id: UUID | None

    @classmethod
    def from_outcome(cls, outcome: DeferOutcome) -> DeferResponse:
        return cls(
            blocks=[BlockOut.model_validate(view) for view in outcome.blocks],
            version_id=outcome.version_id,
        )


class PinRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pinned: bool
