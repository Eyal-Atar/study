"""Tests for the virtual students and the missed-day probe (S46a Task 5).

Two kinds of board. Hand-built boards are small enough that each expected coverage,
replan count and churn can be worked out on paper (the comment on each test does it).
Real boards come from build_boards: s01 x full_time x fill 1.0, and s01 x marathon
(six exams). The clock is the evaluation clock: NOW is Sunday 2026-12-06 08:30 in
Jerusalem, and day offset 0 is that date.
"""

import dataclasses
import datetime as dt
from collections import Counter
from collections.abc import Mapping, Sequence
from functools import cache
from uuid import UUID

import pytest

from app.domain.planner import (
    BlockStatus,
    Exam,
    ExistingBlock,
    Interval,
    PlanResult,
    Profile,
    StudyWindow,
    Task,
    TaskKind,
    TaskStatus,
    plan,
    study_date,
    sunday_weekday,
)
from eval.bank.boards import Board, TopicRef, build_boards, planner_tasks
from eval.bank.cases import load_cases
from eval.bank.clock import NOW, TZ, stable_id
from eval.bank.metrics import planned_coverage
from eval.bank.profiles import load_profiles, profile_by_id
from eval.bank.students import (
    BEHAVIORS,
    MAX_MISS,
    PARTIAL_FRACTION,
    REPLAN_EVERY_DAYS,
    REVIEW_DAYS,
    Behavior,
    PeriodResult,
    ProbeResult,
    _run,
    _settled,
    first_study_day,
    missed_day_probe,
    morning,
    simulate_period,
)

TODAY = NOW.date()


def _behavior(
    behavior_id: str,
    *,
    miss_rate: float = 0.0,
    slowdown: float = 0.0,
    weekend_skip: bool = False,
    late_start: int = 0,
    drift: float = 0.0,
) -> Behavior:
    return Behavior(
        id=behavior_id,
        miss_rate=miss_rate,
        slowdown=slowdown,
        weekend_skip=weekend_skip,
        late_start=late_start,
        drift=drift,
    )


IDEAL = next(b for b in BEHAVIORS if b.id == "ideal")
TYPICAL = next(b for b in BEHAVIORS if b.id == "typical")
# Never does a block: every day is before its start.
NEVER = _behavior("never", late_start=10_000)
SLOW = _behavior("slow", slowdown=1.0)


# --- hand-built boards ---------------------------------------------------------------


def _profile(*, daily: int, windows: frozenset[StudyWindow]) -> Profile:
    # Awake 08:00-24:00, studying from 09:00 (the default one-hour start delay).
    return Profile(
        timezone=TZ,
        wake_time=dt.time(8),
        sleep_time=dt.time(0),
        daily_study_minutes=daily,
        study_windows=windows,
        rest_days_before_exam=1,
    )


def _exam(days: int) -> Exam:
    return Exam(
        id=stable_id("st", "exam", days), exam_date=TODAY + dt.timedelta(days=days), difficulty=3
    )


def _task(key: str, exam: Exam, kind: TaskKind, minutes: int) -> Task:
    return Task(
        id=stable_id("st", "task", key), exam_id=exam.id, kind=kind, estimated_minutes=minutes
    )


def _hand_board(
    board_id: str,
    profile: Profile,
    exam: Exam,
    tasks: Sequence[Task],
    topic_of_task: Mapping[str, tuple[str, int]],
) -> Board:
    """topic_of_task maps a task key (the id's last part) to (topic key, weight)."""
    topics: dict[UUID, TopicRef] = {}
    task_topic: dict[UUID, UUID] = {}
    for key, (topic_key, weight) in topic_of_task.items():
        topic_id = stable_id("st", "topic", topic_key)
        topics[topic_id] = TopicRef(
            id=topic_id, key=topic_key, weight=weight, exam_id=exam.id, has_tasks=True
        )
        task_topic[stable_id("st", "task", key)] = topic_id
    return Board(
        id=board_id,
        list_id="st",
        profile_id="hand",
        course_type="problem_solving",
        source="synthetic",
        fill=1.0,
        profile=profile,
        exams=(exam,),
        tasks=tuple(tasks),
        now=NOW,
        topics=topics,
        task_topic=task_topic,
        exam_minutes=None,
        gap=None,
        gap_value=None,
    )


@cache
def fitting_board() -> Board:
    """Exam on day 4 (Thu), one rest day: study days 0-2 at 120 minutes = 360 >= 180.

    Topic a (weight 3): learn 60 + practice 60. Topic b (weight 1): learn 60.
    """
    exam = _exam(4)
    tasks = [
        _task("a_learn", exam, TaskKind.LEARN, 60),
        _task("a_practice", exam, TaskKind.PRACTICE, 60),
        _task("b_learn", exam, TaskKind.LEARN, 60),
    ]
    windows = frozenset({StudyWindow.MORNING, StudyWindow.AFTERNOON})
    return _hand_board(
        "st:fitting",
        _profile(daily=120, windows=windows),
        exam,
        tasks,
        {"a_learn": ("a", 3), "a_practice": ("a", 3), "b_learn": ("b", 1)},
    )


@cache
def single_board() -> Board:
    """Exam on day 3 (Wed), one rest day: study days 0 and 1, 60 morning minutes each.

    One learn task of 60 minutes, planned on day 0.
    """
    exam = _exam(3)
    return _hand_board(
        "st:single",
        _profile(daily=60, windows=frozenset({StudyWindow.MORNING})),
        exam,
        [_task("only", exam, TaskKind.LEARN, 60)],
        {"only": ("t", 1)},
    )


@cache
def long_board() -> Board:
    """Exam on day 20, one rest day; ten learn tasks of 60 at 60 minutes a day."""
    exam = _exam(20)
    tasks = [_task(f"l{i}", exam, TaskKind.LEARN, 60) for i in range(10)]
    return _hand_board(
        "st:long",
        _profile(daily=60, windows=frozenset({StudyWindow.MORNING})),
        exam,
        tasks,
        {f"l{i}": (f"t{i % 3}", 1 + i % 3) for i in range(10)},
    )


# --- real boards ---------------------------------------------------------------------


@cache
def small_board() -> Board:
    cases = [case for case in load_cases() if case.id.startswith("s01")]
    profile = profile_by_id(load_profiles(), "full_time")
    (board,) = build_boards(cases, (), [profile], fills=(1.0,))
    return board


@cache
def half_board() -> Board:
    cases = [case for case in load_cases() if case.id.startswith("s01")]
    profile = profile_by_id(load_profiles(), "full_time")
    (board,) = build_boards(cases, (), [profile], fills=(0.5,))
    return board


@cache
def marathon_board() -> Board:
    cases = [case for case in load_cases() if case.id.startswith("s01")]
    profile = profile_by_id(load_profiles(), "marathon")
    (board,) = build_boards(cases, (), [profile], fills=(1.0,))
    return board


@cache
def period(board_id: str, behavior: Behavior, seed: str) -> PeriodResult:
    boards = {b.id: b for b in (small_board(), half_board(), marathon_board(), fitting_board())}
    return simulate_period(boards[board_id], behavior, seed=seed)


def _first_plan(board: Board) -> PlanResult:
    return plan(board.profile, board.exams, planner_tasks(board), (), board.now)


def _no_time(result: PeriodResult) -> PeriodResult:
    return dataclasses.replace(result, seconds=0.0)


def _done_days(board: Board, blocks: Mapping[UUID, ExistingBlock]) -> list[dt.date]:
    return sorted(
        study_date(board.profile, block.interval.start)
        for block in blocks.values()
        if block.status is BlockStatus.DONE
    )


# --- constants -----------------------------------------------------------------------


def test_behaviors_and_constants_match_the_global_constraints() -> None:
    table = [
        ("ideal", 0.0, 0.0, False, 0, 0.0),
        ("typical", 0.2, 0.1, False, 0, 0.0),
        ("struggling", 0.3, 0.2, False, 0, 0.2),
        ("weekend_off", 0.1, 0.0, True, 0, 0.0),
        ("late", 0.1, 0.0, False, 3, 0.0),
        ("fading", 0.05, 0.0, False, 0, 0.4),
    ]
    assert [
        (b.id, b.miss_rate, b.slowdown, b.weekend_skip, b.late_start, b.drift) for b in BEHAVIORS
    ] == table
    assert (PARTIAL_FRACTION, MAX_MISS, REPLAN_EVERY_DAYS, REVIEW_DAYS) == (0.5, 0.95, 7, 7)


def test_morning_is_wake_time_plus_start_delay() -> None:
    profile = profile_by_id(load_profiles(), "full_time").profile  # wake 08:00, delay 60
    assert morning(profile, TODAY) == dt.datetime(2026, 12, 6, 9, 0, tzinfo=TZ)
    owl = profile_by_id(load_profiles(), "night_owl").profile  # wake 11:00, delay 60
    assert morning(owl, TODAY + dt.timedelta(days=1)) == dt.datetime(2026, 12, 7, 12, 0, tzinfo=TZ)


# --- hand-built periods --------------------------------------------------------------


def test_ideal_on_fitting_board_covers_everything() -> None:
    # Everything fits, every block is done: coverage 1, nothing left, nothing reported.
    # Days 1-4 are simulated; the last plan is day 0, so no weekly replan comes.
    result = simulate_period(fitting_board(), IDEAL, seed="s")
    assert result.coverage == pytest.approx(1.0)
    assert result.coverage_learned == pytest.approx(1.0)
    assert len(result.coverage_by_exam) == 1
    assert result.coverage_by_exam[0] == pytest.approx(1.0)
    assert (result.core_left_minutes, result.core_reported_minutes) == (0, 0)
    assert (result.replans, result.churn, result.churn_per_replan) == (0, 0, None)
    assert (result.review_moves, result.review_failures) == (0, 0)
    assert (result.board_id, result.behavior_id, result.rep) == ("st:fitting", "ideal", 0)


def test_never_studying_covers_nothing() -> None:
    _, state = _run(fitting_board(), NEVER, seed="s", rep=0)
    result = simulate_period(fitting_board(), NEVER, seed="s")
    assert result.coverage == 0.0
    assert result.coverage_learned == 0.0
    assert result.core_left_minutes == 180
    assert result.review_moves > 0
    assert all(task.status is TaskStatus.TODO for task in state.tasks.values())
    assert not any(block.status is BlockStatus.DONE for block in state.blocks.values())


def test_single_task_review_and_replan_by_hand() -> None:
    # Day 0: the plan puts the 60 minutes on day 0. Morning of day 1: the block was missed;
    # the review moves it to day 1 (move 1). Morning of day 2: missed again; no study day is
    # left (day 1 was the last), so the move fails (failure 1) and a replan runs (replan 1),
    # which removes nothing (no candidates). Day 3 is the exam: 0 covered, the 60 minutes
    # left and in the last plan's report.
    result = simulate_period(single_board(), NEVER, seed="s")
    assert (result.review_moves, result.review_failures) == (1, 1)
    assert (result.replans, result.churn, result.churn_per_replan) == (1, 0, 0.0)
    assert result.coverage == 0.0
    assert (result.core_left_minutes, result.core_reported_minutes) == (60, 60)


def test_weekly_replans_by_hand() -> None:
    # Days 1-20 are simulated; replans come on days 7 and 14 (seven days after the last
    # plan). The ideal student leaves every future block valid, so no block moves.
    result = simulate_period(long_board(), IDEAL, seed="s")
    assert (result.replans, result.churn, result.churn_per_replan) == (2, 0, 0.0)
    assert result.coverage == pytest.approx(1.0)
    assert result.core_left_minutes == 0


def test_slowdown_credits_half_by_hand() -> None:
    # Every block is done at half its minutes. Topic a: 60 of 120 -> 1/2 x 3/4; topic b:
    # 30 of 60 -> 1/2 x 1/4; coverage 0.5. No learn task reaches its estimate: learned 0.
    # 90 core minutes are left. The board still marks every task done (the product's rule
    # counts block minutes, not actual minutes).
    result, state = _run(fitting_board(), SLOW, seed="s", rep=0)
    assert result.coverage == pytest.approx(0.5, abs=0.01)
    assert result.coverage_learned == 0.0
    assert result.core_left_minutes == pytest.approx(90, abs=2)
    assert all(task.status is TaskStatus.DONE for task in state.tasks.values())


def test_task_done_rule_matches_product() -> None:
    exam = _exam(10)
    task = _task("two", exam, TaskKind.LEARN, 120)
    sim = _task("sim", exam, TaskKind.SIMULATION, 180)

    def block(key: str, owner: Task, day: int, status: BlockStatus, minutes: int) -> ExistingBlock:
        local = dt.datetime.combine(TODAY + dt.timedelta(days=day), dt.time(10), tzinfo=TZ)
        start = local.astimezone(dt.UTC)
        return ExistingBlock(
            id=stable_id("st", "block", key),
            task_id=owner.id,
            interval=Interval(start, start + dt.timedelta(minutes=minutes)),
            status=status,
            pinned=False,
        )

    now = dt.datetime.combine(TODAY + dt.timedelta(days=1), dt.time(9), tzinfo=TZ)
    tasks = {task.id: task, sim.id: sim}
    first = block("b1", task, 0, BlockStatus.DONE, 60)
    second = block("b2", task, 2, BlockStatus.PLANNED, 60)
    sim_block = block("s1", sim, 0, BlockStatus.DONE, 90)
    blocks = {b.id: b for b in (first, second, sim_block)}
    settled = _settled(tasks, blocks, now)
    # One block of two done, the other still to come: the task stays todo.
    assert settled[task.id].status is TaskStatus.TODO
    # A simulation is complete with any done block, as is_complete says.
    assert settled[sim.id].status is TaskStatus.DONE
    later = dt.datetime.combine(TODAY + dt.timedelta(days=3), dt.time(9), tzinfo=TZ)
    blocks[second.id] = dataclasses.replace(second, status=BlockStatus.DONE)
    assert _settled(tasks, blocks, later)[task.id].status is TaskStatus.DONE


# --- real boards ---------------------------------------------------------------------


def _first_plan_coverage(board: Board) -> float:
    scheduled: Counter[UUID] = Counter()
    for block in _first_plan(board).blocks:
        scheduled[block.task_id] += block.interval.minutes
    expected = planned_coverage(board, scheduled)
    assert expected is not None
    return expected


def test_ideal_student_covers_planned() -> None:
    # Where the first plan fits everything (fill 0.5), the ideal student ends exactly at
    # its planned coverage.
    fits = half_board()
    result = simulate_period(fits, IDEAL, seed="1")
    assert result.coverage == pytest.approx(_first_plan_coverage(fits), abs=0.01)
    assert result.review_moves == 0
    # On the full board (fill 1.0) the first plan leaves minutes out while days keep some
    # slack, and the weekly replans fill that slack without moving a block: the ideal
    # student ends at the planned coverage or above it, never below.
    board = small_board()
    result = period(board.id, IDEAL, "1")
    assert result.coverage is not None
    assert result.coverage >= _first_plan_coverage(board) - 0.01
    assert (result.review_moves, result.review_failures, result.churn) == (0, 0, 0)


def test_same_seed_same_result() -> None:
    board = small_board()
    first = period(board.id, TYPICAL, "a")  # cached: the same object as in the next test
    period(board.id, TYPICAL, "b")  # another period in between changes nothing
    again = simulate_period(board, TYPICAL, seed="a")
    assert _no_time(first) == _no_time(again)


def test_other_seed_differs() -> None:
    board = small_board()
    assert _no_time(period(board.id, TYPICAL, "a")) != _no_time(period(board.id, TYPICAL, "b"))


def test_missing_everything_covers_nothing() -> None:
    all_miss = _behavior("all_miss", miss_rate=1.0)  # capped at MAX_MISS = 0.95 a block
    result = period(half_board().id, all_miss, "1")
    assert result.coverage is not None
    assert result.coverage < 0.2
    assert result.review_moves > 0


def test_slowdown_credits_half() -> None:
    board = small_board()
    slow = period(board.id, SLOW, "1")
    ideal = period(board.id, IDEAL, "1")
    assert slow.coverage is not None
    assert ideal.coverage is not None
    assert slow.coverage < ideal.coverage
    assert slow.coverage_learned is not None
    assert slow.coverage_learned < 0.2


def test_weekend_skip_misses_friday_saturday() -> None:
    board = small_board()
    weekend_off = next(b for b in BEHAVIORS if b.id == "weekend_off")
    _, state = _run(board, weekend_off, seed="1", rep=0)
    days = _done_days(board, state.blocks)
    assert days
    assert all(sunday_weekday(day) not in (5, 6) for day in days)


def test_late_start_misses_first_days() -> None:
    board = small_board()
    late = next(b for b in BEHAVIORS if b.id == "late")
    _, state = _run(board, late, seed="1", rep=0)
    days = _done_days(board, state.blocks)
    first = study_date(board.profile, board.now)
    assert days
    assert min(days) >= first + dt.timedelta(days=late.late_start)


def test_first_study_day_skips_a_day_already_over() -> None:
    profiles = load_profiles()
    # 08:30 is after a full-time student's wake-up: day 0 is today.
    assert first_study_day(profile_by_id(profiles, "full_time").profile, NOW) == TODAY
    # A night owl (wake 11:00, sleep 03:00) is asleep at 08:30, after Saturday's study day
    # ended at 03:00: day 0 is Sunday, not Saturday.
    owl = profile_by_id(profiles, "night_owl").profile
    assert study_date(owl, NOW) == TODAY - dt.timedelta(days=1)
    assert first_study_day(owl, NOW) == TODAY


def test_late_start_on_night_owl_misses_late_start_days_with_blocks() -> None:
    # late_start counts real study days on every profile: the days with blocks before the
    # first done one are exactly the first late_start days.
    cases = [case for case in load_cases() if case.id.startswith("s01")]
    (board,) = build_boards(cases, (), [profile_by_id(load_profiles(), "night_owl")], fills=(0.5,))
    late = next(b for b in BEHAVIORS if b.id == "late")
    _, state = _run(board, late, seed="1", rep=0)
    done = _done_days(board, state.blocks)
    assert done
    with_blocks = sorted(
        {study_date(board.profile, block.interval.start) for block in state.blocks.values()}
    )
    skipped = [day for day in with_blocks if day < done[0]]
    assert skipped == [TODAY + dt.timedelta(days=k) for k in range(late.late_start)]


def test_marathon_records_each_exam() -> None:
    board = marathon_board()
    result = period(board.id, TYPICAL, "1")
    assert len(board.exams) == 6
    assert len(result.coverage_by_exam) == 6
    assert all(value is not None for value in result.coverage_by_exam)
    assert result.replans > 0


def test_churn_per_replan_is_the_ratio() -> None:
    struggling = next(b for b in BEHAVIORS if b.id == "struggling")
    result = simulate_period(half_board(), struggling, seed="1")
    assert result.replans > 0
    assert result.churn_per_replan == pytest.approx(result.churn / result.replans)


def test_probe_first_and_mid() -> None:
    board = small_board()
    first_plan = _first_plan(board)
    for which in ("first", "mid"):
        probe = missed_day_probe(board, first_plan, which)
        assert isinstance(probe, ProbeResult)
        assert probe.core_reported >= 0
        assert probe.churn >= 0
        assert probe == missed_day_probe(board, first_plan, which)
    empty = PlanResult(blocks=(), removed=(), unscheduled=(), warnings=(), shortfalls=())
    assert missed_day_probe(board, empty, "first") is None


def test_probe_by_hand() -> None:
    # The single board's plan has one block, on day 0, so first and mid are both day 0.
    # Missing it leaves day 1 (60 morning minutes): the replan places the 60 minutes there,
    # reports nothing, and removes nothing (the missed block is history, not a candidate).
    board = single_board()
    first_plan = _first_plan(board)
    assert len(first_plan.blocks) == 1
    for which in ("first", "mid"):
        assert missed_day_probe(board, first_plan, which) == ProbeResult(core_reported=0, churn=0)


def test_periods_do_not_depend_on_order() -> None:
    # One period per behaviour, run forwards and then backwards: each period has its own
    # Random, so the order they run in changes nothing. (The 1,000-period timing is a
    # measurement of the CLI, not a test.)
    board = half_board()
    forwards = [_no_time(simulate_period(board, b, seed=f"o/{b.id}")) for b in BEHAVIORS]
    backwards = [_no_time(simulate_period(board, b, seed=f"o/{b.id}")) for b in reversed(BEHAVIORS)]
    assert forwards == backwards[::-1]
    assert [r.behavior_id for r in forwards] == [b.id for b in BEHAVIORS]
