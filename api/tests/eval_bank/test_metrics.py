"""Tests for the schedule metrics (S46a Task 4).

Every test builds a small board by hand, and most a PlanResult by hand too, so each
expected value can be worked out on paper. The clock is the evaluation clock: NOW is
Sunday 2026-12-06 08:30 in Jerusalem, and day offset 0 is that date.
"""

import datetime as dt
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import cast
from uuid import UUID

import pytest

from app.domain.planner import (
    Exam,
    Interval,
    PlannedBlock,
    PlanResult,
    Profile,
    StudyWindow,
    Task,
    TaskKind,
    TaskStatus,
    Unscheduled,
    UnscheduledReason,
    plan,
)
from eval.bank.boards import Board, TopicRef, build_boards, planner_tasks
from eval.bank.cases import load_cases
from eval.bank.clock import NOW, TZ, stable_id
from eval.bank.metrics import (
    NEW_KINDS,
    SCHEDULE_METRIC_IDS,
    day_capacity,
    exam_coverage,
    is_core,
    planned_coverage,
    schedule_metrics,
    topic_of,
)
from eval.bank.profiles import load_profiles, profile_by_id

TODAY = NOW.date()
ALL_DAY_WINDOWS = frozenset({StudyWindow.MORNING, StudyWindow.AFTERNOON, StudyWindow.EVENING})

# The table of Global Constraints, without the students' and the missed-day metrics.
TABLE_IDS = (
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


def _profile(
    *,
    windows: frozenset[StudyWindow] = ALL_DAY_WINDOWS,
    sleep: dt.time = dt.time(0),
    busy: tuple[Interval, ...] = (),
) -> Profile:
    return Profile(
        timezone=TZ,
        wake_time=dt.time(8),
        sleep_time=sleep,
        daily_study_minutes=240,
        study_windows=windows,
        rest_days_before_exam=1,
        busy=busy,
    )


def _exam(key: str, days: int) -> Exam:
    return Exam(
        id=stable_id("test", "exam", key), exam_date=TODAY + dt.timedelta(days=days), difficulty=3
    )


def _task(key: str, exam: Exam, *, kind: TaskKind = TaskKind.LEARN, minutes: int = 60) -> Task:
    return Task(
        id=stable_id("test", "task", key),
        exam_id=exam.id,
        kind=kind,
        estimated_minutes=minutes,
    )


def _topic(key: str, exam: Exam, weight: int, *, has_tasks: bool = True) -> TopicRef:
    return TopicRef(
        id=stable_id("test", "topic", exam.id, key),
        key=key,
        weight=weight,
        exam_id=exam.id,
        has_tasks=has_tasks,
    )


def _board(
    exams: Sequence[Exam],
    tasks: Sequence[Task],
    *,
    profile: Profile | None = None,
    topics: Sequence[TopicRef] = (),
    task_topic: Mapping[UUID, UUID] | None = None,
    exam_minutes: int | None = None,
    gap: str | None = None,
    gap_value: int | None = None,
) -> Board:
    return Board(
        id="test:board",
        list_id="test",
        profile_id="board",
        course_type="problem_solving",
        source="synthetic",
        fill=1.0,
        profile=profile or _profile(),
        exams=tuple(exams),
        tasks=tuple(tasks),
        now=NOW,
        topics={topic.id: topic for topic in topics},
        task_topic=dict(task_topic or {}),
        exam_minutes=exam_minutes,
        gap=gap,
        gap_value=gap_value,
    )


def _block(task: Task, day: int, minutes: int, *, hour: int = 10) -> PlannedBlock:
    start = dt.datetime.combine(TODAY + dt.timedelta(days=day), dt.time(hour), tzinfo=TZ)
    utc = start.astimezone(dt.UTC)
    return PlannedBlock(
        task_id=task.id,
        interval=Interval(utc, utc + dt.timedelta(minutes=minutes)),
        part_index=1,
        part_count=1,
    )


def _result(blocks: Sequence[PlannedBlock], unscheduled: Sequence[Unscheduled] = ()) -> PlanResult:
    return PlanResult(
        blocks=tuple(blocks),
        removed=(),
        unscheduled=tuple(unscheduled),
        warnings=(),
        shortfalls=(),
    )


def _left_out(task: Task) -> Unscheduled:
    return Unscheduled(
        task_id=task.id,
        minutes=task.estimated_minutes,
        reason=UnscheduledReason.NOT_ENOUGH_TIME,
    )


@dataclass(frozen=True, slots=True, kw_only=True)
class _FutureTask:
    """A stand-in for the domain Task after S47: the same fields plus topic_id and optional."""

    id: UUID
    exam_id: UUID
    kind: TaskKind
    estimated_minutes: int
    focus: int = 5
    depends_on: UUID | None = None
    status: TaskStatus = TaskStatus.TODO
    bite_minutes: int | None = None
    topic_id: UUID | None = None
    optional: bool = False


def _future(
    key: str,
    exam: Exam,
    *,
    minutes: int = 60,
    topic_id: UUID | None = None,
    optional: bool = False,
) -> Task:
    return cast(
        Task,
        _FutureTask(
            id=stable_id("test", "task", key),
            exam_id=exam.id,
            kind=TaskKind.PRACTICE,
            estimated_minutes=minutes,
            topic_id=topic_id,
            optional=optional,
        ),
    )


def test_metric_ids_match_the_table() -> None:
    assert SCHEDULE_METRIC_IDS == TABLE_IDS
    assert frozenset({"learn", "review", "read"}) == NEW_KINDS


def test_empty_days_and_run() -> None:
    exam = _exam("a", 6)  # last study day +4: five active days, 0..4
    task = _task("k1", exam)
    board = _board([exam], [task])
    assert len(day_capacity(board)) == 5

    both = schedule_metrics(board, _result([_block(task, 0, 60), _block(task, 4, 60)]))
    assert both["active_days"] == 5
    assert both["empty_days"] == 3
    assert both["empty_day_share"] == pytest.approx(0.6)
    assert both["longest_empty_run"] == 3

    # No block after the empty days and nothing left out: the run is not counted.
    first_only = schedule_metrics(board, _result([_block(task, 0, 60)]))
    assert first_only["empty_days"] == 4
    assert first_only["longest_empty_run"] == 0

    # With work left out, the trailing empty days count.
    other = _task("k2", exam)
    board_left = _board([exam], [task, other])
    left = schedule_metrics(board_left, _result([_block(task, 0, 60)], [_left_out(other)]))
    assert left["longest_empty_run"] == 4


def test_inactive_day_does_not_break_run() -> None:
    exam = _exam("a", 7)  # last study day +5: days 0..5
    day2 = dt.datetime.combine(TODAY + dt.timedelta(days=2), dt.time(0), tzinfo=TZ)
    busy = Interval(day2.astimezone(dt.UTC), (day2 + dt.timedelta(days=1)).astimezone(dt.UTC))
    task = _task("k1", exam)
    board = _board([exam], [task], profile=_profile(busy=(busy,)))
    capacity = day_capacity(board)
    assert TODAY + dt.timedelta(days=2) not in capacity
    assert len(capacity) == 5

    metrics = schedule_metrics(board, _result([_block(task, 0, 60), _block(task, 5, 60)]))
    assert metrics["active_days"] == 5
    assert metrics["empty_days"] == 3  # days 1, 3 and 4
    assert metrics["longest_empty_run"] == 3


def test_util_uses_window_cap() -> None:
    # Only the evening window, cut by sleep at 19:00: 17:00-19:00 = 120 minutes a day.
    profile = _profile(windows=frozenset({StudyWindow.EVENING}), sleep=dt.time(19))
    exam = _exam("a", 3)  # last study day +1: days 0 and 1
    task = _task("k1", exam, minutes=120)
    board = _board([exam], [task], profile=profile)
    assert day_capacity(board) == {TODAY: 120, TODAY + dt.timedelta(days=1): 120}

    metrics = schedule_metrics(board, _result([_block(task, 0, 120, hour=17)]))
    assert metrics["day_util_mean"] == pytest.approx(0.5)  # 1.0 and 0.0
    assert metrics["day_util_p10"] == 0.0  # sorted index ceil(0.2) - 1 = 0
    assert metrics["days_util_ge90_share"] == pytest.approx(0.5)


def test_util_p10_takes_the_sorted_index() -> None:
    exam = _exam("a", 12)  # last study day +10: eleven days, 0..10
    task = _task("k1", exam, minutes=600)
    board = _board([exam], [task])
    # Day 0 empty, day 1 at half, days 2..10 full: sorted 0.0, 0.5, 1.0 x 9.
    blocks = [_block(task, 1, 120), *(_block(task, day, 240) for day in range(2, 11))]
    metrics = schedule_metrics(board, _result(blocks))
    # n = 11: index ceil(1.1) - 1 = 1, the second smallest.
    assert metrics["day_util_p10"] == pytest.approx(0.5)
    assert metrics["day_util_mean"] == pytest.approx((0.5 + 9) / 11)
    assert metrics["days_util_ge90_share"] == pytest.approx(9 / 11)

    # Ten days (the exam a day earlier, day 10 dropped): index ceil(1.0) - 1 = 0.
    exam10 = _exam("a", 11)
    board10 = _board([exam10], [_task("k1", exam10, minutes=600)])
    assert len(day_capacity(board10)) == 10
    metrics10 = schedule_metrics(board10, _result(blocks[:-1]))
    assert metrics10["day_util_p10"] == 0.0


def test_last20_share() -> None:
    exam = _exam("a", 11)  # last study day +9: window of ten dates, 0..9, tail 8..9
    task = _task("k1", exam, minutes=400)
    idle = _exam("b", 11)  # an exam with no core minutes placed is left out
    board = _board([exam, idle], [task, _task("k2", idle)])
    blocks = [
        _block(task, 0, 100),
        _block(task, 1, 100),
        _block(task, 2, 100),
        _block(task, 9, 100),
    ]
    metrics = schedule_metrics(board, _result(blocks))
    assert metrics["last20_core_share"] == pytest.approx(0.25)


def test_last20_ignores_optional_minutes() -> None:
    exam = _exam("a", 11)
    core = _task("k1", exam, minutes=300)
    extra = _future("k2", exam, optional=True)
    board = _board([exam], [core, extra])
    blocks = [_block(core, 0, 300), _block(extra, 9, 60)]
    assert schedule_metrics(board, _result(blocks))["last20_core_share"] == 0.0


def test_last20_none_without_core_minutes() -> None:
    exam = _exam("a", 11)
    board = _board([exam], [_task("k1", exam)])
    assert schedule_metrics(board, _result([]))["last20_core_share"] is None


def test_between_exams() -> None:
    first = _exam("a", 5)
    second = _exam("b", 12)  # last study day +10: span 6..10, five days of 240
    task = _task("k1", second, minutes=600)
    board = _board([second, first], [_task("k0", first), task])
    blocks = [_block(task, day, 120) for day in range(6, 11)]
    metrics = schedule_metrics(board, _result(blocks))
    assert metrics["between_next_share"] == pytest.approx(1.0)
    assert metrics["between_util"] == pytest.approx(600 / 1200)

    single = _board([second], [task])
    alone = schedule_metrics(single, _result(blocks))
    assert alone["between_util"] is None
    assert alone["between_next_share"] is None


def test_between_counts_a_later_exam_and_skips_close_pairs() -> None:
    first = _exam("a", 5)
    second = _exam("b", 12)
    third = _exam("c", 14)  # last study day +12, not after the second exam: no pair
    task_b = _task("k1", second, minutes=600)
    task_c = _task("k2", third, minutes=120)
    board = _board([first, second, third], [task_b, task_c])
    blocks = [*(_block(task_b, day, 120) for day in range(6, 11)), _block(task_c, 6, 120, hour=14)]
    metrics = schedule_metrics(board, _result(blocks))
    assert metrics["between_util"] == pytest.approx(720 / 1200)
    assert metrics["between_next_share"] == pytest.approx(600 / 720)


def test_topic_meetings() -> None:
    exam = _exam("a", 12)
    twice = _topic("t01", exam, 3)
    once = _topic("t02", exam, 2)
    listless = _topic("t03", exam, 1, has_tasks=False)  # not in the base
    a1 = _task("k1", exam)
    a2 = _task("k2", exam, kind=TaskKind.PRACTICE)
    b1 = _task("k3", exam)
    board = _board(
        [exam],
        [a1, a2, b1],
        topics=[twice, once, listless],
        task_topic={a1.id: twice.id, a2.id: twice.id, b1.id: once.id},
    )
    blocks = [
        _block(a1, 0, 60),
        _block(b1, 0, 60, hour=12),
        _block(a1, 2, 60),
        _block(a2, 2, 60, hour=12),  # the same day again: one meeting
        _block(a2, 6, 60),
    ]
    metrics = schedule_metrics(board, _result(blocks))
    assert metrics["topics_met_twice_share"] == pytest.approx(0.5)
    assert metrics["topic_gap_median_days"] == 3  # gaps 2 and 4


def test_topic_metrics_none_without_topics() -> None:
    exam = _exam("a", 6)
    task = _task("k1", exam)
    metrics = schedule_metrics(_board([exam], [task]), _result([_block(task, 0, 60)]))
    assert metrics["topics_met_twice_share"] is None
    assert metrics["topic_gap_median_days"] is None
    assert metrics["planned_coverage"] is None
    assert metrics["dropped_weight_mean"] is None
    assert metrics["all_weight_mean"] is None
    assert metrics["uncovered_by_list_share"] is None


def test_new_material_cap() -> None:
    exam = _exam("a", 6)
    learn = _task("k1", exam, minutes=240)
    practice = _task("k2", exam, kind=TaskKind.PRACTICE, minutes=120)
    review = _task("k3", exam, kind=TaskKind.REVIEW, minutes=60)
    board = _board([exam], [learn, practice, review])
    day0 = [_block(learn, 0, 180), _block(practice, 0, 60, hour=14)]
    metrics = schedule_metrics(board, _result(day0))
    assert metrics["max_new_minutes_day"] == 180
    assert metrics["new_over60_day_share"] == pytest.approx(1.0)

    # Day 1: review 60 (new) and practice 60 is exactly half: not over 0.6.
    day1 = [_block(review, 1, 60), _block(practice, 1, 60, hour=14)]
    both = schedule_metrics(board, _result([*day0, *day1]))
    assert both["max_new_minutes_day"] == 180
    assert both["new_over60_day_share"] == pytest.approx(0.5)

    empty = schedule_metrics(board, _result([]))
    assert empty["max_new_minutes_day"] == 0
    assert empty["new_over60_day_share"] is None


def test_planned_coverage_caps_topic() -> None:
    exam = _exam("a", 6)
    heavy = _topic("t01", exam, 4)
    light = _topic("t02", exam, 1)
    a = _task("k1", exam)
    b = _task("k2", exam)
    board = _board(
        [exam], [a, b], topics=[heavy, light], task_topic={a.id: heavy.id, b.id: light.id}
    )
    minutes = {a.id: 120, b.id: 30}
    assert exam_coverage(board, exam.id, minutes) == pytest.approx(0.8 * 1 + 0.2 * 0.5)
    assert planned_coverage(board, minutes) == pytest.approx(0.9)

    blocks = [_block(a, 0, 60), _block(a, 1, 60), _block(b, 0, 30, hour=12)]
    metrics = schedule_metrics(board, _result(blocks))
    assert metrics["planned_coverage"] == pytest.approx(0.9)


def test_coverage_counts_optional_minutes_but_targets_only_core() -> None:
    exam = _exam("a", 6)
    topic = _topic("t01", exam, 2)
    core = _task("k1", exam, minutes=100)
    extra = _future("k2", exam, minutes=100, topic_id=topic.id, optional=True)
    board = _board([exam], [core, extra], topics=[topic], task_topic={core.id: topic.id})
    # Target 100 (core only); 50 core + 30 optional = 80 placed.
    assert exam_coverage(board, exam.id, {core.id: 50, extra.id: 30}) == pytest.approx(0.8)


def test_planned_coverage_is_the_mean_over_exams() -> None:
    first = _exam("a", 6)
    second = _exam("b", 8)
    t1 = _topic("t01", first, 1)
    t2 = _topic("t01", second, 1)
    a = _task("k1", first)
    b = _task("k2", second)
    board = _board([first, second], [a, b], topics=[t1, t2], task_topic={a.id: t1.id, b.id: t2.id})
    assert planned_coverage(board, {a.id: 60}) == pytest.approx(0.5)
    assert exam_coverage(board, second.id, {a.id: 60}) == 0.0


def test_topic_of_falls_back_to_task_attribute() -> None:
    exam = _exam("a", 6)
    mapped = _topic("t01", exam, 2)
    own = _topic("t02", exam, 3)
    fake = _future("k1", exam, topic_id=own.id)
    stray = _future("k2", exam, topic_id=stable_id("test", "unknown"))
    plain = _task("k3", exam)
    board = _board([exam], [fake, stray, plain], topics=[mapped, own])
    assert topic_of(board, fake) == own
    assert topic_of(board, stray) is None
    assert topic_of(board, plain) is None

    # The eval map comes first.
    board_mapped = _board([exam], [fake], topics=[mapped, own], task_topic={fake.id: mapped.id})
    assert topic_of(board_mapped, fake) == mapped


def test_is_core_reads_optional_when_present() -> None:
    exam = _exam("a", 6)
    assert is_core(_task("k1", exam)) is True
    assert is_core(_future("k2", exam, optional=False)) is True
    assert is_core(_future("k3", exam, optional=True)) is False


def test_unscheduled_minutes_split_by_core() -> None:
    exam = _exam("a", 6)
    core = _task("k1", exam, minutes=60)
    extra = _future("k2", exam, minutes=30, optional=True)
    board = _board([exam], [core, extra])
    metrics = schedule_metrics(board, _result([], [_left_out(core), _left_out(extra)]))
    assert metrics["unscheduled_minutes"] == 90
    assert metrics["unscheduled_core_minutes"] == 60


def test_dropped_and_all_weight_means() -> None:
    exam = _exam("a", 6)
    heavy = _topic("t01", exam, 3)
    light = _topic("t02", exam, 1)
    a = _task("k1", exam, minutes=60)
    b = _task("k2", exam, minutes=120)
    loose = _task("k3", exam, minutes=60)  # no topic: in neither mean
    board = _board(
        [exam],
        [a, b, loose],
        topics=[heavy, light],
        task_topic={a.id: heavy.id, b.id: light.id},
    )
    metrics = schedule_metrics(board, _result([_block(a, 0, 60)], [_left_out(b), _left_out(loose)]))
    assert metrics["dropped_weight_mean"] == pytest.approx(1.0)
    assert metrics["all_weight_mean"] == pytest.approx((3 * 60 + 1 * 120) / 180)


def test_missing_topic_excluded_from_coverage_and_reported() -> None:
    exam = _exam("a", 6)
    listed = _topic("t01", exam, 3)
    missing = _topic("t02", exam, 1, has_tasks=False)
    task = _task("k1", exam)
    board = _board([exam], [task], topics=[listed, missing], task_topic={task.id: listed.id})
    metrics = schedule_metrics(board, _result([_block(task, 0, 60)]))
    assert metrics["planned_coverage"] == pytest.approx(1.0)
    assert metrics["uncovered_by_list_share"] == pytest.approx(0.25)
    assert metrics["topics_met_twice_share"] == 0.0  # one topic in the base, met once


def test_exam_without_topics_left_out_of_topic_metrics() -> None:
    # The first exam had a budget of 0: no tasks and no topics (review ruling, Task 3).
    empty = _exam("a", 1)
    exam = _exam("b", 6)
    listed = _topic("t01", exam, 3)
    missing = _topic("t02", exam, 1, has_tasks=False)
    task = _task("k1", exam)
    board = _board([empty, exam], [task], topics=[listed, missing], task_topic={task.id: listed.id})
    blocks = [_block(task, 0, 30), _block(task, 2, 30)]
    metrics = schedule_metrics(board, _result(blocks))
    assert exam_coverage(board, empty.id, {task.id: 60}) is None
    assert metrics["planned_coverage"] == pytest.approx(1.0)  # not the mean with 0
    assert metrics["uncovered_by_list_share"] == pytest.approx(0.25)
    assert metrics["topics_met_twice_share"] == pytest.approx(1.0)
    assert metrics["topic_gap_median_days"] == 2


def test_gap_metrics_only_on_gap_boards() -> None:
    exam = _exam("a", 6)
    task = _task("k1", exam, minutes=120)
    short_sim = _task("k2", exam, kind=TaskKind.SIMULATION, minutes=180)
    long_sim = _task("k3", exam, kind=TaskKind.SIMULATION, minutes=240)
    blocks = [_block(task, 0, 20), _block(task, 1, 30), _block(task, 2, 60)]

    adhd = _board([exam], [task, short_sim, long_sim], gap="max_block_minutes", gap_value=25)
    m = schedule_metrics(adhd, _result(blocks))
    assert m["gap_blocks_over_25_share"] == pytest.approx(2 / 3)
    assert m["gap_blocks_over_45_share"] == pytest.approx(1 / 3)
    assert m["gap_sims_short_share"] is None

    # 180 x 125% = 225: the 180-minute simulation is short, the 240-minute one is not.
    extra = _board(
        [exam],
        [task, short_sim, long_sim],
        exam_minutes=180,
        gap="exam_extra_time_percent",
        gap_value=25,
    )
    e = schedule_metrics(extra, _result(blocks))
    assert e["gap_sims_short_share"] == pytest.approx(0.5)
    assert e["gap_blocks_over_25_share"] is None
    assert e["gap_blocks_over_45_share"] is None

    no_minutes = _board([exam], [task, short_sim], gap="exam_extra_time_percent", gap_value=25)
    assert schedule_metrics(no_minutes, _result(blocks))["gap_sims_short_share"] is None

    plain = schedule_metrics(_board([exam], [task, short_sim]), _result(blocks))
    assert plain["gap_blocks_over_25_share"] is None
    assert plain["gap_blocks_over_45_share"] is None
    assert plain["gap_sims_short_share"] is None


def test_block_of_unknown_task_is_an_error() -> None:
    exam = _exam("a", 6)
    known = _task("k1", exam)
    stranger = _task("k9", exam)
    board = _board([exam], [known])
    with pytest.raises(ValueError, match="not on the board"):
        schedule_metrics(board, _result([_block(stranger, 0, 60)]))


def test_metrics_on_real_board() -> None:
    cases = [case for case in load_cases() if case.id.startswith("s01")]
    profiles = [profile_by_id(load_profiles(), "full_time")]
    boards = build_boards(cases, (), profiles)
    assert len(boards) == 2
    for board in boards:
        result = plan(board.profile, board.exams, planner_tasks(board), (), board.now)
        metrics = schedule_metrics(board, result)
        assert tuple(metrics) == TABLE_IDS
        for value in metrics.values():
            assert value is None or type(value) in (int, float)
        assert metrics["active_days"] == len(day_capacity(board))
        assert metrics["planned_coverage"] is not None
