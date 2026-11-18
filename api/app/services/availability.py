"""The user's taken time as the planner sees it: weekly commitments and one-off busy events.

Every place that computes free time (the board, a move and its slots, the defer choices, free
time now) builds its Profile through `planner_profile`, so none of them can forget the
commitments and see time as free that the user said is taken (S35).
"""

import datetime as dt
from dataclasses import dataclass
from typing import Final
from uuid import UUID

from app.domain.planner import Commitment, Interval, Profile
from app.services.profiles import Conn, ProfileRow, to_planner_profile

# Busy events that ended this long ago still reach the planner: the board itself looks back
# 48 hours (BLOCK_LOOKBACK), and a study day can start the evening before.
EVENT_LOOKBACK: Final = dt.timedelta(hours=48)


@dataclass(frozen=True)
class Availability:
    commitments: tuple[Commitment, ...] = ()
    busy: tuple[Interval, ...] = ()


def load_availability(conn: Conn, user_id: UUID, now: dt.datetime) -> Availability:
    """The user's live commitments, and live busy events ending after now - 48h."""
    commitments = tuple(
        Commitment(
            weekday=row["weekday"],
            start=row["start_time"],
            end=row["end_time"],
            valid_from=row["valid_from"],
            valid_until=row["valid_until"],
        )
        for row in conn.execute(
            "SELECT weekday, start_time, end_time, valid_from, valid_until FROM app.commitments "
            "WHERE user_id = %s AND deleted_at IS NULL "
            "ORDER BY weekday, start_time, end_time, id",
            (user_id,),
        ).fetchall()
    )
    busy = tuple(
        Interval(row["starts_at"].astimezone(dt.UTC), row["ends_at"].astimezone(dt.UTC))
        for row in conn.execute(
            "SELECT starts_at, ends_at FROM app.busy_events "
            "WHERE user_id = %s AND deleted_at IS NULL AND ends_at > %s "
            "ORDER BY starts_at, ends_at, id",
            (user_id, now - EVENT_LOOKBACK),
        ).fetchall()
    )
    return Availability(commitments=commitments, busy=busy)


def planner_profile(conn: Conn, user_id: UUID, row: ProfileRow, now: dt.datetime) -> Profile:
    """The planner's Profile for this row, with the user's commitments and busy events."""
    availability = load_availability(conn, user_id, now)
    return to_planner_profile(row, availability.commitments, availability.busy)
