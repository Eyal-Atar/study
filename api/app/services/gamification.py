"""XP, the study-day streak and badges (S19), inside the transaction of complete and uncomplete.

`app.xp_events` is the ledger: at most one row per block (`block_id` unique), written when a
block becomes done and deleted when it is uncompleted (plan S19 decision 2). The total, the
level, the number of blocks done and the streak are always computed from it, never kept as
counters. `app.badges` is the one derived table: after every change `sync_badges` makes it
exactly the set the ledger earns now (adds the new ones, deletes the ones no longer met), so a
complete followed by an undo leaves no badge behind (decision 3).

Callers hold the user's lock (`lock_user`), so two completions of one user run one after the
other; the unique `block_id` with `ON CONFLICT DO NOTHING` is the database's own guard.

Every query runs in the user's transaction (RLS) and still filters on `user_id` explicitly.
"""

import datetime as dt
from dataclasses import dataclass
from typing import Final
from uuid import UUID

from app.domain.gamification import (
    BADGES,
    Badge,
    Stats,
    Streak,
    block_xp,
    earned,
    level_bounds,
    level_for,
    streak,
)
from app.domain.planner import Profile, study_date
from app.services.board import BlockRow
from app.services.profiles import Conn

# The progress board shows this many study days, today included.
RECENT_DAYS: Final = 14

_KNOWN_KEYS: Final = frozenset(badge.key for badge in BADGES)


@dataclass(frozen=True)
class ProgressChange:
    """What one complete or uncomplete did to the user's progress (in its response)."""

    xp_change: int
    total_xp: int
    level: int
    level_up: bool
    badges_earned: tuple[str, ...]
    badges_lost: tuple[str, ...]


@dataclass(frozen=True)
class BadgeState:
    badge: Badge
    earned_at: dt.datetime | None


@dataclass(frozen=True)
class DayXp:
    date: dt.date
    xp: int


@dataclass(frozen=True)
class ProgressView:
    """GET /progress: everything is computed from the ledger and the badges table."""

    total_xp: int
    level: int
    level_start_xp: int
    next_level_xp: int | None
    blocks_done: int
    streak: Streak
    today: dt.date
    days: tuple[DayXp, ...]
    badges: tuple[BadgeState, ...]


@dataclass(frozen=True)
class _Totals:
    total_xp: int
    blocks_done: int


def _totals(conn: Conn, user_id: UUID) -> _Totals:
    row = conn.execute(
        "SELECT coalesce(sum(xp), 0)::int AS total, count(*)::int AS blocks "
        "FROM app.xp_events WHERE user_id = %s",
        (user_id,),
    ).fetchone()
    if row is None:
        raise RuntimeError("an aggregate query returned no row")
    return _Totals(row["total"], row["blocks"])


def _study_days(conn: Conn, user_id: UUID) -> list[dt.date]:
    rows = conn.execute(
        "SELECT DISTINCT study_date FROM app.xp_events WHERE user_id = %s", (user_id,)
    ).fetchall()
    return [row["study_date"] for row in rows]


def _longest_streak(conn: Conn, user_id: UUID) -> int:
    # The longest run does not depend on today: the last study day works as `today`.
    days = _study_days(conn, user_id)
    return streak(days, max(days)).longest if days else 0


def sync_badges(
    conn: Conn, user_id: UUID, totals: _Totals | None = None
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Make app.badges the set the ledger earns now: (keys added, keys removed), in BADGES order.

    A key that is not in BADGES (one a later version retired) is left alone.
    """
    totals = _totals(conn, user_id) if totals is None else totals
    want = earned(
        Stats(
            total_xp=totals.total_xp,
            blocks_done=totals.blocks_done,
            longest_streak=_longest_streak(conn, user_id),
        )
    )
    have = {
        row["badge_key"]
        for row in conn.execute(
            "SELECT badge_key FROM app.badges WHERE user_id = %s", (user_id,)
        ).fetchall()
    }
    added = tuple(badge.key for badge in BADGES if badge.key in want and badge.key not in have)
    lost = tuple(badge.key for badge in BADGES if badge.key in have and badge.key not in want)
    if added:
        conn.execute(
            "INSERT INTO app.badges (user_id, badge_key) "
            "SELECT %s, unnest(%s::text[]) ON CONFLICT DO NOTHING",
            (user_id, list(added)),
        )
    if lost:
        conn.execute(
            "DELETE FROM app.badges WHERE user_id = %s AND badge_key = ANY(%s)",
            (user_id, list(lost)),
        )
    return added, lost


def _change(
    conn: Conn, user_id: UUID, before: _Totals, xp_change: int, *, sync: bool
) -> ProgressChange:
    after = _totals(conn, user_id)
    added, lost = sync_badges(conn, user_id, after) if sync else ((), ())
    return ProgressChange(
        xp_change=xp_change,
        total_xp=after.total_xp,
        level=level_for(after.total_xp),
        level_up=level_for(after.total_xp) > level_for(before.total_xp),
        badges_earned=added,
        badges_lost=lost,
    )


def completion_day(profile: Profile, block: BlockRow, now: dt.datetime) -> dt.date:
    """The study day a completed block counts for (plan S19 decision 5).

    The study day the board shows the block in, so a block after midnight of a late sleeper
    counts for the evening before. A block marked done ahead of time counts for today, when
    the studying happened, not for a later day of the streak.
    """
    return study_date(profile, min(block.starts_at, now))


def record_completion(
    conn: Conn,
    user_id: UUID,
    profile: Profile,
    block: BlockRow,
    focus: int,
    now: dt.datetime,
) -> ProgressChange:
    """The block just became done: its XP (once), then the badges."""
    before = _totals(conn, user_id)
    minutes = int((block.ends_at - block.starts_at).total_seconds() // 60)
    row = conn.execute(
        "INSERT INTO app.xp_events (user_id, block_id, xp, study_date) "
        "VALUES (%s, %s, %s, %s) ON CONFLICT (block_id) DO NOTHING RETURNING xp",
        (user_id, block.id, block_xp(focus, minutes), completion_day(profile, block, now)),
    ).fetchone()
    return _change(conn, user_id, before, 0 if row is None else row["xp"], sync=True)


def revoke_completion(conn: Conn, user_id: UUID, block_id: UUID) -> ProgressChange:
    """The block is no longer done: its XP row goes, then the badges."""
    before = _totals(conn, user_id)
    row = conn.execute(
        "DELETE FROM app.xp_events WHERE user_id = %s AND block_id = %s RETURNING xp",
        (user_id, block_id),
    ).fetchone()
    return _change(conn, user_id, before, 0 if row is None else -row["xp"], sync=True)


def unchanged(conn: Conn, user_id: UUID) -> ProgressChange:
    """The progress as it is, for a complete that changed nothing (the block was done)."""
    return _change(conn, user_id, _totals(conn, user_id), 0, sync=False)


def progress(conn: Conn, user_id: UUID, profile: Profile, now: dt.datetime) -> ProgressView:
    totals = _totals(conn, user_id)
    level = level_for(totals.total_xp)
    start_xp, next_xp = level_bounds(level)
    today = study_date(profile, now)
    first = today - dt.timedelta(days=RECENT_DAYS - 1)
    by_day = {
        row["study_date"]: row["xp"]
        for row in conn.execute(
            "SELECT study_date, sum(xp)::int AS xp FROM app.xp_events "
            "WHERE user_id = %s AND study_date BETWEEN %s AND %s GROUP BY study_date",
            (user_id, first, today),
        ).fetchall()
    }
    days = tuple(
        DayXp(day, by_day.get(day, 0))
        for day in (first + dt.timedelta(days=offset) for offset in range(RECENT_DAYS))
    )
    earned_at = {
        row["badge_key"]: row["earned_at"]
        for row in conn.execute(
            "SELECT badge_key, earned_at FROM app.badges WHERE user_id = %s", (user_id,)
        ).fetchall()
        if row["badge_key"] in _KNOWN_KEYS
    }
    return ProgressView(
        total_xp=totals.total_xp,
        level=level,
        level_start_xp=start_xp,
        next_level_xp=next_xp,
        blocks_done=totals.blocks_done,
        streak=streak(_study_days(conn, user_id), today),
        today=today,
        days=days,
        badges=tuple(BadgeState(badge, earned_at.get(badge.key)) for badge in BADGES),
    )
