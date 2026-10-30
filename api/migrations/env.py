from logging.config import fileConfig
from pathlib import Path

import psycopg
from alembic import context
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import create_engine, text

config = context.config

# The CLI shows the "Running upgrade" lines. When pytest passes the URL in, it owns logging
# (caplog), so leave it alone.
if config.config_file_name is not None and "database_url" not in config.attributes:
    fileConfig(config.config_file_name, disable_existing_loggers=False)


class _MigrationSettings(BaseSettings):
    # An environment variable wins over api/.env.
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[1] / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    migration_database_url: str


def _database_url() -> str:
    url = config.attributes.get("database_url")
    if url is None:
        url = _MigrationSettings().model_dump()["migration_database_url"]
    return str(url)


def run_migrations_online() -> None:
    # psycopg opens the connection itself, so the URL (postgresql://) or a key=value conninfo
    # string goes to it unchanged; SQLAlchemy only needs to know the driver.
    url = _database_url()
    engine = create_engine("postgresql+psycopg://", creator=lambda: psycopg.connect(url))
    with engine.connect() as connection:
        connection.execute(text("CREATE SCHEMA IF NOT EXISTS app"))
        connection.commit()
        context.configure(
            connection=connection,
            target_metadata=None,
            version_table_schema="app",
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    raise RuntimeError("Offline mode is not supported: run migrations against a database")
run_migrations_online()
