"""Migration 0014: weekly commitments, one-off busy events, and the hobby moved to commitments."""

import os
from collections.abc import Callable
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from alembic import command

from app.auth import CurrentUser
from app.db.session import user_transaction
from tests.db.support import admin_database_url, alembic_config, create_database, drop_database

MakeUser = Callable[[], CurrentUser]

_HOBBY_TITLE = "זמן לעצמי"
_START = datetime(2026, 11, 20, 8, 0, tzinfo=UTC)
# valid_until, source_job_id and deleted_at of a moved hobby.
_NO_DATES = (None, None, None)


def _one(db: psycopg.Connection, query: str, params: Any) -> Any:
    row = db.execute(query, params).fetchone()
    assert row is not None
    return row[0]


def _profile(db: psycopg.Connection, user_id: UUID) -> None:
    db.execute("INSERT INTO app.profiles (id) VALUES (%s)", (user_id,))


def _job(db: psycopg.Connection, user_id: UUID) -> UUID:
    job: UUID = _one(
        db,
        "INSERT INTO app.jobs (user_id, kind, payload) VALUES (%s, 'parse_timetable', '{}') "
        "RETURNING id",
        (user_id,),
    )
    return job


def _commitment(db: psycopg.Connection, user_id: UUID, **overrides: Any) -> UUID:
    values: dict[str, Any] = {
        "title": "Work",
        "kind": "work",
        "weekday": 1,
        "start_time": time(16),
        "end_time": time(22),
        "valid_from": date(2026, 11, 1),
        "valid_until": None,
        "source_job_id": None,
        **overrides,
    }
    commitment: UUID = _one(
        db,
        "INSERT INTO app.commitments (user_id, title, kind, weekday, start_time, end_time, "
        "valid_from, valid_until, source_job_id) VALUES (%(user_id)s, %(title)s, %(kind)s, "
        "%(weekday)s, %(start_time)s, %(end_time)s, %(valid_from)s, %(valid_until)s, "
        "%(source_job_id)s) RETURNING id",
        {"user_id": user_id, **values},
    )
    return commitment


def _event(db: psycopg.Connection, user_id: UUID, **overrides: Any) -> UUID:
    values: dict[str, Any] = {
        "title": "Wedding",
        "starts_at": _START,
        "ends_at": _START + timedelta(hours=3),
        **overrides,
    }
    event: UUID = _one(
        db,
        "INSERT INTO app.busy_events (user_id, title, starts_at, ends_at) "
        "VALUES (%(user_id)s, %(title)s, %(starts_at)s, %(ends_at)s) RETURNING id",
        {"user_id": user_id, **values},
    )
    return event


def _version(
    db: psycopg.Connection,
    user_id: UUID,
    busy_event_id: UUID | None = None,
    busy_event_before: str | None = None,
) -> UUID:
    version: UUID = _one(
        db,
        "INSERT INTO app.plan_versions (user_id, reason, snapshot, busy_event_id, "
        "busy_event_before) VALUES (%s, 'busy_added', '{\"v\": 1, \"blocks\": []}', %s, %s) "
        "RETURNING id",
        (user_id, busy_event_id, busy_event_before),
    )
    return version


# --- shape -------------------------------------------------------------------------------


def test_columns(db: psycopg.Connection) -> None:
    rows = db.execute(
        "SELECT table_name, column_name, data_type, is_nullable, column_default "
        "FROM information_schema.columns "
        "WHERE table_schema = 'app' AND table_name IN ('commitments', 'busy_events') "
        "ORDER BY table_name, ordinal_position"
    ).fetchall()
    tz = "timestamp with time zone"
    assert rows == [
        ("busy_events", "id", "uuid", "NO", "gen_random_uuid()"),
        ("busy_events", "user_id", "uuid", "NO", None),
        ("busy_events", "title", "text", "YES", None),
        ("busy_events", "starts_at", tz, "NO", None),
        ("busy_events", "ends_at", tz, "NO", None),
        ("busy_events", "created_at", tz, "NO", "now()"),
        ("busy_events", "deleted_at", tz, "YES", None),
        ("commitments", "id", "uuid", "NO", "gen_random_uuid()"),
        ("commitments", "user_id", "uuid", "NO", None),
        ("commitments", "title", "text", "NO", None),
        ("commitments", "kind", "text", "NO", None),
        ("commitments", "weekday", "smallint", "NO", None),
        ("commitments", "start_time", "time without time zone", "NO", None),
        ("commitments", "end_time", "time without time zone", "NO", None),
        ("commitments", "valid_from", "date", "NO", None),
        ("commitments", "valid_until", "date", "YES", None),
        ("commitments", "source_job_id", "uuid", "YES", None),
        ("commitments", "created_at", tz, "NO", "now()"),
        ("commitments", "deleted_at", tz, "YES", None),
    ]
    plan_columns = db.execute(
        "SELECT column_name, data_type, is_nullable FROM information_schema.columns "
        "WHERE table_schema = 'app' AND table_name = 'plan_versions' "
        "AND column_name IN ('busy_event_id', 'busy_event_before') ORDER BY ordinal_position"
    ).fetchall()
    assert plan_columns == [("busy_event_id", "uuid", "YES"), ("busy_event_before", "jsonb", "YES")]


def test_keys_and_indexes(db: psycopg.Connection) -> None:
    constraints: dict[str, str] = dict(
        db.execute(
            "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint "
            "WHERE conrelid IN ('app.commitments'::regclass, 'app.busy_events'::regclass, "
            "'app.plan_versions'::regclass) AND contype IN ('p', 'u', 'f')"
        ).fetchall()
    )
    assert constraints["commitments_pkey"] == "PRIMARY KEY (id)"
    assert constraints["commitments_id_user_id_key"] == "UNIQUE (id, user_id)"
    assert constraints["commitments_user_id_fkey"] == (
        "FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE"
    )
    assert constraints["commitments_source_job_fkey"] == (
        "FOREIGN KEY (source_job_id, user_id) REFERENCES app.jobs(id, user_id) "
        "ON DELETE SET NULL (source_job_id)"
    )
    assert constraints["busy_events_pkey"] == "PRIMARY KEY (id)"
    assert constraints["busy_events_id_user_id_key"] == "UNIQUE (id, user_id)"
    assert constraints["busy_events_user_id_fkey"] == (
        "FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE"
    )
    assert constraints["plan_versions_busy_event_fkey"] == (
        "FOREIGN KEY (busy_event_id, user_id) REFERENCES app.busy_events(id, user_id) "
        "ON DELETE SET NULL (busy_event_id)"
    )
    indexes: dict[str, str] = dict(
        db.execute(
            "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'app' AND indexname "
            "IN ('commitments_user_live_idx', 'commitments_source_job_idx', "
            "'busy_events_user_ends_at_idx', 'plan_versions_busy_event_idx')"
        ).fetchall()
    )
    assert indexes == {
        "commitments_user_live_idx": "CREATE INDEX commitments_user_live_idx ON app.commitments "
        "USING btree (user_id) WHERE (deleted_at IS NULL)",
        "commitments_source_job_idx": "CREATE INDEX commitments_source_job_idx "
        "ON app.commitments USING btree (source_job_id) WHERE (source_job_id IS NOT NULL)",
        "busy_events_user_ends_at_idx": "CREATE INDEX busy_events_user_ends_at_idx "
        "ON app.busy_events USING btree (user_id, ends_at) WHERE (deleted_at IS NULL)",
        "plan_versions_busy_event_idx": "CREATE INDEX plan_versions_busy_event_idx "
        "ON app.plan_versions USING btree (busy_event_id) WHERE (busy_event_id IS NOT NULL)",
    }


# --- CHECKs on commitments --------------------------------------------------------------


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"title": ""}, id="title-empty"),
        pytest.param({"title": "   "}, id="title-blank"),
        pytest.param({"title": "x" * 101}, id="title-101"),
        pytest.param({"kind": "gym"}, id="kind-unknown"),
        pytest.param({"kind": "Work"}, id="kind-case"),
        pytest.param({"weekday": -1}, id="weekday-minus-1"),
        pytest.param({"weekday": 7}, id="weekday-7"),
        pytest.param({"start_time": time(16, 0, 30)}, id="start-seconds"),
        pytest.param({"end_time": time(22, 0, 0, 1)}, id="end-microseconds"),
        pytest.param({"start_time": time(16), "end_time": time(16)}, id="start-equals-end"),
        pytest.param({"start_time": time(16), "end_time": time(16, 14)}, id="14-minutes"),
        pytest.param({"start_time": time(23, 50), "end_time": time(0, 4)}, id="14-over-midnight"),
        pytest.param(
            {"valid_from": date(2026, 11, 2), "valid_until": date(2026, 11, 1)},
            id="until-before-from",
        ),
    ],
)
def test_commitment_checks_reject(
    db: psycopg.Connection, make_user: MakeUser, overrides: dict[str, Any]
) -> None:
    user = make_user()
    with pytest.raises(psycopg.errors.CheckViolation):
        _commitment(db, user.id, **overrides)


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"title": "x"}, id="title-1"),
        pytest.param({"title": "א" * 100}, id="title-100-hebrew"),
        pytest.param({"kind": "class"}, id="kind-class"),
        pytest.param({"kind": "other"}, id="kind-other"),
        pytest.param({"weekday": 0}, id="weekday-0"),
        pytest.param({"weekday": 6}, id="weekday-6"),
        pytest.param({"start_time": time(16), "end_time": time(16, 15)}, id="15-minutes"),
        pytest.param({"start_time": time(23, 50), "end_time": time(0, 5)}, id="15-over-midnight"),
        pytest.param({"start_time": time(22), "end_time": time(6)}, id="night-shift"),
        pytest.param({"start_time": time(0), "end_time": time(23, 59)}, id="whole-day"),
        pytest.param(
            {"valid_from": date(2026, 11, 1), "valid_until": date(2026, 11, 1)},
            id="until-equals-from",
        ),
    ],
)
def test_commitment_checks_accept_the_edges(
    db: psycopg.Connection, make_user: MakeUser, overrides: dict[str, Any]
) -> None:
    user = make_user()
    _commitment(db, user.id, **overrides)


# --- CHECKs on busy_events --------------------------------------------------------------


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"title": ""}, id="title-empty"),
        pytest.param({"title": "  "}, id="title-blank"),
        pytest.param({"title": "x" * 101}, id="title-101"),
        pytest.param({"starts_at": _START + timedelta(seconds=30)}, id="start-seconds"),
        pytest.param(
            {"ends_at": _START + timedelta(hours=1, microseconds=1)}, id="end-microseconds"
        ),
        pytest.param({"ends_at": _START}, id="ends-equals-starts"),
        pytest.param({"ends_at": _START - timedelta(minutes=1)}, id="ends-before-starts"),
        pytest.param({"ends_at": _START + timedelta(days=14, minutes=1)}, id="over-14-days"),
    ],
)
def test_busy_event_checks_reject(
    db: psycopg.Connection, make_user: MakeUser, overrides: dict[str, Any]
) -> None:
    user = make_user()
    with pytest.raises(psycopg.errors.CheckViolation):
        _event(db, user.id, **overrides)


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"title": None}, id="no-title"),
        pytest.param({"title": "x"}, id="title-1"),
        pytest.param({"title": "א" * 100}, id="title-100"),
        pytest.param({"ends_at": _START + timedelta(minutes=1)}, id="one-minute"),
        pytest.param({"ends_at": _START + timedelta(days=14)}, id="exactly-14-days"),
    ],
)
def test_busy_event_checks_accept_the_edges(
    db: psycopg.Connection, make_user: MakeUser, overrides: dict[str, Any]
) -> None:
    user = make_user()
    _event(db, user.id, **overrides)


@pytest.mark.parametrize("before", ["[]", '"x"', "1", "null"])
def test_busy_event_before_must_be_an_object(
    db: psycopg.Connection, make_user: MakeUser, before: str
) -> None:
    user = make_user()
    with pytest.raises(psycopg.errors.CheckViolation):
        _version(db, user.id, busy_event_before=before)


def test_busy_event_before_accepts_an_object_or_sql_null(
    db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    event = _event(db, user.id)
    _version(db, user.id, event, '{"starts_at": "2026-11-20T08:00:00Z"}')
    _version(db, user.id, event, None)


# --- RLS and grants ---------------------------------------------------------------------


def test_the_owner_inserts_reads_updates_and_soft_deletes(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    job = _job(db, user.id)
    with user_transaction(api_db, user) as conn:
        commitment = _commitment(conn, user.id, source_job_id=job)
        event = _event(conn, user.id)
        version = _version(conn, user.id, event, '{"title": null}')
        conn.execute(
            "UPDATE app.commitments SET title = 'Shift', kind = 'other', weekday = 3, "
            "start_time = '22:00', end_time = '06:00', valid_from = '2026-11-02', "
            "valid_until = '2027-01-10', deleted_at = now() WHERE id = %s",
            (commitment,),
        )
        conn.execute(
            "UPDATE app.busy_events SET title = NULL, starts_at = %s, ends_at = %s, "
            "deleted_at = now() WHERE id = %s",
            (_START + timedelta(hours=1), _START + timedelta(hours=2), event),
        )
        row = conn.execute(
            "SELECT title, kind, weekday, start_time, end_time, valid_until, source_job_id, "
            "deleted_at IS NOT NULL FROM app.commitments"
        ).fetchone()
        assert row == ("Shift", "other", 3, time(22), time(6), date(2027, 1, 10), job, True)
        assert conn.execute(
            "SELECT title, starts_at, deleted_at IS NOT NULL FROM app.busy_events"
        ).fetchone() == (None, _START + timedelta(hours=1), True)
        assert conn.execute(
            "SELECT busy_event_id FROM app.plan_versions WHERE id = %s", (version,)
        ).fetchone() == (event,)


def test_another_user_neither_sees_nor_changes(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    owner, other = make_user(), make_user()
    commitment = _commitment(db, owner.id)
    event = _event(db, owner.id)
    with user_transaction(api_db, other) as conn:
        assert conn.execute("SELECT id FROM app.commitments").fetchall() == []
        assert conn.execute("SELECT id FROM app.busy_events").fetchall() == []
        assert conn.execute("UPDATE app.commitments SET title = 'mine'").rowcount == 0
        assert conn.execute("UPDATE app.busy_events SET deleted_at = now()").rowcount == 0
    assert db.execute("SELECT id, title FROM app.commitments").fetchall() == [(commitment, "Work")]
    assert db.execute("SELECT id, deleted_at FROM app.busy_events").fetchall() == [(event, None)]


@pytest.mark.parametrize("table", ["commitments", "busy_events"])
def test_another_user_cannot_insert_for_the_owner(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser, table: str
) -> None:
    owner, other = make_user(), make_user()
    insert = _commitment if table == "commitments" else _event
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with user_transaction(api_db, other) as conn:
            insert(conn, owner.id)


@pytest.mark.parametrize(
    "query",
    [
        "UPDATE app.commitments SET user_id = %(other)s",
        "UPDATE app.commitments SET created_at = now()",
        "UPDATE app.commitments SET source_job_id = NULL",
        "UPDATE app.commitments SET id = gen_random_uuid()",
        "DELETE FROM app.commitments",
        "UPDATE app.busy_events SET user_id = %(other)s",
        "UPDATE app.busy_events SET created_at = now()",
        "UPDATE app.busy_events SET id = gen_random_uuid()",
        "DELETE FROM app.busy_events",
        "INSERT INTO app.commitments (id, user_id, title, kind, weekday, start_time, end_time, "
        "valid_from) VALUES (gen_random_uuid(), %(user)s, 'x', 'work', 1, '10:00', '12:00', "
        "'2026-11-01')",
        "INSERT INTO app.commitments (user_id, title, kind, weekday, start_time, end_time, "
        "valid_from, created_at) VALUES (%(user)s, 'x', 'work', 1, '10:00', '12:00', "
        "'2026-11-01', now())",
        "INSERT INTO app.commitments (user_id, title, kind, weekday, start_time, end_time, "
        "valid_from, deleted_at) VALUES (%(user)s, 'x', 'work', 1, '10:00', '12:00', "
        "'2026-11-01', now())",
        "INSERT INTO app.busy_events (id, user_id, starts_at, ends_at) "
        "VALUES (gen_random_uuid(), %(user)s, '2026-11-20T08:00Z', '2026-11-20T09:00Z')",
        "INSERT INTO app.busy_events (user_id, starts_at, ends_at, created_at) "
        "VALUES (%(user)s, '2026-11-20T08:00Z', '2026-11-20T09:00Z', now())",
        "INSERT INTO app.busy_events (user_id, starts_at, ends_at, deleted_at) "
        "VALUES (%(user)s, '2026-11-20T08:00Z', '2026-11-20T09:00Z', now())",
    ],
)
def test_the_owner_cannot_write_server_columns_or_delete(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser, query: str
) -> None:
    user, other = make_user(), make_user()
    _commitment(db, user.id)
    _event(db, user.id)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with user_transaction(api_db, user) as conn:
            conn.execute(query, {"user": user.id, "other": other.id})


def test_column_grants(db: psycopg.Connection) -> None:
    rows = db.execute(
        "SELECT table_name, privilege_type, array_agg(column_name::text ORDER BY column_name) "
        "FROM information_schema.column_privileges "
        "WHERE table_schema = 'app' AND table_name IN ('commitments', 'busy_events') "
        "AND grantee = 'authenticated' AND privilege_type IN ('INSERT', 'UPDATE') "
        "GROUP BY 1, 2 ORDER BY 1, 2"
    ).fetchall()
    assert rows == [
        ("busy_events", "INSERT", ["ends_at", "starts_at", "title", "user_id"]),
        ("busy_events", "UPDATE", ["deleted_at", "ends_at", "starts_at", "title"]),
        (
            "commitments",
            "INSERT",
            sorted(
                [
                    "user_id",
                    "title",
                    "kind",
                    "weekday",
                    "start_time",
                    "end_time",
                    "valid_from",
                    "valid_until",
                    "source_job_id",
                ]
            ),
        ),
        (
            "commitments",
            "UPDATE",
            sorted(
                [
                    "title",
                    "kind",
                    "weekday",
                    "start_time",
                    "end_time",
                    "valid_from",
                    "valid_until",
                    "deleted_at",
                ]
            ),
        ),
    ]
    plan_insert = db.execute(
        "SELECT array_agg(column_name::text ORDER BY column_name) "
        "FROM information_schema.column_privileges WHERE table_schema = 'app' "
        "AND table_name = 'plan_versions' AND grantee = 'authenticated' "
        "AND privilege_type = 'INSERT'"
    ).fetchone()
    assert plan_insert == (
        sorted(
            [
                "user_id",
                "reason",
                "snapshot",
                "exam_id",
                "task_id",
                "task_before",
                "analysis_id",
                "block_id",
                "busy_event_id",
                "busy_event_before",
            ]
        ),
    )
    for table in ("commitments", "busy_events"):
        for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
            assert db.execute(
                "SELECT has_table_privilege('anon', %s, %s)", (f"app.{table}", privilege)
            ).fetchone() == (False,), (table, privilege)


# --- foreign keys ------------------------------------------------------------------------


def test_source_job_must_be_the_users_own(db: psycopg.Connection, make_user: MakeUser) -> None:
    owner, other = make_user(), make_user()
    job = _job(db, owner.id)
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        _commitment(db, other.id, source_job_id=job)
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        _commitment(db, owner.id, source_job_id=uuid4())


def test_deleting_the_job_keeps_the_commitment(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    job = _job(db, user.id)
    commitment = _commitment(db, user.id, source_job_id=job)
    db.execute("DELETE FROM app.jobs WHERE id = %s", (job,))
    assert db.execute(
        "SELECT user_id, source_job_id FROM app.commitments WHERE id = %s", (commitment,)
    ).fetchone() == (user.id, None)


def test_a_version_cannot_point_at_another_users_event(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    owner, other = make_user(), make_user()
    event = _event(db, owner.id)
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        _version(db, other.id, event)
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        with user_transaction(api_db, other) as conn:
            _version(conn, other.id, event)


def test_deleting_the_event_keeps_the_version(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    event = _event(db, user.id)
    version = _version(db, user.id, event, '{"title": "x"}')
    db.execute("DELETE FROM app.busy_events WHERE id = %s", (event,))
    assert db.execute(
        "SELECT user_id, busy_event_id, busy_event_before FROM app.plan_versions WHERE id = %s",
        (version,),
    ).fetchone() == (user.id, None, {"title": "x"})


def test_deleting_the_auth_user_deletes_the_rows(
    db: psycopg.Connection, make_user: MakeUser
) -> None:
    user, other = make_user(), make_user()
    for owner in (user, other):
        _commitment(db, owner.id)
        _version(db, owner.id, _event(db, owner.id))
    db.execute("DELETE FROM auth.users WHERE id = %s", (user.id,))
    for table in ("commitments", "busy_events"):
        rows = db.execute(f"SELECT DISTINCT user_id FROM app.{table}").fetchall()  # noqa: S608
        assert rows == [(other.id,)], table


# --- delete_account_data ----------------------------------------------------------------


def test_delete_account_data_removes_both_tables_for_the_caller_only(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    owner, other = make_user(), make_user()
    for user in (owner, other):
        _profile(db, user.id)
        job = _job(db, user.id)
        _commitment(db, user.id, source_job_id=job)
        _version(db, user.id, _event(db, user.id))
    with user_transaction(api_db, owner) as conn:
        conn.execute("SELECT app.delete_account_data()")
    for table in ("commitments", "busy_events", "plan_versions", "jobs"):
        rows = db.execute(f"SELECT user_id FROM app.{table}").fetchall()  # noqa: S608
        assert rows == [(other.id,)], table


# --- the hobby moves to commitments, and back ------------------------------------------


def _commitment_rows(conn: psycopg.Connection, user_id: UUID) -> list[tuple[Any, ...]]:
    return conn.execute(
        "SELECT weekday, title, kind, start_time, end_time, valid_from, valid_until, "
        "source_job_id, deleted_at FROM app.commitments WHERE user_id = %s ORDER BY weekday",
        (user_id,),
    ).fetchall()


def _hobby(conn: psycopg.Connection, user_id: UUID) -> tuple[Any, ...] | None:
    return conn.execute(
        "SELECT hobby_start, hobby_minutes FROM app.profiles WHERE id = %s", (user_id,)
    ).fetchone()


def _function_source(conn: psycopg.Connection) -> str:
    source: str = _one(
        conn, "SELECT prosrc FROM pg_proc WHERE oid = 'app.delete_account_data()'::regprocedure", ()
    )
    return source


def _plan_version_insert_columns(conn: psycopg.Connection) -> list[str]:
    columns: list[str] = _one(
        conn,
        "SELECT array_agg(column_name::text ORDER BY column_name) "
        "FROM information_schema.column_privileges WHERE table_schema = 'app' "
        "AND table_name = 'plan_versions' AND grantee = 'authenticated' "
        "AND privilege_type = 'INSERT'",
        (),
    )
    return columns


def test_the_hobby_moves_to_commitments_and_downgrade_brings_it_back() -> None:
    admin_url = admin_database_url()
    name = f"{os.environ.get('STUDYFLOW_TEST_DB', 'studyflow_test')}_0014"
    url = create_database(admin_url, name)
    users = {
        key: uuid4()
        for key in ("evening", "midnight", "none", "broken", "edited", "extra", "longer")
    }
    try:
        config = alembic_config(url)
        command.upgrade(config, "0012")
        with psycopg.connect(url, autocommit=True) as conn:
            function_before = _function_source(conn)
            grant_before = _plan_version_insert_columns(conn)
            for user_id in users.values():
                conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
            # 22:30 UTC on Nov 1 is 00:30 on Nov 2 in Jerusalem (UTC+2).
            profiles: dict[str, tuple[str, str | None, int | None, str]] = {
                "evening": ("2026-10-20T10:00Z", "18:00", 90, "Asia/Jerusalem"),
                "midnight": ("2026-11-01T22:30Z", "23:30", 60, "Asia/Jerusalem"),
                "none": ("2026-10-20T10:00Z", None, None, "Asia/Jerusalem"),
                "broken": ("2026-10-20T10:00Z", "07:00", 30, "Asia/Jerusalem"),
                "edited": ("2026-10-20T10:00Z", "12:00", 60, "Asia/Jerusalem"),
                "extra": ("2026-11-01T22:30Z", "20:15", 240, "UTC"),
                "longer": ("2026-10-20T10:00Z", "06:00", 240, "Asia/Jerusalem"),
            }
            for key, (created, start, minutes, timezone) in profiles.items():
                conn.execute(
                    "INSERT INTO app.profiles (id, created_at, hobby_start, hobby_minutes, "
                    "timezone) VALUES (%s, %s, %s, %s, %s)",
                    (users[key], created, start, minutes, timezone),
                )

        command.upgrade(config, "0014")
        with psycopg.connect(url, autocommit=True) as conn:
            assert _commitment_rows(conn, users["evening"]) == [
                (day, _HOBBY_TITLE, "other", time(18), time(19, 30), date(2026, 10, 20), *_NO_DATES)
                for day in range(7)
            ]
            assert _commitment_rows(conn, users["midnight"]) == [
                (
                    day,
                    _HOBBY_TITLE,
                    "other",
                    time(23, 30),
                    time(0, 30),
                    date(2026, 11, 2),
                    *_NO_DATES,
                )
                for day in range(7)
            ]
            # The same instant in UTC is still Nov 1.
            assert {row[5] for row in _commitment_rows(conn, users["extra"])} == {date(2026, 11, 1)}
            assert _commitment_rows(conn, users["none"]) == []
            for key in users:
                assert _hobby(conn, users[key]) == (None, None), key
            assert conn.execute("SELECT count(*) FROM app.commitments").fetchone() == (42,)

            # Changes made after the upgrade, which decide what downgrade restores:
            # "broken" loses one day of the set, so it is no longer a hobby set;
            conn.execute(
                "UPDATE app.commitments SET deleted_at = now() WHERE user_id = %s AND weekday = 3",
                (users["broken"],),
            )
            # "edited" moves the whole set to 13:00-14:15 (the API's PATCH /me does this);
            conn.execute(
                "UPDATE app.commitments SET start_time = '13:00', end_time = '14:15' "
                "WHERE user_id = %s",
                (users["edited"],),
            )
            # "extra" adds a work commitment beside the set, which does not disturb it;
            _commitment(conn, users["extra"])
            # "longer" stretches the set past the 240 minutes the old column allows.
            conn.execute(
                "UPDATE app.commitments SET end_time = '10:01' WHERE user_id = %s",
                (users["longer"],),
            )
            # A new user who only ever had commitments.
            fresh = uuid4()
            conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (fresh,))
            conn.execute("INSERT INTO app.profiles (id) VALUES (%s)", (fresh,))
            _commitment(conn, fresh)
            assert _function_source(conn) != function_before
            assert "app.busy_events" in _function_source(conn)

        command.downgrade(config, "0012")
        with psycopg.connect(url, autocommit=True) as conn:
            restored = {key: _hobby(conn, user_id) for key, user_id in users.items()}
            assert restored == {
                "evening": (time(18), 90),
                "midnight": (time(23, 30), 60),
                "none": (None, None),
                "broken": (None, None),
                "edited": (time(13), 75),
                "extra": (time(20, 15), 240),
                "longer": (None, None),
            }
            assert _hobby(conn, fresh) == (None, None)
            assert conn.execute(
                "SELECT to_regclass('app.commitments'), to_regclass('app.busy_events')"
            ).fetchone() == (None, None)
            assert conn.execute(
                "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'app' "
                "AND table_name = 'plan_versions' "
                "AND column_name IN ('busy_event_id', 'busy_event_before')"
            ).fetchone() == (0,)
            assert _function_source(conn) == function_before
            assert _plan_version_insert_columns(conn) == grant_before
            assert conn.execute("SELECT version_num FROM app.alembic_version").fetchall() == [
                ("0012",)
            ]

        command.upgrade(config, "0014")
        with psycopg.connect(url, autocommit=True) as conn:
            # The restored hobbies move again.
            counts: dict[UUID, int] = dict(
                conn.execute(
                    "SELECT user_id, count(*) FROM app.commitments GROUP BY user_id"
                ).fetchall()
            )
            assert counts == {
                users["evening"]: 7,
                users["midnight"]: 7,
                users["edited"]: 7,
                users["extra"]: 7,
            }
            assert {row[3:5] for row in _commitment_rows(conn, users["edited"])} == {
                (time(13), time(14, 15))
            }
            assert conn.execute("SELECT version_num FROM app.alembic_version").fetchall() == [
                ("0014",)
            ]
    finally:
        drop_database(admin_url, name)
