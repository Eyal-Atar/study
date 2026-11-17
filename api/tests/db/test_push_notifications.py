from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from alembic import command

from app.auth import CurrentUser
from app.db.session import user_transaction
from tests.db.support import admin_database_url, alembic_config, create_database, drop_database

MakeUser = Callable[[], CurrentUser]

_P256DH = "B" + "A" * 86  # 87 characters, the length of a base64url uncompressed point
_AUTH = "A" * 22  # 16 bytes in base64url
_START = datetime(2026, 11, 20, 9, 0, tzinfo=UTC)


def _endpoint(name: str) -> str:
    return f"https://fcm.googleapis.com/fcm/send/{name}"


def _subscription(db: psycopg.Connection, user_id: UUID, endpoint: str, **fields: Any) -> UUID:
    values: dict[str, Any] = {"p256dh": _P256DH, "auth": _AUTH, "user_agent": None}
    values.update(fields)
    row = db.execute(
        "INSERT INTO app.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) "
        "VALUES (%s, %s, %s, %s, %s) RETURNING id",
        (user_id, endpoint, values["p256dh"], values["auth"], values["user_agent"]),
    ).fetchone()
    assert row is not None
    return row[0]  # type: ignore[no-any-return]


def _rows(db: psycopg.Connection) -> set[tuple[UUID, str]]:
    return {
        (row[0], row[1])
        for row in db.execute("SELECT user_id, endpoint FROM app.push_subscriptions").fetchall()
    }


def _block(db: psycopg.Connection, user_id: UUID) -> UUID:
    exam = db.execute(
        "INSERT INTO app.exams (user_id, name, exam_date) VALUES (%s, 'x', '2026-12-01') "
        "RETURNING id",
        (user_id,),
    ).fetchone()
    assert exam is not None
    task = db.execute(
        "INSERT INTO app.tasks (user_id, exam_id, title, kind, estimated_minutes, source) "
        "VALUES (%s, %s, 'T', 'learn', 60, 'user') RETURNING id",
        (user_id, exam[0]),
    ).fetchone()
    assert task is not None
    block = db.execute(
        "INSERT INTO app.blocks (user_id, task_id, starts_at, ends_at) "
        "VALUES (%s, %s, %s, %s) RETURNING id",
        (user_id, task[0], _START, _START + timedelta(hours=1)),
    ).fetchone()
    assert block is not None
    return block[0]  # type: ignore[no-any-return]


def _notified_at(db: psycopg.Connection, block_id: UUID) -> datetime | None:
    row = db.execute("SELECT notified_at FROM app.blocks WHERE id = %s", (block_id,)).fetchone()
    assert row is not None
    return row[0]  # type: ignore[no-any-return]


# --- push_subscriptions: RLS and grants ---


def test_owner_can_register_read_update_and_delete_a_subscription(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    with user_transaction(api_db, user) as conn:
        sub = _subscription(conn, user.id, _endpoint("a"), user_agent="Chrome")
        row = conn.execute(
            "SELECT failure_count, last_success_at, created_at IS NOT NULL "
            "FROM app.push_subscriptions WHERE id = %s",
            (sub,),
        ).fetchone()
        assert row == (0, None, True)
        conn.execute(
            "UPDATE app.push_subscriptions SET p256dh = %s, auth = %s, user_agent = 'Edge', "
            "failure_count = 0 WHERE id = %s",
            ("B" + "C" * 86, "C" * 22, sub),
        )
    with user_transaction(api_db, user) as conn:
        assert conn.execute("DELETE FROM app.push_subscriptions WHERE id = %s", (sub,)).rowcount
    assert _rows(db) == set()


def test_another_user_cannot_see_update_or_delete_a_subscription(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    a, b = make_user(), make_user()
    sub = _subscription(db, a.id, _endpoint("a"))
    with user_transaction(api_db, b) as conn:
        assert conn.execute("SELECT id FROM app.push_subscriptions").fetchall() == []
        updated = conn.execute(
            "UPDATE app.push_subscriptions SET user_agent = 'x' WHERE id = %s", (sub,)
        )
        assert updated.rowcount == 0
        deleted = conn.execute("DELETE FROM app.push_subscriptions WHERE id = %s", (sub,))
        assert deleted.rowcount == 0
    row = db.execute(
        "SELECT user_id, user_agent FROM app.push_subscriptions WHERE id = %s", (sub,)
    ).fetchone()
    assert row == (a.id, None)


def test_insert_with_another_users_id_fails(
    api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    a, b = make_user(), make_user()
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with user_transaction(api_db, b) as conn:
            _subscription(conn, a.id, _endpoint("a"))


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE app.push_subscriptions SET user_id = user_id",
        "UPDATE app.push_subscriptions SET endpoint = endpoint",
        "UPDATE app.push_subscriptions SET last_success_at = now()",
        "UPDATE app.push_subscriptions SET created_at = now()",
    ],
)
def test_user_cannot_update_columns_outside_the_grant(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser, statement: str
) -> None:
    user = make_user()
    _subscription(db, user.id, _endpoint("a"))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with user_transaction(api_db, user) as conn:
            conn.execute(statement)


@pytest.mark.parametrize("column", ["id", "failure_count", "last_success_at", "created_at"])
def test_user_cannot_insert_columns_outside_the_grant(
    api_db: psycopg.Connection, make_user: MakeUser, column: str
) -> None:
    user = make_user()
    value = {
        "id": "00000000-0000-0000-0000-000000000001",
        "failure_count": 0,
        "last_success_at": _START,
        "created_at": _START,
    }[column]
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with user_transaction(api_db, user) as conn:
            conn.execute(
                "INSERT INTO app.push_subscriptions (user_id, endpoint, p256dh, auth, "  # noqa: S608
                f"{column}) VALUES (%s, %s, %s, %s, %s)",
                (user.id, _endpoint("a"), _P256DH, _AUTH, value),
            )


def test_duplicate_endpoint_is_rejected_across_users(
    db: psycopg.Connection, make_user: MakeUser
) -> None:
    a, b = make_user(), make_user()
    _subscription(db, a.id, _endpoint("same"))
    with pytest.raises(psycopg.errors.UniqueViolation) as caught:
        _subscription(db, b.id, _endpoint("same"))
    assert caught.value.sqlstate == "23505"


@pytest.mark.parametrize(
    "fields",
    [
        {"endpoint": "http://fcm.googleapis.com/fcm/send/x"},
        {"endpoint": "https://fcm.googleapis.com/" + "x" * 2030},
        {"p256dh": "B" * 79},
        {"p256dh": "B" * 101},
        {"auth": "A" * 15},
        {"auth": "A" * 31},
        {"user_agent": "x" * 501},
        {"failure_count": -1},
    ],
)
def test_subscription_checks(
    db: psycopg.Connection, make_user: MakeUser, fields: dict[str, Any]
) -> None:
    user = make_user()
    values: dict[str, Any] = {
        "endpoint": _endpoint("x"),
        "p256dh": _P256DH,
        "auth": _AUTH,
        "user_agent": None,
        "failure_count": 0,
    }
    values.update(fields)
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute(
            "INSERT INTO app.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, "
            "failure_count) VALUES (%s, %s, %s, %s, %s, %s)",
            (
                user.id,
                values["endpoint"],
                values["p256dh"],
                values["auth"],
                values["user_agent"],
                values["failure_count"],
            ),
        )


def test_subscription_check_boundaries_are_accepted(
    db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    longest = "https://fcm.googleapis.com/"
    longest += "x" * (2048 - len(longest))
    assert _subscription(db, user.id, longest, p256dh="B" * 80, auth="A" * 16)
    assert _subscription(
        db, user.id, _endpoint("y"), p256dh="B" * 100, auth="A" * 30, user_agent="x" * 500
    )


def test_subscriptions_are_deleted_with_the_user(
    db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    _subscription(db, user.id, _endpoint("a"))
    db.execute("DELETE FROM auth.users WHERE id = %s", (user.id,))
    assert _rows(db) == set()


def test_subscriptions_are_indexed_by_user(db: psycopg.Connection) -> None:
    row = db.execute(
        "SELECT indexdef FROM pg_indexes WHERE schemaname = 'app' "
        "AND indexname = 'push_subscriptions_user_idx'"
    ).fetchone()
    assert row is not None
    assert "(user_id)" in row[0]


# --- take_push_endpoint ---


def test_take_push_endpoint_removes_only_other_users_rows_with_that_endpoint(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    a, b = make_user(), make_user()
    _subscription(db, a.id, _endpoint("shared"))
    _subscription(db, a.id, _endpoint("a-other"))
    _subscription(db, b.id, _endpoint("b-own"))

    with user_transaction(api_db, b) as conn:
        conn.execute("SELECT app.take_push_endpoint(%s)", (_endpoint("shared"),))
        _subscription(conn, b.id, _endpoint("shared"))

    assert _rows(db) == {
        (a.id, _endpoint("a-other")),
        (b.id, _endpoint("b-own")),
        (b.id, _endpoint("shared")),
    }


def test_take_push_endpoint_keeps_the_callers_own_row(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    b = make_user()
    _subscription(db, b.id, _endpoint("mine"))
    with user_transaction(api_db, b) as conn:
        conn.execute("SELECT app.take_push_endpoint(%s)", (_endpoint("mine"),))
    assert _rows(db) == {(b.id, _endpoint("mine"))}


def test_take_push_endpoint_needs_a_signed_in_user(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    a = make_user()
    _subscription(db, a.id, _endpoint("shared"))
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="signed-in user"):
        with api_db.transaction():
            api_db.execute("SELECT set_config('role', 'authenticated', true)")
            api_db.execute("SELECT app.take_push_endpoint(%s)", (_endpoint("shared"),))
    assert _rows(db) == {(a.id, _endpoint("shared"))}


def test_take_push_endpoint_is_executable_only_by_authenticated(db: psycopg.Connection) -> None:
    signature = "app.take_push_endpoint(text)"
    for role, expected in [
        ("authenticated", True),
        ("anon", False),
        ("service_role", False),
        ("studyflow_api", False),
    ]:
        row = db.execute(
            "SELECT has_function_privilege(%s, %s, 'EXECUTE')", (role, signature)
        ).fetchone()
        assert row == (expected,), role
    public = db.execute(
        "SELECT count(*) FROM pg_proc, aclexplode(proacl) AS acl "
        "WHERE oid = to_regprocedure(%s) AND acl.grantee = 0",
        (signature,),
    ).fetchone()
    assert public == (0,)


def test_take_push_endpoint_runs_as_the_table_owner(db: psycopg.Connection) -> None:
    # SECURITY DEFINER bypasses RLS only because the function's owner owns the table and
    # the table does not FORCE row level security. On Supabase both are `postgres`.
    row = db.execute(
        "SELECT p.prosecdef, p.proconfig, p.proowner = c.relowner, c.relforcerowsecurity "
        "FROM pg_proc p, pg_class c "
        "WHERE p.oid = to_regprocedure('app.take_push_endpoint(text)') "
        "AND c.oid = to_regclass('app.push_subscriptions')"
    ).fetchone()
    assert row == (True, ['search_path=""'], True, False)


# --- blocks.notified_at ---


def test_blocks_start_without_notified_at(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    assert _notified_at(db, _block(db, user.id)) is None


def test_moving_a_block_resets_notified_at(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    block = _block(db, user.id)
    db.execute("UPDATE app.blocks SET notified_at = %s WHERE id = %s", (_START, block))
    db.execute(
        "UPDATE app.blocks SET starts_at = starts_at + interval '30 minutes', "
        "ends_at = ends_at + interval '30 minutes' WHERE id = %s",
        (block,),
    )
    assert _notified_at(db, block) is None


def test_other_updates_keep_notified_at(db: psycopg.Connection, make_user: MakeUser) -> None:
    user = make_user()
    block = _block(db, user.id)
    db.execute("UPDATE app.blocks SET notified_at = %s WHERE id = %s", (_START, block))
    db.execute("UPDATE app.blocks SET status = 'done' WHERE id = %s", (block,))
    assert _notified_at(db, block) == _START
    # Setting starts_at to the value it already has is not a move.
    db.execute("UPDATE app.blocks SET starts_at = starts_at, pinned = true WHERE id = %s", (block,))
    assert _notified_at(db, block) == _START


def test_moving_a_block_resets_notified_at_for_the_user_too(
    db: psycopg.Connection, api_db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    block = _block(db, user.id)
    db.execute("UPDATE app.blocks SET notified_at = %s WHERE id = %s", (_START, block))
    with user_transaction(api_db, user) as conn:
        conn.execute(
            "UPDATE app.blocks SET starts_at = %s, ends_at = %s WHERE id = %s",
            (_START + timedelta(days=1), _START + timedelta(days=1, hours=1), block),
        )
    assert _notified_at(db, block) is None


def test_due_reminder_index_is_partial(db: psycopg.Connection) -> None:
    row = db.execute(
        "SELECT indexdef FROM pg_indexes WHERE schemaname = 'app' "
        "AND indexname = 'blocks_due_reminder_idx'"
    ).fetchone()
    assert row is not None
    definition = row[0]
    assert "(starts_at)" in definition
    assert "status = 'planned'" in definition
    assert "notified_at IS NULL" in definition


# --- profiles.notify_lead_minutes ---


def test_new_profile_is_reminded_at_the_start_of_the_block(
    db: psycopg.Connection, make_user: MakeUser
) -> None:
    user = make_user()
    db.execute("INSERT INTO app.profiles (id) VALUES (%s)", (user.id,))
    row = db.execute(
        "SELECT notify_lead_minutes FROM app.profiles WHERE id = %s", (user.id,)
    ).fetchone()
    assert row == (0,)


@pytest.mark.parametrize("minutes", [0, 5, 10, 15])
def test_notify_lead_minutes_accepts_the_four_choices(
    db: psycopg.Connection, make_user: MakeUser, minutes: int
) -> None:
    user = make_user()
    db.execute(
        "INSERT INTO app.profiles (id, notify_lead_minutes) VALUES (%s, %s)", (user.id, minutes)
    )


@pytest.mark.parametrize("minutes", [-5, 1, 7, 20, 120])
def test_notify_lead_minutes_rejects_other_values(
    db: psycopg.Connection, make_user: MakeUser, minutes: int
) -> None:
    user = make_user()
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute(
            "INSERT INTO app.profiles (id, notify_lead_minutes) VALUES (%s, %s)",
            (user.id, minutes),
        )


# --- the migration itself, on a database of its own ---


def _delete_account_body(url: str) -> str:
    with psycopg.connect(url, autocommit=True) as conn:
        row = conn.execute(
            "SELECT pg_get_functiondef('app.delete_account_data()'::regprocedure)"
        ).fetchone()
    assert row is not None
    body: str = row[0]
    return body


def test_migration_resets_lead_minutes_and_downgrade_restores_the_old_rules() -> None:
    admin_url = admin_database_url()
    name = "studyflow_push_migration_test"
    url = create_database(admin_url, name)
    try:
        config = alembic_config(url)
        command.upgrade(config, "0011")
        users = {minutes: uuid4() for minutes in (10, 5, 15, 30)}
        with psycopg.connect(url, autocommit=True) as conn:
            for minutes, user_id in users.items():
                conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
                conn.execute(
                    "INSERT INTO app.profiles (id, notify_lead_minutes) VALUES (%s, %s)",
                    (user_id, minutes),
                )

        command.upgrade(config, "0010")
        with psycopg.connect(url, autocommit=True) as conn:
            after: dict[UUID, int] = dict(
                conn.execute("SELECT id, notify_lead_minutes FROM app.profiles").fetchall()
            )
        # 10 was the old default that nobody chose; 30 is outside the new choices.
        assert after == {users[10]: 0, users[5]: 5, users[15]: 15, users[30]: 0}
        assert "app.push_subscriptions" in _delete_account_body(url)

        command.downgrade(config, "0011")
        assert "push_subscriptions" not in _delete_account_body(url)
        with psycopg.connect(url, autocommit=True) as conn:
            fresh = uuid4()
            conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (fresh,))
            conn.execute("INSERT INTO app.profiles (id) VALUES (%s)", (fresh,))
            row = conn.execute(
                "SELECT notify_lead_minutes FROM app.profiles WHERE id = %s", (fresh,)
            ).fetchone()
            assert row == (10,)
            conn.execute(
                "UPDATE app.profiles SET notify_lead_minutes = 120 WHERE id = %s", (fresh,)
            )
            with pytest.raises(psycopg.errors.CheckViolation):
                conn.execute(
                    "UPDATE app.profiles SET notify_lead_minutes = 121 WHERE id = %s", (fresh,)
                )
            leftovers = conn.execute(
                "SELECT to_regclass('app.push_subscriptions'), "
                "to_regprocedure('app.take_push_endpoint(text)'), "
                "to_regclass('app.blocks_due_reminder_idx'), "
                "(SELECT count(*) FROM information_schema.columns WHERE table_schema = 'app' "
                "AND table_name = 'blocks' AND column_name = 'notified_at'), "
                "(SELECT count(*) FROM pg_proc WHERE proname = 'blocks_reset_notified_at')"
            ).fetchone()
            assert leftovers == (None, None, None, 0, 0)
    finally:
        drop_database(admin_url, name)
