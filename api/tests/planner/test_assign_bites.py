"""A split task (Task.bite_minutes) gets one bite a day (S44)."""

from dataclasses import replace

from app.domain.planner import (
    PlanResult,
    Task,
    UnscheduledReason,
    assign_days,
    place_task,
    plan,
    replan,
)
from tests.planner.factories import NOW, by_day, make_block, make_exam, make_profile, make_task
from tests.planner.test_replan import Z, at, board, nov, of, span

# make_profile(): one window, 07:00Z-15:00Z (480 minutes), and a budget of 240.
# An exam on November 5 has study days November 1-3 (one rest day).


def minutes_by_day(result: PlanResult, task: Task) -> list[tuple[int, int]]:
    """The task's blocks as (day of November, minutes), in time order."""
    return sorted(
        (block.interval.start.day, block.interval.minutes)
        for block in result.blocks
        if block.task_id == task.id
    )


def test_a_split_task_gets_one_bite_a_day() -> None:
    exam = make_exam(nov(5))
    task = make_task(exam, 90, bite_minutes=30)
    result = plan(make_profile(), [exam], [task], [], NOW)
    assert minutes_by_day(result, task) == [(1, 30), (2, 30), (3, 30)]
    assert result.unscheduled == ()


def test_the_last_bite_takes_a_remainder_shorter_than_a_bite_and_a_part() -> None:
    exam = make_exam(nov(8))
    task = make_task(exam, 75, bite_minutes=30)
    result = assign_days(make_profile(), [exam], [task], NOW)
    assert by_day(result) == {nov(1): [(task.id, 30)], nov(2): [(task.id, 45)]}


def test_without_a_bite_the_same_task_is_one_block() -> None:
    exam = make_exam(nov(5))
    task = make_task(exam, 90)
    result = plan(make_profile(), [exam], [task], [], NOW)
    assert minutes_by_day(result, task) == [(1, 90)]


def test_a_task_shorter_than_a_bite_and_a_part_is_packed_whole() -> None:
    exam = make_exam(nov(5))
    task = make_task(exam, 50, bite_minutes=30)
    result = plan(make_profile(), [exam], [task], [], NOW)
    assert minutes_by_day(result, task) == [(1, 50)]


def test_a_bite_is_bounded_by_the_daily_budget() -> None:
    exam = make_exam(nov(8))
    task = make_task(exam, 150, bite_minutes=60)
    result = assign_days(make_profile(daily_study_minutes=40), [exam], [task], NOW)
    # 40 a day (the budget), and the last part is never shorter than 30.
    assert [items for _, items in sorted(by_day(result).items())] == [
        [(task.id, 40)],
        [(task.id, 40)],
        [(task.id, 40)],
        [(task.id, 30)],
    ]
    assert result.unscheduled == ()


def test_the_last_study_day_takes_the_rest_of_a_split_task() -> None:
    exam = make_exam(nov(4))  # study days November 1-2: fewer than the three bites
    task = make_task(exam, 90, bite_minutes=30)
    result = plan(make_profile(), [exam], [task], [], NOW)
    assert minutes_by_day(result, task) == [(1, 30), (2, 60)]
    assert result.unscheduled == ()


def test_a_split_task_that_no_budget_holds_is_unscheduled() -> None:
    exam = make_exam(nov(4))  # study days November 1-2
    task = make_task(exam, 90, bite_minutes=30)
    result = plan(make_profile(daily_study_minutes=40), [exam], [task], [], NOW)
    assert result.blocks == ()
    assert [(item.task_id, item.minutes, item.reason) for item in result.unscheduled] == [
        (task.id, 90, UnscheduledReason.NOT_ENOUGH_TIME)
    ]


def test_held_days_take_no_bite() -> None:
    exam = make_exam(nov(8))  # study days November 1-6
    task = make_task(exam, 30, bite_minutes=30)
    result = assign_days(make_profile(), [exam], [task], NOW, held={task.id: frozenset({nov(1)})})
    assert by_day(result) == {nov(2): [(task.id, 30)]}


def test_held_days_do_not_bind_a_task_without_a_bite() -> None:
    exam = make_exam(nov(8))
    task = make_task(exam, 30)
    result = assign_days(make_profile(), [exam], [task], NOW, held={task.id: frozenset({nov(1)})})
    assert by_day(result) == {nov(1): [(task.id, 30)]}


def test_deferring_a_bite_skips_the_days_that_hold_another() -> None:
    profile = make_profile()
    exam = make_exam(nov(8))  # study days November 1-6
    task = make_task(exam, 90, bite_minutes=30)
    existing = board(profile, [exam], [task])
    assert [block.interval.start.day for block in existing] == [1, 2, 3]
    first = existing[0]
    tomorrow = Z(2026, 11, 2, 0)
    result = place_task(
        profile, [exam], [task], existing, task.id, NOW, release=[first.id], not_before=tomorrow
    )
    assert result.unscheduled == ()
    # Not on November 2 or 3, which already hold a bite.
    assert minutes_by_day(result, task) == [(2, 30), (3, 30), (4, 30)]


def test_a_bite_goes_on_a_held_day_when_no_other_day_takes_it() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))  # study days November 1-3
    task = make_task(exam, 90, bite_minutes=30)
    existing = board(profile, [exam], [task])
    first = existing[0]
    tomorrow = Z(2026, 11, 2, 0)
    result = place_task(
        profile, [exam], [task], existing, task.id, NOW, release=[first.id], not_before=tomorrow
    )
    assert result.unscheduled == ()
    assert sorted(day for day, _ in minutes_by_day(result, task)) == [2, 2, 3]


def test_a_pinned_bite_holds_its_day_in_a_fresh_plan() -> None:
    profile = make_profile()
    exam = make_exam(nov(8))
    task = make_task(exam, 90, bite_minutes=30)
    pinned = make_block(task, Z(2026, 11, 1, 7), Z(2026, 11, 1, 7, 30), pinned=True)
    result = plan(profile, [exam], [task], [pinned], NOW)
    assert minutes_by_day(result, task) == [(1, 30), (2, 30), (3, 30)]


def test_replanning_a_lost_bite_skips_the_days_that_hold_another() -> None:
    profile = make_profile()
    exam = make_exam(nov(8))
    task = make_task(exam, 90, bite_minutes=30)
    existing = board(profile, [exam], [task])
    result = replan(profile, [exam], [task], existing[:2], NOW)
    assert result.unscheduled == ()
    assert minutes_by_day(result, task) == [(1, 30), (2, 30), (3, 30)]


def test_a_dependent_comes_after_the_last_bite() -> None:
    exam = make_exam(nov(8))
    split = make_task(exam, 90, bite_minutes=30)
    dependent = make_task(exam, 60, depends_on=split.id)
    result = plan(make_profile(), [exam], [split, dependent], [], NOW)
    assert minutes_by_day(result, split) == [(1, 30), (2, 30), (3, 30)]
    last_bite = max(b.interval.end for b in result.blocks if b.task_id == split.id)
    [after] = [b.interval for b in result.blocks if b.task_id == dependent.id]
    assert last_bite <= after.start


def test_placing_a_split_task_moves_no_other_block() -> None:
    profile = make_profile()
    exam = make_exam(nov(5))
    a, b, c = make_task(exam, 90), make_task(exam, 60), make_task(exam, 120)
    existing = board(profile, [exam], [a, b, c])
    assert [block.interval for block in of(existing, a)] == [at(7, 0, 8, 30)]
    others = [block for block in existing if block.task_id != a.id]
    assert [block.interval for block in others] == [at(9, 0, 10, 0), span(7, 9, day=2)]

    split = replace(a, bite_minutes=30)
    [old] = of(existing, a)
    result = place_task(profile, [exam], [split, b, c], existing, a.id, NOW, release=[old.id])

    assert result.unscheduled == ()
    assert result.removed == (old.id,)
    assert all(block.task_id == a.id and block.block_id is None for block in result.blocks)
    assert minutes_by_day(result, a) == [(1, 30), (2, 30), (3, 30)]
    # The other tasks' blocks stay where they are, and the bites keep clear of them.
    for block in result.blocks:
        for other in others:
            assert block.interval.end <= other.interval.start or (
                other.interval.end <= block.interval.start
            )
