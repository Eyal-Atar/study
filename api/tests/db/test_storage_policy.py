"""The private `materials` bucket and the per-user policies on storage.objects."""

from collections.abc import Callable, Iterator
from uuid import uuid4

import psycopg
import pytest
from psycopg import errors

from app.auth import CurrentUser
from app.db.session import user_transaction

UserFactory = Callable[[], CurrentUser]


@pytest.fixture(autouse=True)
def clean_storage(db: psycopg.Connection) -> Iterator[None]:
    """Objects live outside auth.users, so the db fixture's TRUNCATE does not remove them."""

    def clean() -> None:
        db.execute("DELETE FROM storage.objects")
        db.execute("DELETE FROM storage.buckets WHERE id <> 'materials'")

    clean()
    yield
    clean()


def path(user: CurrentUser) -> str:
    return f"{user.id}/{uuid4()}/{uuid4()}"


def put_object(db: psycopg.Connection, name: str, bucket: str = "materials") -> None:
    db.execute(
        "INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES (%s, %s, 'x')",
        (bucket, name),
    )


def try_insert(
    api_db: psycopg.Connection, user: CurrentUser, name: str, bucket: str = "materials"
) -> None:
    with user_transaction(api_db, user) as conn:
        conn.execute(
            "INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES (%s, %s, %s)",
            (bucket, name, str(user.id)),
        )


def test_bucket_is_private_with_limits(db: psycopg.Connection) -> None:
    row = db.execute(
        "SELECT public, file_size_limit, allowed_mime_types FROM storage.buckets "
        "WHERE id = 'materials'"
    ).fetchone()
    assert row == (False, 20971520, ["application/pdf", "image/jpeg", "image/png"])


def test_user_uploads_only_under_their_own_folder(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: UserFactory
) -> None:
    a, b = make_user(), make_user()
    db.execute("INSERT INTO storage.buckets (id, name) VALUES ('other', 'other')")

    try_insert(api_db, a, path(a))
    row = db.execute("SELECT count(*) FROM storage.objects").fetchone()
    assert row == (1,)

    denied = [
        (path(b), "materials"),
        (f"{a.id}/file.pdf", "materials"),
        (f"{a.id}/x/y/z", "materials"),
        (path(a), "other"),
    ]
    for name, bucket in denied:
        with pytest.raises(errors.InsufficientPrivilege):
            try_insert(api_db, a, name, bucket)


def test_user_reads_only_their_own_objects(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: UserFactory
) -> None:
    a, b = make_user(), make_user()
    mine, theirs = path(a), path(b)
    put_object(db, mine)
    put_object(db, theirs)

    with user_transaction(api_db, a) as conn:
        names = [r[0] for r in conn.execute("SELECT name FROM storage.objects").fetchall()]
    assert names == [mine]


def test_user_cannot_change_or_delete_objects(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: UserFactory
) -> None:
    a = make_user()
    name = path(a)
    put_object(db, name)

    with user_transaction(api_db, a) as conn:
        moved = conn.execute("UPDATE storage.objects SET name = %s", (path(a),))
        assert moved.rowcount == 0
        deleted = conn.execute("DELETE FROM storage.objects")
        assert deleted.rowcount == 0
    row = db.execute("SELECT name FROM storage.objects").fetchone()
    assert row == (name,)


def test_anon_sees_nothing(db: psycopg.Connection, make_user: UserFactory) -> None:
    put_object(db, path(make_user()))
    with db.transaction():
        db.execute("SET LOCAL ROLE anon")
        row = db.execute("SELECT count(*) FROM storage.objects").fetchone()
    assert row == (0,)


def test_policies_exist_for_authenticated_only(db: psycopg.Connection) -> None:
    rows = db.execute(
        "SELECT policyname, cmd, roles::text[] FROM pg_policies "
        "WHERE schemaname = 'storage' AND tablename = 'objects' ORDER BY policyname"
    ).fetchall()
    assert rows == [
        ("materials_read_own", "SELECT", ["authenticated"]),
        ("materials_upload_own", "INSERT", ["authenticated"]),
    ]
