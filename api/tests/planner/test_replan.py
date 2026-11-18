"""Replanning that keeps every future block that is still valid where it is."""

from datetime import UTC, date, datetime
from uuid import UUID, uuid4

from app.domain.planner import (
    BlockStatus,
    Exam,
    ExistingBlock,
    Interval,
    PlannedBlock,
    PlanResult,
    Profile,
    Task,
    UnscheduledReason,
    plan,
    replan,
)
from tests.planner.factories import (
    NOW,
    as_existing,
    make_block,
    make_exam,
    make_profile,
    make_task,
)

# make_profile(): one window, 07:00Z-15:00Z (480 minutes), and a budget of 240.
# An exam on November 5 has study days November 1-3 (one rest day).


def Z(y: int, mo: int, d: int, h: int, mi: int = 0) -> datetime:
    return datetime(y, mo, d, h, mi, tzinfo=UTC)


def nov(day: int) -> date:
    return date(2026, 11, day)


def at(
    start_hour: int, start_minute: int, end_hour: int, end_minute: int, day: int = 1
) -> Interval:
    return Interval(
        Z(2026, 11, day, start_hour, start_minute), Z(2026, 11, day, end_hour, end_minute)
    )


def span(start_hour: int, end_hour: int, day: int = 1) -> Interval:
    return at(start_hour, 0, end_hour, 0, day)


def board(profile: Profile, exams: list[Exam], tasks: list[Task]) -> list[ExistingBlock]:
    return as_existing(plan(profile, exams, tasks, [], NOW))


def of(blocks: list[ExistingBlock], task: Task) -> list[ExistingBlock]:
    return [block for block in blocks if block.task_id == task.id]


def kept(result: PlanResult) -> dict[UUID, Interval]:
    """Existing block id -> its interval, for the blocks that stay."""
    return {b.block_id: b.interval for b in result.blocks if b.block_id is not None}


def new(result: PlanResult, task: Task) -> list[Interval]:
    return [b.interval for b in result.blocks if b.task_id == task.id and b.block_id is None]


def test_replanning_an_unchanged_plan_moves_nothing() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    tasks = [make_task(exam, 300), make_task(exam, 120), make_task(exam, 60)]
    before = plan(profile, [exam], tasks, [], NOW)
    existing = as_existing(before)
    result = replan(profile, [exam], tasks, existing, NOW)
    assert result.removed == ()
    assert all(block.block_id is not None for block in result.blocks)
    assert [(b.task_id, b.interval, b.part_index, b.part_count) for b in result.blocks] == [
        (b.task_id, b.interval, b.part_index, b.part_count) for b in before.blocks
    ]
    assert [b.block_id for b in result.blocks] == [b.id for b in existing]


def test_a_new_task_goes_into_free_time() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    a = make_task(exam, 120)
    existing = board(profile, [exam], [a])
    b = make_task(exam, 60)
    result = replan(profile, [exam], [a, b], existing, NOW)
    assert kept(result) == {block.id: block.interval for block in existing}
    assert new(result, b) == [at(9, 10, 10, 10)]
    assert result.removed == ()


def test_a_removed_task_frees_its_blocks_only() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    a = make_task(exam, 120)
    b = make_task(exam, 120)
    existing = board(profile, [exam], [a, b])
    result = replan(profile, [exam], [a], existing, NOW)
    assert result.removed == tuple(block.id for block in of(existing, b))
    assert kept(result) == {block.id: block.interval for block in of(existing, a)}
    assert result.blocks == tuple(
        PlannedBlock(
            task_id=a.id, interval=block.interval, part_index=1, part_count=1, block_id=block.id
        )
        for block in of(existing, a)
    )


def test_an_earlier_exam_date_moves_only_late_blocks() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    a, b, c = make_task(exam, 240), make_task(exam, 240), make_task(exam, 120)
    existing = board(profile, [exam], [a, b, c])
    assert [block.interval for block in existing] == [span(7, 11, 1), span(7, 11, 2), span(7, 9, 3)]
    earlier = Exam(id=exam.id, exam_date=nov(4), difficulty=exam.difficulty)
    result = replan(profile, [earlier], [a, b, c], existing, NOW)
    assert kept(result) == {
        block.id: block.interval for block in [*of(existing, a), *of(existing, b)]
    }
    assert result.removed == tuple(block.id for block in of(existing, c))
    assert [(u.task_id, u.reason) for u in result.unscheduled] == [
        (c.id, UnscheduledReason.NOT_ENOUGH_TIME)
    ]


def test_a_lower_daily_budget_releases_the_end_of_the_day() -> None:
    exam = make_exam(nov(5))
    a = make_task(exam, 120)
    b = make_task(exam, 120)
    existing = board(make_profile(), [exam], [a, b])
    assert [block.interval.start.date() for block in existing] == [nov(1), nov(1)]
    result = replan(make_profile(daily_study_minutes=180), [exam], [a, b], existing, NOW)
    assert kept(result) == {block.id: block.interval for block in of(existing, a)}
    assert result.removed == tuple(block.id for block in of(existing, b))
    assert new(result, b) == [span(7, 9, 2)]


def test_a_shorter_task_releases_its_last_block() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    a = make_task(exam, 300)
    existing = board(profile, [exam], [a])
    first, second = existing
    assert (first.interval, second.interval) == (span(7, 11, 1), span(7, 8, 2))
    shorter = Task(id=a.id, exam_id=exam.id, kind=a.kind, estimated_minutes=240)
    result = replan(profile, [exam], [shorter], existing, NOW)
    assert result.blocks == (
        PlannedBlock(
            task_id=a.id, interval=first.interval, part_index=1, part_count=1, block_id=first.id
        ),
    )
    assert result.removed == (second.id,)


def test_a_small_growth_does_not_leave_a_short_part() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    a = make_task(exam, 300)
    existing = board(profile, [exam], [a])
    first, second = existing
    longer = Task(id=a.id, exam_id=exam.id, kind=a.kind, estimated_minutes=310)
    result = replan(profile, [exam], [longer], existing, NOW)
    assert result.removed == (second.id,)
    assert kept(result) == {first.id: first.interval}
    assert new(result, a) == [at(7, 0, 8, 10, 2)]
    assert all(block.interval.minutes != 10 for block in result.blocks)


def test_dependents_follow_a_prerequisite_that_moves() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    p = make_task(exam, 240)
    t = make_task(exam, 240, depends_on=p.id)
    existing = board(profile, [exam], [p, t])
    assert [block.interval for block in existing] == [span(7, 11, 1), span(7, 11, 2)]
    x = make_task(exam, 240)  # not in the input
    locked = make_block(x, Z(2026, 11, 1, 7), Z(2026, 11, 1, 11), status=BlockStatus.DONE)
    result = replan(profile, [exam], [p, t], [*existing, locked], NOW)
    assert result.removed == tuple(block.id for block in existing)
    p_blocks = [b.interval for b in result.blocks if b.task_id == p.id]
    t_blocks = [b.interval for b in result.blocks if b.task_id == t.id]
    assert p_blocks
    assert t_blocks
    assert p_blocks[-1].end < t_blocks[0].start


def test_a_candidate_next_to_a_pinned_block_stays() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    a = make_task(exam, 60)
    existing = board(profile, [exam], [a])
    assert [block.interval for block in existing] == [span(7, 8)]
    b = make_task(exam, 60)
    pinned = make_block(b, Z(2026, 11, 1, 8), Z(2026, 11, 1, 9), pinned=True)
    result = replan(profile, [exam], [a, b], [*existing, pinned], NOW)
    assert kept(result) == {existing[0].id: span(7, 8), pinned.id: span(8, 9)}
    assert result.removed == ()


def test_replan_falls_back_when_stability_costs_minutes() -> None:
    profile = make_profile()
    e1 = make_exam(nov(5))
    a = make_task(e1, 240)
    existing = board(profile, [e1], [a])
    assert [block.interval for block in existing] == [span(7, 11, 1)]
    e2 = make_exam(nov(3))
    b = make_task(e2, 240)
    exams, tasks = [e1, e2], [a, b]
    result = replan(profile, exams, tasks, existing, NOW)
    assert result == plan(profile, exams, tasks, existing, NOW)
    assert new(result, b) == [span(7, 11, 1)]
    assert new(result, a) == [span(7, 11, 2)]
    assert result.removed == (existing[0].id,)
    assert result.unscheduled == ()


def test_replan_keeps_the_stable_plan_on_a_tie() -> None:
    profile = make_profile()
    exam = make_exam(nov(3))
    a = make_task(exam, 240)
    existing = board(profile, [exam], [a])
    b = make_task(exam, 240)
    stable = plan(profile, [exam], [a, b], existing, NOW, keep_valid=True)
    fresh = plan(profile, [exam], [a, b], existing, NOW)
    assert b.id in {u.task_id for u in stable.unscheduled}
    assert b.id in {u.task_id for u in fresh.unscheduled}
    result = replan(profile, [exam], [a, b], existing, NOW)
    assert result == stable
    assert kept(result) == {existing[0].id: existing[0].interval}
    assert result.removed == ()


def test_replan_returns_the_stable_plan_when_everything_fits() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    a = make_task(exam, 60)
    existing = [make_block(a, Z(2026, 11, 1, 12), Z(2026, 11, 1, 13), id=uuid4())]
    result = replan(profile, [exam], [a], existing, NOW)
    assert result == plan(profile, [exam], [a], existing, NOW, keep_valid=True)
    assert kept(result) == {existing[0].id: span(12, 13)}


def test_a_new_block_keeps_a_break_from_a_kept_candidate() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    a = make_task(exam, 60)
    candidate = make_block(a, Z(2026, 11, 1, 7, 30), Z(2026, 11, 1, 8, 30))
    b = make_task(exam, 60)
    result = replan(profile, [exam], [a, b], [candidate], NOW)
    assert kept(result) == {candidate.id: at(7, 30, 8, 30)}
    assert new(result, b) == [at(8, 40, 9, 40)]
    assert result.removed == ()


def test_an_existing_block_keeps_its_pinned_flag() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    a, b = make_task(exam, 60), make_task(exam, 60)
    pinned = make_block(a, Z(2026, 11, 2, 7), Z(2026, 11, 2, 8), pinned=True)
    free = make_block(b, Z(2026, 11, 2, 9), Z(2026, 11, 2, 10))
    result = replan(profile, [exam], [a, b], [pinned, free], NOW)
    assert {(blk.block_id, blk.pinned) for blk in result.blocks} == {
        (pinned.id, True),
        (free.id, False),
    }
