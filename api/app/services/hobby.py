"""The hobby of S15 as a view over app.commitments, until S34 replaces the settings screen.

Migration 0014 moved `profiles.hobby_start`/`hobby_minutes` into seven commitments, one per
weekday, so the planner has one mechanism for taken time. The settings screen of S15 still
reads and writes the hobby through GET/PATCH /me, so the API keeps those two fields: they read
and replace the "hobby set", exactly the set the migration writes and its downgrade
recognises: seven live commitments of kind 'other' titled HOBBY_TITLE, with no valid_until,
the same start and end, covering every weekday, 15 to 240 minutes long (a duplicate row
on a weekday does not hide it). When several such sets exist, the one created first is the
hobby. Writing it replaces every live hobby-titled row at the old time and at the new time,
so an edited or duplicated set never piles up. S34 deletes this module (decision 7).
"""

import datetime as dt
from typing import Final
from uuid import UUID

from app.errors import ApiError
from app.services.commitments import MAX_LIVE_COMMITMENTS, live_count
from app.services.profiles import Conn

HOBBY_TITLE: Final = "זמן לעצמי"
_WEEKDAYS: Final = 7

# The hobby set, as (start_time, end_time, minutes), oldest first.
_SETS_SQL: Final = """
    SELECT start_time, end_time,
           (((extract(epoch FROM end_time - start_time) / 60)::int + 1440) %% 1440) AS minutes
    FROM app.commitments
    WHERE user_id = %(user_id)s AND deleted_at IS NULL AND kind = 'other'
      AND title = %(title)s AND valid_until IS NULL
    GROUP BY start_time, end_time
    HAVING count(DISTINCT weekday) = 7
    ORDER BY min(created_at), start_time, end_time
"""


def _end(start: dt.time, minutes: int) -> dt.time:
    total = (start.hour * 60 + start.minute + minutes) % (24 * 60)
    return dt.time(total // 60, total % 60)


def read_hobby(conn: Conn, user_id: UUID) -> tuple[dt.time, int] | None:
    """The hobby (start, minutes) from the user's commitments, or None."""
    for row in conn.execute(_SETS_SQL, {"user_id": user_id, "title": HOBBY_TITLE}).fetchall():
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
            "AND title = %(title)s AND valid_until IS NULL "
            "AND start_time = %(start)s AND end_time = %(end)s",
            {"now": now, "user_id": user_id, "title": HOBBY_TITLE, "start": start, "end": end},
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
