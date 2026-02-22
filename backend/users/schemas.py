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
    onboarding_completed: Optional[int] = None
    timezone_offset: Optional[int] = None
    push_subscription: Optional[str] = None
    notif_timing: Optional[str] = None
    notif_per_task: Optional[int] = None
    notif_daily_summary: Optional[int] = None
