import datetime as dt

from app.domain.gamification import Streak, streak

TODAY = dt.date(2026, 11, 16)


def d(offset: int) -> dt.date:
    return TODAY + dt.timedelta(days=offset)


def test_no_days() -> None:
    assert streak([], TODAY) == Streak(current=0, longest=0, studied_today=False)


def test_only_today() -> None:
    assert streak([TODAY], TODAY) == Streak(current=1, longest=1, studied_today=True)


def test_only_yesterday_is_still_alive() -> None:
    assert streak([d(-1)], TODAY) == Streak(current=1, longest=1, studied_today=False)


def test_two_days_ago_only_is_broken() -> None:
    assert streak([d(-2)], TODAY) == Streak(current=0, longest=1, studied_today=False)


def test_a_run_ending_yesterday() -> None:
    assert streak([d(-3), d(-2), d(-1)], TODAY) == Streak(3, 3, False)


def test_a_one_day_gap_resets() -> None:
    assert streak([d(-4), d(-3), d(-1), d(0)], TODAY) == Streak(2, 2, True)


def test_unsorted_with_duplicates() -> None:
    days = [d(0), d(-2), d(-1), d(0), d(-2), d(-1), d(-1)]
    assert streak(days, TODAY) == Streak(3, 3, True)


def test_accepts_any_iterable_once() -> None:
    assert streak(iter([d(-1), d(0)]), TODAY) == Streak(2, 2, True)


def test_future_days_are_ignored_for_current_but_count_for_longest() -> None:
    days = [d(1), d(2), d(3), d(4)]
    assert streak(days, TODAY) == Streak(current=0, longest=4, studied_today=False)


def test_future_days_do_not_extend_today() -> None:
    assert streak([d(0), d(1), d(2)], TODAY) == Streak(current=1, longest=3, studied_today=True)


def test_longest_is_across_a_gap() -> None:
    old_run = [d(-30 + i) for i in range(9)]
    assert streak([*old_run, d(-1), d(0)], TODAY) == Streak(2, 9, True)


def test_a_run_across_the_israeli_dst_dates_is_consecutive() -> None:
    spring = [dt.date(2026, 3, 26), dt.date(2026, 3, 27), dt.date(2026, 3, 28)]
    autumn = [dt.date(2026, 10, 24), dt.date(2026, 10, 25), dt.date(2026, 10, 26)]
    assert streak(spring, dt.date(2026, 3, 28)) == Streak(3, 3, True)
    assert streak(autumn, dt.date(2026, 10, 26)) == Streak(3, 3, True)
