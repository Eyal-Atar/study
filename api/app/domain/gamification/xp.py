"""XP for a finished study block.

The legacy formula is kept (plan decision 1): focus x hours x 10, written here
on minutes so it stays integer until the final rounding. A focus-5 hour is 50
XP, so level 2 comes after about 20 hours of study.
"""

from typing import Final

# A block shorter than this still earns as if it were this long, so a short
# review block is worth marking done; it also keeps the smallest award above 0.
MIN_MINUTES: Final = 15

# The XP of the first plan after the onboarding, once per user (S34 decision 8).
FIRST_PLAN_XP: Final = 50

_MIN_FOCUS: Final = 1
_MAX_FOCUS: Final = 10


def _is_int(value: object) -> bool:
    # bool is an int subclass; True as a focus or a length is a caller bug.
    return isinstance(value, int) and not isinstance(value, bool)


def block_xp(focus: int, minutes: int) -> int:
    """The XP of a block of `minutes` at `focus` (1..10).

    `round(focus * max(minutes, MIN_MINUTES) / 6)`. Python's round is half to
    even, as in the legacy code, so a total never shifts between versions.
    A half appears only when focus x minutes is 3 mod 6, and that is an exact
    float, so the rounding is never off by a representation error.
    """
    if not _is_int(focus) or not _MIN_FOCUS <= focus <= _MAX_FOCUS:
        raise ValueError(f"focus must be an int in {_MIN_FOCUS}..{_MAX_FOCUS}, got {focus!r}")
    if not _is_int(minutes) or minutes <= 0:
        raise ValueError(f"minutes must be a positive int, got {minutes!r}")
    return round(focus * max(minutes, MIN_MINUTES) / 6)
