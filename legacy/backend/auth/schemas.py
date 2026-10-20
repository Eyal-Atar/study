"""Auth request/response schemas."""

from pydantic import BaseModel
from users.schemas import UserResponse


class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str
    wake_up_time: str = "08:00"
    sleep_time: str = "23:00"
    study_method: str = "pomodoro"
    session_minutes: int = 50
    break_minutes: int = 10
    timezone_offset: int = 0


class LoginRequest(BaseModel):
    email: str
    password: str


class AuthResponse(BaseModel):
    token: str
    user: UserResponse
