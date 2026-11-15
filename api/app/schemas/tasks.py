import datetime as dt
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.domain.planner import TaskKind

TaskTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Minutes = Annotated[int, Field(ge=5, le=600)]
Focus = Annotated[int, Field(ge=1, le=10)]
TaskStatusName = Literal["todo", "done", "skipped"]


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    exam_id: UUID
    title: str
    kind: TaskKind
    estimated_minutes: int
    focus: int
    depends_on_task_id: UUID | None
    status: TaskStatusName
    source: str
    created_at: dt.datetime


class TaskCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exam_id: UUID
    title: TaskTitle
    kind: TaskKind
    estimated_minutes: Minutes
    focus: Focus = 5
    depends_on_task_id: UUID | None = None


class TaskPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: TaskTitle | None = None
    kind: TaskKind | None = None
    estimated_minutes: Minutes | None = None
    focus: Focus | None = None
    depends_on_task_id: UUID | None = None  # null removes the dependency
    status: TaskStatusName | None = None

    @model_validator(mode="before")
    @classmethod
    def _no_nulls_and_not_empty(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if not data:
                raise ValueError("at least one field is required")
            if any(value is None for key, value in data.items() if key != "depends_on_task_id"):
                raise ValueError("null is not a valid value")
        return data


class Placement(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    placed: bool
    reason: str | None
    blocked_by: UUID | None


class TaskCreateResponse(BaseModel):
    task: TaskOut
    placement: Placement
    version_id: UUID | None


class TaskPatchResponse(BaseModel):
    task: TaskOut
    placement: Placement | None
    version_id: UUID | None


class TaskDeleteResponse(BaseModel):
    version_id: UUID | None
