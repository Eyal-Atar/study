""" "I have time now": the next tasks in line are placed from now on (S35, plan decision 10)."""

from dataclasses import replace
from datetime import UTC, date, datetime, time, timedelta

import pytest

from app.domain.planner import (
    BlockStatus,
    Commitment,
    Exam,
    ExistingBlock,
    FreeTimeFailure,
    FreeTimeResult,
    Interval,
    PlannedBlock,
    PlannerInputError,
    Profile,
    Task,
    TaskKind,
    TaskStatus,
    busy_intervals,
    free_time,
    plan,
)
from tests.planner.factories import as_existing, make_block, make_exam, make_profile, make_task

# make_profile(): Jerusalem (UTC+2), awake 08:00-23:00 local (06:00Z-21:00Z), one study
# window 07:00Z-15:00Z and a budget of 240. At EVENING, 19:00 local on Sunday November 1,
# the study window is over: free time ignores it, as it ignores the budget.
EVENING = datetime(2026, 11, 1, 17, tzinfo=UTC)
EXAM_DATE = date(2026, 11, 5)  # study days November 1-3
LAST_DAY_TODAY = date(2026, 11, 3)  # last study day November 1, cutoff 21:00Z


def Z(h: int, mi: int = 0, d: int = 1) -> datetime:
    return datetime(2026, 11, d, h, mi, tzinfo=UTC)


def iv(start: datetime, end: datetime) -> Interval:
    return Interval(start, end)


def board(profile: Profile, exams: list[Exam], tasks: list[Task]) -> list[ExistingBlock]:
    """The plan made at EVENING, stored: it starts on November 2."""
    return as_existing(plan(profile, exams, tasks, [], EVENING))


def of(result: FreeTimeResult, task: Task) -> list[PlannedBlock]:
    return [block for block in result.blocks if block.task_id == task.id]


def run(
    profile: Profile,
    exams: list[Exam],
    tasks: list[Task],
    blocks: list[ExistingBlock],
    minutes: int,
) -> FreeTimeResult:
    return free_time(profile, exams, tasks, blocks, EVENING, minutes)


def test_the_next_task_goes_in_now() -> None:
    profile = make_profile()
    exam = make_exam(EXAM_DATE)
    a, b = make_task(exam, 60), make_task(exam, 60)
    existing = board(profile, [exam], [a, b])
    [old] = [block for block in existing if block.task_id == a.id]
    result = run(profile, [exam], [a, b], existing, 60)
    assert result.session == iv(Z(17), Z(18))
    assert result.failure is None
    assert result.placed == (a.id,)
    assert result.removed == (old.id,)
    assert result.blocks == (
        PlannedBlock(
            task_id=a.id, interval=iv(Z(17), Z(18)), part_index=1, part_count=1, pinned=True
        ),
    )


def test_tasks_follow_each_other_with_a_break() -> None:
    profile = make_profile()
    exam = make_exam(EXAM_DATE)
    a, b, c = make_task(exam, 60), make_task(exam, 30), make_task(exam, 45)
    existing = board(profile, [exam], [a, b, c])
    result = run(profile, [exam], [a, b, c], existing, 180)
    assert result.placed == (a.id, b.id, c.id)
    assert [block.interval for block in result.blocks] == [
        iv(Z(17), Z(18)),
        iv(Z(18, 10), Z(18, 40)),
        iv(Z(18, 50), Z(19, 35)),
    ]
    assert set(result.removed) == {block.id for block in existing}
    assert all(block.pinned for block in result.blocks)


def test_now_is_rounded_to_the_next_minute() -> None:
    profile = make_profile()
    exam = make_exam(EXAM_DATE)
    a = make_task(exam, 30)
    result = free_time(profile, [exam], [a], [], EVENING + timedelta(seconds=1), 30)
    assert result.session == iv(Z(17, 1), Z(17, 31))
    assert [block.interval for block in result.blocks] == [iv(Z(17, 1), Z(17, 31))]


def test_the_queue_follows_the_next_candidate_block() -> None:
    profile = make_profile()
    exam = make_exam(EXAM_DATE)
    a, b, c = make_task(exam, 60), make_task(exam, 60), make_task(exam, 60)
    later = make_block(a, Z(9, d=3), Z(10, d=3))
    sooner = make_block(b, Z(9, d=2), Z(10, d=2))
    # c is not on the board at all: it comes after both.
    result = run(profile, [exam], [a, b, c], [later, sooner], 60)
    assert result.placed == (b.id,)
    result = run(profile, [exam], [c, a, b], [later, sooner], 200)
    assert result.placed == (b.id, a.id, c.id)


def test_a_pinned_block_is_not_a_candidate_and_stays() -> None:
    profile = make_profile()
    exam = make_exam(EXAM_DATE)
    a = make_task(exam, 60)
    pinned = make_block(a, Z(9, d=2), Z(10, d=2), pinned=True)
    result = run(profile, [exam], [a], [pinned], 60)
    # a is covered by its pinned block: nothing is left of it to place.
    assert result.placed == ()
    assert result.failure is FreeTimeFailure.NOTHING_TO_PLACE


def test_a_long_task_gets_a_part_and_the_rest_later() -> None:
    profile = make_profile()
    exam = make_exam(EXAM_DATE)
    a = make_task(exam, 150)
    existing = board(profile, [exam], [a])
    result = run(profile, [exam], [a], existing, 90)
    assert result.placed == (a.id,)
    assert set(result.removed) == {block.id for block in existing}
    first, *rest = of(result, a)
    assert (first.interval, first.pinned) == (iv(Z(17), Z(18, 30)), True)
    assert rest
    assert sum(block.interval.minutes for block in rest) == 60
    assert all(block.interval.start >= Z(18, 30) and not block.pinned for block in rest)
    assert [block.part_index for block in result.blocks] == list(range(1, len(result.blocks) + 1))
    assert all(block.block_id is None for block in result.blocks)


def test_a_part_leaves_a_remainder_of_half_an_hour() -> None:
    profile = make_profile()
    exam = make_exam(EXAM_DATE)
    a = make_task(exam, 100)
    result = run(profile, [exam], [a], [], 90)
    first, *rest = of(result, a)
    assert first.interval == iv(Z(17), Z(18, 10))  # 70 minutes, so 30 are left
    assert sum(block.interval.minutes for block in rest) == 30


def test_a_task_shorter_than_an_hour_is_not_split() -> None:
    profile = make_profile()
    exam = make_exam(EXAM_DATE)
    a = make_task(exam, 50)
    result = run(profile, [exam], [a], [], 40)
    assert result.placed == ()
    assert result.failure is FreeTimeFailure.NOTHING_TO_PLACE


def test_a_whole_piece_is_preferred_over_a_split() -> None:
    profile = make_profile(busy=(iv(Z(17, 30), Z(18)),))
    exam = make_exam(EXAM_DATE)
    a, b = make_task(exam, 60), make_task(exam, 30)
    result = run(profile, [exam], [a, b], [], 120)
    assert result.placed == (a.id, b.id)
    assert [(block.task_id, block.interval) for block in result.blocks] == [
        (a.id, iv(Z(18), Z(19))),
        (b.id, iv(Z(17), Z(17, 30))),
    ]


def test_a_remainder_that_does_not_fit_skips_the_task() -> None:
    profile = make_profile()
    soon = make_exam(LAST_DAY_TODAY)
    later = make_exam(EXAM_DATE)
    long = make_task(soon, 300)  # 180 minutes would be left for after 19:00Z: no room
    short = make_task(later, 30)
    result = run(profile, [soon, later], [long, short], [], 120)
    assert result.placed == (short.id,)
    assert [block.interval for block in result.blocks] == [iv(Z(17), Z(17, 30))]


def test_busy_time_inside_the_session_is_skipped() -> None:
    profile = make_profile(busy=(iv(Z(17), Z(17, 45)),))
    exam = make_exam(EXAM_DATE)
    a = make_task(exam, 60)
    result = run(profile, [exam], [a], [], 120)
    assert [block.interval for block in result.blocks] == [iv(Z(17, 45), Z(18, 45))]
    assert all(
        busy_intervals(profile, block.interval.start, block.interval.end) == ()
        for block in result.blocks
    )


def test_a_commitment_inside_the_session_is_skipped() -> None:
    # Sunday 19:30-20:00 local is 17:30Z-18:00Z.
    weekly = Commitment(weekday=0, start=time(19, 30), end=time(20), valid_from=date(2026, 1, 1))
    profile = make_profile(commitments=(weekly,))
    exam = make_exam(EXAM_DATE)
    a, b = make_task(exam, 30), make_task(exam, 60)
    result = run(profile, [exam], [a, b], [], 120)
    assert [(block.task_id, block.interval) for block in result.blocks] == [
        (a.id, iv(Z(17), Z(17, 30))),
        (b.id, iv(Z(18), Z(19))),
    ]


def test_a_block_already_inside_the_session_stays_with_a_break() -> None:
    profile = make_profile()
    exam = make_exam(EXAM_DATE)
    a, other = make_task(exam, 60), make_task(exam, 30)
    pinned = make_block(other, Z(17, 20), Z(17, 50), pinned=True)
    result = run(profile, [exam], [a, other], [pinned], 120)
    assert result.placed == (a.id,)
    assert [block.interval for block in result.blocks] == [iv(Z(18), Z(19))]
    assert pinned.id not in result.removed


def test_a_done_block_inside_the_session_stays() -> None:
    profile = make_profile()
    exam = make_exam(EXAM_DATE)
    a, other = make_task(exam, 60), make_task(exam, 30)
    done = make_block(other, Z(17), Z(17, 30), status=BlockStatus.DONE)
    result = run(profile, [exam], [a, other], [done], 120)
    assert [block.interval for block in result.blocks] == [iv(Z(17, 40), Z(18, 40))]


def test_the_tasks_own_candidate_inside_the_session_is_released() -> None:
    profile = make_profile()
    exam = make_exam(EXAM_DATE)
    a = make_task(exam, 60)
    inside = make_block(a, Z(17, 10), Z(18, 10))
    result = run(profile, [exam], [a], [inside], 60)
    assert result.removed == (inside.id,)
    assert [block.interval for block in result.blocks] == [iv(Z(17), Z(18))]


def test_a_running_block_keeps_its_time() -> None:
    profile = make_profile()
    exam = make_exam(EXAM_DATE)
    a, b = make_task(exam, 60), make_task(exam, 60)
    running = make_block(b, Z(16, 30), Z(17, 30))
    result = run(profile, [exam], [a, b], [running], 120)
    assert result.placed == (a.id,)
    assert [block.interval for block in result.blocks] == [iv(Z(17, 40), Z(18, 40))]


def test_a_dependency_chain_goes_in_order() -> None:
    profile = make_profile()
    exam = make_exam(EXAM_DATE)
    p = make_task(exam, 60)
    t = make_task(exam, 30, depends_on=p.id)
    u = make_task(exam, 30, depends_on=t.id)
    existing = board(profile, [exam], [p, t, u])
    result = run(profile, [exam], [p, t, u], existing, 180)
    assert result.placed == (p.id, t.id, u.id)
    ends = {block.task_id: block.interval for block in result.blocks}
    assert ends[p.id].end <= ends[t.id].start and ends[t.id].end <= ends[u.id].start


def test_a_task_waits_for_a_prerequisite_that_is_not_finished_before() -> None:
    profile = make_profile()
    exam = make_exam(EXAM_DATE)
    p = make_task(exam, 150)  # a part now, and 30 minutes after the session
    t = make_task(exam, 30, depends_on=p.id)
    existing = board(profile, [exam], [p, t])
    result = run(profile, [exam], [p, t], existing, 140)
    assert result.placed == (p.id,)
    assert of(result, t) == []
    assert all(block.task_id == p.id for block in existing if block.id in result.removed)


def test_a_task_waits_for_a_prerequisite_pinned_for_later() -> None:
    profile = make_profile()
    exam = make_exam(EXAM_DATE)
    p = make_task(exam, 60)
    t = make_task(exam, 30, depends_on=p.id)
    pinned = make_block(p, Z(9, d=2), Z(10, d=2), pinned=True)
    result = run(profile, [exam], [p, t], [pinned], 60)
    assert result.placed == ()
    assert result.failure is FreeTimeFailure.NOTHING_TO_PLACE


def test_a_task_never_goes_after_a_block_of_its_dependent() -> None:
    # t is pinned inside the session; p, which t waits for, may only go before it.
    profile = make_profile()
    exam = make_exam(EXAM_DATE)
    p = make_task(exam, 60)
    t = make_task(exam, 30, depends_on=p.id)
    pinned = make_block(t, Z(17, 30), Z(18), pinned=True)
    result = run(profile, [exam], [p, t], [pinned], 180)
    assert result.placed == ()


def test_a_prerequisite_that_is_done_does_not_hold_back() -> None:
    profile = make_profile()
    exam = make_exam(EXAM_DATE)
    p = make_task(exam, 60, status=TaskStatus.DONE)
    t = make_task(exam, 30, depends_on=p.id)
    result = run(profile, [exam], [p, t], [], 30)
    assert result.placed == (t.id,)


def test_a_prerequisite_with_no_blocks_holds_back() -> None:
    profile = make_profile()
    exam = make_exam(EXAM_DATE)
    p = make_task(exam, 600)
    t = make_task(exam, 30, depends_on=p.id)
    # A part of p now would leave 560 minutes, more than its exam's days hold, so p is
    # skipped, and t waits for it.
    result = run(profile, [exam], [t, p], [], 40)
    assert result.placed == ()
    assert result.failure is FreeTimeFailure.NOTHING_TO_PLACE


def test_a_simulation_is_never_split() -> None:
    profile = make_profile()
    exam = make_exam(EXAM_DATE)
    sim = make_task(exam, 120, TaskKind.SIMULATION)
    a = make_task(exam, 30)
    result = run(profile, [exam], [sim, a], [], 90)
    assert result.placed == (a.id,)
    whole = run(profile, [exam], [sim, a], [], 180)
    assert whole.placed == (sim.id, a.id)
    assert of(whole, sim)[0].interval == iv(Z(17), Z(19))


def test_one_simulation_a_study_day() -> None:
    profile = make_profile()
    exam = make_exam(EXAM_DATE)
    earlier = make_task(exam, 60, TaskKind.SIMULATION)
    sim = make_task(exam, 60, TaskKind.SIMULATION)
    done = make_block(earlier, Z(9), Z(10), status=BlockStatus.DONE)
    result = run(profile, [exam], [earlier, sim], [done], 90)
    assert result.placed == ()


def test_a_simulation_review_waits_for_a_later_study_day() -> None:
    profile = make_profile()
    exam = make_exam(EXAM_DATE)
    sim = make_task(exam, 60, TaskKind.SIMULATION)
    review = make_task(exam, 30, TaskKind.SIMULATION_REVIEW, depends_on=sim.id)
    a = make_task(exam, 30)
    done = make_block(sim, Z(9), Z(10), status=BlockStatus.DONE)
    result = run(profile, [exam], [sim, review, a], [done], 60)
    assert result.placed == (a.id,)


def test_an_exam_whose_last_study_day_is_today() -> None:
    profile = make_profile()
    exam = make_exam(LAST_DAY_TODAY)
    a = make_task(exam, 240)
    result = run(profile, [exam], [a], [], 300)
    # The cutoff is the end of today's waking hours, 21:00Z: four hours from now.
    assert [block.interval for block in result.blocks] == [iv(Z(17), Z(21))]
    b = make_task(exam, 30)
    late = free_time(profile, [exam], [b], [], Z(20, 45), 60)
    assert late.placed == ()
    assert late.failure is FreeTimeFailure.NOTHING_TO_PLACE


def test_an_exam_that_is_over_is_not_studied_for() -> None:
    profile = make_profile()
    exam = make_exam(date(2026, 11, 2))  # last study day October 31
    a = make_task(exam, 30)
    assert run(profile, [exam], [a], [], 60).failure is FreeTimeFailure.NOTHING_TO_PLACE


def test_no_free_time_when_the_session_is_busy() -> None:
    profile = make_profile(busy=(iv(Z(16), Z(19)),))
    exam = make_exam(EXAM_DATE)
    a = make_task(exam, 30)
    result = run(profile, [exam], [a], [], 60)
    assert result == FreeTimeResult(
        blocks=(),
        removed=(),
        placed=(),
        session=iv(Z(17), Z(18)),
        failure=FreeTimeFailure.NO_FREE_TIME,
    )


def test_a_short_piece_is_free_time_for_a_short_task() -> None:
    # 20 minutes are free: too short for a part, long enough for a 15-minute task.
    profile = make_profile(busy=(iv(Z(17, 20), Z(19)),))
    exam = make_exam(EXAM_DATE)
    small = make_task(exam, 15)
    assert run(profile, [exam], [small], [], 60).placed == (small.id,)
    big = make_task(exam, 60)
    assert run(profile, [exam], [big], [], 60).failure is FreeTimeFailure.NO_FREE_TIME


def test_nothing_to_place_without_tasks() -> None:
    result = run(make_profile(), [], [], [], 60)
    assert result.failure is FreeTimeFailure.NOTHING_TO_PLACE
    assert result.placed == ()


def test_other_tasks_are_untouched() -> None:
    profile = make_profile()
    exam = make_exam(EXAM_DATE)
    a, b = make_task(exam, 60), make_task(exam, 60)
    existing = board(profile, [exam], [a, b])
    result = run(profile, [exam], [a, b], existing, 60)
    assert {block.task_id for block in result.blocks} == {a.id}
    assert all(block.task_id == a.id for block in existing if block.id in result.removed)


@pytest.mark.parametrize("minutes", [29, 481, 0, True, 60.0])
def test_minutes_must_be_30_to_480(minutes: object) -> None:
    with pytest.raises(PlannerInputError):
        run(make_profile(), [], [], [], minutes)  # type: ignore[arg-type]


def test_the_same_input_gives_the_same_output() -> None:
    profile = make_profile()
    exam = make_exam(EXAM_DATE)
    tasks = [make_task(exam, 90), make_task(exam, 45), make_task(exam, 200)]
    existing = board(profile, [exam], tasks)
    assert run(profile, [exam], tasks, existing, 240) == run(profile, [exam], tasks, existing, 240)


def test_a_cancelled_task_is_not_placed() -> None:
    profile = make_profile()
    exam = make_exam(EXAM_DATE)
    a = make_task(exam, 30)
    skipped = replace(make_task(exam, 30), status=TaskStatus.SKIPPED)
    result = run(profile, [exam], [skipped, a], [], 30)
    assert result.placed == (a.id,)
