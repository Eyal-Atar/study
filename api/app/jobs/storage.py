"""The worker's client for the private Supabase Storage bucket of study materials."""

import logging
from typing import Protocol

import httpx2

logger = logging.getLogger(__name__)

_CHUNK_SIZE = 64 * 1024
_ERROR_BODY_LIMIT = 4096


class StorageError(Exception):
    """Base class for storage failures; messages carry a status and a class, never a body."""


class FileMissing(StorageError):
    """The object does not exist in the bucket."""


class FileTooLarge(StorageError):
    """The object is larger than the caller's limit."""


class StorageUnavailable(StorageError):
    """A transient failure; the caller may retry."""


class Storage(Protocol):
    def download(self, path: str, *, max_bytes: int) -> bytes: ...

    def delete(self, path: str) -> None:
        """Delete the object; one that does not exist is not an error."""
        ...


class SupabaseStorage:
    """Supabase Storage over REST with the project's secret key.

    The key lives only in the client's default headers and is left out of `repr`.
    """

    def __init__(
        self,
        supabase_url: str,
        secret_key: str,
        *,
        bucket: str = "materials",
        timeout: float = 30.0,
        transport: httpx2.BaseTransport | None = None,
    ) -> None:
        self._base = f"{supabase_url.rstrip('/')}/storage/v1/object"
        self._bucket = bucket
        self._client = httpx2.Client(
            transport=transport,
            timeout=timeout,
            headers={"Authorization": f"Bearer {secret_key}", "apikey": secret_key},
        )

    def __repr__(self) -> str:
        return f"SupabaseStorage(bucket={self._bucket!r})"

    def close(self) -> None:
        self._client.close()

    def download(self, path: str, *, max_bytes: int) -> bytes:
        url = f"{self._base}/{self._bucket}/{path}"
        try:
            with self._client.stream("GET", url) as response:
                status = response.status_code
                if status == 404:
                    raise FileMissing("storage download: status 404")
                if status == 400 and _is_not_found(response):
                    raise FileMissing("storage download: status 400 not_found")
                if status != 200:
                    raise StorageUnavailable(f"storage download: status {status}")
                declared = response.headers.get("content-length")
                if declared is not None and declared.isdigit() and int(declared) > max_bytes:
                    raise FileTooLarge(f"storage download: content-length over {max_bytes}")
                body = bytearray()
                for chunk in response.iter_bytes(_CHUNK_SIZE):
                    body += chunk
                    if len(body) > max_bytes:
                        raise FileTooLarge(f"storage download: body over {max_bytes}")
                return bytes(body)
        except httpx2.TransportError as exc:
            logger.warning("storage download failed: %s", type(exc).__name__)
            raise StorageUnavailable(f"storage download: {type(exc).__name__}") from None

    def delete(self, path: str) -> None:
        url = f"{self._base}/{self._bucket}"
        try:
            response = self._client.request("DELETE", url, json={"prefixes": [path]})
        except httpx2.TransportError as exc:
            logger.warning("storage delete failed: %s", type(exc).__name__)
            raise StorageUnavailable(f"storage delete: {type(exc).__name__}") from None
        if response.status_code not in (200, 404):
            raise StorageUnavailable(f"storage delete: status {response.status_code}")


def _is_not_found(response: httpx2.Response) -> bool:
    """Whether a 400 is Supabase's way of saying the object is missing."""
    body = bytearray()
    for chunk in response.iter_bytes(_CHUNK_SIZE):
        body += chunk
        if len(body) >= _ERROR_BODY_LIMIT:
            break
    text = bytes(body).decode("utf-8", errors="replace")
    return "not_found" in text or "Object not found" in text
