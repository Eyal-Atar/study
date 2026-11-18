""" "I have time now": the next tasks in line are placed from now on (plan decision 10).

The user says they are free for the next `minutes`. That session, [N, N + minutes)
with N = start_minute(now), is filled with the next tasks in the planner's order as
the board shows it. The study windows and the daily budget do not apply inside the
session, since the user said they are free; busy time does. The session's blocks are
pinned, so a replan (which checks windows and budgets) leaves them where they are.

The queue: the todo tasks that have minutes left after their fixed blocks, first those
with a candidate block (by the start of their next one, then input order), then those
with no candidate block, in input order. Each task in turn takes a piece of the free
time that is left: the session minus busy time, minus every live block that stays and
every block placed so far, each padded by BREAK_MINUTES on both sides. A task takes
the earliest piece that holds it whole; failing that, a non-simulation task of an hour
or more takes a part of the earliest piece that can hold one (at least MIN_PART_MINUTES,
leaving at least MIN_PART_MINUTES), and its remainder is placed after the session with
place_task. If the remainder finds no room, the task is skipped and nothing changes. A
placed task's candidate blocks are all released.
"""

import datetime as dt
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Final
from uuid import UUID

from app.domain.planner.availability import (
    exam_cutoff,
    last_study_day,
    start_minute,
    study_date,
)
from app.domain.planner.busy import busy_intervals
from app.domain.planner.capacity import BREAK_MINUTES, MIN_PART_MINUTES
from app.domain.planner.clear import is_live, new_block, overlaps
from app.domain.planner.fixed import BlockRole, block_role, check_blocks, fixed_state
from app.domain.planner.intervals import Interval, clip, subtract
from app.domain.planner.model import (
    Exam,
    ExistingBlock,
    PlannedBlock,
    PlannerInputError,
    Profile,
    Task,
    TaskKind,
    TaskStatus,
)
from app.domain.planner.place import place_task
from app.domain.planner.plan import number_parts
from app.domain.planner.stability import is_complete

MIN_FREE_TIME_MINUTES: Final = 30
MAX_FREE_TIME_MINUTES: Final = 480

_BREAK: Final = dt.timedelta(minutes=BREAK_MINUTES)
_MINUTE: Final = dt.timedelta(minutes=1)


class FreeTimeFailure(StrEnum):
    # No piece of the session is free for MIN_PART_MINUTES, or for the whole of the
    # shortest task in line when that is shorter.
    NO_FREE_TIME = "no_free_time"
    # There is free time, but no task in line can use it.
    NOTHING_TO_PLACE = "nothing_to_place"


@dataclass(frozen=True, slots=True, kw_only=True)
class FreeTimeResult:
    # The live blocks of every placed task after the change, each task's numbered 1..n
    # by time: the session's blocks are new and pinned, a remainder's blocks are new
    # and not pinned, and an existing fixed block keeps its block_id.
    blocks: tuple[PlannedBlock, ...]
    # The released candidate blocks of the placed tasks, in input order.
    removed: tuple[UUID, ...]
    # The placed tasks, in the order they were placed.
    placed: tuple[UUID, ...]
    session: Interval
    # None when at least one task was placed.
    failure: FreeTimeFailure | None


def _padded(interval: Interval) -> Interval:
    return Interval(interval.start - _BREAK, interval.end + _BREAK)


def free_time(
    profile: Profile,
    exams: Sequence[Exam],
    tasks: Sequence[Task],
    existing_blocks: Sequence[ExistingBlock],
    now: dt.datetime,
    minutes: int,
) -> FreeTimeResult:
    """Fill the next `minutes` from now with the next tasks in line (see the module)."""
    # type() rather than isinstance(): bool is a subclass of int.
    if type(minutes) is not int or not MIN_FREE_TIME_MINUTES <= minutes <= MAX_FREE_TIME_MINUTES:
        raise PlannerInputError(
            f"minutes must be an int, {MIN_FREE_TIME_MINUTES}-{MAX_FREE_TIME_MINUTES}"
        )
    check_blocks(existing_blocks)
    start = start_minute(now)
    session = Interval(start, start + minutes * _MINUTE)
    filler = _Filler(profile, exams, tasks, existing_blocks, now, session)
    for task in filler.queue():
        filler.try_task(task)
    return filler.result()


class _Filler:
    """The board as the session fills it, task by task."""

    def __init__(
        self,
        profile: Profile,
        exams: Sequence[Exam],
        tasks: Sequence[Task],
        existing_blocks: Sequence[ExistingBlock],
        now: dt.datetime,
        session: Interval,
    ) -> None:
        self.profile = profile
        self.exams = exams
        self.tasks = tasks
        self.now = now
        self.start = session.start
        self.session = session
        self.busy = busy_intervals(profile, session.start, session.end)
        self.exams_by_id = {exam.id: exam for exam in exams}
        self.tasks_by_id = {task.id: task for task in tasks}
        self.todo = {task.id: task for task in tasks if task.status is TaskStatus.TODO}
        self.board: list[ExistingBlock] = list(existing_blocks)
        self.input_order = {block.id: index for index, block in enumerate(existing_blocks)}
        self.synthetic: set[UUID] = set()  # ids of blocks made here; only for membership
        fixed = [b for b in existing_blocks if block_role(b, self.start) is BlockRole.FIXED]
        self.fixed = fixed
        # What is left of each todo task once its fixed blocks are done.
        self.remaining = {
            task.id: task.estimated_minutes
            for task in fixed_state(profile, tasks, fixed, self.start).tasks
            if task.status is TaskStatus.TODO
        }
        self.blocks: list[PlannedBlock] = []
        self.removed: list[UUID] = []
        self.placed: list[UUID] = []

    # The queue.

    def queue(self) -> list[Task]:
        position = {task.id: index for index, task in enumerate(self.tasks)}
        next_start: dict[UUID, dt.datetime] = {}
        for block in self.board:
            if block.task_id in self.remaining and self._is_candidate(block):
                first = next_start.get(block.task_id)
                if first is None or block.interval.start < first:
                    next_start[block.task_id] = block.interval.start
        on_board = sorted(next_start, key=lambda task_id: (next_start[task_id], position[task_id]))
        rest = [
            task.id
            for task in self.tasks
            if task.id in self.remaining and task.id not in next_start
        ]
        return [self.todo[task_id] for task_id in [*on_board, *rest]]

    def _is_candidate(self, block: ExistingBlock) -> bool:
        return block_role(block, self.start) is BlockRole.CANDIDATE

    # Free time.

    def _pieces(self, task_id: UUID | None) -> list[Interval]:
        """The free pieces of the session, in time order, for task_id: its own candidate
        blocks are released if it is placed, so they do not take time."""
        free = [self.session]
        for taken in self.busy:
            free = subtract(free, taken)
        for block in self.board:
            if not is_live(block, self.start):
                continue
            if block.task_id == task_id and self._is_candidate(block):
                continue
            padded = _padded(block.interval)
            if overlaps(padded, self.session):
                free = subtract(free, padded)
        return sorted(free)

    # One task.

    def try_task(self, task: Task) -> None:
        exam = self.exams_by_id.get(task.exam_id)
        if exam is None:
            return
        cutoff = exam_cutoff(exam, self.profile)
        last_day = last_study_day(exam, self.profile)
        need = self.remaining[task.id]
        usable: list[Interval] = []
        for piece in self._pieces(task.id):
            if study_date(self.profile, piece.start) > last_day:
                break
            usable.extend(clip([piece], end=cutoff))
        for piece in usable:
            if piece.minutes >= need:
                block = Interval(piece.start, piece.start + need * _MINUTE)
                if self._may_take(task, block, whole=True):
                    self._place_whole(task, block)
                    return
        if task.kind is TaskKind.SIMULATION or need < 2 * MIN_PART_MINUTES:
            return
        for piece in usable:
            part = min(piece.minutes, need - MIN_PART_MINUTES)
            if part < MIN_PART_MINUTES:
                continue
            block = Interval(piece.start, piece.start + part * _MINUTE)
            if self._may_take(task, block, whole=False):
                self._place_part(task, block)  # the task is placed or skipped
                return

    def _live(self, task_id: UUID) -> list[ExistingBlock]:
        return [b for b in self.board if b.task_id == task_id and is_live(b, self.start)]

    def _is_simulation(self, task_id: UUID) -> bool:
        task = self.tasks_by_id.get(task_id)
        return task is not None and task.kind is TaskKind.SIMULATION

    def _may_take(self, task: Task, block: Interval, *, whole: bool) -> bool:
        """Whether the task's dependencies and the one-simulation-a-day rule allow the
        block. For a part, place_task checks the dependents with the remainder."""
        day = study_date(self.profile, block.start)
        prerequisite = self.todo.get(task.depends_on) if task.depends_on is not None else None
        if prerequisite is not None:
            required = self._live(prerequisite.id)
            minutes = sum(b.interval.minutes for b in required)
            if not is_complete(prerequisite, minutes, has_live_block=bool(required)):
                return False
            if any(b.interval.end > block.start for b in required):
                return False
            pair = TaskKind.SIMULATION in (task.kind, prerequisite.kind)
            if pair and any(study_date(self.profile, b.interval.start) >= day for b in required):
                return False
        if whole:
            for dependent in self.todo.values():
                if dependent.depends_on != task.id:
                    continue
                theirs = self._live(dependent.id)
                if not theirs:
                    continue
                first = min(b.interval.start for b in theirs)
                pair = TaskKind.SIMULATION in (task.kind, dependent.kind)
                if block.end > first or (pair and day >= study_date(self.profile, first)):
                    return False
        if task.kind is TaskKind.SIMULATION:
            for other in self.board:
                if (
                    other.task_id != task.id
                    and is_live(other, self.start)
                    and self._is_simulation(other.task_id)
                    and study_date(self.profile, other.interval.start) == day
                ):
                    return False
        return True

    def _released(self, task_id: UUID) -> list[ExistingBlock]:
        return [b for b in self.board if b.task_id == task_id and self._is_candidate(b)]

    def _place_whole(self, task: Task, block: Interval) -> None:
        session_block = self._made(task.id, block, pinned=True)
        released = self._released(task.id)
        released_ids = {b.id for b in released}
        self.board = [b for b in self.board if b.id not in released_ids]
        self.board.append(session_block)
        self._record(task, released, number_parts([task], self._live(task.id), []))

    def _place_part(self, task: Task, block: Interval) -> None:
        session_block = self._made(task.id, block, pinned=True)
        released = self._released(task.id)
        released_ids = {b.id for b in released}
        trial = [b for b in self.board if b.id not in released_ids]
        trial.append(session_block)
        result = place_task(
            self.profile,
            self.exams,
            self.tasks,
            trial,
            task.id,
            self.now,
            not_before=self.session.end,
        )
        if result.unscheduled:
            self.synthetic.discard(session_block.id)
            return
        trial.extend(
            self._made(task.id, b.interval, pinned=False)
            for b in result.blocks
            if b.block_id is None
        )
        self.board = trial
        self._record(task, released, result.blocks)

    def _made(self, task_id: UUID, interval: Interval, *, pinned: bool) -> ExistingBlock:
        block = new_block(task_id, interval, pinned=pinned)
        self.synthetic.add(block.id)
        return block

    def _record(
        self, task: Task, released: Sequence[ExistingBlock], blocks: Sequence[PlannedBlock]
    ) -> None:
        self.removed.extend(b.id for b in released)
        self.placed.append(task.id)
        for b in blocks:
            if b.block_id is not None and b.block_id in self.synthetic:
                b = PlannedBlock(
                    task_id=b.task_id,
                    interval=b.interval,
                    part_index=b.part_index,
                    part_count=b.part_count,
                    pinned=b.pinned,
                )
            self.blocks.append(b)

    # The result.

    def result(self) -> FreeTimeResult:
        failure: FreeTimeFailure | None = None
        if not self.placed:
            failure = (
                FreeTimeFailure.NOTHING_TO_PLACE
                if self._has_free_time()
                else FreeTimeFailure.NO_FREE_TIME
            )
        return FreeTimeResult(
            blocks=tuple(self.blocks),
            removed=tuple(sorted(self.removed, key=self.input_order.__getitem__)),
            placed=tuple(self.placed),
            session=self.session,
            failure=failure,
        )

    def _has_free_time(self) -> bool:
        """Whether a piece of MIN_PART_MINUTES, or of the shortest task in line, is free
        once busy time and the fixed blocks are taken out (candidates can move)."""
        shortest = min(self.remaining.values(), default=MIN_PART_MINUTES)
        threshold = min(MIN_PART_MINUTES, shortest)
        free = [self.session]
        for taken in self.busy:
            free = subtract(free, taken)
        for block in self.fixed:
            padded = _padded(block.interval)
            if overlaps(padded, self.session):
                free = subtract(free, padded)
        return any(piece.minutes >= threshold for piece in free)
