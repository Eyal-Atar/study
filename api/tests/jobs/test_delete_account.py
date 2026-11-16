"""Deleting an account end to end (S15): DELETE /me, then one worker run.

The API empties the app tables at once and queues delete_account; the worker deletes the
user's files in Storage and then the user in Auth. The fake Auth admin deletes the
auth.users row in the test database, so the ON DELETE CASCADE that removes the job row
(and anything written in between) is the real one. The fake storage also deletes the
storage.objects rows, as Supabase Storage does.

Also here: unit tests of SupabaseAuthAdmin and SupabaseStorage.delete_many over a mock
transport (the exact HTTP calls the worker makes).
"""

import json
import logging
from collections.abc import Callable, Iterator, Sequence
from typing import Any
from uuid import UUID, uuid4

import httpx2
import psycopg
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.domain.materials import JOB_DELETE_ACCOUNT
from app.jobs.auth_admin import AuthUnavailable, SupabaseAuthAdmin
from app.jobs.ingest import HANDLERS, ON_CRASHED
from app.jobs.storage import StorageUnavailable, SupabaseStorage
from app.jobs.worker import Worker
from tests.api.factories import NOW, TEST_PROFILE, scalar
from tests.api.test_account import USER_COLUMN, counts, fill_account
from tests.fixtures_db import ApiUser, FrozenClock
from tests.jobs.fake_storage import MemoryStorage

type MakeApiUser = Callable[[], ApiUser]
type MakeWorker = Callable[..., Worker]

URL = "https://proj.supabase.co"


class ObjectsStorage(MemoryStorage):
    """MemoryStorage that also deletes the storage.objects rows, like Supabase Storage."""

    def __init__(self, url: str) -> None:
        super().__init__()
        self._url = url

    def delete_many(self, paths: Sequence[str]) -> None:
        super().delete_many(paths)
        with psycopg.connect(self._url, autocommit=True) as conn:
            conn.execute(
                "DELETE FROM storage.objects WHERE bucket_id = 'materials' AND name = ANY(%s)",
                (list(paths),),
            )


class FakeAuthAdmin:
    """Deletes the auth.users row in the test database; can be told to fail or to 404."""

    def __init__(self, url: str) -> None:
        self._url = url
        self.calls: list[UUID] = []
        self.failure: Exception | None = None

    def delete_user(self, user_id: UUID) -> None:
        self.calls.append(user_id)
        if self.failure is not None:
            raise self.failure
        with psycopg.connect(self._url, autocommit=True) as conn:
            # A user already gone is a success, like the real 404.
            conn.execute("DELETE FROM auth.users WHERE id = %s", (user_id,))


@pytest.fixture
def storage(migrated_database_url: str) -> MemoryStorage:
    return ObjectsStorage(migrated_database_url)


@pytest.fixture
def auth_admin(migrated_database_url: str) -> FakeAuthAdmin:
    return FakeAuthAdmin(migrated_database_url)


@pytest.fixture
def account_worker(
    migrated_database_url: str,
    storage: MemoryStorage,
    worker_settings: Settings,
    clock: FrozenClock,
    auth_admin: FakeAuthAdmin,
    db: psycopg.Connection,
) -> Iterator[Worker]:
    """The real handlers, like the `worker` fixture, with the fake Auth admin."""
    worker = Worker(
        migrated_database_url,
        storage=storage,
        settings=worker_settings,
        handlers=HANDLERS,
        clock=clock,
        on_crashed=ON_CRASHED,
        auth_admin_factory=lambda settings: auth_admin,
    )
    worker.connect()
    try:
        yield worker
    finally:
        worker.close()


@pytest.fixture
def new_user(
    api: TestClient, make_api_user: MakeApiUser, clock: FrozenClock
) -> Callable[[], ApiUser]:
    clock.set(NOW)

    def make() -> ApiUser:
        user = make_api_user()
        response = api.patch("/me", json=TEST_PROFILE, headers=user.headers)
        assert response.status_code == 200, response.text
        return user

    return make


def _put_object(db: psycopg.Connection, storage: MemoryStorage, name: str) -> None:
    """A file in the bucket: a storage.objects row and its bytes in the fake storage."""
    db.execute(
        "INSERT INTO storage.objects (bucket_id, name) VALUES ('materials', %s)",
        (name,),
    )
    storage.files[name] = b"%PDF"


def _objects(db: psycopg.Connection, user_id: UUID) -> list[str]:
    rows = db.execute(
        "SELECT name FROM storage.objects WHERE bucket_id = 'materials' "
        "AND (storage.foldername(name))[1] = %s ORDER BY name",
        (str(user_id),),
    ).fetchall()
    return [name for (name,) in rows]


def _delete_me(api: TestClient, db: psycopg.Connection, clock: FrozenClock, user: ApiUser) -> UUID:
    response = api.delete("/me", headers=user.headers)
    assert response.status_code == 202, response.text
    job_id = UUID(response.json()["job_id"])
    # The API's jobs get run_at from the database clock; move the frozen one up to it.
    run_at = scalar(db, "SELECT run_at FROM app.jobs WHERE id = %s", job_id)
    if run_at > clock.now:
        clock.set(run_at)
    return job_id


def _job(db: psycopg.Connection, job_id: UUID) -> tuple[str, str | None, int] | None:
    row = db.execute(
        "SELECT status, error, attempts FROM app.jobs WHERE id = %s", (job_id,)
    ).fetchone()
    return None if row is None else (row[0], row[1], row[2])


@pytest.fixture
def two_users(
    db: psycopg.Connection, storage: MemoryStorage, new_user: Callable[[], ApiUser]
) -> tuple[ApiUser, ApiUser]:
    """A and B, each with rows in every app table and two files in their own folder."""
    a, b = new_user(), new_user()
    for user in (a, b):
        filled = fill_account(db, user.id)
        _put_object(db, storage, filled.storage_path)
        _put_object(db, storage, f"{user.id}/{filled.exam_id}/{uuid4()}")
    # fill_account's own job must not be the one the worker claims.
    db.execute("UPDATE app.jobs SET run_at = now() + interval '1 year'")
    return a, b


# --- the job, end to end --------------------------------------------------------------------


def test_delete_account_removes_the_files_and_the_auth_user(
    api: TestClient,
    db: psycopg.Connection,
    clock: FrozenClock,
    storage: MemoryStorage,
    auth_admin: FakeAuthAdmin,
    account_worker: Worker,
    two_users: tuple[ApiUser, ApiUser],
    caplog: pytest.LogCaptureFixture,
) -> None:
    a, b = two_users
    a_files = _objects(db, a.id)
    b_files = _objects(db, b.id)
    assert len(a_files) == 2
    b_counts = counts(db, b.id)
    job_id = _delete_me(api, db, clock, a)

    with caplog.at_level(logging.INFO):
        assert account_worker.run_once() is True

    assert auth_admin.calls == [a.id]
    assert scalar(db, "SELECT count(*) FROM auth.users WHERE id = %s", a.id) == 0
    # The cascade took the job row too.
    assert counts(db, a.id) == dict.fromkeys(USER_COLUMN, 0)
    assert _job(db, job_id) is None
    assert _objects(db, a.id) == []
    assert not any(name.startswith(f"{a.id}/") for name in storage.files)
    assert sorted(storage.deleted) == a_files
    # B is untouched: files, Auth and app rows.
    assert _objects(db, b.id) == b_files
    assert all(name in storage.files for name in b_files)
    assert scalar(db, "SELECT count(*) FROM auth.users WHERE id = %s", b.id) == 1
    assert counts(db, b.id) == b_counts
    # The job row went with its user: no "claim lost" warning, no error.
    assert not [record for record in caplog.records if record.levelno >= logging.WARNING]
    # And the old token is now unauthenticated.
    assert api.get("/me", headers=a.headers).status_code == 401


def test_a_user_without_files_is_still_deleted_from_auth(
    api: TestClient,
    db: psycopg.Connection,
    clock: FrozenClock,
    storage: MemoryStorage,
    auth_admin: FakeAuthAdmin,
    account_worker: Worker,
    new_user: Callable[[], ApiUser],
) -> None:
    user = new_user()
    _delete_me(api, db, clock, user)

    assert account_worker.run_once() is True

    assert storage.batches == []
    assert auth_admin.calls == [user.id]
    assert scalar(db, "SELECT count(*) FROM auth.users WHERE id = %s", user.id) == 0


def test_storage_unavailable_retries_without_calling_auth(
    api: TestClient,
    db: psycopg.Connection,
    clock: FrozenClock,
    storage: MemoryStorage,
    auth_admin: FakeAuthAdmin,
    account_worker: Worker,
    two_users: tuple[ApiUser, ApiUser],
) -> None:
    a, _ = two_users
    storage.failures[_objects(db, a.id)[0]] = StorageUnavailable("down")
    job_id = _delete_me(api, db, clock, a)

    assert account_worker.run_once() is True

    assert _job(db, job_id) == ("queued", "storage_unavailable", 1)
    assert auth_admin.calls == []
    assert scalar(db, "SELECT count(*) FROM auth.users WHERE id = %s", a.id) == 1


def test_auth_unavailable_retries_and_the_next_run_finishes(
    api: TestClient,
    db: psycopg.Connection,
    clock: FrozenClock,
    storage: MemoryStorage,
    auth_admin: FakeAuthAdmin,
    account_worker: Worker,
    two_users: tuple[ApiUser, ApiUser],
) -> None:
    a, _ = two_users
    auth_admin.failure = AuthUnavailable("auth admin: status 503")
    job_id = _delete_me(api, db, clock, a)

    assert account_worker.run_once() is True

    assert _job(db, job_id) == ("queued", "auth_unavailable", 1)
    # The files are already gone; a retry lists nothing and goes straight to Auth.
    assert _objects(db, a.id) == []
    auth_admin.failure = None
    clock.advance(hours=1)
    assert account_worker.run_once() is True
    assert auth_admin.calls == [a.id, a.id]
    assert _job(db, job_id) is None
    assert scalar(db, "SELECT count(*) FROM auth.users WHERE id = %s", a.id) == 0


def test_a_user_already_gone_from_auth_is_a_success(
    api: TestClient,
    db: psycopg.Connection,
    clock: FrozenClock,
    auth_admin: FakeAuthAdmin,
    account_worker: Worker,
    new_user: Callable[[], ApiUser],
    caplog: pytest.LogCaptureFixture,
) -> None:
    # The fake ignores a missing user, as SupabaseAuthAdmin does with a 404: here the job
    # row stays (no cascade), and the job ends done.
    user = new_user()
    job_id = _delete_me(api, db, clock, user)
    auth_admin.failure = None

    def gone(user_id: UUID) -> None:
        auth_admin.calls.append(user_id)

    auth_admin.delete_user = gone  # type: ignore[method-assign]

    with caplog.at_level(logging.INFO):
        assert account_worker.run_once() is True

    assert _job(db, job_id) == ("done", None, 1)
    assert not [record for record in caplog.records if record.levelno >= logging.WARNING]


def test_a_forged_name_outside_the_users_folder_is_never_deleted(
    api: TestClient,
    db: psycopg.Connection,
    clock: FrozenClock,
    storage: MemoryStorage,
    auth_admin: FakeAuthAdmin,
    account_worker: Worker,
    two_users: tuple[ApiUser, ApiUser],
) -> None:
    a, b = two_users
    # Its first folder is A's, so the listing returns it; the ".." would climb into B's.
    forged = f"{a.id}/../{b.id}/x"
    _put_object(db, storage, forged)
    job_id = _delete_me(api, db, clock, a)

    assert account_worker.run_once() is True

    # Refused before anything was deleted, and not retried.
    assert storage.batches == []
    assert storage.deleted == []
    assert auth_admin.calls == []
    assert _job(db, job_id) == ("failed", "unsafe_storage_path", 1)
    assert forged in _objects(db, a.id)


def test_the_listing_never_runs_inside_a_user_transaction(
    make_worker: MakeWorker,
    make_job: Callable[..., UUID],
    make_user: Callable[[], Any],
    read_job: Callable[[UUID], Any],
) -> None:
    from app.jobs.worker import JobContext

    seen: list[str] = []

    def handler(ctx: JobContext) -> None:
        with ctx.user_transaction():
            with pytest.raises(RuntimeError):
                ctx.user_storage_names("materials")
            seen.append("refused")
        assert ctx.user_storage_names("materials") == []
        seen.append("listed")

    user = make_user()
    job_id = make_job(user, "probe")
    assert make_worker({"probe": handler}).run_once() is True
    assert seen == ["refused", "listed"]
    assert read_job(job_id).status == "done"


def test_the_listing_is_only_the_jobs_users_folder(
    db: psycopg.Connection,
    make_worker: MakeWorker,
    make_job: Callable[..., UUID],
    make_user: Callable[[], Any],
) -> None:
    from app.jobs.worker import JobContext

    user, other = make_user(), make_user()
    for name in (
        f"{user.id}/e/m1",
        f"{user.id}/e/m2",
        f"{other.id}/e/m3",
        f"x{user.id}/e/m4",
        f"{user.id}",  # a file named like the folder, at the root: not inside it
    ):
        db.execute(
            "INSERT INTO storage.objects (bucket_id, name) VALUES ('materials', %s)", (name,)
        )
    db.execute("INSERT INTO storage.buckets (id, name) VALUES ('other', 'other')")
    db.execute(
        "INSERT INTO storage.objects (bucket_id, name) VALUES ('other', %s)", (f"{user.id}/o",)
    )
    names: list[list[str]] = []

    def handler(ctx: JobContext) -> None:
        names.append(ctx.user_storage_names("materials"))

    make_job(user, "probe")
    assert make_worker({"probe": handler}).run_once() is True
    assert names == [[f"{user.id}/e/m1", f"{user.id}/e/m2"]]


def test_the_default_auth_admin_needs_the_secret_key(settings: Settings) -> None:
    with pytest.raises(AuthUnavailable):
        SupabaseAuthAdmin.from_settings(settings.model_copy(update={"supabase_secret_key": None}))


# --- SupabaseAuthAdmin over a mock transport ------------------------------------------------

Handler = Callable[[httpx2.Request], httpx2.Response]


def _admin(handler: Handler, key: str = "k") -> SupabaseAuthAdmin:
    return SupabaseAuthAdmin(URL, key, transport=httpx2.MockTransport(handler))


def _raise(exc: Exception) -> Handler:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise exc

    return handler


def test_delete_user_sends_one_admin_delete_with_the_key() -> None:
    seen: list[httpx2.Request] = []
    user_id = uuid4()

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(200, json={})

    _admin(handler).delete_user(user_id)

    (request,) = seen
    assert request.method == "DELETE"
    assert str(request.url) == f"{URL}/auth/v1/admin/users/{user_id}"
    assert request.headers["Authorization"] == "Bearer k"
    assert request.headers["apikey"] == "k"
    assert request.content == b""


def test_delete_user_treats_404_as_done() -> None:
    _admin(lambda r: httpx2.Response(404, json={"code": "user_not_found"})).delete_user(uuid4())


@pytest.mark.parametrize(
    "handler",
    [
        lambda r: httpx2.Response(500),
        lambda r: httpx2.Response(503),
        lambda r: httpx2.Response(401),
        lambda r: httpx2.Response(403),
        lambda r: httpx2.Response(400),
        _raise(httpx2.ConnectError("boom")),
        _raise(httpx2.ReadTimeout("slow")),
    ],
)
def test_delete_user_maps_everything_else_to_unavailable(handler: Handler) -> None:
    with pytest.raises(AuthUnavailable):
        _admin(handler).delete_user(uuid4())


def test_auth_admin_repr_and_errors_hide_the_key() -> None:
    admin = _admin(lambda r: httpx2.Response(503, content=b"k-secret"), key="k-secret")
    assert "k-secret" not in repr(admin)
    with pytest.raises(AuthUnavailable) as info:
        admin.delete_user(uuid4())
    assert "k-secret" not in str(info.value)
    broken = _admin(_raise(httpx2.ConnectError("k-secret")), key="k-secret")
    with pytest.raises(AuthUnavailable) as info:
        broken.delete_user(uuid4())
    assert "k-secret" not in str(info.value)


def test_from_settings_uses_the_project_url_and_secret_key(settings: Settings) -> None:
    from pydantic import SecretStr

    admin = SupabaseAuthAdmin.from_settings(
        settings.model_copy(update={"supabase_secret_key": SecretStr("s-key")})
    )
    assert isinstance(admin, SupabaseAuthAdmin)
    assert "s-key" not in repr(admin)


# --- SupabaseStorage.delete_many over a mock transport --------------------------------------


def _storage(handler: Handler) -> SupabaseStorage:
    return SupabaseStorage(URL, "k", transport=httpx2.MockTransport(handler))


def test_delete_many_sends_prefixes_in_chunks_of_100() -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(200, json=[])

    paths = [f"u/e/{index:03}" for index in range(250)]
    _storage(handler).delete_many(paths)

    assert [request.method for request in seen] == ["DELETE"] * 3
    assert {request.url.path for request in seen} == {"/storage/v1/object/materials"}
    bodies = [json.loads(request.content) for request in seen]
    assert [len(body["prefixes"]) for body in bodies] == [100, 100, 50]
    assert [path for body in bodies for path in body["prefixes"]] == paths
    assert all(request.headers["Authorization"] == "Bearer k" for request in seen)
    assert all(request.headers["apikey"] == "k" for request in seen)


def test_delete_many_with_nothing_sends_nothing() -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(200)

    _storage(handler).delete_many([])
    assert seen == []


def test_delete_many_accepts_404() -> None:
    _storage(lambda r: httpx2.Response(404)).delete_many(["u/e/m"])


@pytest.mark.parametrize(
    "handler",
    [
        lambda r: httpx2.Response(500),
        lambda r: httpx2.Response(401),
        lambda r: httpx2.Response(400),
        _raise(httpx2.ConnectError("boom")),
        _raise(httpx2.ReadTimeout("slow")),
    ],
)
def test_delete_many_maps_outages(handler: Handler) -> None:
    with pytest.raises(StorageUnavailable):
        _storage(handler).delete_many(["u/e/m"])


def test_delete_many_stops_at_the_first_failed_chunk() -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(503)

    with pytest.raises(StorageUnavailable):
        _storage(handler).delete_many([f"u/e/{index}" for index in range(150)])
    assert len(seen) == 1


def test_memory_storage_delete_many_records_batches() -> None:
    storage = MemoryStorage()
    storage.files.update({"a": b"1", "b": b"2", "c": b"3"})
    storage.delete_many(["a", "b"])
    assert storage.batches == [["a", "b"]]
    assert storage.deleted == ["a", "b"]
    assert set(storage.files) == {"c"}
    storage.failures["c"] = StorageUnavailable("down")
    with pytest.raises(StorageUnavailable):
        storage.delete_many(["c"])
    assert "c" in storage.files


# --- registration ---------------------------------------------------------------------------


def test_delete_account_is_a_registered_handler() -> None:
    assert JOB_DELETE_ACCOUNT in HANDLERS
    # No crash callback: the app rows are already gone, and the next claim reruns or fails.
    assert JOB_DELETE_ACCOUNT not in ON_CRASHED
