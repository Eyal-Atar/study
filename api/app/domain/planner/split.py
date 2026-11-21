"""Splitting a task the user keeps putting off into bites (S44, audit section 15).

A task the user deferred SPLIT_THRESHOLD times in a row is offered a split: from then on
the planner gives it one bite a day (Task.bite_minutes, see assign.py). The bite comes from
the block the user keeps pushing back (its next planned block): a third of it, never under
the planner's shortest part. 60 -> 2x30, 90 -> 3x30, 120 -> 3x40. Every minute of the task
stays planned: a split changes the shape of the work, not its amount.
"""

from typing import Final

from app.domain.planner.capacity import MIN_PART_MINUTES

# Deferrals in a row that bring the offer.
SPLIT_THRESHOLD: Final = 3

# The longest bite the database accepts (tasks_bite_minutes_range).
MAX_BITE_MINUTES: Final = 300

_STEP: Final = 5


def bite_for(block_minutes: int) -> int | None:
    """The bite for a block of these minutes, or None when it cannot be cut in two.

    `max(30, 5 * floor(block_minutes / 15))`: a third of the block on a 5-minute step.
    A block shorter than two shortest parts (60 minutes) has no split.
    """
    if block_minutes < 2 * MIN_PART_MINUTES:
        return None
    third = _STEP * (block_minutes // (3 * _STEP))
    return min(MAX_BITE_MINUTES, max(MIN_PART_MINUTES, third))
