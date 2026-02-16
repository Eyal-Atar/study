"""Exam schemas."""

from pydantic import BaseModel
from typing import Optional


class ExamCreate(BaseModel):
    name: str
    subject: str
    exam_date: str
    special_needs: Optional[str] = None


class ExamResponse(BaseModel):
    id: int
    user_id: int
    name: str
    subject: str
    exam_date: str
    special_needs: Optional[str]
    status: str
    file_count: int = 0
    task_count: int = 0
    done_count: int = 0


class ExamFileResponse(BaseModel):
    id: int
    exam_id: int
    filename: str
    file_type: str
    file_size: Optional[int]
