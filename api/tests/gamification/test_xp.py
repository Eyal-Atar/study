import pytest

from app.domain.gamification import MIN_MINUTES, block_xp


def test_an_hour_at_focus_five_is_fifty() -> None:
    assert block_xp(5, 60) == 50


def test_the_formula_is_focus_times_hours_times_ten() -> None:
    assert block_xp(10, 120) == 200
    assert block_xp(1, 60) == 10
    assert block_xp(7, 90) == 105


def test_short_blocks_count_as_fifteen_minutes() -> None:
    assert MIN_MINUTES == 15
    assert block_xp(6, 1) == 15
    assert block_xp(6, 14) == 15
    assert block_xp(6, 15) == 15
    assert block_xp(6, 16) == 16


def test_rounding_is_half_to_even_like_legacy() -> None:
    assert block_xp(1, 15) == 2  # 2.5 -> 2
    assert block_xp(1, 21) == 4  # 3.5 -> 4
    assert block_xp(1, 20) == 3  # 3.33 -> 3
    assert block_xp(1, 22) == 4  # 3.67 -> 4
    assert block_xp(3, 25) == 12  # 12.5 -> 12


@pytest.mark.parametrize("focus", [0, 11, -1, True, False, 5.0, "5"])
def test_focus_outside_one_to_ten_is_rejected(focus: object) -> None:
    with pytest.raises(ValueError, match="focus"):
        block_xp(focus, 60)  # type: ignore[arg-type]


@pytest.mark.parametrize("minutes", [0, -5, True, 30.0, "30"])
def test_minutes_must_be_a_positive_int(minutes: object) -> None:
    with pytest.raises(ValueError, match="minutes"):
        block_xp(5, minutes)  # type: ignore[arg-type]
