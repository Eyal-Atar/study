"""User schemas."""

from pydantic import BaseModel
from typing import Optional


class UserResponse(BaseModel):
    id: int
    name: str
    email: str
    wake_up_time: str
    sleep_time: str
    study_method: str
    session_minutes: int
    break_minutes: int
    hobby_name: Optional[str]
    neto_study_hours: Optional[float]
    peak_productivity: Optional[str]
    study_hours_preference: Optional[str] = '["morning", "afternoon"]'
    buffer_days: Optional[int] = 1
    onboarding_completed: Optional[int]
    timezone_offset: Optional[int] = 0
    push_subscription: Optional[str] = None
    notif_timing: Optional[str] = 'at_start'
    notif_per_task: Optional[int] = 1
    notif_daily_summary: Optional[int] = 0


class UserUpdate(BaseModel):
    name: Optional[str] = None
    wake_up_time: Optional[str] = None
    sleep_time: Optional[str] = None
    study_method: Optional[str] = None
    session_minutes: Optional[int] = None
    break_minutes: Optional[int] = None
    hobby_name: Optional[str] = None
    neto_study_hours: Optional[float] = None
    peak_productivity: Optional[str] = None
    study_hours_preference: Optional[str] = None
    buffer_days: Optional[int] = None
    onboarding_completed: Optional[int] = None
    timezone_offset: Optional[int] = None
    push_subscription: Optional[str] = None
    notif_timing: Optional[str] = None
    notif_per_task: Optional[int] = None
    notif_daily_summary: Optional[int] = None


class OnboardExam(BaseModel):
    name: str
    subject: str
    exam_date: str
    special_needs: Optional[str] = None
    file_indices: list[int] = []  # Indices into the 'files' list provided in the request
    file_types: list[str] = []    # Types/tags for each file (syllabus, past_exam, etc.)


class UserOnboardRequest(BaseModel):
    # Profile
    name: Optional[str] = None
    wake_up_time: str
    sleep_time: str
    study_method: str
    session_minutes: int
    break_minutes: int
    hobby_name: Optional[str]
    neto_study_hours: float
    study_hours_preference: str  # JSON string e.g. ["morning", "afternoon"]
    buffer_days: int
    timezone_offset: int = 0
    
    # Exams
    exams: list[OnboardExam]
