import pytest

from app.domain.gamification import BADGES, Badge, BadgeGroup, Stats, earned, level_for

ORDER = [
    "first_task",
    "task_master_10",
    "task_master_20",
    "task_master_50",
    "task_master_100",
    "iron_will_7",
    "iron_will_10",
    "iron_will_14",
    "iron_will_30",
    "iron_will_100",
    "knowledge_seeker_5",
    "knowledge_seeker_10",
    "knowledge_seeker_20",
    "knowledge_seeker_25",
    "knowledge_seeker_50",
    "xp_1000",
    "xp_5000",
    "xp_10000",
]

NONE = Stats(total_xp=0, blocks_done=0, longest_streak=0)


def test_order_and_count() -> None:
    assert [b.key for b in BADGES] == ORDER
    assert len(BADGES) == 18
    assert len({b.key for b in BADGES}) == 18


def test_groups_and_thresholds() -> None:
    assert BADGES[0] == Badge("first_task", BadgeGroup.FIRST, 1)
    for badge in BADGES:
        assert badge.key.endswith(str(badge.threshold)) or badge.key == "first_task"
    groups = [b.group for b in BADGES]
    assert groups == (
        [BadgeGroup.FIRST]
        + [BadgeGroup.BLOCKS] * 4
        + [BadgeGroup.STREAK] * 5
        + [BadgeGroup.LEVEL] * 5
        + [BadgeGroup.XP] * 3
    )


def test_group_values() -> None:
    assert [g.value for g in BadgeGroup] == ["first", "blocks", "streak", "level", "xp"]


def test_removed_badges_are_absent() -> None:
    keys = {b.key for b in BADGES}
    assert not keys & {"streak_broken_once", "first_login", "week_streak"}


def test_nothing_earned_at_zero() -> None:
    assert earned(NONE) == frozenset()


def _stats_at(badge: Badge, value: int) -> Stats:
    match badge.group:
        case BadgeGroup.FIRST | BadgeGroup.BLOCKS:
            return Stats(total_xp=0, blocks_done=value, longest_streak=0)
        case BadgeGroup.STREAK:
            return Stats(total_xp=0, blocks_done=0, longest_streak=value)
        case BadgeGroup.LEVEL:
            # The smallest XP of level `value` is (value - 1) * 1000.
            return Stats(total_xp=(value - 1) * 1000, blocks_done=0, longest_streak=0)
        case BadgeGroup.XP:
            return Stats(total_xp=value, blocks_done=0, longest_streak=0)


@pytest.mark.parametrize("badge", BADGES, ids=[b.key for b in BADGES])
def test_each_threshold_and_just_below(badge: Badge) -> None:
    at = _stats_at(badge, badge.threshold)
    below = _stats_at(badge, badge.threshold - 1)
    assert badge.key in earned(at)
    if badge.group is BadgeGroup.LEVEL:
        assert level_for(at.total_xp - 1) == badge.threshold - 1
        below = Stats(total_xp=at.total_xp - 1, blocks_done=0, longest_streak=0)
    assert badge.key not in earned(below)


def test_a_whole_set() -> None:
    stats = Stats(total_xp=5000, blocks_done=20, longest_streak=7)
    assert earned(stats) == frozenset(
        {
            "first_task",
            "task_master_10",
            "task_master_20",
            "iron_will_7",
            "knowledge_seeker_5",
            "xp_1000",
            "xp_5000",
        }
    )


def test_everything_at_the_top() -> None:
    stats = Stats(total_xp=10**9, blocks_done=10**6, longest_streak=10**4)
    assert earned(stats) == frozenset(ORDER)
