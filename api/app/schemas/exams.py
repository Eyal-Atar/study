import datetime as dt
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from pydantic.json_schema import SkipJsonSchema

from app.schemas.text import NoNul

ExamName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200), NoNul
]
Difficulty = Annotated[int, Field(ge=1, le=5)]


class ExamOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    exam_date: dt.date
    difficulty: int
    color_index: int
    created_at: dt.datetime
    sitting: int
    state: Literal["active", "pending", "waiting_moed_b", "done"]
    closed_at: dt.datetime | None
    first_exam_date: dt.date | None
    first_grade: int | None


class ExamCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ExamName
    exam_date: dt.date
    difficulty: Difficulty = 3


class ExamPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ExamName | SkipJsonSchema[None] = None
    exam_date: dt.date | SkipJsonSchema[None] = None
    difficulty: Difficulty | SkipJsonSchema[None] = None

    @model_validator(mode="before")
    @classmethod
    def _no_nulls_and_not_empty(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if not data:
                raise ValueError("at least one field is required")
            if any(value is None for value in data.values()):
                raise ValueError("null is not a valid value")
        return data


class ExamResponse(BaseModel):
    exam: ExamOut
    plan_affected: bool


class ExamDeleteResponse(BaseModel):
    version_id: UUID | None
    plan_affected: bool
