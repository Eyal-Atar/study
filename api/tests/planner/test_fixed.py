from dataclasses import replace
from datetime import UTC, date, datetime
from uuid import uuid4

import pytest

from app.domain.planner import (
    BlockRole,
    BlockStatus,
    ExistingBlock,
    Interval,
    TaskKind,
    TaskStatus,
    block_role,
    fixed_state,
)
from tests.planner.factories import make_block, make_exam, make_profile, make_task

# make_profile(): one window, 07:00Z-15:00Z, and a budget of 240.


def Z(y: int, mo: int, d: int, h: int, mi: int = 0) -> datetime:
    return datetime(y, mo, d, h, mi, tzinfo=UTC)


def nov(day: int) -> date:
    return date(2026, 11, day)


START = Z(2026, 11, 1, 9)


@pytest.mark.parametrize(
    ("status", "pinned", "start", "end", "role"),
    [
        pytest.param(BlockStatus.DONE, False, 7, 8, BlockRole.FIXED, id="done-past"),
        pytest.param(BlockStatus.DONE, False, 10, 11, BlockRole.FIXED, id="done-future"),
        pytest.param(BlockStatus.PLANNED, True, 10, 11, BlockRole.FIXED, id="pinned-future"),
        pytest.param(BlockStatus.PLANNED, True, 8, 10, BlockRole.FIXED, id="pinned-in-progress"),
        pytest.param(BlockStatus.PLANNED, False, 8, 10, BlockRole.FIXED, id="in-progress"),
        pytest.param(BlockStatus.PLANNED, False, 10, 11, BlockRole.CANDIDATE, id="future"),
        pytest.param(BlockStatus.PLANNED, False, 9, 10, BlockRole.CANDIDATE, id="starts-at-start"),
        pytest.param(BlockStatus.PLANNED, False, 7, 8, BlockRole.HISTORY, id="planned-past"),
        pytest.param(BlockStatus.PLANNED, True, 8, 9, BlockRole.HISTORY, id="pinned-ends-at-start"),
        pytest.param(BlockStatus.PLANNED, False, 8, 9, BlockRole.HISTORY, id="ends-at-start"),
        pytest.param(BlockStatus.MISSED, True, 10, 11, BlockRole.HISTORY, id="pinned-missed"),
        pytest.param(BlockStatus.MISSED, False, 10, 11, BlockRole.HISTORY, id="missed"),
        pytest.param(BlockStatus.SKIPPED, False, 10, 11, BlockRole.HISTORY, id="skipped"),
    ],
)
def test_block_role(
    status: BlockStatus, pinned: bool, start: int, end: int, role: BlockRole
) -> None:
    task = make_task(make_exam(nov(5)), 60)
    block = make_block(
        task, Z(2026, 11, 1, start), Z(2026, 11, 1, end), status=status, pinned=pinned
    )
    assert block_role(block, START) is role


def test_fixed_state() -> None:
    profile = make_profile()
    exam = make_exam(nov(10))
    a = make_task(exam, 120)  # 60 minutes fixed: 60 left
    b = make_task(exam, 60)  # 60 minutes fixed: covered, so it leaves the list
    c = make_task(exam, 60, depends_on=a.id)  # waits until after November 2
    d = make_task(exam, 60, depends_on=b.id)  # waits until after November 3
    simulation = make_task(exam, 180, TaskKind.SIMULATION)  # any fixed block covers it
    done = make_task(exam, 60, status=TaskStatus.DONE)  # not todo: as it is
    e = make_task(exam, 60, depends_on=done.id)  # its prerequisite is not todo
    f = make_task(exam, 60)  # no fixed blocks: as it is
    deleted = uuid4()
    blocks = [
        # Before start: counts in the day and shortens a, but is not busy.
        make_block(a, Z(2026, 11, 1, 7), Z(2026, 11, 1, 7, 30), status=BlockStatus.DONE),
        make_block(a, Z(2026, 11, 2, 7), Z(2026, 11, 2, 7, 30), pinned=True),
        make_block(b, Z(2026, 11, 3, 7), Z(2026, 11, 3, 8), pinned=True),
        make_block(simulation, Z(2026, 11, 2, 10), Z(2026, 11, 2, 11), pinned=True),
        make_block(done, Z(2026, 11, 1, 10), Z(2026, 11, 1, 11), status=BlockStatus.DONE),
        # Of a deleted task: it counts in the day only.
        ExistingBlock(
            id=uuid4(),
            task_id=deleted,
            interval=Interval(Z(2026, 11, 1, 6), Z(2026, 11, 1, 6, 30)),
            status=BlockStatus.DONE,
            pinned=False,
        ),
    ]
    tasks = [a, b, c, d, simulation, done, e, f]
    state = fixed_state(profile, tasks, blocks, START)

    assert state.busy == (
        Interval(Z(2026, 11, 2, 6, 50), Z(2026, 11, 2, 7, 40)),
        Interval(Z(2026, 11, 3, 6, 50), Z(2026, 11, 3, 8, 10)),
        Interval(Z(2026, 11, 2, 9, 50), Z(2026, 11, 2, 11, 10)),
        Interval(Z(2026, 11, 1, 9, 50), Z(2026, 11, 1, 11, 10)),
    )
    # 06:00Z is 08:00 in Israel, the wake time, so it is November 1 too.
    assert dict(state.used) == {nov(1): 30 + 60 + 30, nov(2): 30 + 60, nov(3): 60}
    assert list(state.used) == [nov(1), nov(2), nov(3)]
    assert state.simulation_days == frozenset({nov(2)})
    assert state.tasks == (
        replace(a, estimated_minutes=60),
        c,
        d,
        done,
        e,
        f,
    )
    assert dict(state.after) == {c.id: nov(2), d.id: nov(3)}
