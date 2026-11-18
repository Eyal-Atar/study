"""The hobby of S15 as a view over app.commitments, until S34 replaces the settings screen.

Migration 0014 moved `profiles.hobby_start`/`hobby_minutes` into seven commitments, one per
weekday, so the planner has one mechanism for taken time. The settings screen of S15 still
reads and writes the hobby through GET/PATCH /me, so the API keeps those two fields: they read
and replace the "hobby set", exactly the set the migration writes and its downgrade
recognises: seven live commitments of kind 'other' titled HOBBY_TITLE, with no valid_until,
the same start and end, one on each weekday, 15 to 240 minutes long. When several such sets
exist, the one created first is the hobby. S34 deletes this module (decision 7).
"""

import datetime as dt
from typing import Final
from uuid import UUID

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
    HAVING count(*) = 7 AND count(DISTINCT weekday) = 7
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
    if current is not None:
        conn.execute(
            "UPDATE app.commitments SET deleted_at = %(now)s "
            "WHERE user_id = %(user_id)s AND deleted_at IS NULL AND kind = 'other' "
            "AND title = %(title)s AND valid_until IS NULL "
            "AND start_time = %(start)s AND end_time = %(end)s",
            {
                "now": now,
                "user_id": user_id,
                "title": HOBBY_TITLE,
                "start": current[0],
                "end": _end(*current),
            },
        )
    if hobby is not None:
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
