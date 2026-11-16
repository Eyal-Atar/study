"""Push subscriptions: store a browser's subscription for the user, or remove one.

The endpoint is unique across all users. A shared device hands the same endpoint to whoever
signs in next, so saving it first takes it away from any other user (decision 8 of S16):
the previous user's reminders, with their task names, must stop reaching this browser.
"""

from typing import Final
from uuid import UUID

from app.domain.notifications import PUSH_ENDPOINT_INVALID, check_push_endpoint, check_push_keys
from app.errors import ApiError
from app.services.profiles import Conn

_UPSERT: Final = (
    "INSERT INTO app.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) "
    "VALUES (%s, %s, %s, %s, %s) "
    "ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, "
    "user_agent = EXCLUDED.user_agent, failure_count = 0 "
    # xmax is 0 only on a freshly inserted row version, so it tells insert from update.
    "RETURNING id, (xmax = 0) AS created"
)


def save_subscription(
    conn: Conn,
    user_id: UUID,
    *,
    endpoint: str,
    p256dh: str,
    auth: str,
    user_agent: str | None,
) -> tuple[UUID, bool]:
    """Insert or refresh the user's subscription; returns its id and whether it is new.

    A refresh (same endpoint, same user) takes the browser's current keys and clears the
    failure count, so a subscription the worker had counted as failing gets a fresh start.
    """
    # The worker POSTs to this URL, so only known push services are stored (SSRF).
    if check_push_endpoint(endpoint) is not None or not check_push_keys(p256dh, auth):
        raise ApiError(PUSH_ENDPOINT_INVALID)
    # Another user's row with this endpoint would make the upsert's ON CONFLICT target a
    # row RLS hides, which fails; the SECURITY DEFINER function deletes it first.
    conn.execute("SELECT app.take_push_endpoint(%s)", (endpoint,))
    row = conn.execute(_UPSERT, (user_id, endpoint, p256dh, auth, user_agent)).fetchone()
    if row is None:
        raise RuntimeError("INSERT ... RETURNING returned no row")
    return row["id"], row["created"]


def delete_subscription(conn: Conn, user_id: UUID, subscription_id: UUID) -> None:
    row = conn.execute(
        "DELETE FROM app.push_subscriptions WHERE id = %s AND user_id = %s RETURNING id",
        (subscription_id, user_id),
    ).fetchone()
    if row is None:
        raise ApiError("not_found")
