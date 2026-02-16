"""All Pydantic models for request/response validation."""

from pydantic import BaseModel
from typing import Optional


# ─── Auth ─────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str
    wake_up_time: str = "08:00"
    sleep_time: str = "23:00"
    study_method: str = "pomodoro"
    session_minutes: int = 50
    break_minutes: int = 10


class LoginRequest(BaseModel):
    email: str
    password: str


class AuthResponse(BaseModel):
    token: str
    user: "UserResponse"


# ─── Users ────────────────────────────────────────────────

class UserResponse(BaseModel):
    id: int
    name: str
    email: str
    wake_up_time: str
    sleep_time: str
    study_method: str
    session_minutes: int
    break_minutes: int


class UserUpdate(BaseModel):
    name: Optional[str] = None
    wake_up_time: Optional[str] = None
    sleep_time: Optional[str] = None
    study_method: Optional[str] = None
    session_minutes: Optional[int] = None
    break_minutes: Optional[int] = None


# ─── Exams ────────────────────────────────────────────────

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


# ─── Tasks ────────────────────────────────────────────────

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


# ─── Schedule ─────────────────────────────────────────────

class ScheduleBlock(BaseModel):
    task_id: int
    exam_id: Optional[int]
    exam_name: Optional[str] = None
    task_title: str
    subject: Optional[str]
    start_time: str
    end_time: str
    day_date: Optional[str]
    block_type: str


# ─── Brain Chat ───────────────────────────────────────────

class BrainMessage(BaseModel):
    message: str


# Rebuild forward refs
AuthResponse.model_rebuild()
