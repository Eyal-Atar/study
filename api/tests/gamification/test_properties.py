"""Invariants of the streak and the badges, for every input the strategies produce."""

import datetime as dt

from hypothesis import given
from hypothesis import strategies as st

from app.domain.gamification import Stats, earned, streak

TODAY = dt.date(2026, 11, 16)

days_around_today = st.lists(
    st.integers(min_value=-60, max_value=10).map(lambda n: TODAY + dt.timedelta(days=n)),
    max_size=60,
)
stats = st.builds(
    Stats,
    total_xp=st.integers(min_value=0, max_value=60_000),
    blocks_done=st.integers(min_value=0, max_value=150),
    longest_streak=st.integers(min_value=0, max_value=150),
)
bump = st.integers(min_value=0, max_value=60_000)


@given(days_around_today)
def test_longest_is_at_least_current(days: list[dt.date]) -> None:
    result = streak(days, TODAY)
    assert result.longest >= result.current


@given(days_around_today)
def test_current_is_at_most_the_distinct_days_up_to_today(days: list[dt.date]) -> None:
    result = streak(days, TODAY)
    assert result.current <= len({day for day in days if day <= TODAY})
    assert result.studied_today == (TODAY in days)


@given(days_around_today)
def test_order_and_duplicates_do_not_matter(days: list[dt.date]) -> None:
    assert streak(days, TODAY) == streak(sorted(set(days), reverse=True), TODAY)


@given(stats, bump)
def test_earned_is_monotone_in_total_xp(base: Stats, extra: int) -> None:
    more = Stats(base.total_xp + extra, base.blocks_done, base.longest_streak)
    assert earned(base) <= earned(more)


@given(stats, bump)
def test_earned_is_monotone_in_blocks_done(base: Stats, extra: int) -> None:
    more = Stats(base.total_xp, base.blocks_done + extra, base.longest_streak)
    assert earned(base) <= earned(more)


@given(stats, bump)
def test_earned_is_monotone_in_longest_streak(base: Stats, extra: int) -> None:
    more = Stats(base.total_xp, base.blocks_done, base.longest_streak + extra)
    assert earned(base) <= earned(more)
