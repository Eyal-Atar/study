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


class UserUpdate(BaseModel):
    name: Optional[str] = None
    wake_up_time: Optional[str] = None
    sleep_time: Optional[str] = None
    study_method: Optional[str] = None
    session_minutes: Optional[int] = None
    break_minutes: Optional[int] = None
