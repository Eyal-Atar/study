"""The day capacity rule shared by day assignment and hour packing.

Day assignment puts on a day only what `day_fits` accepts, and hour packing
must then fit all of it. Everything here is pure arithmetic on minutes; each
`windows` argument holds the lengths of the day's study windows in time order.
"""

from collections.abc import Sequence
from typing import Final

MIN_PART_MINUTES: Final = 30
BREAK_MINUTES: Final = 10
LONG_BREAK_MINUTES: Final = 30
# The most a window can waste before packing moves on to the next one: an item
# shorter than an hour that does not fit (MIN_PART_MINUTES * 2 - 1 = 59 at
# worst, rounded up to 60), plus the break in front of it.
WINDOW_EDGE_RESERVE_MINUTES: Final = 70

_LONG_BREAK_EXTRA: Final = LONG_BREAK_MINUTES - BREAK_MINUTES


def simulation_window(windows: Sequence[int], minutes: int) -> int | None:
    """Index of the smallest window holding `minutes` (earliest on a tie)."""
    best: int | None = None
    for index, length in enumerate(windows):
        if length >= minutes and (best is None or length < windows[best]):
            best = index
    return best


def _after_simulation(windows: Sequence[int], simulation: int | None) -> list[int] | None:
    """The windows left once the simulation is placed, or None if it cannot fit."""
    remaining = list(windows)
    if simulation is None:
        return remaining
    index = simulation_window(remaining, simulation)
    if index is None:
        return None
    left = remaining[index] - (simulation + BREAK_MINUTES)
    if left < MIN_PART_MINUTES:
        del remaining[index]
    else:
        remaining[index] = left
    return remaining


def _slack(remaining: Sequence[int], minutes: Sequence[int], blocks: int) -> int:
    """Window minutes left after `minutes`, its breaks and the window reserves."""
    long_break = _LONG_BREAK_EXTRA if blocks >= 2 else 0
    return (
        sum(remaining)
        - sum(minutes)
        - BREAK_MINUTES * (len(minutes) - 1)
        - long_break
        - WINDOW_EDGE_RESERVE_MINUTES * (len(remaining) - 1)
    )


def day_fits(windows: Sequence[int], minutes: Sequence[int], simulation: int | None = None) -> bool:
    """Whether a day with these windows can hold all of these items."""
    remaining = _after_simulation(windows, simulation)
    if remaining is None:
        return False
    if not minutes:
        return True
    if not remaining:
        return False
    blocks = len(minutes) + (1 if simulation is not None else 0)
    return _slack(remaining, minutes, blocks) >= 0


def room(windows: Sequence[int], minutes: Sequence[int], simulation: int | None = None) -> int:
    """The longest item that can still be added, so that `day_fits` holds."""
    remaining = _after_simulation(windows, simulation)
    if not remaining:
        return 0
    blocks = len(minutes) + 1 + (1 if simulation is not None else 0)
    # Adding one item adds one more break to the existing ones.
    return max(0, _slack(remaining, [*minutes, 0], blocks))
