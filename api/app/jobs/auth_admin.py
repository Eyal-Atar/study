"""The worker's client for the Supabase Auth admin API: deleting a user (S15).

Only the worker holds the project's secret key (spec 7.11), so only the worker can delete
a user from Auth. Deleting the user cascades (ON DELETE CASCADE) to every app row of theirs.
"""

import logging
from typing import Protocol, Self
from uuid import UUID

import httpx2

from app.config import Settings

logger = logging.getLogger(__name__)


class AuthUnavailable(Exception):
    """The user was not deleted, for now; the caller may retry. Never carries a body."""


class AuthAdmin(Protocol):
    def delete_user(self, user_id: UUID) -> None:
        """Delete the user; one that does not exist is not an error."""
        ...


class SupabaseAuthAdmin:
    """`DELETE {supabase_url}/auth/v1/admin/users/{id}` with the project's secret key.

    One short-lived HTTP client per call: the worker deletes one user per job. The key
    lives only in the request headers and is left out of `repr` and of every error.
    """

    def __init__(
        self,
        supabase_url: str,
        secret_key: str,
        *,
        timeout: float = 30.0,
        transport: httpx2.BaseTransport | None = None,
    ) -> None:
        self._base = f"{supabase_url.rstrip('/')}/auth/v1/admin/users"
        self._headers = {"Authorization": f"Bearer {secret_key}", "apikey": secret_key}
        self._timeout = timeout
        self._transport = transport

    @classmethod
    def from_settings(cls, settings: Settings) -> Self:
        if settings.supabase_secret_key is None:
            # The worker refuses to start without it (app/jobs/__main__.py); this is a guard.
            raise AuthUnavailable("auth admin: SUPABASE_SECRET_KEY is not set")
        return cls(str(settings.supabase_url), settings.supabase_secret_key.get_secret_value())

    def __repr__(self) -> str:
        return "SupabaseAuthAdmin()"

    def delete_user(self, user_id: UUID) -> None:
        # str(UUID) is the canonical form: nothing but hex digits and dashes in the path.
        url = f"{self._base}/{UUID(str(user_id))}"
        try:
            with httpx2.Client(
                transport=self._transport, timeout=self._timeout, headers=self._headers
            ) as client:
                response = client.request("DELETE", url)
        except httpx2.TransportError as exc:
            logger.warning("auth admin delete failed: %s", type(exc).__name__)
            raise AuthUnavailable(f"auth admin delete: {type(exc).__name__}") from None
        # 404: already deleted (an earlier attempt whose answer was lost, or by hand).
        status = response.status_code
        if not (200 <= status < 300 or status == 404):
            raise AuthUnavailable(f"auth admin delete: status {status}")
