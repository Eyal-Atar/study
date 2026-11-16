from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.schemas.plan import BlockOut
from app.services.plan_views import BlockView
from app.services.review import RescheduleOutcome, SkipOutcome


class ReviewResponse(BaseModel):
    blocks: list[BlockOut]

    @classmethod
    def from_views(cls, views: tuple[BlockView, ...]) -> ReviewResponse:
        return cls(blocks=[BlockOut.model_validate(view) for view in views])


class RescheduleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    today_only: bool = True


class RescheduleResponse(BaseModel):
    blocks: list[BlockOut]
    version_id: UUID | None

    @classmethod
    def from_outcome(cls, outcome: RescheduleOutcome) -> RescheduleResponse:
        return cls(
            blocks=[BlockOut.model_validate(view) for view in outcome.blocks],
            version_id=outcome.version_id,
        )


class SkipResponse(BaseModel):
    task_status: str
    version_id: UUID

    @classmethod
    def from_outcome(cls, outcome: SkipOutcome) -> SkipResponse:
        return cls(task_status=outcome.task_status.value, version_id=outcome.version_id)
