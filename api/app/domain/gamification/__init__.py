"""Gamification (S19): XP, levels, the study-day streak and badges. Pure, no database.

The service turns stored rows into the inputs here (block focus and length,
total XP, each block's stored study date) and these functions give back the
numbers and the badge set, so every rule lives in one place and is tested
without a database.
"""

from app.domain.gamification.badges import BADGES, Badge, BadgeGroup, Stats, earned
from app.domain.gamification.levels import MAX_LEVEL, XP_PER_LEVEL, level_bounds, level_for
from app.domain.gamification.streak import Streak, streak
from app.domain.gamification.xp import FIRST_PLAN_XP, MIN_MINUTES, block_xp

__all__ = [
    "BADGES",
    "FIRST_PLAN_XP",
    "MAX_LEVEL",
    "MIN_MINUTES",
    "XP_PER_LEVEL",
    "Badge",
    "BadgeGroup",
    "Stats",
    "Streak",
    "block_xp",
    "earned",
    "level_bounds",
    "level_for",
    "streak",
]
