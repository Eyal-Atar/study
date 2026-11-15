"""Planner eval: the S06-S09 planner rules measured on the real analysis results. Numbers only.

Usage, from api/:
    uv run python eval/plan_eval.py [--seed N] [--boards N]

It reads the S11 analysis results in eval/results/*.json (git-ignored), keeps only the codes and
numbers of each task (key, kind, minutes, focus, depends_on), and builds boards from them: 1-3
exams 2-8 weeks after a fixed now in Asia/Jerusalem, three daily budgets (120, 240, 360) and
different study windows. Each exam's tasks are scaled to the minutes exam_budgets gives it, as
the analysis would be asked for. No network, no database, and no title or other text is printed.

What it measures, item by item (the thresholds are the ones of the S12 plan, task 9):
- runtime of plan() and replan() (three days later, past blocks done or missed), the
  daily_minutes sweep included;
- the rerun rule of assign_days, against an oracle that tries dropping each started multi-day
  task, one step ahead (so its gain is a lower bound); also
  on stress boards whose focused tasks stretch up to 600 minutes, since real ones (30-90) never
  span days;
- the 70-minute window reserve, against the same board with a reserve of 0, of 35, and one
  worked out per day from its items; a day that then does not pack is counted apart;
- reserved simulation days whose simulation did not go in, while a reported task could use them;
- five user tasks placed one after the other with place_task: days whose long break is gone,
  as it is (with the S12 padding of the long break) and before S12 (no extra padding).

The smaller reserves, the padding and the counters are patched in with unittest.mock, only in
this script. 100 boards take about 10 seconds, the default of 600 about a minute.
"""

import argparse
import datetime as dt
import importlib
import json
import math
import random
import statistics
import sys
import time
import uuid
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import Any
from unittest import mock
from zoneinfo import ZoneInfo

# Running a file puts its own folder on sys.path, not api/; add api/ so that `app` imports.
API_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_DIR))

from app.domain.planner import (  # noqa: E402
    BlockStatus,
    Exam,
    ExistingBlock,
    PlannedBlock,
    PlanResult,
    Profile,
    StudyWindow,
    Task,
    TaskKind,
    assign_days,
    exam_budgets,
    pack_day,
    place_task,
    plan,
    replan,
    resolve_dependencies,
    study_date,
)

# The package exports the functions under the module names, so reach the modules directly.
assign_module: Any = importlib.import_module("app.domain.planner.assign")
capacity_module: Any = importlib.import_module("app.domain.planner.capacity")
plan_module: Any = importlib.import_module("app.domain.planner.plan")
place_module: Any = importlib.import_module("app.domain.planner.place")

EVAL_DIR = Path(__file__).resolve().parent
RESULTS_DIR = EVAL_DIR / "results"
CASES_FILE = EVAL_DIR / "analysis_cases.json"

TZ = ZoneInfo("Asia/Jerusalem")
NOW = dt.datetime(2026, 11, 16, 8, 30, tzinfo=TZ)
NAMESPACE = uuid.UUID("6f1c3a52-7d1e-4c55-9a3b-2f0e8c1d4b77")
DAILY_BUDGETS = (120, 240, 360)
W = StudyWindow
WINDOW_SETS = (
    frozenset({W.MORNING, W.AFTERNOON, W.EVENING, W.NIGHT}),
    frozenset({W.AFTERNOON, W.EVENING}),
    frozenset({W.MORNING, W.EVENING}),
    frozenset({W.MORNING, W.NIGHT}),
    frozenset({W.AFTERNOON, W.NIGHT}),
    frozenset({W.EVENING, W.NIGHT}),
    frozenset({W.MORNING, W.AFTERNOON}),
)
WAKE_SLEEP = (
    (dt.time(7), dt.time(23, 30)),
    (dt.time(8), dt.time(0, 30)),
    (dt.time(6, 30), dt.time(23)),
)
# The most tasks one exam gets: the analysis writes at most about 150 tasks.
MAX_TASKS_PER_EXAM = 150
# How much one copy of a run's tasks may be stretched before the run is repeated.
MAX_STRETCH = 2.0
# The smaller reserves tried: a flat 0 or 35 (no packing proof), and "fit", the bound
# worked out per day from its items (see _fitted_slack).
SMALLER_RESERVES = ("0", "35", "fit")
USER_TASKS = 5
USER_MINUTES = (20, 30, 45, 60, 90)
LONG_BREAK = 30
MINUTE = dt.timedelta(minutes=1)


@dataclass(frozen=True, slots=True)
class RunTask:
    key: str
    kind: TaskKind
    minutes: int
    focus: int
    depends_on: str | None


@dataclass(frozen=True, slots=True)
class Run:
    budget: int  # the budget the analysis was asked for
    tasks: tuple[RunTask, ...]


@dataclass(slots=True)
class Board:
    profile: Profile
    exams: list[Exam]
    tasks: list[Task]
    # The same runs with focused tasks stretched up to 600 minutes, so that tasks span days.
    stress_tasks: list[Task]


@dataclass(slots=True)
class PlaceStats:
    calls: int = 0
    failed: int = 0
    days: int = 0  # days that got a new block
    broken: int = 0  # of those, the long break is missing
    had_blocks: int = 0  # of those, days that had planned blocks before
    had_blocks_broken: int = 0
    stretch: int = 0  # of those, a stretch of more than half the minutes
    seconds: list[float] = field(default_factory=list)


@dataclass(slots=True)
class Stats:
    boards: int = 0
    tasks: list[int] = field(default_factory=list)
    plan_seconds: list[float] = field(default_factory=list)
    replan_seconds: list[float] = field(default_factory=list)
    plan_assign_calls: list[int] = field(default_factory=list)
    replan_assign_calls: list[int] = field(default_factory=list)
    unscheduled_boards: int = 0
    unscheduled_minutes: int = 0
    reasons: dict[str, int] = field(default_factory=dict)  # reason code -> minutes
    # daily budget -> (unscheduled minutes, task minutes)
    by_daily: dict[int, list[int]] = field(default_factory=dict)
    planned_minutes: int = 0
    # rerun rule
    rerun_boards: int = 0
    reruns: int = 0
    replica_mismatch: int = 0
    oracle_better_boards: int = 0
    oracle_gain_minutes: int = 0
    # the same, on the stress boards: focused tasks stretched up to 600 minutes
    stress_rerun_boards: int = 0
    stress_reruns: int = 0
    stress_oracle_better_boards: int = 0
    stress_oracle_gain_minutes: int = 0
    # reserve: per smaller reserve
    reserve_gain_boards: dict[str, int] = field(default_factory=dict)
    reserve_gain_minutes: dict[str, int] = field(default_factory=dict)
    reserve_unpacked_boards: dict[str, int] = field(default_factory=dict)
    reserve_unpacked_days: dict[str, int] = field(default_factory=dict)
    # reserved simulation days
    reserved_days: int = 0
    reserved_missed: int = 0
    reserved_wasted: int = 0
    reserved_wasted_boards: int = 0
    reserved_later: int = 0  # missed days whose simulation went on a later day
    # place_task, as it is and before S12 (no extra padding around live blocks)
    place: PlaceStats = field(default_factory=PlaceStats)
    place_before: PlaceStats = field(default_factory=PlaceStats)
    baseline_days: int = 0
    baseline_broken: int = 0
    baseline_stretch: int = 0


def load_runs() -> list[Run]:
    """The valid analysis runs, codes and numbers only: titles and reasons are dropped here."""
    budgets = {
        case["id"]: int(case["budget_minutes"]) for case in json.loads(CASES_FILE.read_text())
    }
    runs: list[Run] = []
    for path in sorted(RESULTS_DIR.glob("*.json")):
        for result in json.loads(path.read_text())["results"]:
            if not result.get("ok") or not result.get("tasks"):
                continue
            runs.append(
                Run(
                    budget=budgets[result["case"]],
                    tasks=tuple(
                        RunTask(
                            key=str(task["key"]),
                            kind=TaskKind(task["kind"]),
                            minutes=int(task["minutes"]),
                            focus=int(task["focus"]),
                            depends_on=task["depends_on"],
                        )
                        for task in result["tasks"]
                    ),
                )
            )
    return runs


def _id(*parts: object) -> uuid.UUID:
    return uuid.uuid5(NAMESPACE, "/".join(str(part) for part in parts))


def _round5(minutes: float, low: int, high: int) -> int:
    return max(low, min(high, 5 * round(minutes / 5)))


def exam_tasks(
    board_no: int, exam: Exam, run: Run, budget: int, focused_max: int = 90
) -> list[Task]:
    """The run's tasks for this exam, fitted to the exam's budget as the analysis would be.

    The analysis keeps a focused task at 30-90 minutes and a simulation at the length of the
    exam, so only the focused tasks stretch (up to MAX_STRETCH); past that the run repeats,
    as a longer study period gets more tasks rather than longer ones. Dependencies stay inside
    each copy. Over the budget's upper bound (+10%), tasks nothing depends on are dropped from
    the end, practice first, as trim_to_budget does.
    """
    scale = budget / run.budget
    stretch = MAX_STRETCH if focused_max <= 90 else 600 / 90
    copies = max(1, math.ceil(scale / stretch))
    copies = min(copies, max(1, MAX_TASKS_PER_EXAM // len(run.tasks)))
    factor = scale / copies
    keys = {task.key for task in run.tasks}
    tasks: list[Task] = []
    for copy in range(copies):
        for task in run.tasks:
            depends = task.depends_on if task.depends_on in keys else None
            if task.kind is TaskKind.SIMULATION:
                minutes = _round5(task.minutes, 30, 300)
            else:
                minutes = _round5(task.minutes * factor, 30, focused_max)
            tasks.append(
                Task(
                    id=_id(board_no, exam.id, copy, task.key),
                    exam_id=exam.id,
                    kind=task.kind,
                    estimated_minutes=minutes,
                    focus=max(1, min(10, task.focus)),
                    depends_on=None if depends is None else _id(board_no, exam.id, copy, depends),
                )
            )
    high = -(-budget * 11 // 10)
    for droppable in ((TaskKind.PRACTICE,), (TaskKind.LEARN, TaskKind.REVIEW, TaskKind.CUSTOM)):
        while sum(task.estimated_minutes for task in tasks) > high:
            depended = {task.depends_on for task in tasks}
            last = next(
                (
                    index
                    for index in range(len(tasks) - 1, -1, -1)
                    if tasks[index].kind in droppable and tasks[index].id not in depended
                ),
                None,
            )
            if last is None:
                break
            del tasks[last]
    return tasks


def make_board(board_no: int, rng: random.Random, runs: Sequence[Run]) -> Board:
    wake, sleep = rng.choice(WAKE_SLEEP)
    profile = Profile(
        timezone=TZ,
        wake_time=wake,
        sleep_time=sleep,
        daily_study_minutes=DAILY_BUDGETS[board_no % len(DAILY_BUDGETS)],
        study_windows=rng.choice(WINDOW_SETS),
        rest_days_before_exam=rng.choice((0, 1, 2)),
    )
    exams = [
        Exam(
            id=_id(board_no, "exam", number),
            exam_date=NOW.date() + dt.timedelta(days=rng.randint(14, 56)),
            difficulty=rng.randint(1, 5),
        )
        for number in range(rng.choice((1, 2, 3)))
    ]
    budgets = exam_budgets(profile, exams, NOW)
    tasks: list[Task] = []
    stress: list[Task] = []
    for exam in exams:
        if budgets[exam.id] > 0:
            run = rng.choice(runs)
            tasks.extend(exam_tasks(board_no, exam, run, budgets[exam.id]))
            stress.extend(exam_tasks(board_no, exam, run, budgets[exam.id], focused_max=600))
    return Board(profile=profile, exams=exams, tasks=tasks, stress_tasks=stress)


@contextmanager
def counting(target: Any, name: str) -> Iterator[list[Any]]:
    """Wrap target.name so that every call's return value is recorded."""
    original = getattr(target, name)
    returns: list[Any] = []

    def wrapper(*args: Any, **kwargs: Any) -> Any:
        value = original(*args, **kwargs)
        returns.append(value)
        return value

    with mock.patch.object(target, name, wrapper):
        yield returns


def unscheduled_minutes(result: PlanResult) -> int:
    return sum(item.minutes for item in result.unscheduled)


# --- the rerun rule -------------------------------------------------------------------------


def _rerun_loop(
    context: Any,
    study: Any,
    limits: Any,
    excluded: frozenset[uuid.UUID],
    choose: Callable[[Any, Any, frozenset[uuid.UUID]], uuid.UUID],
) -> tuple[int, int]:
    """assign_days's rerun loop with a drop policy: (unscheduled minutes, reruns)."""
    reruns = 0
    while True:
        _, progress = assign_module._run_days(context, study, limits, excluded)
        if not progress.started:
            break
        excluded = excluded.union((choose(context, progress, excluded),))
        reruns += 1
    left = sum(task.estimated_minutes for task in context.todo if task.id not in progress.finished)
    return left, reruns


def _default_drop(context: Any, progress: Any, excluded: frozenset[uuid.UUID]) -> uuid.UUID:
    task: Task = min(progress.started.values(), key=lambda t: context.rank[t.exam_id])
    return task.id


def rerun_oracle(board: Board, tasks: Sequence[Task]) -> tuple[int, int, int]:
    """(minutes left with the rule, minutes left with the oracle, reruns) on a fresh board.

    At every drop the oracle tries each started task (only multi-day tasks can be started),
    finishes that run with the rule, and keeps the drop that leaves the fewest minutes (the
    rule's drop on a tie). It looks one step ahead, not at every order of drops, so what it
    gains is a lower bound on what a better drop rule could gain.
    """
    profile, exams = board.profile, board.exams
    study = assign_module.study_days(profile, exams, NOW, ())
    limits = assign_module._Limits(
        daily=profile.daily_study_minutes,
        used=MappingProxyType({}),
        simulation_days=frozenset(),
    )
    context = assign_module._prepare(
        profile, exams, tasks, assign_module._new_days(study, limits), {}
    )

    def oracle_drop(ctx: Any, progress: Any, excluded: frozenset[uuid.UUID]) -> uuid.UUID:
        best = _default_drop(ctx, progress, excluded)
        best_left = _rerun_loop(ctx, study, limits, excluded | {best}, _default_drop)[0]
        for candidate in progress.started:
            if candidate == best:
                continue
            left = _rerun_loop(ctx, study, limits, excluded | {candidate}, _default_drop)[0]
            if left < best_left:
                best, best_left = candidate, left
        return best

    rule_left, reruns = _rerun_loop(context, study, limits, frozenset(), _default_drop)
    if reruns == 0:
        return rule_left, rule_left, 0
    oracle_left, _ = _rerun_loop(context, study, limits, frozenset(), oracle_drop)
    return rule_left, oracle_left, reruns


# --- the reserved simulation days ------------------------------------------------------------


def reserved_day_waste(board: Board) -> tuple[int, int, int, int, int]:
    """(assign minutes left, reserved days, days whose simulation did not go in, of those
    the days where a reported task could take the free time, of those the days whose
    simulation went on a later day)."""
    with (
        counting(assign_module, "_prepare") as contexts,
        counting(assign_module, "_reserve_simulations") as reserves,
        counting(assign_module, "_run_days") as passes,
    ):
        assignment = assign_days(board.profile, board.exams, board.tasks, NOW)
    context, reserved = contexts[-1], reserves[-1]
    days, progress = passes[-1]
    reported = [task for task in context.todo if task.id not in progress.finished]
    missed = wasted = later = 0
    for simulation_id, index in reserved.items():
        day = days[index]
        if day.holds(simulation_id):
            continue
        missed += 1
        later += simulation_id in progress.finished
        for task in reported:
            if task.id in context.dependencies.in_cycle:
                continue
            if not (
                assign_module._is_eligible(day, context.last_day[task.exam_id])
                and assign_module._is_after(context, task, day)
                and assign_module._is_ready(context, progress, task, index)
            ):
                continue
            minutes = task.estimated_minutes
            if task.kind is TaskKind.SIMULATION:
                fits = day.fits_simulation(minutes)
            elif task.id in context.multi_day:
                fits = day.part(minutes) > 0
            else:
                fits = day.fits(minutes)
            if fits:
                wasted += 1
                break
    left = sum(item.minutes for item in assignment.unscheduled)
    return left, len(reserved), missed, wasted, later


# --- the window reserve ----------------------------------------------------------------------


def _fitted_slack(remaining: Sequence[int], minutes: Sequence[int], blocks: int) -> int:
    """capacity._slack with a window reserve worked out from the day's items.

    Packing leaves unused at a window's end at most: the free time an item shorter than an
    hour cannot use (its minutes less one) plus its break, or for a longer item less than
    MIN_PART_MINUTES of free time plus the break. So the reserve is BREAK + max(29, the
    longest item under an hour less one), and 2 minutes of margin as the flat 70 has. room()
    passes the new item as 0, its length not known yet: then the flat reserve stays.
    """
    break_minutes = capacity_module.BREAK_MINUTES
    min_part = capacity_module.MIN_PART_MINUTES
    if 0 in minutes:
        reserve = capacity_module.WINDOW_EDGE_RESERVE_MINUTES
    else:
        short = [m for m in minutes if m < 2 * min_part]
        reserve = break_minutes + max(min_part - 1, max(short, default=0) - 1) + 2
    long_break = capacity_module.LONG_BREAK_MINUTES - break_minutes if blocks >= 2 else 0
    return (
        sum(remaining)
        - sum(minutes)
        - break_minutes * (len(minutes) - 1)
        - long_break
        - reserve * (len(remaining) - 1)
    )


def reserve_trial(board: Board, reserve: str) -> tuple[int, int]:
    """(assign minutes left, days that do not pack) with a smaller window reserve."""
    if reserve == "fit":
        patch = mock.patch.object(capacity_module, "_slack", _fitted_slack)
    else:
        patch = mock.patch.object(capacity_module, "WINDOW_EDGE_RESERVE_MINUTES", int(reserve))
    with patch:
        assignment = assign_days(board.profile, board.exams, board.tasks, NOW)
    tasks_by_id = {task.id: task for task in board.tasks}
    prerequisite = resolve_dependencies(board.tasks).prerequisite
    unpacked = 0
    for day_plan in assignment.days:
        if not day_plan.items:
            continue
        try:
            pack_day(day_plan.day, day_plan.items, tasks_by_id, prerequisite)
        except RuntimeError:
            unpacked += 1
    return sum(item.minutes for item in assignment.unscheduled), unpacked


# --- place_task in a row ---------------------------------------------------------------------


def _existing(blocks: Sequence[PlannedBlock], salt: object) -> list[ExistingBlock]:
    return [
        ExistingBlock(
            id=block.block_id or _id("block", salt, block.task_id, block.interval.start),
            task_id=block.task_id,
            interval=block.interval,
            status=BlockStatus.PLANNED,
            pinned=False,
        )
        for block in blocks
    ]


def long_break_missing(intervals: Sequence[Any]) -> bool:
    """Whether the block in which half of the day's minutes pass is followed, in the
    same run of blocks, by a gap shorter than the long break."""
    ordered = sorted(intervals, key=lambda interval: interval.start)
    total = sum(interval.minutes for interval in ordered)
    before = 0
    for position, interval in enumerate(ordered):
        after = before + interval.minutes
        if before * 2 < total <= after * 2:
            if position + 1 == len(ordered):
                return False
            gap = (ordered[position + 1].start - interval.end) // dt.timedelta(minutes=1)
            return gap < LONG_BREAK
        before = after
    return False


def long_stretch(intervals: Sequence[Any]) -> bool:
    """Whether a day of two blocks or more has a stretch of more than half of its minutes:
    blocks with no gap of the long break or more between them."""
    ordered = sorted(intervals, key=lambda interval: interval.start)
    total = sum(interval.minutes for interval in ordered)
    stretch = 0
    for position, interval in enumerate(ordered):
        if position and (interval.start - ordered[position - 1].end) // MINUTE >= LONG_BREAK:
            stretch = 0
        stretch += interval.minutes
        if len(ordered) > 1 and stretch * 2 > total:
            return True
    return False


def _by_day(profile: Profile, blocks: Sequence[ExistingBlock]) -> dict[dt.date, list[Any]]:
    days: dict[dt.date, list[Any]] = {}
    for block in blocks:
        days.setdefault(study_date(profile, block.interval.start), []).append(block.interval)
    return days


def _place_sequence(
    board: Board,
    blocks: list[ExistingBlock],
    start: dt.datetime,
    user_tasks: Sequence[Task],
    out: PlaceStats,
    salt: object,
) -> None:
    profile = board.profile
    before = _by_day(profile, blocks)
    tasks = list(board.tasks)
    new_days: set[dt.date] = set()
    for number, task in enumerate(user_tasks):
        tasks.append(task)
        began = time.perf_counter()
        placed = place_task(profile, board.exams, tasks, blocks, task.id, start)
        out.seconds.append(time.perf_counter() - began)
        out.calls += 1
        if placed.unscheduled:
            out.failed += 1
            continue
        fresh = [block for block in placed.blocks if block.block_id is None]
        blocks.extend(_existing(fresh, (salt, number)))
        new_days.update(study_date(profile, block.interval.start) for block in fresh)
    after = _by_day(profile, blocks)
    for day in new_days:
        broken = long_break_missing(after[day])
        out.days += 1
        out.broken += broken
        out.stretch += long_stretch(after[day])
        if day in before:
            out.had_blocks += 1
            out.had_blocks_broken += broken


def place_in_a_row(
    board: Board, result: PlanResult, rng: random.Random, stats: Stats, board_no: int
) -> None:
    """Five user tasks placed one after the other from the start of a real planned day.

    The same sequence runs again as place_task was before S12: _LONG_BREAK_EXTRA patched to 0,
    so live blocks keep only the 10-minute break around them.
    """
    profile = board.profile
    blocks = _existing(result.blocks, board_no)
    days = _by_day(profile, blocks)
    for intervals in days.values():
        stats.baseline_days += 1
        stats.baseline_broken += long_break_missing(intervals)
        stats.baseline_stretch += long_stretch(intervals)
    busy_days = sorted(day for day, intervals in days.items() if len(intervals) >= 2)
    if not busy_days:
        return
    chosen = rng.choice(busy_days[: max(1, len(busy_days) // 2)])
    start = min(interval.start for interval in days[chosen])
    exam = max(board.exams, key=lambda e: e.exam_date)
    user_tasks = [
        Task(
            id=_id(board_no, "user", number),
            exam_id=exam.id,
            kind=TaskKind.CUSTOM,
            estimated_minutes=rng.choice(USER_MINUTES),
            focus=rng.randint(1, 10),
        )
        for number in range(USER_TASKS)
    ]
    _place_sequence(board, list(blocks), start, user_tasks, stats.place, board_no)
    with mock.patch.object(place_module, "_LONG_BREAK_EXTRA", dt.timedelta(0)):
        _place_sequence(board, list(blocks), start, user_tasks, stats.place_before, board_no)


# --- one board -------------------------------------------------------------------------------


def replan_board(board: Board, result: PlanResult, rng: random.Random, board_no: int) -> Any:
    """Three days later: the blocks that ended are done (70%) or missed (30%)."""
    later = NOW + dt.timedelta(days=3)
    blocks: list[ExistingBlock] = []
    for block in _existing(result.blocks, board_no):
        if block.interval.end <= later:
            status = BlockStatus.DONE if rng.random() < 0.7 else BlockStatus.MISSED
            block = ExistingBlock(
                id=block.id,
                task_id=block.task_id,
                interval=block.interval,
                status=status,
                pinned=False,
            )
        blocks.append(block)
    return blocks, later


def measure(board_no: int, board: Board, rng: random.Random, stats: Stats) -> None:
    stats.boards += 1
    stats.tasks.append(len(board.tasks))
    profile, exams, tasks = board.profile, board.exams, board.tasks

    with counting(plan_module, "assign_days") as calls:
        began = time.perf_counter()
        result = plan(profile, exams, tasks, (), NOW)
        stats.plan_seconds.append(time.perf_counter() - began)
    stats.plan_assign_calls.append(len(calls))
    left = unscheduled_minutes(result)
    stats.unscheduled_minutes += left
    stats.unscheduled_boards += left > 0
    daily = stats.by_daily.setdefault(profile.daily_study_minutes, [0, 0])
    daily[0] += left
    daily[1] += sum(task.estimated_minutes for task in tasks)
    for item in result.unscheduled:
        stats.reasons[item.reason.value] = stats.reasons.get(item.reason.value, 0) + item.minutes
    stats.planned_minutes += sum(task.estimated_minutes for task in tasks)

    blocks, later = replan_board(board, result, rng, board_no)
    with counting(plan_module, "assign_days") as calls:
        began = time.perf_counter()
        replan(profile, exams, tasks, blocks, later)
        stats.replan_seconds.append(time.perf_counter() - began)
    stats.replan_assign_calls.append(len(calls))

    rule_left, oracle_left, reruns = rerun_oracle(board, board.tasks)
    stress_left, stress_oracle_left, stress_reruns = rerun_oracle(board, board.stress_tasks)
    stats.stress_reruns += stress_reruns
    stats.stress_rerun_boards += stress_reruns > 0
    if stress_oracle_left < stress_left:
        stats.stress_oracle_better_boards += 1
        stats.stress_oracle_gain_minutes += stress_left - stress_oracle_left
    assign_left, reserved, missed, wasted, later = reserved_day_waste(board)
    stats.reserved_later += later
    stats.replica_mismatch += rule_left != assign_left
    stats.reruns += reruns
    stats.rerun_boards += reruns > 0
    if oracle_left < rule_left:
        stats.oracle_better_boards += 1
        stats.oracle_gain_minutes += rule_left - oracle_left

    stats.reserved_days += reserved
    stats.reserved_missed += missed
    stats.reserved_wasted += wasted
    stats.reserved_wasted_boards += wasted > 0

    for reserve in SMALLER_RESERVES:
        smaller_left, unpacked = reserve_trial(board, reserve)
        if smaller_left < assign_left:
            if unpacked:
                stats.reserve_unpacked_boards[reserve] = (
                    stats.reserve_unpacked_boards.get(reserve, 0) + 1
                )
            else:
                stats.reserve_gain_boards[reserve] = stats.reserve_gain_boards.get(reserve, 0) + 1
                stats.reserve_gain_minutes[reserve] = (
                    stats.reserve_gain_minutes.get(reserve, 0) + assign_left - smaller_left
                )
        stats.reserve_unpacked_days[reserve] = (
            stats.reserve_unpacked_days.get(reserve, 0) + unpacked
        )

    place_in_a_row(board, result, rng, stats, board_no)


# --- the report ------------------------------------------------------------------------------


def _p95(values: Sequence[float]) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, math.ceil(0.95 * len(ordered)) - 1)]


def _pct(part: int, whole: int) -> float:
    return 100.0 * part / whole if whole else 0.0


# The fewest cases a verdict stands on: below it the line says "no evidence".
MIN_EVIDENCE = 30


def _verdict(passes: bool, evidence: int | None = None) -> str:
    """The verdict, or "no evidence (n=...)" when it stands on fewer than MIN_EVIDENCE cases."""
    if evidence is not None and evidence < MIN_EVIDENCE:
        return f"no evidence (n={evidence})"
    return "passes threshold" if passes else "does not pass threshold"


def _share(part: int, whole: int) -> str:
    return f"{part} ({_pct(part, whole):.1f}%)"


def _timing(values: Sequence[float]) -> str:
    return f"{statistics.median(values):.3f} / {_p95(values):.3f} / {max(values):.3f}"


def _place_rows(name: str, place: PlaceStats) -> list[tuple[str, str]]:
    return [
        (f"{name}: calls / failed", f"{place.calls} / {place.failed}"),
        (f"{name}: days with new blocks", f"{place.days}"),
        (f"{name}: long break missing", _share(place.broken, place.days)),
        (
            f"{name}: days that had blocks / long break missing",
            f"{place.had_blocks} / {place.had_blocks_broken}",
        ),
        (f"{name}: stretch over half the minutes", _share(place.stretch, place.days)),
    ]


def report(stats: Stats, seconds: float) -> None:
    n = stats.boards
    rows = [
        ("boards", f"{n}"),
        (
            "tasks per board (median / max)",
            f"{statistics.median(stats.tasks):.0f} / {max(stats.tasks)}",
        ),
        ("boards with unscheduled minutes", _share(stats.unscheduled_boards, n)),
        (
            "unscheduled minutes / task minutes",
            f"{stats.unscheduled_minutes} / {stats.planned_minutes} "
            f"({_pct(stats.unscheduled_minutes, stats.planned_minutes):.2f}%)",
        ),
        *(
            (f"unscheduled minutes: {reason}", f"{minutes}")
            for reason, minutes in sorted(stats.reasons.items())
        ),
        *(
            (
                f"unscheduled share at {daily} minutes a day",
                f"{_pct(minutes[0], minutes[1]):.2f}%",
            )
            for daily, minutes in sorted(stats.by_daily.items())
        ),
        ("plan() seconds (median / p95 / max)", _timing(stats.plan_seconds)),
        (
            "plan() assign_days runs (median / max)",
            f"{statistics.median(stats.plan_assign_calls):.0f} / {max(stats.plan_assign_calls)}",
        ),
        ("replan() seconds (median / p95 / max)", _timing(stats.replan_seconds)),
        (
            "replan() assign_days runs (median / max)",
            f"{statistics.median(stats.replan_assign_calls):.0f} / "
            f"{max(stats.replan_assign_calls)}",
        ),
        ("place_task() seconds (median / p95 / max)", _timing(stats.place.seconds)),
        ("rerun: boards with a rerun", _share(stats.rerun_boards, n)),
        ("rerun: reruns in all", f"{stats.reruns}"),
        ("rerun: replica differs from assign_days", f"{stats.replica_mismatch}"),
        ("rerun: oracle places more (boards)", _share(stats.oracle_better_boards, n)),
        ("rerun: oracle places more (minutes)", f"{stats.oracle_gain_minutes}"),
        ("rerun stress: boards with a rerun", _share(stats.stress_rerun_boards, n)),
        ("rerun stress: reruns in all", f"{stats.stress_reruns}"),
        (
            "rerun stress: oracle places more (boards)",
            _share(stats.stress_oracle_better_boards, n),
        ),
        ("rerun stress: oracle places more (minutes)", f"{stats.stress_oracle_gain_minutes}"),
    ]
    for reserve in SMALLER_RESERVES:
        rows += [
            (
                f"reserve {reserve}: places more and packs (boards)",
                _share(stats.reserve_gain_boards.get(reserve, 0), n),
            ),
            (
                f"reserve {reserve}: places more and packs (minutes)",
                f"{stats.reserve_gain_minutes.get(reserve, 0)}",
            ),
            (
                f"reserve {reserve}: places more, a day does not pack (boards)",
                f"{stats.reserve_unpacked_boards.get(reserve, 0)}",
            ),
            (
                f"reserve {reserve}: days that do not pack",
                f"{stats.reserve_unpacked_days.get(reserve, 0)}",
            ),
        ]
    rows += [
        ("simulation: reserved days", f"{stats.reserved_days}"),
        ("simulation: reserved days without their simulation", f"{stats.reserved_missed}"),
        ("simulation: of those, placed on a later day", f"{stats.reserved_later}"),
        ("simulation: of those, a reported task could use", f"{stats.reserved_wasted}"),
        ("simulation: boards with such a day", _share(stats.reserved_wasted_boards, n)),
        *_place_rows("place_task", stats.place),
        *_place_rows("place_task before S12 (no extra pad)", stats.place_before),
        ("plan(): days with blocks", f"{stats.baseline_days}"),
        ("plan(): long break missing", f"{stats.baseline_broken}"),
        (
            "plan(): stretch over half the minutes",
            _share(stats.baseline_stretch, stats.baseline_days),
        ),
        ("script seconds", f"{seconds:.1f}"),
    ]
    width = max(len(label) for label, _ in rows)
    for label, value in rows:
        print(f"{label:<{width}}  {value}")
    print()

    plan_p95, plan_max = _p95(stats.plan_seconds), max(stats.plan_seconds)
    replan_p95, replan_max = _p95(stats.replan_seconds), max(stats.replan_seconds)
    timing = plan_p95 <= 2 and plan_max <= 10 and replan_p95 <= 2 and replan_max <= 10
    print(
        f"runtime: {_verdict(timing)} (plan p95 {plan_p95:.3f}s max {plan_max:.3f}s, "
        f"replan p95 {replan_p95:.3f}s max {replan_max:.3f}s; limits p95 2s, max 10s)"
    )
    for name, better, gain, reruns in (
        ("rerun rule", stats.oracle_better_boards, stats.oracle_gain_minutes, stats.reruns),
        (
            "rerun rule, stress",
            stats.stress_oracle_better_boards,
            stats.stress_oracle_gain_minutes,
            stats.stress_reruns,
        ),
    ):
        print(
            f"{name}: {_verdict(_pct(better, n) <= 1, reruns)} ({reruns} reruns; the oracle, "
            f"one step over the started multi-day tasks, so a lower bound, places more on "
            f"{better}/{n} boards = {_pct(better, n):.1f}%, {gain} minutes; limit 1%)"
        )
    for reserve in SMALLER_RESERVES:
        gain = stats.reserve_gain_boards.get(reserve, 0)
        print(
            f"reserve 70 vs {reserve}: {_verdict(_pct(gain, n) <= 5)} (the smaller reserve "
            f"places more and packs on {gain}/{n} boards = {_pct(gain, n):.1f}%, "
            f"{stats.reserve_gain_minutes.get(reserve, 0)} minutes; "
            f"{stats.reserve_unpacked_days.get(reserve, 0)} days do not pack; limit 5%)"
        )
    wasted = _pct(stats.reserved_wasted_boards, n)
    print(
        f"simulation day: {_verdict(wasted <= 5, stats.reserved_missed)} "
        f"({stats.reserved_missed} reserved days without their simulation; "
        f"{stats.reserved_wasted} of them usable by a reported task, on "
        f"{stats.reserved_wasted_boards}/{n} boards = {wasted:.1f}%; limit 5%)"
    )
    for name, place in (
        ("place_task in a row", stats.place),
        ("place_task before S12 (no extra pad)", stats.place_before),
    ):
        broken = _pct(place.broken, place.days)
        print(
            f"{name}: {_verdict(broken <= 50, place.days)} ({place.broken}/{place.days} days = "
            f"{broken:.1f}% without the long break; limit 50%)"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--boards", type=int, default=600)
    args = parser.parse_args()
    runs = load_runs()
    if not runs:
        print(f"no valid runs in {RESULTS_DIR}", file=sys.stderr)
        return 1
    rng = random.Random(args.seed)  # noqa: S311
    stats = Stats()
    began = time.perf_counter()
    for board_no in range(args.boards):
        board = make_board(board_no, rng, runs)
        if board.tasks:
            measure(board_no, board, rng, stats)
    report(stats, time.perf_counter() - began)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
