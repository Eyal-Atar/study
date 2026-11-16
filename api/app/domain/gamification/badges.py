"""The badges and when they are earned (plan decisions 3 and 4).

Badges are derived from the stats, never stored as events: `earned` gives the
full set the stats deserve right now, and the service adds and removes rows to
match. So uncompleting a block can take a badge back, and there is a single
rule for when a badge holds.

The legacy list without three badges: `streak_broken_once` (the design doc
drops rewarding a broken streak), `first_login` (v2 does not track logins, and
in practice it came together with `first_task`) and `week_streak` (the same
condition as `iron_will_7`).
"""

from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from app.domain.gamification.levels import level_for


class BadgeGroup(StrEnum):
    """Which stat a badge measures; also how the screen groups them."""

    FIRST = "first"
    BLOCKS = "blocks"
    STREAK = "streak"
    LEVEL = "level"
    XP = "xp"


@dataclass(frozen=True)
class Badge:
    """A badge earned once its group's stat reaches `threshold`."""

    key: str
    group: BadgeGroup
    threshold: int


@dataclass(frozen=True)
class Stats:
    """What the badges are measured on.

    `blocks_done` counts blocks, not tasks, as in the legacy code.
    """

    total_xp: int
    blocks_done: int
    longest_streak: int


def _group(prefix: str, group: BadgeGroup, thresholds: tuple[int, ...]) -> tuple[Badge, ...]:
    return tuple(Badge(f"{prefix}_{t}", group, t) for t in thresholds)


# A fixed order: the screen lists every badge in it, earned or not.
BADGES: Final[tuple[Badge, ...]] = (
    Badge("first_task", BadgeGroup.FIRST, 1),
    *_group("task_master", BadgeGroup.BLOCKS, (10, 20, 50, 100)),
    *_group("iron_will", BadgeGroup.STREAK, (7, 10, 14, 30, 100)),
    *_group("knowledge_seeker", BadgeGroup.LEVEL, (5, 10, 20, 25, 50)),
    *_group("xp", BadgeGroup.XP, (1000, 5000, 10000)),
)


def _measure(group: BadgeGroup, stats: Stats) -> int:
    match group:
        case BadgeGroup.FIRST | BadgeGroup.BLOCKS:
            return stats.blocks_done
        case BadgeGroup.STREAK:
            return stats.longest_streak
        case BadgeGroup.LEVEL:
            return level_for(stats.total_xp)
        case BadgeGroup.XP:
            return stats.total_xp


def earned(stats: Stats) -> frozenset[str]:
    """The keys of every badge whose threshold `stats` meets (>=)."""
    return frozenset(b.key for b in BADGES if _measure(b.group, stats) >= b.threshold)
