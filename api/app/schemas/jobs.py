import datetime as dt
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class JobOut(BaseModel):
    """A job's progress: never its payload, attempts or lock."""

    id: UUID
    kind: str
    status: str
    stage: str | None
    percent: int | None
    error: str | None
    result: dict[str, Any] | None
    created_at: dt.datetime
    started_at: dt.datetime | None
    finished_at: dt.datetime | None
