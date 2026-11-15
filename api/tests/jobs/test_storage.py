import json
from collections.abc import Callable, Iterator

import httpx2
import pytest

from app.jobs.storage import (
    FileMissing,
    FileTooLarge,
    StorageError,
    StorageUnavailable,
    SupabaseStorage,
)
from tests.jobs.fake_storage import MemoryStorage

URL = "https://proj.supabase.co"
PATH = "u/e/m"
Handler = Callable[[httpx2.Request], httpx2.Response]


def make(handler: Handler) -> SupabaseStorage:
    return SupabaseStorage(URL, "k", transport=httpx2.MockTransport(handler))


class CountingStream(httpx2.SyncByteStream):
    def __init__(self, chunks: list[bytes]) -> None:
        self.chunks = chunks
        self.consumed = False

    def __iter__(self) -> Iterator[bytes]:
        self.consumed = True
        yield from self.chunks


def test_download_sends_the_key_and_returns_the_body() -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(200, content=b"%PDF-1.7 body")

    assert make(handler).download(PATH, max_bytes=1000) == b"%PDF-1.7 body"
    (request,) = seen
    assert request.method == "GET"
    assert request.url.path == "/storage/v1/object/materials/u/e/m"
    assert request.headers["Authorization"] == "Bearer k"
    assert request.headers["apikey"] == "k"


@pytest.mark.parametrize(
    ("status", "body"),
    [
        (404, b""),
        (400, b'{"statusCode":"404","error":"not_found","message":"Object not found"}'),
    ],
)
def test_download_maps_missing_files(status: int, body: bytes) -> None:
    storage = make(lambda r: httpx2.Response(status, content=body))
    with pytest.raises(FileMissing):
        storage.download(PATH, max_bytes=1000)


def _raise(exc: Exception) -> Handler:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise exc

    return handler


@pytest.mark.parametrize(
    "handler",
    [
        lambda r: httpx2.Response(500),
        lambda r: httpx2.Response(503),
        lambda r: httpx2.Response(401),
        _raise(httpx2.ConnectError("boom")),
        _raise(httpx2.ReadTimeout("slow")),
    ],
)
def test_download_maps_outages(handler: Handler) -> None:
    with pytest.raises(StorageUnavailable):
        make(handler).download(PATH, max_bytes=1000)


def test_download_refuses_a_large_content_length_without_reading() -> None:
    stream = CountingStream([b"x" * 21])

    def handler(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(200, headers={"Content-Length": "21"}, stream=stream)

    with pytest.raises(FileTooLarge):
        make(handler).download(PATH, max_bytes=20)
    assert not stream.consumed


def test_download_stops_a_streamed_body_over_the_limit() -> None:
    def chunked(total: int) -> Handler:
        def handler(request: httpx2.Request) -> httpx2.Response:
            stream = CountingStream([b"x" * 10 for _ in range(total // 10)])
            return httpx2.Response(200, headers={"Transfer-Encoding": "chunked"}, stream=stream)

        return handler

    with pytest.raises(FileTooLarge):
        make(chunked(100)).download(PATH, max_bytes=20)
    assert make(chunked(20)).download(PATH, max_bytes=20) == b"x" * 20


def test_delete_sends_prefixes_and_ignores_missing() -> None:
    seen: list[httpx2.Request] = []
    status = 200

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(status)

    storage = make(handler)
    storage.delete(PATH)
    status = 404
    storage.delete(PATH)
    status = 500
    with pytest.raises(StorageUnavailable):
        storage.delete(PATH)
    request = seen[0]
    assert request.method == "DELETE"
    assert request.url.path == "/storage/v1/object/materials"
    assert json.loads(request.content) == {"prefixes": ["u/e/m"]}
    assert request.headers["Authorization"] == "Bearer k"


def test_repr_and_errors_hide_the_key() -> None:
    storage = SupabaseStorage(
        URL,
        "k-secret",
        transport=httpx2.MockTransport(lambda r: httpx2.Response(503, content=b"k-secret")),
    )
    assert "k-secret" not in repr(storage)
    errors: list[StorageError] = []
    for call in (
        lambda: storage.download(PATH, max_bytes=10),
        lambda: storage.delete(PATH),
    ):
        with pytest.raises(StorageUnavailable) as info:
            call()
        errors.append(info.value)
    broken = SupabaseStorage(
        URL, "k-secret", transport=httpx2.MockTransport(_raise(httpx2.ConnectError("k-secret")))
    )
    with pytest.raises(StorageUnavailable) as info:
        broken.download(PATH, max_bytes=10)
    errors.append(info.value)
    for error in errors:
        assert "k-secret" not in str(error)


def test_memory_storage_behaves_like_the_protocol() -> None:
    storage = MemoryStorage()
    storage.files["a"] = b"12345"
    with pytest.raises(FileMissing):
        storage.download("nope", max_bytes=10)
    with pytest.raises(FileTooLarge):
        storage.download("a", max_bytes=4)
    assert storage.download("a", max_bytes=5) == b"12345"
    storage.delete("a")
    assert storage.deleted == ["a"]
    storage.failures["b"] = StorageUnavailable("down")
    with pytest.raises(StorageUnavailable):
        storage.download("b", max_bytes=10)
    with pytest.raises(StorageUnavailable):
        storage.delete("b")
