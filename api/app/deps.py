from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Request

from app.config import Settings
from app.db.pool import Database
from app.errors import ApiError


def get_database(request: Request) -> Database:
    database: Database | None = request.app.state.database
    if database is None:
        raise ApiError("database_unavailable")
    return database


DatabaseDep = Annotated[Database, Depends(get_database)]


def get_now(request: Request) -> datetime:
    now: datetime = request.app.state.clock()
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("the clock must return an aware datetime")
    return now.astimezone(UTC)


Now = Annotated[datetime, Depends(get_now)]


def get_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


SettingsDep = Annotated[Settings, Depends(get_settings)]
