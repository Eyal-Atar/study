import pytest

from app.domain.gamification import MAX_LEVEL, XP_PER_LEVEL, level_bounds, level_for


@pytest.mark.parametrize(
    ("total_xp", "level"),
    [
        (0, 1),
        (999, 1),
        (1000, 2),
        (1999, 2),
        (2000, 3),
        (48999, 49),
        (49000, 50),
        (49999, 50),
        (50000, 50),
        (10**12, 50),
    ],
)
def test_level_boundaries(total_xp: int, level: int) -> None:
    assert level_for(total_xp) == level


def test_constants() -> None:
    assert XP_PER_LEVEL == 1000
    assert MAX_LEVEL == 50


def test_negative_xp_is_rejected() -> None:
    with pytest.raises(ValueError, match="total_xp"):
        level_for(-1)


def test_level_bounds() -> None:
    assert level_bounds(1) == (0, 1000)
    assert level_bounds(2) == (1000, 2000)
    assert level_bounds(49) == (48000, 49000)
    assert level_bounds(50) == (49000, None)


def test_level_bounds_agree_with_level_for() -> None:
    for level in range(1, MAX_LEVEL + 1):
        start, nxt = level_bounds(level)
        assert level_for(start) == level
        if nxt is not None:
            assert level_for(nxt - 1) == level
            assert level_for(nxt) == level + 1


@pytest.mark.parametrize("level", [0, 51, -1])
def test_level_bounds_outside_range_is_rejected(level: int) -> None:
    with pytest.raises(ValueError, match="level"):
        level_bounds(level)
