from typing import Annotated, Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.schemas.text import NoNul

TopicName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120), NoNul
]
Weight = Annotated[int, Field(ge=1, le=5)]


class TopicOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    exam_id: UUID
    name: str
    weight: int
    evidence: str | None
    position: int | None
    analysis_id: UUID | None


class GapOut(BaseModel):
    topic: str
    note: str


class ExamTopicsResponse(BaseModel):
    """The exam's topics: the latest applied analysis's, plus those its live tasks point to."""

    analysis_id: UUID | None
    draft_analysis_id: UUID | None
    topics: list[TopicOut]
    gaps: list[GapOut]


class TopicPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: TopicName | None = None
    weight: Weight | None = None

    @model_validator(mode="before")
    @classmethod
    def _no_nulls_and_not_empty(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if not data:
                raise ValueError("at least one field is required")
            if any(value is None for value in data.values()):
                raise ValueError("null is not a valid value")
        return data
