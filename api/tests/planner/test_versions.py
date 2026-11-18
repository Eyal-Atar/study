import json
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest

from app.domain.planner import (
    SNAPSHOT_VERSION,
    BlockStatus,
    Interval,
    PlannerInputError,
    SnapshotBlock,
    SnapshotError,
    UndoResult,
    parse_snapshot,
    snapshot,
    undo,
)


def at(h: int, m: int = 0, day: int = 2) -> datetime:
    return datetime(2026, 11, day, h, m, tzinfo=UTC)


def block(
    start: int,
    end: int,
    *,
    id: UUID | None = None,
    status: BlockStatus = BlockStatus.PLANNED,
    pinned: bool = False,
    task_id: UUID | None = None,
    part_index: int = 1,
    part_count: int = 1,
) -> SnapshotBlock:
    return SnapshotBlock(
        id=id or uuid4(),
        task_id=task_id or uuid4(),
        interval=Interval(at(start), at(end)),
        part_index=part_index,
        part_count=part_count,
        pinned=pinned,
        status=status,
    )


def moved(b: SnapshotBlock, start: int, end: int, **changes: Any) -> SnapshotBlock:
    fields: dict[str, Any] = {
        "id": b.id,
        "task_id": b.task_id,
        "part_index": b.part_index,
        "part_count": b.part_count,
        "pinned": b.pinned,
        "status": b.status,
    }
    fields.update(changes)
    return SnapshotBlock(interval=Interval(at(start), at(end)), **fields)


def test_snapshot_version() -> None:
    assert SNAPSHOT_VERSION == 1


def test_snapshot_block_validates_like_the_planner_types() -> None:
    good = block(7, 8)
    with pytest.raises(PlannerInputError):
        moved(good, 7, 8, id="not-a-uuid")
    with pytest.raises(PlannerInputError):
        moved(good, 7, 8, task_id="not-a-uuid")
    with pytest.raises(PlannerInputError):
        moved(good, 7, 8, status="planned")
    with pytest.raises(PlannerInputError):
        moved(good, 7, 8, pinned=1)
    with pytest.raises(PlannerInputError):
        moved(good, 7, 8, part_count=0)
    with pytest.raises(PlannerInputError):
        moved(good, 7, 8, part_index=0)
    with pytest.raises(PlannerInputError):
        moved(good, 7, 8, part_index=3, part_count=2)
    with pytest.raises(PlannerInputError):
        moved(good, 7, 8, part_index=True)
    with pytest.raises(PlannerInputError):
        SnapshotBlock(
            id=good.id,
            task_id=good.task_id,
            interval=(at(7), at(8)),  # type: ignore[arg-type]
            part_index=1,
            part_count=1,
            pinned=False,
            status=BlockStatus.PLANNED,
        )


def test_snapshot_keeps_future_planned_blocks() -> None:
    now = at(9)
    done = block(10, 11, status=BlockStatus.DONE)
    missed = block(10, 11, status=BlockStatus.MISSED)
    ended = block(7, 9)
    running = block(8, 10)
    locked = block(12, 13, pinned=True)
    data = snapshot([locked, done, missed, ended, running], now)
    blocks = data["blocks"]
    assert isinstance(blocks, list)
    assert [b["id"] for b in blocks] == [str(running.id), str(locked.id)]


def test_snapshot_orders_by_start_then_id() -> None:
    now = at(6)
    low, high = sorted([uuid4(), uuid4()], key=lambda u: u)
    late = block(12, 13)
    a = block(8, 9, id=high)
    b = block(8, 9, id=low)
    data = snapshot([late, a, b], now)
    blocks = data["blocks"]
    assert isinstance(blocks, list)
    assert [x["id"] for x in blocks] == [str(low), str(high), str(late.id)]


def test_snapshot_format() -> None:
    b = SnapshotBlock(
        id=UUID("00000000-0000-0000-0000-000000000001"),
        task_id=UUID("00000000-0000-0000-0000-000000000002"),
        interval=Interval(
            datetime(2026, 11, 1, 7, tzinfo=UTC), datetime(2026, 11, 1, 8, tzinfo=UTC)
        ),
        part_index=2,
        part_count=3,
        pinned=True,
        status=BlockStatus.PLANNED,
    )
    assert snapshot([b], datetime(2026, 11, 1, 6, tzinfo=UTC)) == {
        "v": 1,
        "blocks": [
            {
                "id": "00000000-0000-0000-0000-000000000001",
                "task_id": "00000000-0000-0000-0000-000000000002",
                "starts_at": "2026-11-01T07:00:00+00:00",
                "ends_at": "2026-11-01T08:00:00+00:00",
                "part_index": 2,
                "part_count": 3,
                "pinned": True,
            }
        ],
    }


def test_snapshot_round_trips_through_json() -> None:
    now = at(6)
    blocks = [block(8, 9, pinned=True, part_index=1, part_count=2), block(10, 11)]
    data = snapshot(blocks, now)
    assert parse_snapshot(json.loads(json.dumps(data))) == tuple(blocks)


def _valid_block() -> dict[str, Any]:
    return {
        "id": str(uuid4()),
        "task_id": str(uuid4()),
        "starts_at": "2026-11-02T07:00:00+00:00",
        "ends_at": "2026-11-02T08:00:00+00:00",
        "part_index": 1,
        "part_count": 1,
        "pinned": False,
    }


def _without(key: str) -> dict[str, Any]:
    b = _valid_block()
    del b[key]
    return b


def _with(**changes: object) -> dict[str, Any]:
    return {**_valid_block(), **changes}


@pytest.mark.parametrize(
    "data",
    [
        None,
        [],
        "x",
        {"v": 2, "blocks": []},
        {"v": True, "blocks": []},
        {"v": 1},
        {"v": 1, "blocks": [], "extra": 1},
        {"v": 1, "blocks": {}},
        {"v": 1, "blocks": ["x"]},
        {"v": 1, "blocks": [_without("task_id")]},
        {"v": 1, "blocks": [_with(extra=1)]},
        {"v": 1, "blocks": [_with(starts_at="2026-11-02T07:00:00")]},
        {"v": 1, "blocks": [_with(starts_at="garbage")]},
        {"v": 1, "blocks": [_with(starts_at=5)]},
        {"v": 1, "blocks": [_with(starts_at="2026-11-02T07:00:30+00:00")]},
        {"v": 1, "blocks": [_with(ends_at="2026-11-02T06:00:00+00:00")]},
        {"v": 1, "blocks": [_with(part_index=0)]},
        {"v": 1, "blocks": [_with(part_index=True)]},
        {"v": 1, "blocks": [_with(part_count="1")]},
        {"v": 1, "blocks": [_with(pinned=1)]},
        {"v": 1, "blocks": [_with(id="nope")]},
        {"v": 1, "blocks": [_with(id=5)]},
        {"v": 1, "blocks": [_with(task_id=None)]},
        {"v": 1, "blocks": [_with(starts_at="0001-01-01T00:00:00+05:00")]},
        {"v": 1, "blocks": [_with(ends_at="9999-12-31T23:59:00-05:00")]},
        {
            "v": 1,
            "blocks": [
                _with(id="00000000-0000-0000-0000-000000000001"),
                _with(id="00000000-0000-0000-0000-000000000001"),
            ],
        },
    ],
)
def test_parse_rejects_bad_snapshots(data: object) -> None:
    with pytest.raises(SnapshotError):
        parse_snapshot(data)


def test_parse_converts_offsets_to_utc() -> None:
    data = {
        "v": 1,
        "blocks": [
            _with(starts_at="2026-11-02T09:00:00+02:00", ends_at="2026-11-02T10:00:00+02:00")
        ],
    }
    (parsed,) = parse_snapshot(data)
    assert parsed.interval == Interval(at(7), at(8))
    assert parsed.interval.start.tzinfo is UTC
    assert parsed.status is BlockStatus.PLANNED


def test_undo_restores_the_saved_blocks() -> None:
    saved = block(7, 8)
    current = moved(saved, 10, 11, id=uuid4())
    result = undo([saved], [current], at(6))
    assert result == UndoResult(delete=(current.id,), restore=(saved,), dropped=())


def test_undo_leaves_identical_blocks_alone() -> None:
    saved = block(7, 8)
    result = undo([saved], [moved(saved, 7, 8)], at(6))
    assert result == UndoResult(delete=(), restore=(), dropped=())


def test_undo_restores_a_block_that_changed_in_place() -> None:
    saved = block(7, 8)
    current = moved(saved, 9, 10)
    result = undo([saved], [current], at(6))
    assert result.delete == (current.id,)
    assert result.restore == (saved,)


def test_undo_does_not_rewrite_the_past() -> None:
    saved = block(8, 9)
    started = block(8, 9)
    result = undo([saved], [started], at(8, 30))
    assert result.dropped == (saved,)
    assert result.delete == ()
    assert result.restore == ()


def test_undo_skips_a_slot_taken_by_a_done_block() -> None:
    saved = block(10, 12)
    done = block(11, 13, status=BlockStatus.DONE)
    result = undo([saved], [done], at(11, 30))
    assert result.dropped == (saved,)
    assert result.restore == ()


def test_undo_touching_a_closed_block_is_not_an_overlap() -> None:
    saved = block(12, 13)
    done = block(10, 12, status=BlockStatus.DONE)
    result = undo([saved], [done], at(11))
    assert result.restore == (saved,)
    assert result.dropped == ()


def test_undo_skips_a_block_completed_since() -> None:
    saved = block(12, 13)
    done = moved(saved, 12, 13, status=BlockStatus.DONE)
    result = undo([saved], [done], at(6))
    assert result.dropped == (saved,)
    assert result.delete == ()
    assert result.restore == ()


def test_undo_ignores_a_missed_block_overlap() -> None:
    saved = block(12, 13)
    missed = block(12, 13, status=BlockStatus.MISSED)
    result = undo([saved], [missed], at(6))
    assert result.restore == (saved,)


def test_undo_removes_blocks_added_since() -> None:
    added = block(12, 13)
    result = undo([], [added], at(6))
    assert result == UndoResult(delete=(added.id,), restore=(), dropped=())


def test_undo_orders_the_output() -> None:
    first, second = block(8, 9), block(10, 11)
    cur_a, cur_b = block(14, 15), block(13, 14)
    result = undo([second, first], [cur_a, cur_b], at(6))
    assert result.delete == (cur_a.id, cur_b.id)
    assert result.restore == (first, second)


def test_undo_skips_a_block_that_is_now_missed() -> None:
    saved = block(12, 13)
    missed = moved(saved, 12, 13, status=BlockStatus.MISSED)
    result = undo([saved], [missed], at(6))
    assert result == UndoResult(delete=(), restore=(), dropped=(saved,))


def test_undo_orders_dropped_by_start_then_id() -> None:
    low, high = sorted([uuid4(), uuid4()])
    late = block(9, 10)
    a = block(8, 9, id=high)
    b = block(8, 9, id=low)
    result = undo([late, a, b], [], at(10))
    assert result.dropped == (b, a, late)


def test_undo_drops_a_started_saved_block_and_deletes_the_open_one_with_its_id() -> None:
    saved = block(7, 8)
    current = moved(saved, 12, 13)
    result = undo([saved], [current], at(7, 30))
    assert result.dropped == (saved,)
    assert result.delete == (current.id,)
    assert result.restore == ()


def test_undo_keeps_a_block_pinned_since_the_change() -> None:
    saved = block(12, 13)
    pinned = moved(saved, 12, 13, pinned=True)
    result = undo([saved], [pinned], at(6))
    assert result == UndoResult(delete=(), restore=(), dropped=(saved,))


def test_undo_keeps_a_block_moved_and_pinned_since_the_change() -> None:
    saved = block(12, 13)
    pinned = moved(saved, 14, 15, pinned=True)
    result = undo([saved], [pinned], at(6))
    assert result == UndoResult(delete=(), restore=(), dropped=(saved,))


def test_undo_keeps_a_pinned_block_created_since_the_change() -> None:
    pinned = block(12, 13, pinned=True)
    result = undo([], [pinned], at(6))
    assert result == UndoResult(delete=(), restore=(), dropped=())


def test_undo_drops_a_saved_block_that_overlaps_a_new_pinned_block() -> None:
    saved = block(12, 13)
    pinned = block(12, 14, pinned=True)
    result = undo([saved], [pinned], at(6))
    assert result == UndoResult(delete=(), restore=(), dropped=(saved,))


def test_undo_treats_a_pinned_block_as_saved_like_any_open_block() -> None:
    saved = block(12, 13, pinned=True)
    other = block(9, 10, pinned=True)
    unchanged = undo([saved], [moved(saved, 12, 13)], at(6))
    assert unchanged == UndoResult(delete=(), restore=(), dropped=())
    gone = undo([saved, other], [moved(saved, 12, 13)], at(6))
    assert gone == UndoResult(delete=(), restore=(other,), dropped=())


def test_undo_ignores_the_numbering_of_a_pinned_block() -> None:
    saved = block(12, 13, pinned=True, part_index=1, part_count=2)
    renumbered = moved(saved, 12, 13, part_index=1, part_count=1)
    result = undo([saved], [renumbered], at(6))
    assert result == UndoResult(delete=(renumbered.id,), restore=(saved,), dropped=())


# Decision 12: blocks the version itself created (free time, defer to a chosen time)
# are pinned, but undoing the version removes them.


def test_undo_deletes_a_pinned_block_the_version_created() -> None:
    saved = block(12, 13)
    created = block(9, 10, pinned=True)
    result = undo([saved], [created], at(6), created=[created.id])
    assert result == UndoResult(delete=(created.id,), restore=(saved,), dropped=())


def test_undo_deletes_a_created_block_the_user_moved_since() -> None:
    created = block(9, 10, pinned=True)
    moved_since = moved(created, 14, 15)
    result = undo([], [moved_since], at(6), created=[created.id])
    assert result == UndoResult(delete=(created.id,), restore=(), dropped=())


def test_undo_takes_back_a_created_block_that_started() -> None:
    # Free time starts its session at once: undo a few minutes later must still remove it,
    # or the task would keep the session and get its saved blocks back too.
    created = block(9, 10, pinned=True)
    result = undo([], [created], at(9, 30), created=[created.id])
    assert result == UndoResult(delete=(created.id,), restore=(), dropped=())


def test_undo_keeps_a_created_block_that_is_over() -> None:
    created = block(9, 10, pinned=True)
    result = undo([], [created], at(10, 30), created=[created.id])
    assert result == UndoResult(delete=(), restore=(), dropped=())


def test_undo_keeps_a_created_block_that_is_done() -> None:
    created = block(9, 10, pinned=True, status=BlockStatus.DONE)
    result = undo([], [created], at(6), created=[created.id])
    assert result == UndoResult(delete=(), restore=(), dropped=())


def test_undo_keeps_other_pinned_blocks_closed() -> None:
    created = block(9, 10, pinned=True)
    other = block(12, 13, pinned=True)
    result = undo([], [created, other], at(6), created=[created.id])
    assert result == UndoResult(delete=(created.id,), restore=(), dropped=())
