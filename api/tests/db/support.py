from pathlib import Path

import psycopg
from alembic.config import Config
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

DEFAULT_TEST_DATABASE_URL = "postgresql://localhost:5432/postgres"

_API_DIR = Path(__file__).resolve().parents[2]
_SHIM = Path(__file__).with_name("supabase_shim.sql")
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def require_local_database_url(url: str) -> str:
    """Return url if it points at this machine; tests drop databases, so refuse any other host."""
    params = conninfo_to_dict(url)
    hosts = [h for h in str(params.get("host", "")).split(",") if h]
    if not hosts:  # no host at all: libpq uses the default local socket
        return url
    for host in hosts:
        if host not in _LOCAL_HOSTS and not host.startswith("/"):
            raise ValueError(
                f"Refusing to use the database host {host!r}: tests create and drop databases, "
                "so TEST_DATABASE_URL must point at localhost, 127.0.0.1, ::1 or a socket path"
            )
    return url


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
