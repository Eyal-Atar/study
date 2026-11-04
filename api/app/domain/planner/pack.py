"""Packing one study day's items into timed blocks.

The rules this packer keeps are the ones listed in `capacity.py`; they are what
makes every day that `assign_days` produced pack completely. A day that does not
pack is a contract bug, so it raises instead of dropping an item.
"""

from collections import deque
from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta
from uuid import UUID

from app.domain.planner.capacity import (
    BREAK_MINUTES,
    LONG_BREAK_MINUTES,
    MIN_PART_MINUTES,
    simulation_window,
)
from app.domain.planner.intervals import Interval
from app.domain.planner.model import DayItem, StudyDay, Task, TaskKind

_MINUTE = timedelta(minutes=1)


def _order(
    items: Sequence[DayItem],
    tasks: Mapping[UUID, Task],
    prerequisite: Mapping[UUID, UUID],
    day: StudyDay,
) -> list[DayItem]:
    """Highest focus first, never before a prerequisite that is on the same day."""
    pending = list(items)
    ordered: list[DayItem] = []
    while pending:
        waiting = {item.task_id for item in pending}
        ready = [item for item in pending if prerequisite.get(item.task_id) not in waiting]
        if not ready:
            raise RuntimeError(f"day {day.date}: the dependencies of its items form a cycle")
        # max keeps the first of equal focus, which is the earlier one in items.
        chosen = max(ready, key=lambda item: tasks[item.task_id].focus)
        pending.remove(chosen)
        ordered.append(chosen)
    return ordered


class _Walk:
    """The blocks placed so far, in time order, and what decides the next break."""

    def __init__(self, total: int) -> None:
        self.total = total
        self.placed = 0
        self.blocks: list[tuple[UUID, Interval]] = []
        self.previous_long = False
        self.has_previous = False

    def break_before(self) -> int:
        if not self.has_previous:
            return 0
        return LONG_BREAK_MINUTES if self.previous_long else BREAK_MINUTES

    def start_window(self) -> None:
        self.has_previous = False
        self.previous_long = False

    def add(self, task_id: UUID, interval: Interval) -> None:
        before = self.placed
        after = before + interval.minutes
        self.blocks.append((task_id, interval))
        self.placed = after
        self.previous_long = before * 2 < self.total <= after * 2
        self.has_previous = True


def _fill_window(
    walk: _Walk, queue: deque[tuple[UUID, int]], window: Interval, cursor: datetime
) -> None:
    """Place items from the queue into the window; at most the last one splits."""
    while queue:
        task_id, minutes = queue[0]
        start = cursor + walk.break_before() * _MINUTE
        free = (window.end - start) // _MINUTE
        if minutes <= free:
            queue.popleft()
            part = minutes
        else:
            # The part leaves at least MIN_PART_MINUTES for the rest of the item.
            part = min(free, minutes - MIN_PART_MINUTES)
            if part < MIN_PART_MINUTES:
                return
            queue[0] = (task_id, minutes - part)
        cursor = start + part * _MINUTE
        walk.add(task_id, Interval(start, cursor))
        if part < minutes:
            return


def pack_day(
    day: StudyDay,
    items: Sequence[DayItem],
    tasks: Mapping[UUID, Task],
    prerequisite: Mapping[UUID, UUID],
) -> tuple[tuple[UUID, Interval], ...]:
    """The day's blocks as (task_id, interval) in time order."""
    if not items:
        return ()
    simulation = next((i for i in items if tasks[i.task_id].kind is TaskKind.SIMULATION), None)
    rest = [i for i in items if i is not simulation]
    sim_index: int | None = None
    if simulation is not None:
        sim_index = simulation_window([w.minutes for w in day.windows], simulation.minutes)
        if sim_index is None:
            raise RuntimeError(f"day {day.date}: no window holds simulation {simulation.task_id}")

    queue = deque((i.task_id, i.minutes) for i in _order(rest, tasks, prerequisite, day))
    walk = _Walk(sum(i.minutes for i in items))
    for index, window in enumerate(day.windows):
        walk.start_window()
        cursor = window.start
        if simulation is not None and index == sim_index:
            cursor += simulation.minutes * _MINUTE
            walk.add(simulation.task_id, Interval(window.start, cursor))
        _fill_window(walk, queue, window, cursor)
    if queue:
        raise RuntimeError(f"day {day.date}: task {queue[0][0]} does not pack into its windows")
    return tuple(walk.blocks)
