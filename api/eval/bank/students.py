"""Virtual students: a whole exam period lived day by day on the real planner.

A period starts with ``plan()`` at the board's clock. Then, every morning up to the last
exam, the student's behaviour decides which of yesterday's blocks were done, the exams of
the day are scored, the morning review moves each block that ended without a mark (as
``app.services.review`` does: mark it missed, then ``place_task`` with nothing released),
and ``replan`` runs after a failed move or once a week. Its headline number, the weighted
coverage on exam day, is what S47 and S48 are accepted or rejected on, so the domain is
driven the way the product drives it:

- A task becomes done as ``app.services.blocks.complete_block`` decides: no planned block
  still to come, and ``is_complete`` over the minutes of its done blocks. The product
  counts block minutes, so a block done at half pace still counts whole for the status;
  only the coverage counts the minutes actually studied.
- Every call gets what ``app.services.board.load_board`` would load: the exams dated today
  or later, their tasks, and those tasks' blocks (history blocks play no part in the
  planner either way).

The missed-day probe is the one-day version: the first plan, everything before a day
done, that day missed, and one ``replan`` the morning after.

Randomness is a ``random.Random(seed)`` per period, never shared, so a period's result
depends only on its board, behaviour and seed. Nothing here reads or prints a title, a
topic name or a course name.
"""

import datetime as dt
import random
import time
from collections import Counter, defaultdict
from collections.abc import Mapping
from dataclasses import dataclass, replace
from typing import Final, Literal
from uuid import UUID

from app.domain.planner import (
    BlockStatus,
    Exam,
    ExistingBlock,
    PlanResult,
    Profile,
    Task,
    TaskKind,
    TaskStatus,
    is_complete,
    place_task,
    plan,
    replan,
    start_minute,
    study_date,
    sunday_weekday,
)
from app.domain.time import local_date, local_span
from eval.bank.boards import Board, planner_tasks
from eval.bank.clock import stable_id
from eval.bank.metrics import exam_coverage, is_core, topic_of

# A slowed-down block is done at this share of its minutes.
PARTIAL_FRACTION: Final = 0.5
# The highest chance of missing a block, whatever the drift adds.
MAX_MISS: Final = 0.95
# Friday and Saturday, in sunday_weekday's numbering.
WEEKEND: Final = (5, 6)
# A replan runs when this many days passed since the last plan.
REPLAN_EVERY_DAYS: Final = 7
# The morning review holds the last seven study days, today included (services.review).
REVIEW_DAYS: Final = 7

_ONE_DAY: Final = dt.timedelta(days=1)


@dataclass(frozen=True, slots=True, kw_only=True)
class Behavior:
    id: str
    miss_rate: float  # the chance of missing a block on the first day
    slowdown: float  # the chance a done block was studied at PARTIAL_FRACTION
    weekend_skip: bool  # Friday and Saturday blocks are always missed
    late_start: int  # the first late_start days are always missed
    drift: float  # added to miss_rate linearly, up to the period's last day


BEHAVIORS: Final[tuple[Behavior, ...]] = (
    Behavior(id="ideal", miss_rate=0.0, slowdown=0.0, weekend_skip=False, late_start=0, drift=0.0),
    Behavior(
        id="typical", miss_rate=0.2, slowdown=0.1, weekend_skip=False, late_start=0, drift=0.0
    ),
    Behavior(
        id="struggling", miss_rate=0.3, slowdown=0.2, weekend_skip=False, late_start=0, drift=0.2
    ),
    Behavior(
        id="weekend_off", miss_rate=0.1, slowdown=0.0, weekend_skip=True, late_start=0, drift=0.0
    ),
    Behavior(id="late", miss_rate=0.1, slowdown=0.0, weekend_skip=False, late_start=3, drift=0.0),
    Behavior(
        id="fading", miss_rate=0.05, slowdown=0.0, weekend_skip=False, late_start=0, drift=0.4
    ),
)


@dataclass(frozen=True, slots=True, kw_only=True)
class PeriodResult:
    board_id: str
    behavior_id: str
    rep: int
    coverage: float | None  # mean over the board's exams
    coverage_learned: float | None  # mean over the board's exams
    coverage_by_exam: tuple[float | None, ...]  # in board.exams order
    replans: int
    churn: int
    churn_per_replan: float | None
    core_left_minutes: int
    core_reported_minutes: int
    review_moves: int
    review_failures: int
    seconds: float


@dataclass(frozen=True, slots=True, kw_only=True)
class ProbeResult:
    core_reported: int
    churn: int


@dataclass(slots=True, kw_only=True)
class _State:
    board: Board
    tasks: dict[UUID, Task]  # in planner_tasks order
    blocks: dict[UUID, ExistingBlock]
    actual: dict[UUID, int]  # done block -> the minutes actually studied
    last: PlanResult  # the last plan or replan
    counter: int = 0  # for new block ids, over the whole period


@dataclass(slots=True)
class _Exams:
    """Per exam, what its exam day recorded."""

    coverage: dict[UUID, float | None]
    learned: dict[UUID, float | None]
    core_reported: dict[UUID, int]
    core_left: dict[UUID, int]


def morning(profile: Profile, day: dt.date) -> dt.datetime:
    """The local wake_time of day plus study_start_delay: when the student's day starts.

    The delay is elapsed time, added on the UTC instant, as awake_span adds it.
    """
    wake, _ = local_span(day, profile.wake_time, profile.sleep_time, profile.timezone)
    return (wake.astimezone(dt.UTC) + profile.study_start_delay).astimezone(profile.timezone)


def first_study_day(profile: Profile, now: dt.datetime) -> dt.date:
    """Day 0 of a period: the first study day whose waking hours end after now.

    study_date(now) alone is not it when now falls in the sleep after a study day (a night
    owl at 08:30): that day is already over, and counting from it would start late_start
    and the weekly replans a day early on such a profile only.
    """
    day = study_date(profile, now)
    while local_span(day, profile.wake_time, profile.sleep_time, profile.timezone)[1] <= now:
        day += _ONE_DAY
    return day


def simulate_period(board: Board, behavior: Behavior, *, seed: str, rep: int = 0) -> PeriodResult:
    """One student with this behaviour living the board's period, from its clock to the
    last exam. rep is only recorded: the caller puts it in the seed."""
    result, _ = _run(board, behavior, seed=seed, rep=rep)
    return result


def missed_day_probe(
    board: Board, result: PlanResult, which: Literal["first", "mid"]
) -> ProbeResult | None:
    """The replan the morning after a missed day of result (the board's plan).

    The day is the first or the middle study day that holds a block of result. Every block
    before it is done, its blocks are missed, the later ones are planned; the tasks settle
    as the product settles them, and replan runs at the next morning. None when result has
    no block.
    """
    if which not in ("first", "mid"):
        raise ValueError("which must be first or mid")
    profile = board.profile
    days = sorted({study_date(profile, block.interval.start) for block in result.blocks})
    if not days:
        return None
    missed = days[0] if which == "first" else days[len(days) // 2]
    blocks: dict[UUID, ExistingBlock] = {}
    for k, block in enumerate(result.blocks):
        day = study_date(profile, block.interval.start)
        if day < missed:
            status = BlockStatus.DONE
        elif day == missed:
            status = BlockStatus.MISSED
        else:
            status = BlockStatus.PLANNED
        block_id = stable_id(board.id, "probe", which, k)
        blocks[block_id] = ExistingBlock(
            id=block_id,
            task_id=block.task_id,
            interval=block.interval,
            status=status,
            pinned=False,
        )
    now = morning(profile, missed + _ONE_DAY)
    tasks = _settled({task.id: task for task in planner_tasks(board)}, blocks, now)
    exams, live_tasks, live_blocks = _loaded(board, tasks, blocks, now)
    after = replan(profile, exams, live_tasks, live_blocks, now)
    return ProbeResult(core_reported=_core_minutes(tasks, after), churn=len(after.removed))


def _run(board: Board, behavior: Behavior, *, seed: str, rep: int) -> tuple[PeriodResult, _State]:
    """The period, and the board's state at its end (for the tests)."""
    started = time.perf_counter()
    rng = random.Random(seed)  # noqa: S311 - a seeded simulation, not cryptography
    profile = board.profile
    tasks = planner_tasks(board)
    first_plan = plan(profile, board.exams, tasks, (), board.now)
    state = _State(
        board=board,
        tasks={task.id: task for task in tasks},
        blocks={},
        actual={},
        last=first_plan,
    )
    _apply(state, first_plan, "p0")

    # Day 0 of every count below: late_start, the drift and the weekly replans.
    first = first_study_day(profile, board.now)
    if any(exam.exam_date <= first for exam in board.exams):
        raise ValueError(f"board {board.id}: an exam on or before the first study day")
    last_exam = max((exam.exam_date for exam in board.exams), default=first)
    n = (last_exam - first).days
    exams = _Exams(coverage={}, learned={}, core_reported={}, core_left={})
    replans = churn = review_moves = review_failures = 0
    last_plan = first

    for offset in range(1, n + 1):
        day = first + dt.timedelta(days=offset)
        now = morning(profile, day)
        index = offset - 1  # of yesterday, the day whose blocks are judged
        _yesterday(state, behavior, rng, day - _ONE_DAY, now, index, n)
        state.tasks = _settled(state.tasks, state.blocks, now)

        for exam in board.exams:
            if exam.exam_date == day:
                _record(state, exam, exams)

        changed = False
        for block in _review_blocks(state, now):
            state.blocks[block.id] = replace(block, status=BlockStatus.MISSED)
            loaded = _loaded(board, state.tasks, state.blocks, now)
            moved = place_task(profile, *loaded, block.task_id, now)
            if moved.unscheduled:
                review_failures += 1
                changed = True
            else:
                _apply(state, moved, f"r{day.isoformat()}")
                review_moves += 1

        if changed or (day - last_plan).days >= REPLAN_EVERY_DAYS:
            again = replan(profile, *_loaded(board, state.tasks, state.blocks, now), now)
            churn += len(again.removed)
            replans += 1
            _apply(state, again, f"w{day.isoformat()}")
            state.last = again
            last_plan = day

    by_exam = tuple(exams.coverage.get(exam.id) for exam in board.exams)
    learned = tuple(exams.learned.get(exam.id) for exam in board.exams)
    result = PeriodResult(
        board_id=board.id,
        behavior_id=behavior.id,
        rep=rep,
        coverage=_mean(by_exam),
        coverage_learned=_mean(learned),
        coverage_by_exam=by_exam,
        replans=replans,
        churn=churn,
        churn_per_replan=churn / replans if replans else None,
        core_left_minutes=sum(exams.core_left.values()),
        core_reported_minutes=sum(exams.core_reported.values()),
        review_moves=review_moves,
        review_failures=review_failures,
        seconds=time.perf_counter() - started,
    )
    return result, state


def _yesterday(
    state: _State,
    behavior: Behavior,
    rng: random.Random,
    yesterday: dt.date,
    now: dt.datetime,
    index: int,
    n: int,
) -> None:
    """Yesterday's planned blocks, done or missed by the behaviour, in (start, id) order.

    Two draws a block, always, so a change of one parameter does not shift the others'
    sequence. A missed block stays planned, for the morning review to find.
    """
    profile = state.board.profile
    end = start_minute(now)
    due = sorted(
        (
            block
            for block in state.blocks.values()
            if block.status is BlockStatus.PLANNED
            and block.interval.end <= end
            and study_date(profile, block.interval.start) == yesterday
        ),
        key=lambda block: (block.interval.start, block.id),
    )
    chance = min(MAX_MISS, behavior.miss_rate + behavior.drift * index / max(1, n - 1))
    off = index < behavior.late_start or (
        behavior.weekend_skip and sunday_weekday(yesterday) in WEEKEND
    )
    for block in due:
        miss_draw = rng.random()
        pace_draw = rng.random()
        if off or miss_draw < chance:
            continue
        state.blocks[block.id] = replace(block, status=BlockStatus.DONE)
        minutes = block.interval.minutes
        task = state.tasks[block.task_id]
        slowed = task.kind is not TaskKind.SIMULATION and pace_draw < behavior.slowdown
        state.actual[block.id] = round(PARTIAL_FRACTION * minutes) if slowed else minutes


def _review_blocks(state: _State, now: dt.datetime) -> list[ExistingBlock]:
    """The blocks of the morning review (services.review.review_blocks), by (start, id):
    planned and over, in the last REVIEW_DAYS study days, of a todo task of an exam dated
    today or later."""
    profile = state.board.profile
    today = study_date(profile, now)
    since = today - dt.timedelta(days=REVIEW_DAYS - 1)
    local_today = local_date(now, profile.timezone)
    exam_dates = {exam.id: exam.exam_date for exam in state.board.exams}
    end = start_minute(now)
    found: list[ExistingBlock] = []
    for block in state.blocks.values():
        if block.status is not BlockStatus.PLANNED or block.interval.end > end:
            continue
        if not since <= study_date(profile, block.interval.start) <= today:
            continue
        task = state.tasks[block.task_id]
        if task.status is TaskStatus.TODO and exam_dates[task.exam_id] >= local_today:
            found.append(block)
    return sorted(found, key=lambda block: (block.interval.start, block.id))


def _loaded(
    board: Board,
    tasks: Mapping[UUID, Task],
    blocks: Mapping[UUID, ExistingBlock],
    now: dt.datetime,
) -> tuple[tuple[Exam, ...], tuple[Task, ...], tuple[ExistingBlock, ...]]:
    """What load_board gives the planner at now: the exams dated today or later, their
    tasks, and those tasks' blocks."""
    today = local_date(now, board.profile.timezone)
    exams = tuple(exam for exam in board.exams if exam.exam_date >= today)
    live = {exam.id for exam in exams}
    loaded = tuple(task for task in tasks.values() if task.exam_id in live)
    ids = {task.id for task in loaded}
    return exams, loaded, tuple(block for block in blocks.values() if block.task_id in ids)


def _apply(state: _State, result: PlanResult, salt: str) -> None:
    """The result on the board: removed blocks leave, new blocks come in as planned.

    Blocks that stay are already on the board; history blocks are never removed.
    """
    for block_id in result.removed:
        del state.blocks[block_id]
    for block in result.blocks:
        if block.block_id is not None:
            if block.block_id not in state.blocks:
                raise RuntimeError(f"board {state.board.id}: a kept block is not on the board")
            continue
        block_id = stable_id(state.board.id, salt, state.counter)
        state.counter += 1
        state.blocks[block_id] = ExistingBlock(
            id=block_id,
            task_id=block.task_id,
            interval=block.interval,
            status=BlockStatus.PLANNED,
            pinned=block.pinned,
        )


def _settled(
    tasks: Mapping[UUID, Task], blocks: Mapping[UUID, ExistingBlock], now: dt.datetime
) -> dict[UUID, Task]:
    """The tasks after complete_block's rule: a todo task with a done block, no planned
    block that ends after now, and is_complete over its done blocks' minutes is done."""
    end = start_minute(now)
    done_minutes: dict[UUID, int] = defaultdict(int)
    has_done: set[UUID] = set()
    still_planned: set[UUID] = set()
    for block in blocks.values():
        if block.status is BlockStatus.DONE:
            done_minutes[block.task_id] += block.interval.minutes
            has_done.add(block.task_id)
        elif block.status is BlockStatus.PLANNED and block.interval.end > end:
            still_planned.add(block.task_id)
    settled: dict[UUID, Task] = {}
    for task_id, task in tasks.items():
        if (
            task.status is TaskStatus.TODO
            and task_id in has_done
            and task_id not in still_planned
            and is_complete(task, done_minutes[task_id], has_live_block=True)
        ):
            task = replace(task, status=TaskStatus.DONE)
        settled[task_id] = task
    return settled


def _record(state: _State, exam: Exam, exams: _Exams) -> None:
    """The exam's day: its coverage by the minutes actually studied, the share of its
    weight whose learning was all done, and its core minutes reported and left."""
    board = state.board
    actual: Counter[UUID] = Counter()
    for block_id, minutes in state.actual.items():
        actual[state.blocks[block_id].task_id] += minutes
    own = [task for task in planner_tasks(board) if task.exam_id == exam.id]
    exams.coverage[exam.id] = exam_coverage(board, exam.id, actual)

    # A topic is learned when each of its learn tasks (each of its core tasks when it has
    # none) got its estimate. Learned topics count whole, the others not at all, through
    # exam_coverage's own weights.
    by_topic: dict[UUID, list[Task]] = defaultdict(list)
    for task in own:
        ref = topic_of(board, task)
        if ref is not None and ref.exam_id == exam.id:
            by_topic[ref.id].append(task)
    learned: dict[UUID, int] = {}
    for topic_tasks in by_topic.values():
        learn = [task for task in topic_tasks if task.kind is TaskKind.LEARN]
        judged = learn or [task for task in topic_tasks if is_core(task)]
        if judged and all(actual[task.id] >= task.estimated_minutes for task in judged):
            learned.update((task.id, task.estimated_minutes) for task in topic_tasks)
    exams.learned[exam.id] = exam_coverage(board, exam.id, learned)

    exams.core_reported[exam.id] = sum(
        item.minutes
        for item in state.last.unscheduled
        if state.tasks[item.task_id].exam_id == exam.id and is_core(state.tasks[item.task_id])
    )
    exams.core_left[exam.id] = sum(
        max(0, task.estimated_minutes - actual[task.id]) for task in own if is_core(task)
    )


def _core_minutes(tasks: Mapping[UUID, Task], result: PlanResult) -> int:
    return sum(item.minutes for item in result.unscheduled if is_core(tasks[item.task_id]))


def _mean(values: tuple[float | None, ...]) -> float | None:
    present = [value for value in values if value is not None]
    return sum(present) / len(present) if present else None
