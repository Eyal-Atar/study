"""Schedule metrics: one PlanResult of a board turned into a dict of numbers.

These are the baseline numbers the next planner (S47) is judged against, so every
definition here follows the S46a plan (Task 4) and the metric table of its Global
Constraints exactly. Two rules keep them valid once the domain Task changes in S47:

- A task's topic comes only from ``topic_of``: the eval map of the board first, then
  ``task.topic_id`` when the domain has it.
- Whether a task is core comes only from ``is_core``: ``task.optional`` when the domain
  has it, otherwise every task is core.

Days are study days: a block belongs to ``study_date(profile, block.interval.start)``,
and a block's minutes are ``block.interval.minutes``. Shares that use a ceiling
(``ceil(0.1 n)``, ``ceil(0.2 n)``) are computed on integers, never on floats.

Nothing here reads a title or a topic name, and no error message holds one.
"""

import datetime as dt
import statistics
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from itertools import pairwise
from typing import Final
from uuid import UUID

from app.domain.planner import (
    PlannedBlock,
    PlanResult,
    Task,
    TaskKind,
    last_study_day,
    study_date,
    study_days,
)
from eval.bank.boards import Board, TopicRef, planner_tasks

Value = float | int | None

# By TaskKind value, so a kind the domain adds later (S49's read) counts by its name.
NEW_KINDS: Final = frozenset({"learn", "review", "read"})
# A study day counts as active from this capacity up (the planner's shortest part).
MIN_ACTIVE_MINUTES: Final = 30
# The block-length gap of the adhd profile, measured at two lengths.
GAP_BLOCK_MINUTES: Final = (25, 45)
MAX_BLOCK_GAP: Final = "max_block_minutes"
EXTRA_TIME_GAP: Final = "exam_extra_time_percent"

# The keys schedule_metrics returns, in the order of the metric table.
SCHEDULE_METRIC_IDS: Final = (
    "unscheduled_minutes",
    "unscheduled_core_minutes",
    "active_days",
    "empty_days",
    "empty_day_share",
    "longest_empty_run",
    "day_util_mean",
    "day_util_p10",
    "days_util_ge90_share",
    "last20_core_share",
    "between_util",
    "between_next_share",
    "topics_met_twice_share",
    "topic_gap_median_days",
    "max_new_minutes_day",
    "new_over60_day_share",
    "planned_coverage",
    "dropped_weight_mean",
    "all_weight_mean",
    "uncovered_by_list_share",
    "gap_blocks_over_25_share",
    "gap_blocks_over_45_share",
    "gap_sims_short_share",
)

_Placed = Sequence[tuple[Task, PlannedBlock]]


def topic_of(board: Board, task: Task) -> TopicRef | None:
    """The eval map first, then task.topic_id when the domain has it (S47).

    An id that is not one of the board's topics is no topic.
    """
    topic_id = board.task_topic.get(task.id)
    if topic_id is None:
        topic_id = getattr(task, "topic_id", None)
    if topic_id is None:
        return None
    return board.topics.get(topic_id)


def is_core(task: Task) -> bool:
    """Not optional; Task.optional arrives in S47 (getattr with default False)."""
    return not bool(getattr(task, "optional", False))


def day_capacity(board: Board) -> dict[dt.date, int]:
    """min(daily_study_minutes, Σ windows) per study day of study_days(profile, exams, now),
    only days with capacity >= 30 and on or before the latest last_study_day."""
    profile = board.profile
    if not board.exams:
        return {}
    last = max(last_study_day(exam, profile) for exam in board.exams)
    capacity: dict[dt.date, int] = {}
    for day in study_days(profile, board.exams, board.now):
        minutes = min(profile.daily_study_minutes, sum(w.minutes for w in day.windows))
        if minutes >= MIN_ACTIVE_MINUTES and day.date <= last:
            capacity[day.date] = minutes
    return capacity


def exam_coverage(board: Board, exam_id: UUID, minutes_by_task: Mapping[UUID, int]) -> float | None:
    """The weighted coverage of one exam's topics by these minutes.

    target_t is the estimate of the exam's core tasks of topic t; only topics with a
    target count. Each counts with its weight, up to its target: Σ (w_t / W) x
    min(1, m_t / target_t), where m_t holds the minutes of every task of topic t, core or
    optional. None when no topic counts (W == 0), as for an exam with no tasks.
    """
    target: dict[UUID, int] = defaultdict(int)
    got: dict[UUID, int] = defaultdict(int)
    refs: dict[UUID, TopicRef] = {}
    for task in planner_tasks(board):
        ref = topic_of(board, task)
        if ref is None or ref.exam_id != exam_id:
            continue
        refs[ref.id] = ref
        if is_core(task):
            target[ref.id] += task.estimated_minutes
        got[ref.id] += minutes_by_task.get(task.id, 0)
    counted = [ref for topic_id, ref in refs.items() if target[topic_id] > 0]
    total = sum(ref.weight for ref in counted)
    if total == 0:
        return None
    return sum(ref.weight / total * min(1.0, got[ref.id] / target[ref.id]) for ref in counted)


def planned_coverage(board: Board, minutes_by_task: Mapping[UUID, int]) -> float | None:
    """The mean of exam_coverage over the exams where it is not None (None when none)."""
    return _mean(exam_coverage(board, exam.id, minutes_by_task) for exam in board.exams)


def schedule_metrics(board: Board, result: PlanResult) -> dict[str, Value]:
    """Every schedule metric of the table (SCHEDULE_METRIC_IDS), for one plan of the board."""
    tasks = {task.id: task for task in planner_tasks(board)}
    blocks = [(_task(tasks, block.task_id), block) for block in result.blocks]
    left_out = [(_task(tasks, item.task_id), item.minutes) for item in result.unscheduled]
    capacity = day_capacity(board)
    planned: dict[dt.date, int] = defaultdict(int)
    scheduled: dict[UUID, int] = defaultdict(int)
    for task, block in blocks:
        planned[_day(board, block)] += block.interval.minutes
        scheduled[task.id] += block.interval.minutes

    unscheduled = sum(minutes for _, minutes in left_out)
    metrics: dict[str, Value] = {
        "unscheduled_minutes": unscheduled,
        "unscheduled_core_minutes": sum(minutes for task, minutes in left_out if is_core(task)),
    }
    metrics.update(_day_metrics(capacity, planned, unscheduled))
    metrics["last20_core_share"] = _last20_core_share(board, blocks)
    metrics.update(_between_metrics(board, blocks, capacity, planned))
    metrics.update(_topic_meetings(board, blocks))
    metrics.update(_new_material(board, blocks, planned))
    metrics["planned_coverage"] = planned_coverage(board, scheduled)
    metrics["dropped_weight_mean"] = _weight_mean(
        (topic_of(board, task), minutes) for task, minutes in left_out
    )
    metrics["all_weight_mean"] = _weight_mean(
        (topic_of(board, task), task.estimated_minutes) for task in tasks.values()
    )
    metrics["uncovered_by_list_share"] = _uncovered_by_list_share(board)
    metrics.update(_gap_metrics(board, blocks))
    if tuple(metrics) != SCHEDULE_METRIC_IDS:
        raise RuntimeError("schedule metric keys out of step with the table")
    return metrics


def _task(tasks: Mapping[UUID, Task], task_id: UUID) -> Task:
    task = tasks.get(task_id)
    if task is None:
        raise ValueError(f"task {task_id} is not on the board")
    return task


def _day(board: Board, block: PlannedBlock) -> dt.date:
    return study_date(board.profile, block.interval.start)


def _mean(values: Iterable[float | None]) -> float | None:
    present = [value for value in values if value is not None]
    return sum(present) / len(present) if present else None


def _share(part: int, whole: int) -> float | None:
    return part / whole if whole else None


def _day_metrics(
    capacity: Mapping[dt.date, int], planned: Mapping[dt.date, int], unscheduled: int
) -> dict[str, Value]:
    """Active days, empty days, the longest empty run and the daily utilisation."""
    days = sorted(capacity)
    empty = [day for day in days if planned.get(day, 0) == 0]

    # Inactive days are not in days, so they neither break nor extend a run. A run counts
    # when a block comes on a later day, or when the plan left work out.
    longest = 0
    run = 0
    for day in days:
        if planned.get(day, 0) == 0:
            run += 1
        else:
            longest = max(longest, run)
            run = 0
    if run and (unscheduled > 0 or any(m > 0 and d > days[-1] for d, m in planned.items())):
        longest = max(longest, run)

    utils = sorted(min(1.0, planned.get(day, 0) / capacity[day]) for day in days)
    count = len(utils)
    return {
        "active_days": count,
        "empty_days": len(empty),
        "empty_day_share": _share(len(empty), count),
        "longest_empty_run": longest,
        "day_util_mean": sum(utils) / count if count else None,
        # The value at ceil(0.1 n) - 1 after sorting.
        "day_util_p10": utils[(count + 9) // 10 - 1] if count else None,
        "days_util_ge90_share": _share(sum(1 for u in utils if u >= 0.9), count),
    }


def _last20_core_share(board: Board, blocks: _Placed) -> float | None:
    """Per exam with core minutes placed, the share of them in the last 20% of its window;
    the mean over those exams.

    The window holds the dates from study_date(now) to the exam's last study day, every
    calendar date counted; the tail is its last ceil(0.2 x len) dates.
    """
    profile = board.profile
    start = study_date(profile, board.now)
    shares: list[float | None] = []
    for exam in board.exams:
        core = [
            (_day(board, block), block.interval.minutes)
            for task, block in blocks
            if task.exam_id == exam.id and is_core(task)
        ]
        total = sum(minutes for _, minutes in core)
        if total == 0:
            continue
        end = last_study_day(exam, profile)
        length = max(0, (end - start).days + 1)
        tail_start = end - dt.timedelta(days=(length + 4) // 5 - 1)
        in_tail = sum(minutes for day, minutes in core if tail_start <= day <= end)
        shares.append(in_tail / total)
    return _mean(shares)


def _between_metrics(
    board: Board,
    blocks: _Placed,
    capacity: Mapping[dt.date, int],
    planned: Mapping[dt.date, int],
) -> dict[str, Value]:
    """For consecutive exams (A, B) with study days for B after A's exam: how full those
    days are, and how much of them goes to B. Means over the pairs; a pair whose
    denominator is 0 is left out of that mean."""
    profile = board.profile
    ordered = sorted(board.exams, key=lambda exam: exam.exam_date)
    utils: list[float | None] = []
    nexts: list[float | None] = []
    for first, second in pairwise(ordered):
        last = last_study_day(second, profile)
        if last <= first.exam_date:
            continue
        span = {day for day in capacity if first.exam_date < day <= last}
        span_planned = sum(planned.get(day, 0) for day in span)
        span_capacity = sum(capacity[day] for day in span)
        to_second = sum(
            block.interval.minutes
            for task, block in blocks
            if task.exam_id == second.id and _day(board, block) in span
        )
        utils.append(_share(span_planned, span_capacity))
        nexts.append(_share(to_second, span_planned))
    return {"between_util": _mean(utils), "between_next_share": _mean(nexts)}


def _topic_meetings(board: Board, blocks: _Placed) -> dict[str, Value]:
    """Over the topics that have tasks: the share met on two days or more, and the median
    of each such topic's median gap in days between meetings."""
    met: dict[UUID, set[dt.date]] = defaultdict(set)
    for task, block in blocks:
        ref = topic_of(board, task)
        if ref is not None:
            met[ref.id].add(_day(board, block))
    base = [ref for ref in board.topics.values() if ref.has_tasks]
    twice = [sorted(met[ref.id]) for ref in base if len(met[ref.id]) >= 2]
    gaps = [
        float(statistics.median([(later - earlier).days for earlier, later in pairwise(days)]))
        for days in twice
    ]
    return {
        "topics_met_twice_share": _share(len(twice), len(base)),
        "topic_gap_median_days": statistics.median(gaps) if gaps else None,
    }


def _new_material(
    board: Board, blocks: _Placed, planned: Mapping[dt.date, int]
) -> dict[str, Value]:
    """The most new-material minutes on one day, and the share of days with blocks whose
    new material is over 60% of the day's minutes."""
    new: dict[dt.date, int] = defaultdict(int)
    for task, block in blocks:
        if task.kind.value in NEW_KINDS:
            new[_day(board, block)] += block.interval.minutes
    days = [day for day, minutes in planned.items() if minutes > 0]
    over = sum(1 for day in days if new.get(day, 0) * 10 > planned[day] * 6)
    return {
        "max_new_minutes_day": max(new.values(), default=0),
        "new_over60_day_share": _share(over, len(days)),
    }


def _weight_mean(items: Iterable[tuple[TopicRef | None, int]]) -> float | None:
    """The minute-weighted mean of the topic weight over the items that have a topic."""
    weighted = 0
    minutes = 0
    for ref, item_minutes in items:
        if ref is not None:
            weighted += ref.weight * item_minutes
            minutes += item_minutes
    return _share(weighted, minutes)


def _uncovered_by_list_share(board: Board) -> float | None:
    """Per exam, the weight of its topics without tasks over the weight of all its topics;
    the mean over the exams that have topics."""
    shares: list[float | None] = []
    for exam in board.exams:
        refs = [ref for ref in board.topics.values() if ref.exam_id == exam.id]
        total = sum(ref.weight for ref in refs)
        if total == 0:
            continue
        shares.append(sum(ref.weight for ref in refs if not ref.has_tasks) / total)
    return _mean(shares)


def _gap_metrics(board: Board, blocks: _Placed) -> dict[str, Value]:
    """The documented gaps: block length on max_block_minutes boards, simulation length on
    exam_extra_time_percent boards with exam minutes. None on every other board."""
    over_25: float | None = None
    over_45: float | None = None
    if board.gap == MAX_BLOCK_GAP:
        lengths = [block.interval.minutes for _, block in blocks]
        over_25, over_45 = (
            _share(sum(1 for length in lengths if length > limit), len(lengths))
            for limit in GAP_BLOCK_MINUTES
        )
    sims_short: float | None = None
    if (
        board.gap == EXTRA_TIME_GAP
        and board.exam_minutes is not None
        and board.gap_value is not None
    ):
        sims = [task for task in planner_tasks(board) if task.kind is TaskKind.SIMULATION]
        needed = board.exam_minutes * (100 + board.gap_value)  # x 100, kept on integers
        sims_short = _share(
            sum(1 for task in sims if task.estimated_minutes * 100 < needed), len(sims)
        )
    return {
        "gap_blocks_over_25_share": over_25,
        "gap_blocks_over_45_share": over_45,
        "gap_sims_short_share": sims_short,
    }
