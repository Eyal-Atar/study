"""Database access on behalf of a signed-in user.

The API connects as `studyflow_api`, which has no privileges on schema `app` by
itself. Every query goes through `user_transaction`, which switches the transaction
to the `authenticated` role with the user's verified claims, so row level security
applies. Querying outside it fails with `permission denied`, because `studyflow_api`
has no table privileges itself (RLS would be bypassed only by connecting as the owner,
`postgres`, which the API must never do). This is the only way the API reaches the
database.
"""

import json
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg
from psycopg.pq import TransactionStatus

from app.auth import CurrentUser


@contextmanager
def user_transaction(
    conn: psycopg.Connection[Any], user: CurrentUser
) -> Iterator[psycopg.Connection[Any]]:
    """Run one transaction as `user`: role `authenticated`, their claims, TimeZone UTC.

    Raises RuntimeError, before running anything, if conn is already inside a
    transaction (the settings are transaction-local and would leak or be lost).
    An exception in the block rolls the transaction back and propagates.
    """
    if conn.info.transaction_status != TransactionStatus.IDLE:
        raise RuntimeError("user_transaction needs a connection that is not in a transaction")
    claims = json.dumps({**user.claims, "sub": str(user.id), "role": "authenticated"})
    with conn.transaction():
        conn.execute("SET LOCAL ROLE authenticated")
        # auth.uid() reads request.jwt.claim.sub before request.jwt.claims, so pin it too:
        # a session-level value left on a pooled connection must not override the user.
        conn.execute(
            "select set_config('request.jwt.claims', %s, true), "
            "set_config('request.jwt.claim.sub', %s, true)",
            (claims, str(user.id)),
        )
        conn.execute("SET LOCAL TIME ZONE 'UTC'")
        yield conn
