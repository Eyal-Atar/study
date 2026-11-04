"""The day capacity rule shared by day assignment and hour packing.

Day assignment puts on a day only what `day_fits` accepts, and hour packing
must then fit all of it. Everything here is pure arithmetic on minutes; each
`windows` argument holds the lengths of the day's study windows in time order.

The bound holds only for a packer that keeps these rules:
- A break, the long one too, goes only between two blocks in the same window;
  the gap between two windows replaces it.
- The simulation sits at the start of the smallest window that holds it, the
  earliest one on a tie. When less than MIN_PART_MINUTES of that window is left
  after it and its break, the window leaves the count k of windows.
- For the long break, the n blocks of the day include the simulation.
- Packing goes through the windows in time order and splits only at the end of
  a window.
"""

from collections.abc import Sequence
from typing import Final

MIN_PART_MINUTES: Final = 30
BREAK_MINUTES: Final = 10
LONG_BREAK_MINUTES: Final = 30
# What each window but one keeps free in the bound. Packing moves on to the
# next window only when the next item does not fit; an item of an hour or more
# can split at the end of the window into parts of MIN_PART_MINUTES or more, so
# only an item shorter than an hour (59 minutes at most) leaves time unused.
# That is at most 68 minutes: free time of at most 58 that the item cannot use,
# plus the 10-minute break in front of it. 70 keeps a small margin over 68.
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
