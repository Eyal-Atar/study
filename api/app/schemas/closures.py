"""Exam closure (S45): GET /closures and POST /exams/{id}/close."""

import datetime as dt
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.domain.closure import ExamState, Outcome
from app.schemas.plan import AddedBlockOut, BlockOut, ShortfallOut, UnscheduledOut
from app.services.closures import CloseOutcome, ClosureItem, ClosureLists


class TopicRefOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str


class ClosureItemOut(BaseModel):
    """An exam whose closure is open (pending) or that waits for Moed B, as the sheet shows it."""

    model_config = ConfigDict(from_attributes=True)

    exam_id: UUID
    exam_name: str
    exam_date: dt.date
    color_index: int
    sitting: int
    state: ExamState
    # What the user may decide now: ["done", "moed_b"] at a first sitting, else ["done"].
    options: list[Outcome]
    # When the closure opened (or opens): 19:00 local time on the exam date, in UTC.
    opens_at: dt.datetime
    studied_minutes: int
    tasks_done: int
    tasks_total: int
    completion_percent: int
    topics: list[TopicRefOut]

    @classmethod
    def from_item(cls, item: ClosureItem) -> Self:
        return cls.model_validate(item)


class ClosureListResponse(BaseModel):
    pending: list[ClosureItemOut]
    waiting: list[ClosureItemOut]

    @classmethod
    def from_lists(cls, lists: ClosureLists) -> Self:
        return cls(
            pending=[ClosureItemOut.from_item(item) for item in lists.pending],
            waiting=[ClosureItemOut.from_item(item) for item in lists.waiting],
        )


class CloseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outcome: Literal["done", "moed_b"]


class BloomEventOut(BaseModel):
    """The garden's full bloom: shown once, when an exam closes done. It gives no XP."""

    model_config = ConfigDict(from_attributes=True)

    kind: Literal["course_bloomed"]
    exam_id: UUID
    exam_name: str
    color_index: int


class ClosedExamOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    exam_date: dt.date
    difficulty: int
    color_index: int
    sitting: int
    state: ExamState
    closed_at: dt.datetime | None


class ClosureReplanOut(BaseModel):
    """What the replan after the closure changed on the board."""

    added: list[AddedBlockOut]
    # The exam's own open blocks the closure deleted, and those the replan moved.
    removed: list[BlockOut]
    unscheduled: list[UnscheduledOut]
    shortfalls: list[ShortfallOut]


class CloseResponse(BaseModel):
    exam: ClosedExamOut
    # POST /plan/undo with this puts the closure and the board back.
    version_id: UUID
    event: BloomEventOut | None
    replan: ClosureReplanOut

    @classmethod
    def from_outcome(cls, outcome: CloseOutcome) -> Self:
        return cls(
            exam=ClosedExamOut.model_validate(outcome.exam),
            version_id=outcome.version_id,
            event=None if outcome.event is None else BloomEventOut.model_validate(outcome.event),
            replan=ClosureReplanOut(
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
                removed=[BlockOut.model_validate(view) for view in outcome.removed],
                unscheduled=[UnscheduledOut.model_validate(item) for item in outcome.unscheduled],
                shortfalls=[ShortfallOut.model_validate(item) for item in outcome.shortfalls],
            ),
        )
