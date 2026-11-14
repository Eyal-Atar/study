from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest

from app.domain.planner import DayItem, Interval, StudyDay, Task, TaskKind
from app.domain.planner.pack import pack_day
from tests.planner.factories import make_exam, make_task

EXAM = make_exam(date(2026, 12, 1))


def at(hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 11, 2, hour, minute, tzinfo=UTC)


def iv(start: tuple[int, int], end: tuple[int, int]) -> Interval:
    return Interval(at(*start), at(*end))


def day(*windows: Interval) -> StudyDay:
    return StudyDay(date=date(2026, 11, 2), windows=windows)


def task(minutes: int, **overrides: Any) -> Task:
    return make_task(EXAM, minutes, **overrides)


def pack(
    study_day: StudyDay,
    tasks: list[Task],
    prerequisite: dict[UUID, UUID] | None = None,
) -> tuple[tuple[UUID, Interval], ...]:
    items = [DayItem(task_id=t.id, minutes=t.estimated_minutes) for t in tasks]
    return pack_day(study_day, items, {t.id: t for t in tasks}, prerequisite or {})


def test_one_item_starts_at_the_window() -> None:
    a = task(60)
    assert pack(day(iv((7, 0), (12, 0))), [a]) == ((a.id, iv((7, 0), (8, 0))),)


def test_breaks_and_the_long_break() -> None:
    a, b, c = task(60), task(60), task(60)
    assert pack(day(iv((7, 0), (12, 0))), [a, b, c]) == (
        (a.id, iv((7, 0), (8, 0))),
        (b.id, iv((8, 10), (9, 10))),
        (c.id, iv((9, 40), (10, 40))),
    )


def test_the_window_gap_replaces_the_long_break() -> None:
    a, b = task(60), task(60)
    assert pack(day(iv((7, 0), (8, 0)), iv((9, 0), (12, 0))), [a, b]) == (
        (a.id, iv((7, 0), (8, 0))),
        (b.id, iv((9, 0), (10, 0))),
    )


def test_an_item_splits_at_the_window_end() -> None:
    a = task(100)
    assert pack(day(iv((7, 0), (8, 0)), iv((9, 0), (12, 0))), [a]) == (
        (a.id, iv((7, 0), (8, 0))),
        (a.id, iv((9, 0), (9, 40))),
    )


def test_the_last_part_stays_long_enough() -> None:
    a = task(80)
    assert pack(day(iv((7, 0), (8, 0)), iv((9, 0), (12, 0))), [a]) == (
        (a.id, iv((7, 0), (7, 50))),
        (a.id, iv((9, 0), (9, 30))),
    )


def test_a_short_item_moves_to_the_next_window() -> None:
    a, b = task(30), task(50)
    assert pack(day(iv((7, 0), (8, 0)), iv((9, 0), (11, 0))), [a, b]) == (
        (a.id, iv((7, 0), (7, 30))),
        (b.id, iv((9, 0), (9, 50))),
    )


def test_the_simulation_takes_the_smallest_window_that_holds_it() -> None:
    a, s = task(60), task(180, kind=TaskKind.SIMULATION)
    assert pack(day(iv((7, 0), (12, 0)), iv((13, 0), (16, 30))), [a, s]) == (
        (a.id, iv((7, 0), (8, 0))),
        (s.id, iv((13, 0), (16, 0))),
    )


def test_items_after_the_simulation_wait_for_its_break() -> None:
    s, a = task(120, kind=TaskKind.SIMULATION), task(60)
    assert pack(day(iv((7, 0), (12, 0))), [s, a]) == (
        (s.id, iv((7, 0), (9, 0))),
        (a.id, iv((9, 30), (10, 30))),
    )


def test_a_split_item_goes_on_after_the_simulation() -> None:
    a, s = task(100), task(180, kind=TaskKind.SIMULATION)
    assert pack(day(iv((7, 0), (8, 0)), iv((9, 0), (15, 0))), [a, s]) == (
        (a.id, iv((7, 0), (8, 0))),
        (s.id, iv((9, 0), (12, 0))),
        (a.id, iv((12, 30), (13, 10))),
    )


def test_high_focus_goes_first() -> None:
    a, b = task(60, focus=3), task(60, focus=8)
    assert pack(day(iv((7, 0), (12, 0))), [a, b]) == (
        (b.id, iv((7, 0), (8, 0))),
        (a.id, iv((8, 30), (9, 30))),
    )


def test_focus_never_breaks_a_dependency() -> None:
    a, b, c = task(60, focus=2), task(60, focus=9), task(60, focus=5)
    assert pack(day(iv((7, 0), (12, 0))), [a, b, c], {b.id: a.id}) == (
        (c.id, iv((7, 0), (8, 0))),
        (a.id, iv((8, 10), (9, 10))),
        (b.id, iv((9, 40), (10, 40))),
    )


def test_a_prerequisite_from_another_day_does_not_hold_back() -> None:
    a, b = task(60, focus=2), task(60, focus=9)
    assert pack(day(iv((7, 0), (12, 0))), [a, b], {b.id: uuid4()}) == (
        (b.id, iv((7, 0), (8, 0))),
        (a.id, iv((8, 30), (9, 30))),
    )


def test_an_empty_day() -> None:
    assert pack_day(day(iv((7, 0), (12, 0))), [], {}, {}) == ()


def test_a_day_that_does_not_pack_raises() -> None:
    a = task(61)
    with pytest.raises(RuntimeError, match=str(a.id)):
        pack(day(iv((7, 0), (8, 0))), [a])


def test_a_simulation_without_a_window_raises() -> None:
    s = task(90, kind=TaskKind.SIMULATION)
    with pytest.raises(RuntimeError, match=str(s.id)):
        pack(day(iv((7, 0), (8, 0))), [s])


def test_a_second_simulation_raises() -> None:
    s1, s2 = task(60, kind=TaskKind.SIMULATION), task(60, kind=TaskKind.SIMULATION)
    with pytest.raises(RuntimeError, match="2026-11-02"):
        pack(day(iv((7, 0), (15, 0))), [s1, s2])


def test_a_dependency_cycle_inside_the_day_raises() -> None:
    a, b = task(60), task(60)
    with pytest.raises(RuntimeError, match="cycle"):
        pack(day(iv((7, 0), (15, 0))), [a, b], {a.id: b.id, b.id: a.id})
