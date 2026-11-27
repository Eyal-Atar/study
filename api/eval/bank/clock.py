"""The single source of the evaluation clock and of deterministic identifiers."""

import datetime as dt
import uuid
from typing import Final
from zoneinfo import ZoneInfo

TZ: Final = ZoneInfo("Asia/Jerusalem")
NOW: Final = dt.datetime(2026, 12, 6, 8, 30, tzinfo=TZ)  # a Sunday
NAMESPACE: Final = uuid.UUID("2b7e4f0a-9c3d-4e61-8a5f-46d1c0b9e731")


def stable_id(*parts: object) -> uuid.UUID:
    """A deterministic UUID derived from the parts."""
    return uuid.uuid5(NAMESPACE, "/".join(str(p) for p in parts))
