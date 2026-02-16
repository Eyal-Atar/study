"""Brain chat schemas."""

from pydantic import BaseModel


class BrainMessage(BaseModel):
    message: str


class ScheduleBlock(BaseModel):
    task_id: int
    exam_id: int | None
    exam_name: str | None = None
    task_title: str
    subject: str | None
    start_time: str
    end_time: str
    day_date: str | None
    block_type: str
