"""Brain chat schemas."""

from pydantic import BaseModel
from typing import Optional


class BrainMessage(BaseModel):
    message: str


class RegenerateDeltaRequest(BaseModel):
    reason: str  # Natural language reason, e.g. "I moved my exam to Friday"


class ScheduleBlock(BaseModel):
    task_id: Optional[int]
    exam_id: Optional[int]
    exam_name: Optional[str] = None
    task_title: str
    subject: Optional[str]
    start_time: str
    end_time: str
    day_date: Optional[str]
    block_type: str
    is_delayed: bool = False
