"""XP, the study-day streak and badges (S19), inside the transaction of complete and uncomplete.

`app.xp_events` is the ledger: at most one row per block (`kind = 'block'`, `block_id`
unique), written when a block becomes done and deleted when it is uncompleted (plan S19
decision 2), and at most one row per user of the first plan's XP (`kind = 'first_plan'`,
no block, S34 decision 8). The total, the level, the number of blocks done and the streak
are always computed from it, never kept as counters: the total counts every row, while
`blocks_done`, the streak and the days count only blocks.

`app.badges` is the one derived table: after every change `sync_badges` makes it exactly the
set the ledger earns now (adds the new ones, deletes the ones no longer met), so a complete
followed by an undo leaves no badge behind (decision 3).

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
    FIRST_PLAN_XP,
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
from app.services.exam_stats import EMPTY, exam_stats
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
class ArchivedExam:
    """An exam the student closed as done, with how far its current sitting got (S45)."""

    exam_id: UUID
    name: str
    color_index: int
    exam_date: dt.date
    first_exam_date: dt.date | None
    sitting: int
    closed_at: dt.datetime | None
    studied_minutes: int
    tasks_done: int
    tasks_total: int
    completion_percent: int


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
    archive: tuple[ArchivedExam, ...] = ()


@dataclass(frozen=True)
class _Totals:
    total_xp: int
    blocks_done: int


def _totals(conn: Conn, user_id: UUID) -> _Totals:
    row = conn.execute(
        "SELECT coalesce(sum(xp), 0)::int AS total, "
        "count(*) FILTER (WHERE kind = 'block')::int AS blocks "
        "FROM app.xp_events WHERE user_id = %s",
        (user_id,),
    ).fetchone()
    if row is None:
        raise RuntimeError("an aggregate query returned no row")
    return _Totals(row["total"], row["blocks"])


def _study_days(conn: Conn, user_id: UUID) -> list[dt.date]:
    rows = conn.execute(
        "SELECT DISTINCT study_date FROM app.xp_events WHERE user_id = %s AND kind = 'block'",
        (user_id,),
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
    *,
    split: bool = False,
) -> ProgressChange:
    """The block just became done: its XP (once), then the badges.

    For a block of a split task (S44, `split`) the XP is what the task's done minutes earn
    as one block, less what its other done blocks already earned (never below 0), so the
    bites of a split task never earn more than the task would in one block: block_xp rounds
    each block, and a rounding up per bite would otherwise add up.
    """
    before = _totals(conn, user_id)
    minutes = int((block.ends_at - block.starts_at).total_seconds() // 60)
    xp = _split_xp(conn, user_id, block, focus, minutes) if split else block_xp(focus, minutes)
    row = conn.execute(
        "INSERT INTO app.xp_events (user_id, block_id, xp, study_date, kind) "
        "VALUES (%s, %s, %s, %s, 'block') ON CONFLICT (block_id) DO NOTHING RETURNING xp",
        (user_id, block.id, xp, completion_day(profile, block, now)),
    ).fetchone()
    return _change(conn, user_id, before, 0 if row is None else row["xp"], sync=True)


def _split_xp(conn: Conn, user_id: UUID, block: BlockRow, focus: int, minutes: int) -> int:
    row = conn.execute(
        "SELECT coalesce(sum(x.xp), 0)::int AS xp, "
        "coalesce(sum(extract(epoch FROM b.ends_at - b.starts_at) / 60), 0)::int AS minutes "
        "FROM app.xp_events x JOIN app.blocks b ON b.id = x.block_id AND b.user_id = x.user_id "
        "WHERE x.user_id = %s AND b.task_id = %s AND b.id <> %s",
        (user_id, block.task_id, block.id),
    ).fetchone()
    if row is None:
        raise RuntimeError("an aggregate query returned no row")
    earned: int = row["xp"]
    return max(0, block_xp(focus, minutes + int(row["minutes"])) - earned)


def revoke_completion(conn: Conn, user_id: UUID, block_id: UUID) -> ProgressChange:
    """The block is no longer done: its XP row goes, then the badges."""
    before = _totals(conn, user_id)
    row = conn.execute(
        "DELETE FROM app.xp_events WHERE user_id = %s AND block_id = %s RETURNING xp",
        (user_id, block_id),
    ).fetchone()
    return _change(conn, user_id, before, 0 if row is None else -row["xp"], sync=True)


def award_first_plan(
    conn: Conn, user_id: UUID, profile: Profile, now: dt.datetime
) -> ProgressChange:
    """The first plan's XP (S34 decision 8): once per user.

    Called in the transaction that ends the onboarding.

    The partial unique index xp_events_first_plan_key is the database's guard: a second call
    writes nothing and returns xp_change 0.
    """
    before = _totals(conn, user_id)
    row = conn.execute(
        "INSERT INTO app.xp_events (user_id, block_id, xp, study_date, kind) "
        "VALUES (%s, NULL, %s, %s, 'first_plan') "
        "ON CONFLICT (user_id) WHERE kind = 'first_plan' DO NOTHING RETURNING xp",
        (user_id, FIRST_PLAN_XP, study_date(profile, now)),
    ).fetchone()
    return _change(conn, user_id, before, 0 if row is None else row["xp"], sync=True)


def unchanged(conn: Conn, user_id: UUID) -> ProgressChange:
    """The progress as it is, for a complete that changed nothing (the block was done)."""
    return _change(conn, user_id, _totals(conn, user_id), 0, sync=False)


def _archive(conn: Conn, user_id: UUID) -> tuple[ArchivedExam, ...]:
    """The live exams closed as done, the latest closed first (plan S45, decision 10)."""
    exams = conn.execute(
        "SELECT id, name, color_index, exam_date, first_exam_date, sitting, closed_at "
        "FROM app.exams WHERE user_id = %s AND closure = 'done' AND deleted_at IS NULL "
        "ORDER BY closed_at DESC NULLS LAST, id",
        (user_id,),
    ).fetchall()
    stats = exam_stats(conn, user_id, [row["id"] for row in exams])
    return tuple(
        ArchivedExam(
            exam_id=row["id"],
            name=row["name"],
            color_index=row["color_index"],
            exam_date=row["exam_date"],
            first_exam_date=row["first_exam_date"],
            sitting=row["sitting"],
            closed_at=row["closed_at"],
            studied_minutes=(stat := stats.get(row["id"], EMPTY)).studied_minutes,
            tasks_done=stat.tasks_done,
            tasks_total=stat.tasks_total,
            completion_percent=stat.completion_percent,
        )
        for row in exams
    )


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
            "WHERE user_id = %s AND kind = 'block' AND study_date BETWEEN %s AND %s "
            "GROUP BY study_date",
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
        archive=_archive(conn, user_id),
    )
