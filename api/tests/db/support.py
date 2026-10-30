import os
from pathlib import Path

import psycopg
from alembic.config import Config
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

DEFAULT_TEST_DATABASE_URL = "postgresql://localhost:5432/postgres"

_API_DIR = Path(__file__).resolve().parents[2]
_SHIM = Path(__file__).with_name("supabase_shim.sql")
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


_LOOPBACK = {"127.0.0.1", "::1"}


def _reject(part: str, value: str) -> ValueError:
    return ValueError(
        f"Refusing to use {part} {value!r}: tests create and drop databases, so the "
        "connection must only reach localhost, 127.0.0.1, ::1 or a socket directory"
    )


def _check_hosts(part: str, value: str, allowed: set[str], allow_socket: bool) -> None:
    for entry in value.split(","):
        if entry in allowed or (allow_socket and entry.startswith("/")):
            continue
        raise _reject(part, entry)


def require_local_database_url(url: str) -> str:
    """Return url if every host the connection could use is local; otherwise raise ValueError.

    Covers host, hostaddr, service files and, when the string names no host, the libpq
    environment variables, because tests drop and create databases.
    """
    params = conninfo_to_dict(url)
    for key in ("service", "servicefile"):
        if params.get(key):
            raise _reject(key, str(params[key]))
    host = str(params.get("host") or "")
    hostaddr = str(params.get("hostaddr") or "")
    if not host and not hostaddr:
        if os.environ.get("PGSERVICE"):
            raise _reject("PGSERVICE", os.environ["PGSERVICE"])
        host = os.environ.get("PGHOST", "")
        hostaddr = os.environ.get("PGHOSTADDR", "")
    if host:
        _check_hosts("host", host, _LOCAL_HOSTS, allow_socket=True)
    if hostaddr:
        _check_hosts("hostaddr", hostaddr, _LOOPBACK, allow_socket=False)
    return url


def admin_database_url() -> str:
    """TEST_DATABASE_URL (or the default), checked to be local."""
    return require_local_database_url(
        os.environ.get("TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL)
    )


def alembic_config(database_url: str) -> Config:
    config = Config(str(_API_DIR / "alembic.ini"))
    config.attributes["database_url"] = database_url
    return config


def create_database(admin_url: str, name: str) -> str:
    """Create an empty database with the Supabase shim applied; return its URL."""
    drop_database(admin_url, name)
    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    url = make_conninfo(admin_url, dbname=name)
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(_SHIM.read_text(encoding="utf-8"))
    return url


def drop_database(admin_url: str, name: str) -> None:
    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute(
            sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name))
        )
