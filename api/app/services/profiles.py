"""The user's profile: created on first use, locked per user, mapped to the planner."""

import datetime as dt
from collections.abc import Mapping
from dataclasses import dataclass, fields
from typing import Final
from uuid import UUID

import psycopg
import psycopg.errors
from psycopg import sql
from psycopg.rows import DictRow

from app.domain.planner import Commitment, Interval, Profile, StudyWindow
from app.domain.time import parse_timezone
from app.errors import ApiError

type Conn = psycopg.Connection[DictRow]

# The columns a PATCH may write: a closed list, never taken from the request.
UPDATABLE_COLUMNS: Final = frozenset(
    {
        "display_name",
        "timezone",
        "wake_time",
        "sleep_time",
        "daily_study_minutes",
        "study_windows",
        "rest_days_before_exam",
        "notify_lead_minutes",
        "study_start_delay_minutes",
    }
)
PLAN_FIELDS: Final = frozenset(
    {
        "timezone",
        "wake_time",
        "sleep_time",
        "daily_study_minutes",
        "study_windows",
        "rest_days_before_exam",
        "study_start_delay_minutes",
    }
)
_WINDOW_ORDER: Final = tuple(window.value for window in StudyWindow)


def canonical_windows(windows: object) -> tuple[str, ...]:
    """The study windows in the fixed order morning, afternoon, evening, night."""
    names = {str(window) for window in windows}  # type: ignore[attr-defined]
    return tuple(name for name in _WINDOW_ORDER if name in names)


@dataclass(frozen=True)
class ProfileRow:
    id: UUID
    display_name: str | None
    timezone: str
    wake_time: dt.time
    sleep_time: dt.time
    daily_study_minutes: int
    study_windows: tuple[str, ...]
    rest_days_before_exam: int
    notify_lead_minutes: int
    onboarding_completed_at: dt.datetime | None
    created_at: dt.datetime
    # Migration 0009 (S15); the default is the column default. The hobby columns of 0009 were
    # dropped by 0017 (S34); Me time lives in app.commitments, see app.services.hobby.
    study_start_delay_minutes: int = 60


_ROW_FIELDS: Final = frozenset(field.name for field in fields(ProfileRow))


def _to_row(raw: Mapping[str, object] | None) -> ProfileRow:
    if raw is None:
        raise RuntimeError("the profile row is not visible to this user")
    # Only the fields this code knows: a column added by a later migration must not break
    # code that is still running against the same database (S15).
    values = {key: value for key, value in raw.items() if key in _ROW_FIELDS}
    values["study_windows"] = canonical_windows(values["study_windows"])
    return ProfileRow(**values)  # type: ignore[arg-type]


def ensure_profile(conn: Conn, user_id: UUID) -> ProfileRow:
    try:
        conn.execute(
            "INSERT INTO app.profiles (id) VALUES (%s) ON CONFLICT DO NOTHING",
            (user_id,),
        )
    except psycopg.errors.ForeignKeyViolation:
        # The token is still valid, but the user is gone from Auth: the account was deleted.
        raise ApiError("unauthenticated") from None
    row = conn.execute("SELECT * FROM app.profiles WHERE id = %s", (user_id,)).fetchone()
    return _to_row(row)


def lock_user(conn: Conn, user_id: UUID) -> ProfileRow:
    """Serialize everything that changes this user's board: hold the profile row."""
    ensure_profile(conn, user_id)
    row = conn.execute("SELECT * FROM app.profiles WHERE id = %s FOR UPDATE", (user_id,)).fetchone()
    return _to_row(row)


def update_profile(
    conn: Conn, user_id: UUID, changes: Mapping[str, object]
) -> tuple[ProfileRow, bool]:
    unknown = set(changes) - UPDATABLE_COLUMNS
    if unknown:
        raise ValueError(f"Not updatable: {sorted(unknown)}")
    before = lock_user(conn, user_id)
    values = dict(changes)
    if "study_windows" in values:
        values["study_windows"] = list(canonical_windows(values["study_windows"]))
    if not values:
        return before, False
    assignments = sql.SQL(", ").join(
        sql.SQL("{} = {}").format(sql.Identifier(column), sql.Placeholder()) for column in values
    )
    row = conn.execute(
        sql.SQL("UPDATE app.profiles SET {} WHERE id = %s RETURNING *").format(assignments),
        [*values.values(), user_id],
    ).fetchone()
    after = _to_row(row)
    plan_affected = any(
        getattr(before, field) != getattr(after, field) for field in PLAN_FIELDS if field in values
    )
    return after, plan_affected


def complete_onboarding(conn: Conn, user_id: UUID, now: dt.datetime) -> bool:
    """Mark the onboarding done at `now`, the time of the first plan; a later plan keeps it.

    True when this call ended the onboarding (the first plan); False when it had already ended.
    """
    cursor = conn.execute(
        "UPDATE app.profiles SET onboarding_completed_at = %(now)s "
        "WHERE id = %(user_id)s AND onboarding_completed_at IS NULL",
        {"now": now, "user_id": user_id},
    )
    return cursor.rowcount == 1


def to_planner_profile(
    row: ProfileRow,
    commitments: tuple[Commitment, ...] = (),
    busy: tuple[Interval, ...] = (),
) -> Profile:
    """The planner's Profile; only callers that read times, never free time, may omit the rest.

    Free time (the board, moves, slots, free time now) must come from
    app.services.availability.planner_profile, which loads the commitments and busy events.
    """
    return Profile(
        timezone=parse_timezone(row.timezone),
        wake_time=row.wake_time,
        sleep_time=row.sleep_time,
        daily_study_minutes=row.daily_study_minutes,
        study_windows=frozenset(StudyWindow(name) for name in row.study_windows),
        rest_days_before_exam=row.rest_days_before_exam,
        study_start_delay=dt.timedelta(minutes=row.study_start_delay_minutes),
        commitments=commitments,
        busy=busy,
    )
