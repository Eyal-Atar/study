from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, StringConstraints

from app.domain.notifications import MAX_ENDPOINT_LENGTH
from app.schemas.text import NoNul


class PushKeys(BaseModel):
    """The browser's keys, as PushSubscription.toJSON() gives them (base64url)."""

    model_config = ConfigDict(extra="forbid")

    # The lengths are checked properly (a P-256 point, a 16-byte secret) by the service;
    # this only stops a huge string before it is decoded.
    p256dh: Annotated[str, StringConstraints(max_length=200)]
    auth: Annotated[str, StringConstraints(max_length=200)]


class PushSubscriptionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    endpoint: Annotated[str, StringConstraints(max_length=MAX_ENDPOINT_LENGTH)]
    keys: PushKeys
    user_agent: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=500), NoNul] | None
    ) = None


class PushSubscriptionOut(BaseModel):
    id: UUID
    # False when the browser was already subscribed for this user (the row was refreshed).
    created: bool
