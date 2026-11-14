"""Which candidate blocks stay where they are: valid_blocks, pass by pass."""

from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from app.domain.planner import (
    BlockStatus,
    Exam,
    ExistingBlock,
    Interval,
    Profile,
    StudyWindow,
    Task,
    TaskKind,
    TaskStatus,
    is_complete,
    replan,
    valid_blocks,
)
from tests.planner.factories import NOW, make_block, make_exam, make_profile, make_task

# make_profile(): one window, 07:00Z-15:00Z (480 minutes), and a budget of 240.
# An exam on November 5 has study days November 1-3 (one rest day).


def Z(y: int, mo: int, d: int, h: int, mi: int = 0) -> datetime:
    return datetime(y, mo, d, h, mi, tzinfo=UTC)


def nov(day: int) -> date:
    return date(2026, 11, day)


def block(task: Task, day: int, start: int, end: int, *, pinned: bool = False) -> ExistingBlock:
    return make_block(task, Z(2026, 11, day, start), Z(2026, 11, day, end), pinned=pinned)


def ids(blocks: tuple[ExistingBlock, ...]) -> list[UUID]:
    return [b.id for b in blocks]


def test_a_valid_candidate_stays() -> None:
    exam = make_exam(nov(5))
    a = make_task(exam, 60)
    b1 = block(a, 1, 9, 10)
    assert valid_blocks(make_profile(), [exam], [a], [b1], NOW) == (b1,)


def test_a_block_of_a_task_not_in_the_input_goes() -> None:
    exam = make_exam(nov(5))
    a = make_task(exam, 60)
    gone = make_task(exam, 60)
    assert valid_blocks(make_profile(), [exam], [a], [block(gone, 1, 9, 10)], NOW) == ()


def test_a_block_of_a_done_task_goes() -> None:
    exam = make_exam(nov(5))
    a = make_task(exam, 60, status=TaskStatus.DONE)
    assert valid_blocks(make_profile(), [exam], [a], [block(a, 1, 9, 10)], NOW) == ()


def test_a_block_of_a_task_without_its_exam_goes() -> None:
    exam = make_exam(nov(5))
    other = make_exam(nov(5))
    a = make_task(exam, 60)
    assert valid_blocks(make_profile(), [other], [a], [block(a, 1, 9, 10)], NOW) == ()


def test_a_block_on_a_dependency_cycle_goes() -> None:
    exam = make_exam(nov(5))
    a = make_task(exam, 60)
    b = make_task(exam, 60, depends_on=a.id)
    a = Task(id=a.id, exam_id=exam.id, kind=a.kind, estimated_minutes=60, depends_on=b.id)
    blocks = [block(a, 1, 9, 10), block(b, 2, 9, 10)]
    assert valid_blocks(make_profile(), [exam], [a, b], blocks, NOW) == ()


def test_a_block_outside_a_window_goes() -> None:
    exam = make_exam(nov(5))
    a = make_task(exam, 60)
    # The window ends at 15:00Z.
    assert valid_blocks(make_profile(), [exam], [a], [block(a, 1, 14, 16)], NOW) == ()


def test_a_block_after_the_last_study_day_goes() -> None:
    exam = make_exam(nov(5))
    later = make_exam(nov(10))  # keeps November 4 open for the other exam
    a = make_task(exam, 60)
    assert valid_blocks(make_profile(), [exam, later], [a], [block(a, 4, 9, 10)], NOW) == ()


def test_a_block_over_a_fixed_block_goes() -> None:
    exam = make_exam(nov(5))
    a = make_task(exam, 60)
    b = make_task(exam, 60)
    done = make_block(b, Z(2026, 11, 1, 8), Z(2026, 11, 1, 9, 30), status=BlockStatus.DONE)
    blocks = [block(a, 1, 9, 10), done]
    assert valid_blocks(make_profile(), [exam], [a, b], blocks, NOW) == ()


def test_a_simulation_whose_length_changed_goes() -> None:
    exam = make_exam(nov(5))
    simulation = make_task(exam, 120, TaskKind.SIMULATION)
    blocks = [block(simulation, 1, 9, 10)]
    assert valid_blocks(make_profile(), [exam], [simulation], blocks, NOW) == ()


def test_a_simulation_with_a_fixed_block_loses_its_candidates() -> None:
    exam = make_exam(nov(5))
    simulation = make_task(exam, 60, TaskKind.SIMULATION)
    pinned = block(simulation, 1, 7, 8, pinned=True)
    blocks = [pinned, block(simulation, 2, 9, 10)]
    assert valid_blocks(make_profile(), [exam], [simulation], blocks, NOW) == ()


def test_of_two_overlapping_candidates_the_earlier_stays() -> None:
    exam = make_exam(nov(5))
    a = make_task(exam, 60)
    b = make_task(exam, 60)
    first = block(b, 1, 9, 10)
    second = make_block(a, Z(2026, 11, 1, 9, 30), Z(2026, 11, 1, 10, 30))
    assert valid_blocks(make_profile(), [exam], [a, b], [second, first], NOW) == (first,)


def test_minutes_over_the_estimate_go() -> None:
    exam = make_exam(nov(5))
    a = make_task(exam, 90)
    blocks = [block(a, 2, 9, 10), block(a, 1, 9, 10)]
    # Both stay by themselves, but 60 + 60 > 90: the later one goes.
    assert ids(valid_blocks(make_profile(), [exam], [a], blocks, NOW)) == [blocks[1].id]


def test_minutes_over_the_daily_budget_go() -> None:
    exam = make_exam(nov(5))
    a = make_task(exam, 180)
    b = make_task(exam, 120)
    blocks = [block(b, 1, 11, 13), block(a, 1, 7, 10)]
    profile = make_profile(daily_study_minutes=240)
    assert ids(valid_blocks(profile, [exam], [a, b], blocks, NOW)) == [blocks[1].id]


def test_a_second_simulation_on_a_day_goes() -> None:
    exam = make_exam(nov(5))
    s1 = make_task(exam, 60, TaskKind.SIMULATION)
    s2 = make_task(exam, 60, TaskKind.SIMULATION)
    blocks = [block(s2, 1, 11, 12), block(s1, 1, 7, 8)]
    assert ids(valid_blocks(make_profile(), [exam], [s1, s2], blocks, NOW)) == [blocks[1].id]


def test_the_output_is_sorted_by_start_then_id() -> None:
    exam = make_exam(nov(5))
    a = make_task(exam, 300)
    b = make_task(exam, 300)
    blocks = [
        block(a, 2, 7, 8),
        block(b, 1, 12, 13),
        block(a, 1, 7, 8),
        block(b, 2, 12, 13),
    ]
    result = valid_blocks(make_profile(), [exam], [a, b], blocks, NOW)
    assert result == tuple(sorted(blocks, key=lambda b: (b.interval.start, b.id)))


def test_a_prerequisite_that_is_not_complete_drops_its_dependents() -> None:
    exam = make_exam(nov(5))
    p = make_task(exam, 120)
    t = make_task(exam, 60, depends_on=p.id)
    blocks = [block(p, 1, 7, 8), block(t, 2, 7, 8)]
    assert ids(valid_blocks(make_profile(), [exam], [p, t], blocks, NOW)) == [blocks[0].id]


def test_a_dependent_before_its_prerequisite_ends_goes() -> None:
    exam = make_exam(nov(5))
    p = make_task(exam, 60)
    t = make_task(exam, 60, depends_on=p.id)
    blocks = [block(p, 1, 9, 10), block(t, 1, 7, 8)]
    assert ids(valid_blocks(make_profile(), [exam], [t, p], blocks, NOW)) == [blocks[0].id]


def test_a_dependent_after_its_prerequisite_stays() -> None:
    exam = make_exam(nov(5))
    p = make_task(exam, 60)
    t = make_task(exam, 60, depends_on=p.id)
    blocks = [block(p, 1, 7, 8), block(t, 1, 9, 10)]
    assert valid_blocks(make_profile(), [exam], [t, p], blocks, NOW) == tuple(blocks)


def test_a_simulation_dependent_needs_a_later_day() -> None:
    exam = make_exam(nov(5))
    p = make_task(exam, 60)
    review = make_task(exam, 60, TaskKind.SIMULATION, depends_on=p.id)
    blocks = [block(p, 1, 7, 8), block(review, 1, 9, 10)]
    assert ids(valid_blocks(make_profile(), [exam], [p, review], blocks, NOW)) == [blocks[0].id]


def test_a_dependent_waits_for_the_short_remainder_rule() -> None:
    exam = make_exam(nov(5))
    p = make_task(exam, 70)
    t = make_task(exam, 60, depends_on=p.id)
    # P has 60 of its 70 minutes: the 10-minute remainder drops its block, so P is
    # not complete and T's block goes too.
    blocks = [block(p, 1, 7, 8), block(t, 2, 7, 8)]
    assert valid_blocks(make_profile(), [exam], [t, p], blocks, NOW) == ()


def test_a_short_remainder_drops_the_latest_block() -> None:
    exam = make_exam(nov(5))
    a = make_task(exam, 140)
    blocks = [block(a, 2, 7, 8), block(a, 1, 7, 8)]
    # 140 - 120 = 20 < 30, so the later block goes; 140 - 60 = 80 is fine.
    assert ids(valid_blocks(make_profile(), [exam], [a], blocks, NOW)) == [blocks[1].id]


def test_is_complete() -> None:
    exam = make_exam(nov(5))
    a = make_task(exam, 60)
    simulation = make_task(exam, 60, TaskKind.SIMULATION)
    assert is_complete(a, 60, has_live_block=True)
    assert not is_complete(a, 59, has_live_block=True)
    assert is_complete(simulation, 0, has_live_block=True)
    assert not is_complete(simulation, 0, has_live_block=False)


# The profile, exam and ids of the property-test findings (test_replan_properties.py).
_UTC_PROFILE = Profile(
    timezone=ZoneInfo("UTC"),
    wake_time=time(7),
    sleep_time=time(23),
    daily_study_minutes=240,
    study_windows=frozenset({StudyWindow.MORNING, StudyWindow.AFTERNOON}),
    rest_days_before_exam=0,
    study_start_delay=timedelta(0),
)
_EXAM = Exam(id=UUID(int=1), exam_date=nov(20), difficulty=3)
_NOW = Z(2026, 11, 14, 9)


def _stored(
    number: int,
    task: int,
    start: datetime,
    minutes: int,
    *,
    status: BlockStatus = BlockStatus.PLANNED,
    pinned: bool = False,
) -> ExistingBlock:
    return ExistingBlock(
        id=UUID(int=number),
        task_id=UUID(int=task),
        interval=Interval(start, start + timedelta(minutes=minutes)),
        status=status,
        pinned=pinned,
    )


def test_a_cycle_broken_by_a_covered_member_keeps_the_other_members_block() -> None:
    # Finding 2: tasks 2 and 4 wait for each other, and a pinned block covers task 2.
    # plan schedules task 4 (the covered member no longer holds it back), so its
    # stored block is valid.
    tasks = [
        Task(
            id=UUID(int=2),
            exam_id=_EXAM.id,
            kind=TaskKind.LEARN,
            estimated_minutes=30,
            depends_on=UUID(int=4),
        ),
        Task(
            id=UUID(int=4),
            exam_id=_EXAM.id,
            kind=TaskKind.LEARN,
            estimated_minutes=30,
            depends_on=UUID(int=2),
        ),
    ]
    pin = _stored(101, 2, Z(2026, 11, 14, 10), 30, pinned=True)
    stored = _stored(102, 4, Z(2026, 11, 15, 7), 30)
    first = replan(_UTC_PROFILE, [_EXAM], tasks, [pin], _NOW)
    assert [b.interval for b in first.blocks if b.block_id is None] == [stored.interval]
    assert valid_blocks(_UTC_PROFILE, [_EXAM], tasks, [pin, stored], _NOW) == (stored,)
    assert replan(_UTC_PROFILE, [_EXAM], tasks, [pin, stored], _NOW).removed == ()


def test_a_remainder_topped_up_to_five_minutes_stays() -> None:
    # Finding 4: 30 of 32 minutes done; the 2-minute remainder is planned as 5.
    tasks = [Task(id=UUID(int=2), exam_id=_EXAM.id, kind=TaskKind.LEARN, estimated_minutes=32)]
    done = _stored(101, 2, Z(2026, 11, 14, 8), 30, status=BlockStatus.DONE)
    stored = _stored(102, 2, Z(2026, 11, 14, 9), 5)
    first = replan(_UTC_PROFILE, [_EXAM], tasks, [done], _NOW)
    assert [b.interval for b in first.blocks if b.block_id is None] == [stored.interval]
    assert valid_blocks(_UTC_PROFILE, [_EXAM], tasks, [done, stored], _NOW) == (stored,)
    assert replan(_UTC_PROFILE, [_EXAM], tasks, [done, stored], _NOW).removed == ()


def test_a_top_up_never_goes_past_five_minutes_of_remainder() -> None:
    tasks = [Task(id=UUID(int=2), exam_id=_EXAM.id, kind=TaskKind.LEARN, estimated_minutes=32)]
    done = _stored(101, 2, Z(2026, 11, 14, 8), 30, status=BlockStatus.DONE)
    stored = _stored(102, 2, Z(2026, 11, 14, 9), 6)
    assert valid_blocks(_UTC_PROFILE, [_EXAM], tasks, [done, stored], _NOW) == ()
