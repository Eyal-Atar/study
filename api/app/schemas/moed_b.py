import datetime as dt
from typing import Annotated, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.domain.closure import ExamState
from app.schemas.plan import ShortfallOut, UnscheduledOut
from app.schemas.text import NoNul
from app.services.moed_b import MoedBOutcome

HardNotes = Annotated[str, Field(max_length=1000), NoNul]


class MoedBRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exam_date: dt.date
    grade: Annotated[int, Field(ge=0, le=100)] | None = None
    hard_topic_ids: Annotated[list[UUID], Field(max_length=50)] = []
    # What was hard, in the user's words; blank counts as no notes.
    hard_notes: HardNotes | None = None


class MoedBExamOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    exam_date: dt.date
    first_exam_date: dt.date | None
    first_grade: int | None
    sitting: int
    state: ExamState
    color_index: int


class WeakTopicOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str


class MoedBResponse(BaseModel):
    exam: MoedBExamOut
    version_id: UUID
    tasks_created: int
    weak_topics: list[WeakTopicOut]
    # General review tasks dropped to fit the new date's budget.
    trimmed: int
    unscheduled: list[UnscheduledOut]
    shortfalls: list[ShortfallOut]

    @classmethod
    def from_outcome(cls, outcome: MoedBOutcome) -> Self:
        return cls(
            exam=MoedBExamOut.model_validate({**outcome.exam, "state": outcome.state}),
            version_id=outcome.version_id,
            tasks_created=outcome.tasks_created,
            weak_topics=[WeakTopicOut.model_validate(topic) for topic in outcome.weak_topics],
            trimmed=outcome.trimmed,
            unscheduled=[UnscheduledOut.model_validate(item) for item in outcome.unscheduled],
            shortfalls=[ShortfallOut.model_validate(item) for item in outcome.shortfalls],
        )
