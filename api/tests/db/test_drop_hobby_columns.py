"""Migration 0017: the S15 hobby columns leave app.profiles (S34).

0014 already moved every hobby into app.commitments and nulled the columns, so 0017 only
drops them. Its downgrade brings them back empty, with the three CHECKs of 0009; 0014's own
downgrade is what refills them from the commitments.
"""

import os
from uuid import uuid4

import psycopg
import pytest
from alembic import command

from tests.db.support import admin_database_url, alembic_config, create_database, drop_database

_COLUMNS = ("hobby_minutes", "hobby_start")
_CHECKS = (
    "profiles_hobby_minutes_range",
    "profiles_hobby_start_whole_minute",
    "profiles_hobby_together",
)


def _hobby_columns(conn: psycopg.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' "
        "AND table_name = 'profiles' AND column_name LIKE 'hobby%' ORDER BY column_name"
    ).fetchall()
    return [row[0] for row in rows]


def _hobby_checks(conn: psycopg.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT conname FROM pg_constraint WHERE conrelid = 'app.profiles'::regclass "
        "AND conname LIKE 'profiles_hobby%' ORDER BY conname"
    ).fetchall()
    return [row[0] for row in rows]


def test_head_has_no_hobby_columns(db: psycopg.Connection) -> None:
    assert _hobby_columns(db) == []
    assert _hobby_checks(db) == []


def test_downgrade_brings_the_columns_back_empty_with_their_checks() -> None:
    admin_url = admin_database_url()
    name = f"{os.environ.get('STUDYFLOW_TEST_DB', 'studyflow_test')}_0017"
    url = create_database(admin_url, name)
    try:
        config = alembic_config(url)
        command.upgrade(config, "0017")
        user_id = uuid4()
        with psycopg.connect(url, autocommit=True) as conn:
            assert _hobby_columns(conn) == []
            conn.execute("INSERT INTO auth.users (id) VALUES (%s)", (user_id,))
            conn.execute("INSERT INTO app.profiles (id) VALUES (%s)", (user_id,))

        command.downgrade(config, "0016")
        with psycopg.connect(url, autocommit=True) as conn:
            assert _hobby_columns(conn) == list(_COLUMNS)
            assert _hobby_checks(conn) == list(_CHECKS)
            assert conn.execute(
                "SELECT hobby_start, hobby_minutes FROM app.profiles WHERE id = %s", (user_id,)
            ).fetchone() == (None, None)
            # The CHECKs are the ones 0009 made: together, 15-240 minutes, a whole minute.
            for assignment in (
                "hobby_start = '18:00'",
                "hobby_minutes = 60",
                "hobby_start = '18:00', hobby_minutes = 14",
                "hobby_start = '18:00', hobby_minutes = 241",
                "hobby_start = '18:00:30', hobby_minutes = 60",
            ):
                with pytest.raises(psycopg.errors.CheckViolation):
                    conn.execute(
                        f"UPDATE app.profiles SET {assignment} WHERE id = %s",  # noqa: S608
                        (user_id,),
                    )
            conn.execute(
                "UPDATE app.profiles SET hobby_start = '18:00', hobby_minutes = 90 WHERE id = %s",
                (user_id,),
            )
            conn.execute(
                "UPDATE app.profiles SET hobby_start = NULL, hobby_minutes = NULL WHERE id = %s",
                (user_id,),
            )

        command.upgrade(config, "0017")
        with psycopg.connect(url, autocommit=True) as conn:
            assert _hobby_columns(conn) == []
            assert _hobby_checks(conn) == []
            assert conn.execute("SELECT version_num FROM app.alembic_version").fetchall() == [
                ("0017",)
            ]
    finally:
        drop_database(admin_url, name)
