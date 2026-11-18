"""Plan snapshots and a pure undo.

Before every change to a plan, the future PLANNED blocks are saved as a snapshot
(JSON, stored in plan_versions). `undo` computes what to delete and what to put back
to return the calendar to that snapshot, without rewriting the past and without
touching blocks the user has since finished or that have already started.
"""

import datetime as dt
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from typing import Final
from uuid import UUID

from app.domain.planner.availability import start_minute
from app.domain.planner.intervals import Interval
from app.domain.planner.model import BlockStatus, PlannerInputError, _require

SNAPSHOT_VERSION: Final = 1

_BLOCK_KEYS: Final = frozenset(
    {"id", "task_id", "starts_at", "ends_at", "part_index", "part_count", "pinned"}
)


class SnapshotError(ValueError):
    pass


def _is_int(value: object) -> bool:
    return type(value) is int


@dataclass(frozen=True, slots=True, kw_only=True)
class SnapshotBlock:
    """A calendar block as a snapshot holds it."""

    id: UUID
    task_id: UUID
    interval: Interval
    part_index: int
    part_count: int
    pinned: bool
    status: BlockStatus

    def __post_init__(self) -> None:
        _require(isinstance(self.id, UUID), "id must be a UUID")
        _require(isinstance(self.task_id, UUID), "task_id must be a UUID")
        _require(isinstance(self.interval, Interval), "interval must be an Interval")
        _require(isinstance(self.status, BlockStatus), "status must be a BlockStatus")
        _require(isinstance(self.pinned, bool), "pinned must be a bool")
        _require(_is_int(self.part_index), "part_index must be an int")
        _require(_is_int(self.part_count), "part_count must be an int")
        _require(self.part_count >= 1, "part_count must be at least 1")
        _require(1 <= self.part_index <= self.part_count, "part_index must be 1-part_count")


def _sort_key(block: SnapshotBlock) -> tuple[dt.datetime, UUID]:
    return (block.interval.start, block.id)


def snapshot(blocks: Sequence[SnapshotBlock], now: dt.datetime) -> dict[str, object]:
    """The future PLANNED blocks (those not yet over at now), ready for json.dumps."""
    start = start_minute(now)
    kept = sorted(
        (
            block
            for block in blocks
            if block.status is BlockStatus.PLANNED and block.interval.end > start
        ),
        key=_sort_key,
    )
    return {
        "v": SNAPSHOT_VERSION,
        "blocks": [
            {
                "id": str(block.id),
                "task_id": str(block.task_id),
                "starts_at": block.interval.start.isoformat(),
                "ends_at": block.interval.end.isoformat(),
                "part_index": block.part_index,
                "part_count": block.part_count,
                "pinned": block.pinned,
            }
            for block in kept
        ],
    }


def _parse_uuid(value: object, name: str) -> UUID:
    if not isinstance(value, str):
        raise SnapshotError(f"{name} must be a string")
    try:
        return UUID(value)
    except ValueError as error:
        raise SnapshotError(f"{name} is not a UUID") from error


def _parse_instant(value: object, name: str) -> dt.datetime:
    if not isinstance(value, str):
        raise SnapshotError(f"{name} must be a string")
    try:
        parsed = dt.datetime.fromisoformat(value)
    except ValueError as error:
        raise SnapshotError(f"{name} is not an ISO timestamp") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise SnapshotError(f"{name} must carry an offset")
    try:
        utc = parsed.astimezone(dt.UTC)
    except OverflowError as error:
        raise SnapshotError(f"{name} is out of range") from error
    if utc.second or utc.microsecond:
        raise SnapshotError(f"{name} must fall on a whole minute")
    return utc


def _parse_block(raw: object) -> SnapshotBlock:
    if not isinstance(raw, dict):
        raise SnapshotError("a block must be an object")
    if set(raw) != _BLOCK_KEYS:
        raise SnapshotError("a block has missing or unexpected keys")
    part_index = raw["part_index"]
    part_count = raw["part_count"]
    pinned = raw["pinned"]
    if not _is_int(part_index) or not _is_int(part_count):
        raise SnapshotError("part_index and part_count must be integers")
    if not isinstance(pinned, bool):
        raise SnapshotError("pinned must be a bool")
    try:
        return SnapshotBlock(
            id=_parse_uuid(raw["id"], "id"),
            task_id=_parse_uuid(raw["task_id"], "task_id"),
            interval=Interval(
                _parse_instant(raw["starts_at"], "starts_at"),
                _parse_instant(raw["ends_at"], "ends_at"),
            ),
            part_index=part_index,
            part_count=part_count,
            pinned=pinned,
            status=BlockStatus.PLANNED,
        )
    except (PlannerInputError, ValueError) as error:
        if isinstance(error, SnapshotError):
            raise
        raise SnapshotError(str(error)) from error


def parse_snapshot(data: object) -> tuple[SnapshotBlock, ...]:
    """The blocks of a snapshot, or SnapshotError for anything malformed."""
    if not isinstance(data, dict):
        raise SnapshotError("a snapshot must be an object")
    if set(data) != {"v", "blocks"}:
        raise SnapshotError("a snapshot must hold exactly v and blocks")
    version = data["v"]
    if not _is_int(version) or version != SNAPSHOT_VERSION:
        raise SnapshotError(f"unsupported snapshot version: {version!r}")
    blocks = data["blocks"]
    if not isinstance(blocks, list):
        raise SnapshotError("blocks must be a list")
    parsed = tuple(_parse_block(raw) for raw in blocks)
    if len({block.id for block in parsed}) != len(parsed):
        raise SnapshotError("two blocks share an id")
    return parsed


@dataclass(frozen=True, slots=True, kw_only=True)
class UndoResult:
    delete: tuple[UUID, ...]
    restore: tuple[SnapshotBlock, ...]
    dropped: tuple[SnapshotBlock, ...]


def _overlaps(a: Interval, b: Interval) -> bool:
    return a.start < b.end and b.start < a.end


def _place(block: SnapshotBlock) -> tuple[UUID, UUID, Interval, bool, BlockStatus]:
    """What the user decides about a block: everything but its numbering."""
    return (block.id, block.task_id, block.interval, block.pinned, block.status)


def undo(
    saved: Sequence[SnapshotBlock],
    current: Sequence[SnapshotBlock],
    now: dt.datetime,
    *,
    created: Collection[UUID] = (),
) -> UndoResult:
    """What to delete and restore to return the future calendar to the snapshot.

    Open blocks (PLANNED, not yet started) are the only ones undo may change. A pinned
    block of `current` is open only when it is unchanged: a saved block has the same
    id, task_id, interval, pinned and status. part_index and part_count are ignored,
    because the numbering is derived from the board (a replan renumbers a task's
    blocks when its other blocks change) and is not a user change. Any other pinned
    block was pinned, moved or created pinned by the user since the change, so it is
    closed: it is never deleted, and it blocks the saved blocks that overlap it or
    share its id. The exception is a block in `created`, the ids the version being
    undone wrote itself (free time, a defer to a chosen time): it is pinned because the
    change pinned it, so it is open while it is PLANNED and not over (also once it has
    started), even if the user has moved it since (it is part of the change being undone).

    A saved block comes back if it has not started, was not closed since (same id) and
    does not overlap a closed PLANNED or DONE block; otherwise it is dropped.
    `saved` is expected to come from parse_snapshot (unique ids).
    """
    start = start_minute(now)
    saved_places = {_place(block) for block in saved}  # only tested for membership
    made = frozenset(created)  # only tested for membership
    open_blocks: list[SnapshotBlock] = []
    closed: list[SnapshotBlock] = []
    for block in current:
        if block.status is BlockStatus.PLANNED and (
            # A block the undone version wrote is open even once it has started: free time
            # starts its session at once, and undo must still take it back.
            (block.id in made and block.interval.end > start)
            or (
                block.interval.start >= start
                and (not block.pinned or _place(block) in saved_places)
            )
        ):
            open_blocks.append(block)
        else:
            closed.append(block)
    closed_ids = {block.id for block in closed}
    blocking = [
        block.interval
        for block in closed
        if block.status in (BlockStatus.PLANNED, BlockStatus.DONE)
    ]

    returning: list[SnapshotBlock] = []
    dropped: list[SnapshotBlock] = []
    for block in sorted(saved, key=_sort_key):
        if (
            block.interval.start >= start
            and block.id not in closed_ids
            and not any(_overlaps(block.interval, other) for other in blocking)
        ):
            returning.append(block)
        else:
            dropped.append(block)

    delete = tuple(block.id for block in open_blocks if block not in returning)
    restore = tuple(block for block in returning if block not in open_blocks)
    return UndoResult(delete=delete, restore=restore, dropped=tuple(dropped))
