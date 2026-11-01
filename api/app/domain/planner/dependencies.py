"""Which task waits for which, once finished, skipped and deleted tasks are gone."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from uuid import UUID

from app.domain.planner.model import Task, TaskStatus


@dataclass(frozen=True, slots=True)
class Dependencies:
    # A todo task -> the todo task it waits for. A task depends on at most one other.
    prerequisite: Mapping[UUID, UUID]
    # The todo tasks on a dependency cycle; a task that only leads into a cycle is not.
    in_cycle: frozenset[UUID]


def resolve_dependencies(tasks: Sequence[Task]) -> Dependencies:
    """The dependencies that still hold: between two todo tasks of the input.

    A dependency on a task that is done, skipped or missing from the input
    (deleted) does not hold the dependent back, so it is dropped.
    """
    todo = {task.id for task in tasks if task.status is TaskStatus.TODO}
    prerequisite = {
        task.id: task.depends_on
        for task in tasks
        if task.status is TaskStatus.TODO
        and task.depends_on is not None
        and task.depends_on in todo
    }
    return Dependencies(
        prerequisite=MappingProxyType(prerequisite),
        in_cycle=_cycle_members(prerequisite),
    )


def _cycle_members(prerequisite: Mapping[UUID, UUID]) -> frozenset[UUID]:
    """Each task has at most one prerequisite, so following them from any task
    either ends or runs into a cycle; every task is walked once."""
    members: set[UUID] = set()
    visited: set[UUID] = set()
    for start in prerequisite:
        path: dict[UUID, int] = {}  # task -> its position on the current walk
        node: UUID | None = start
        while node is not None and node not in visited and node not in path:
            path[node] = len(path)
            node = prerequisite.get(node)
        if node is not None and node in path:
            members.update(task for task, position in path.items() if position >= path[node])
        visited.update(path)
    return frozenset(members)
