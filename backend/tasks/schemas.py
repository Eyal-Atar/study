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
    estimated_hours: float
    difficulty: int
    status: str
