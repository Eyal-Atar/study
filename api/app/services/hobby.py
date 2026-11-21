"""Me time of the settings screen: the hobby of S15 as a view over app.commitments.

Migration 0014 moved `profiles.hobby_start`/`hobby_minutes` into seven commitments, one per
weekday, so the planner has one mechanism for taken time, and 0017 (S34) dropped those old
columns. The settings screen reads and writes Me time through GET/PATCH /me, so the API keeps
the two fields `hobby_start` and `hobby_minutes`: they read
and replace the "hobby set", the set the migration writes: seven live commitments of kind
'other' titled HOBBY_TITLE or a legacy title, with no valid_until,
the same start and end, covering every weekday, 15 to 240 minutes long (a duplicate row
on a weekday does not hide it). When several such sets exist, the one created first is the
hobby. Writing it replaces every live hobby-titled row at the old time and at the new time,
so an edited or duplicated set never piles up. The layer stays because Me time is one
preference with one replan offer, written atomically under the user's lock (S34, decision 1).
"""

import datetime as dt
from typing import Final
from uuid import UUID

from app.errors import ApiError
from app.services.commitments import MAX_LIVE_COMMITMENTS, live_count
from app.services.profiles import Conn

HOBBY_TITLE: Final = "Me time"
# Rows written before 2026-11-21 keep the Hebrew title; there is no migration.
# The downgrade of migration 0014 knows only the legacy title, so rows written as HOBBY_TITLE
# are not restored by a downgrade (dev only).
LEGACY_HOBBY_TITLES: Final = ("\u05d6\u05de\u05df \u05dc\u05e2\u05e6\u05de\u05d9",)
_TITLES: Final = (HOBBY_TITLE, *LEGACY_HOBBY_TITLES)
_WEEKDAYS: Final = 7

# The hobby set, as (start_time, end_time, minutes), oldest first.
_SETS_SQL: Final = """
    SELECT start_time, end_time,
           (((extract(epoch FROM end_time - start_time) / 60)::int + 1440) %% 1440) AS minutes
    FROM app.commitments
    WHERE user_id = %(user_id)s AND deleted_at IS NULL AND kind = 'other'
      AND title = ANY(%(titles)s) AND valid_until IS NULL
    GROUP BY start_time, end_time
    HAVING count(DISTINCT weekday) = 7
    ORDER BY min(created_at), start_time, end_time
"""


def _end(start: dt.time, minutes: int) -> dt.time:
    total = (start.hour * 60 + start.minute + minutes) % (24 * 60)
    return dt.time(total // 60, total % 60)


def read_hobby(conn: Conn, user_id: UUID) -> tuple[dt.time, int] | None:
    """The hobby (start, minutes) from the user's commitments, or None."""
    for row in conn.execute(_SETS_SQL, {"user_id": user_id, "titles": list(_TITLES)}).fetchall():
        if 15 <= row["minutes"] <= 240:
            return row["start_time"], row["minutes"]
    return None


def write_hobby(
    conn: Conn, user_id: UUID, hobby: tuple[dt.time, int] | None, today: dt.date, now: dt.datetime
) -> bool:
    """Replace the hobby set with `hobby` (None turns it off); whether anything changed.

    The caller holds the user lock. The old set is soft-deleted, like any commitment; the new
    one is valid from the profile's local today.
    """
    current = read_hobby(conn, user_id)
    if current == hobby:
        return False
    times = {(h[0], _end(*h)) for h in (current, hobby) if h is not None}
    for start, end in times:
        conn.execute(
            "UPDATE app.commitments SET deleted_at = %(now)s "
            "WHERE user_id = %(user_id)s AND deleted_at IS NULL AND kind = 'other' "
            "AND title = ANY(%(titles)s) AND valid_until IS NULL "
            "AND start_time = %(start)s AND end_time = %(end)s",
            {"now": now, "user_id": user_id, "titles": list(_TITLES), "start": start, "end": end},
        )
    if hobby is not None:
        if live_count(conn, user_id) + _WEEKDAYS > MAX_LIVE_COMMITMENTS:
            raise ApiError("too_many_commitments", extra={"limit": MAX_LIVE_COMMITMENTS})
        start, minutes = hobby
        with conn.cursor() as cursor:
            cursor.executemany(
                "INSERT INTO app.commitments (user_id, title, kind, weekday, start_time, "
                "end_time, valid_from) VALUES (%s, %s, 'other', %s, %s, %s, %s)",
                [
                    (user_id, HOBBY_TITLE, weekday, start, _end(start, minutes), today)
                    for weekday in range(_WEEKDAYS)
                ],
            )
    return True
