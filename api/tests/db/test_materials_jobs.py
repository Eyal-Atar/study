from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from app.auth import CurrentUser
from app.db.session import user_transaction

MakeUser = Callable[[], CurrentUser]

_INSERT_MATERIAL = (
    "INSERT INTO app.materials (id, user_id, exam_id, storage_path, filename, kind, mime, "
    "size_bytes) VALUES (%s, %s, %s, %s, 'notes.pdf', 'notes', 'application/pdf', 1000)"
)


def _exam(db: psycopg.Connection, user_id: UUID) -> UUID:
    row = db.execute(
        "INSERT INTO app.exams (user_id, name, exam_date) VALUES (%s, 'x', '2027-01-01') "
        "RETURNING id",
        (user_id,),
    ).fetchone()
    assert row is not None
    return row[0]  # type: ignore[no-any-return]


def _material(db: psycopg.Connection, user_id: UUID, exam_id: UUID) -> UUID:
    """Insert a material as the owner connection, with a correct storage_path."""
    material_id = uuid4()
    db.execute(
        _INSERT_MATERIAL, (material_id, user_id, exam_id, f"{user_id}/{exam_id}/{material_id}")
    )
    return material_id


def _field(db: psycopg.Connection, material_id: UUID, column: str) -> Any:
    row = db.execute(
        f"SELECT {column} FROM app.materials WHERE id = %s",  # noqa: S608
        (material_id,),
    ).fetchone()
    assert row is not None
    return row[0]


def test_storage_path_must_follow_the_convention(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    user, other = make_user(), make_user()
    exam = _exam(db, user.id)
    material = uuid4()
    with user_transaction(api_db, user) as conn:
        conn.execute(_INSERT_MATERIAL, (material, user.id, exam, f"{user.id}/{exam}/{material}"))
    for path in (f"{other.id}/{exam}/{uuid4()}", f"{user.id}/{exam}/{uuid4()}/extra"):
        with pytest.raises(psycopg.errors.CheckViolation):
            with user_transaction(api_db, user) as conn:
                conn.execute(_INSERT_MATERIAL, (uuid4(), user.id, exam, path))


def test_authenticated_insert_is_limited_to_registration_columns(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    exam = _exam(db, user.id)
    base = (
        "INSERT INTO app.materials (id, user_id, exam_id, storage_path, filename, kind, mime, "
        "size_bytes{extra}) VALUES (%s, %s, %s, %s, 'n.pdf', 'notes', 'application/pdf', 5{value})"
    )
    for extra, value in (
        (", ingest_status", ", 'ready'"),
        (", text_by_page", ", '[]'::jsonb"),
    ):
        material = uuid4()
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with user_transaction(api_db, user) as conn:
                conn.execute(
                    base.format(extra=extra, value=value),
                    (material, user.id, exam, f"{user.id}/{exam}/{material}"),
                )
    material = uuid4()
    with user_transaction(api_db, user) as conn:
        conn.execute(
            base.format(extra="", value=""),
            (material, user.id, exam, f"{user.id}/{exam}/{material}"),
        )
    assert _field(db, material, "ingest_status") == "queued"
    assert _field(db, material, "warnings") == []


def test_authenticated_update_is_limited_to_result_columns(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    a, b = make_user(), make_user()
    mine = _material(db, a.id, _exam(db, a.id))
    theirs = _material(db, b.id, _exam(db, b.id))
    for column, value in (("filename", "evil.pdf"), ("storage_path", "x")):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with user_transaction(api_db, a) as conn:
                conn.execute(
                    f"UPDATE app.materials SET {column} = %s WHERE id = %s",  # noqa: S608
                    (value, mine),
                )
    update = (
        "UPDATE app.materials SET ingest_status = 'ready', page_count = 2, scanned_pages = 0, "
        "text_by_page = %s, ingested_at = now() WHERE id = %s"
    )
    with user_transaction(api_db, a) as conn:
        assert conn.execute(update, (Jsonb(["a", "b"]), mine)).rowcount == 1
    with user_transaction(api_db, a) as conn:
        assert conn.execute(update, (Jsonb(["a", "b"]), theirs)).rowcount == 0
    assert _field(db, mine, "ingest_status") == "ready"
    assert _field(db, theirs, "ingest_status") == "queued"
    assert _field(db, theirs, "text_by_page") is None


@pytest.mark.parametrize(
    "assignment",
    [
        "ingest_status = 'ready', page_count = 1, scanned_pages = 0, ingested_at = now()",
        "ingest_status = 'failed'",
        "ingest_status = 'failed', ingest_error = 'Boom!'",
    ],
    ids=["ready-without-text", "failed-without-error", "error-format"],
)
def test_ready_and_failed_need_their_fields(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser, assignment: str
) -> None:
    user = make_user()
    material = _material(db, user.id, _exam(db, user.id))
    with pytest.raises(psycopg.errors.CheckViolation):
        with user_transaction(api_db, user) as conn:
            conn.execute(
                f"UPDATE app.materials SET {assignment} WHERE id = %s",  # noqa: S608
                (material,),
            )


def test_material_of_another_users_exam_is_rejected(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    user, other = make_user(), make_user()
    foreign_exam = _exam(db, other.id)
    material = uuid4()
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        with user_transaction(api_db, user) as conn:
            conn.execute(
                _INSERT_MATERIAL,
                (material, user.id, foreign_exam, f"{user.id}/{foreign_exam}/{material}"),
            )


def test_deleting_an_exam_deletes_its_materials(
    db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    exam = _exam(db, user.id)
    material = _material(db, user.id, exam)
    db.execute("DELETE FROM app.exams WHERE id = %s", (exam,))
    row = db.execute("SELECT count(*) FROM app.materials WHERE id = %s", (material,)).fetchone()
    assert row == (0,)


def test_user_can_delete_only_their_own_material(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    a, b = make_user(), make_user()
    mine = _material(db, a.id, _exam(db, a.id))
    theirs = _material(db, b.id, _exam(db, b.id))
    with user_transaction(api_db, a) as conn:
        assert conn.execute("DELETE FROM app.materials WHERE id = %s", (theirs,)).rowcount == 0
        assert conn.execute("DELETE FROM app.materials WHERE id = %s", (mine,)).rowcount == 1


def test_jobs_insert_is_limited_to_user_kind_payload(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    for column, value in (("status", "'done'"), ("run_at", "now()")):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with user_transaction(api_db, user) as conn:
                conn.execute(
                    f"INSERT INTO app.jobs (user_id, kind, payload, {column}) "  # noqa: S608
                    f"VALUES (%s, 'ingest', '{{}}', {value})",
                    (user.id,),
                )
    with user_transaction(api_db, user) as conn:
        conn.execute(
            "INSERT INTO app.jobs (user_id, kind, payload) VALUES (%s, 'ingest', %s)",
            (user.id, Jsonb({"material_id": "m"})),
        )
    row = db.execute("SELECT status, attempts, max_attempts FROM app.jobs").fetchone()
    assert row == ("queued", 0, 3)


def test_authenticated_cannot_update_or_delete_jobs(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    db.execute("INSERT INTO app.jobs (user_id, kind) VALUES (%s, 'ingest')", (user.id,))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with user_transaction(api_db, user) as conn:
            conn.execute("UPDATE app.jobs SET status = 'done'")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with user_transaction(api_db, user) as conn:
            conn.execute("DELETE FROM app.jobs")


def test_jobs_are_visible_to_their_owner_only(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    a, b = make_user(), make_user()
    with user_transaction(api_db, a) as conn:
        conn.execute("INSERT INTO app.jobs (user_id, kind) VALUES (%s, 'ingest')", (a.id,))
    with user_transaction(api_db, b) as conn:
        assert conn.execute("SELECT count(*) FROM app.jobs").fetchone() == (0,)
    with user_transaction(api_db, a) as conn:
        assert conn.execute("SELECT count(*) FROM app.jobs").fetchone() == (1,)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with user_transaction(api_db, b) as conn:
            conn.execute("INSERT INTO app.jobs (user_id, kind) VALUES (%s, 'ingest')", (a.id,))


@pytest.mark.parametrize(
    "columns, values",
    [
        ("kind", "'Ingest'"),
        ("kind, payload", "'ingest', '[]'"),
        ("kind, percent", "'ingest', 101"),
        ("kind, max_attempts", "'ingest', 0"),
    ],
    ids=["kind-format", "payload-array", "percent-101", "max-attempts-0"],
)
def test_job_constraints(
    db: psycopg.Connection, make_user: MakeUser, columns: str, values: str
) -> None:
    user = make_user()
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute(
            f"INSERT INTO app.jobs (user_id, {columns}) VALUES (%s, {values})",  # noqa: S608
            (user.id,),
        )
