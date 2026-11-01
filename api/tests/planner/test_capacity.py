import pytest

from app.domain.planner import day_fits, room, simulation_window

ROOM_CASES: list[tuple[list[int], list[int], int | None, int]] = [
    ([480], [], None, 480),
    ([480], [120], None, 330),
    ([60, 60], [], None, 50),
    ([], [], None, 0),
    ([200], [], 180, 0),
    ([100], [], 200, 0),
]


def test_empty_day() -> None:
    assert day_fits([480], []) is True
    assert day_fits([], []) is True
    assert day_fits([], [30]) is False


def test_single_item_uses_the_whole_window() -> None:
    assert day_fits([60], [60]) is True
    assert day_fits([60], [61]) is False


def test_breaks_and_the_long_break() -> None:
    assert day_fits([100], [45, 45]) is False  # needs 120
    assert day_fits([120], [45, 45]) is True


def test_long_break_needs_two_blocks() -> None:
    assert day_fits([70], [60]) is True
    assert day_fits([80], [30, 30]) is False
    assert day_fits([90], [30, 30]) is True


def test_each_extra_window_reserves_70_minutes() -> None:
    assert day_fits([60, 60], [50]) is True
    assert day_fits([60, 60], [51]) is False


def test_simulation_window_is_the_smallest_that_holds_it() -> None:
    assert simulation_window([180, 240], 200) == 1
    assert simulation_window([240, 180], 180) == 1
    assert simulation_window([200, 200], 200) == 0
    assert simulation_window([100], 200) is None


def test_simulation_with_other_items() -> None:
    assert day_fits([180, 240], [60], 180) is True
    assert day_fits([200], [30], 180) is False
    assert day_fits([230], [30], 180) is False
    assert day_fits([250], [30], 180) is True


def test_room() -> None:
    for windows, minutes, simulation, expected in ROOM_CASES:
        assert room(windows, minutes, simulation) == expected


@pytest.mark.parametrize(
    ("windows", "minutes", "simulation", "expected"),
    [case for case in ROOM_CASES if case[3] > 0],
)
def test_room_is_the_exact_limit(
    windows: list[int], minutes: list[int], simulation: int | None, expected: int
) -> None:
    assert day_fits(windows, [*minutes, expected], simulation) is True
    assert day_fits(windows, [*minutes, expected + 1], simulation) is False
