"""The split offer (S44): GET /split-offers, POST /tasks/{id}/split and its dismiss."""

import datetime as dt
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.domain.planner import TaskKind
from app.schemas.plan import BlockOut
from app.services.friction import SplitOffer, SplitOutcome


class SplitPartOut(BaseModel):
    starts_at: dt.datetime
    ends_at: dt.datetime
    minutes: int


class OfferBlockOut(BaseModel):
    """The block the user keeps putting off: the task's next planned block."""

    id: UUID
    starts_at: dt.datetime
    ends_at: dt.datetime
    minutes: int


class SplitOfferOut(BaseModel):
    task_id: UUID
    exam_id: UUID
    task_title: str
    task_kind: TaskKind
    deferrals: int
    block: OfferBlockOut
    bite_minutes: int
    parts: list[SplitPartOut]
    basis: str

    @classmethod
    def from_offer(cls, offer: SplitOffer) -> SplitOfferOut:
        block = offer.block
        return cls(
            task_id=offer.task_id,
            exam_id=offer.exam_id,
            task_title=offer.title,
            task_kind=offer.kind,
            deferrals=offer.deferrals,
            block=OfferBlockOut(
                id=block.id,
                starts_at=block.starts_at,
                ends_at=block.ends_at,
                minutes=block.interval.minutes,
            ),
            bite_minutes=offer.bite_minutes,
            parts=[
                SplitPartOut(
                    starts_at=part.interval.start, ends_at=part.interval.end, minutes=part.minutes
                )
                for part in offer.parts
            ],
            basis=offer.basis,
        )


class SplitOffersResponse(BaseModel):
    offers: list[SplitOfferOut]


class SplitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    basis: str = Field(min_length=1, max_length=128)


class SplitResponse(BaseModel):
    task_id: UUID
    bite_minutes: int
    blocks: list[BlockOut]
    version_id: UUID

    @classmethod
    def from_outcome(cls, outcome: SplitOutcome) -> SplitResponse:
        return cls(
            task_id=outcome.task_id,
            bite_minutes=outcome.bite_minutes,
            blocks=[BlockOut.model_validate(view) for view in outcome.blocks],
            version_id=outcome.version_id,
        )
