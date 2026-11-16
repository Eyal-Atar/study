"""Levels from total XP: a flat 1000 XP per level, capped at 50 (plan decision 1).

A flat step keeps the progress bar honest: every level costs the same study
time, and the screen can show where the current level starts and ends.
"""

from typing import Final

XP_PER_LEVEL: Final = 1000
MAX_LEVEL: Final = 50


def level_for(total_xp: int) -> int:
    """The level at `total_xp`: `min(MAX_LEVEL, total_xp // XP_PER_LEVEL + 1)`."""
    if total_xp < 0:
        raise ValueError(f"total_xp must not be negative, got {total_xp}")
    return min(MAX_LEVEL, total_xp // XP_PER_LEVEL + 1)


def level_bounds(level: int) -> tuple[int, int | None]:
    """The XP where `level` starts, and where the next one starts.

    The second value is None at MAX_LEVEL: there is no next level, and the
    screen shows a full bar instead of a target.
    """
    if not 1 <= level <= MAX_LEVEL:
        raise ValueError(f"level must be in 1..{MAX_LEVEL}, got {level}")
    start = (level - 1) * XP_PER_LEVEL
    return start, None if level == MAX_LEVEL else start + XP_PER_LEVEL
