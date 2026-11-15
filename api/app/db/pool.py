"""The API's connection pool, and the one way to run a transaction on behalf of a user."""

from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg.rows import DictRow, dict_row
from psycopg_pool import ConnectionPool

from app.auth import CurrentUser
from app.db.session import user_transaction


class Database:
    """A pool of connections as `studyflow_api`; every use goes through `transaction`.

    Prepared statements are off, so the pool also works behind a pooler in transaction
    mode, and `check` drops a connection the pooler closed while it sat idle.
    """

    def __init__(
        self,
        conninfo: str,
        *,
        min_size: int = 1,
        max_size: int = 10,
        timeout: float = 5.0,
    ) -> None:
        self._pool: ConnectionPool[psycopg.Connection[DictRow]] = ConnectionPool(
            conninfo,
            min_size=min_size,
            max_size=max_size,
            timeout=timeout,
            open=False,
            kwargs={"row_factory": dict_row, "prepare_threshold": None},
            check=ConnectionPool.check_connection,
        )

    def open(self) -> None:
        """Open the pool and wait for its first connection."""
        self._pool.open(wait=True)

    def close(self) -> None:
        self._pool.close()

    @contextmanager
    def transaction(self, user: CurrentUser) -> Iterator[psycopg.Connection[DictRow]]:
        """One transaction as `user`: commit on normal exit, roll back on an exception.

        The commit happens before this block exits, so a deferred constraint (the
        overlap check on blocks) fails here, before any response is built.
        """
        with self._pool.connection() as conn:
            with user_transaction(conn, user):
                yield conn
