"""Task schemas."""

from pydantic import BaseModel
from typing import Optional


class TaskResponse(BaseModel):
    id: int
    user_id: int
    exam_id: Optional[int]
    exam_name: Optional[str] = None
    title: str
    topic: Optional[str]
    subject: Optional[str]
    deadline: Optional[str]
    day_date: Optional[str] = None
    sort_order: int = 0
    estimated_hours: float
    difficulty: int
    status: str
