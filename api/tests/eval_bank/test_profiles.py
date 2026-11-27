"""Tests for the profile library (S46a Task 2)."""

import copy
import datetime as dt
import json
from pathlib import Path
from typing import Any

import pytest

from app.domain.planner import Exam, Profile, exam_budgets, study_days, sunday_weekday
from eval.bank.boards import build_boards
from eval.bank.cases import load_cases
from eval.bank.clock import NOW, TZ, stable_id
from eval.bank.metrics import day_capacity
from eval.bank.profiles import ProfileError, load_profiles, profile_by_id

IDS = [
    "full_time",
    "worker",
    "reservist",
    "parent",
    "night_owl",
    "late_starter_4d",
    "early_8w",
    "marathon",
    "moed_b",
    "adhd",
    "extra_time",
]


def _by_id(profile_id: str) -> Any:
    return profile_by_id(load_profiles(), profile_id)


def _file(tmp_path: Path, mutate: Any) -> Path:
    data = json.loads(Path(__file__).parents[2].joinpath("eval/profiles.json").read_text())
    data = copy.deepcopy(data)
    mutate(data["profiles"][0])
    path = tmp_path / "profiles.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def test_loads_eleven_profiles_in_file_order() -> None:
    assert [p.id for p in load_profiles()] == IDS


def test_profiles_build_valid_planner_profiles() -> None:
    for p in load_profiles():
        assert isinstance(p.profile, Profile)
        assert p.profile.timezone == TZ


def test_worker_commitments() -> None:
    commitments = _by_id("worker").profile.commitments
    assert [c.weekday for c in commitments] == [0, 2, 4]
    assert all(c.start == dt.time(8) and c.end == dt.time(18) for c in commitments)
    assert all(c.valid_from == NOW.date() for c in commitments)


def test_worker_shift_days_are_bound_by_their_windows() -> None:
    # study_days of the domain itself: on Sunday, Tuesday and Thursday the shift leaves
    # 18:00-21:00 (180 minutes) of the windows, below the daily cap of 240, and between 120
    # and 200; the other days keep 08:30-21:00.
    worker = _by_id("worker").profile
    exam = Exam(id=stable_id("x"), exam_date=NOW.date() + dt.timedelta(days=28), difficulty=3)
    days = [d for d in study_days(worker, [exam], NOW) if d.windows]
    shift = [d for d in days if sunday_weekday(d.date) in (0, 2, 4)]
    assert shift
    for day in shift:
        minutes = sum(w.minutes for w in day.windows)
        assert minutes == 180
        assert 120 <= minutes <= 200 < worker.daily_study_minutes
    assert all(sum(w.minutes for w in d.windows) == 750 for d in days if d not in shift)


def test_worker_has_days_below_its_cap() -> None:
    (board,) = build_boards(_reference_cases(), (), [_by_id("worker")], fills=(1.0,))
    capacity = day_capacity(board)
    assert any(minutes < 240 for minutes in capacity.values())


def _reference_cases() -> list[Any]:
    return [case for case in load_cases() if case.id.startswith("s01")]


def test_no_two_profiles_measure_the_same() -> None:
    # On a reference case, no two non-gap profiles give the same per-day capacities and the
    # same exam budgets: each profile measures something of its own. adhd and extra_time
    # are documented copies of full_time (their gaps are not in the planner yet).
    seen: dict[object, str] = {}
    for eval_profile in load_profiles():
        if eval_profile.gap is not None:
            continue
        (board,) = build_boards(_reference_cases(), (), [eval_profile], fills=(1.0,))
        budgets = exam_budgets(board.profile, board.exams, board.now)
        # The budgets in exam order: exam ids differ from profile to profile.
        key = (
            tuple(sorted(day_capacity(board).items())),
            tuple(budgets[exam.id] for exam in board.exams),
        )
        assert key not in seen, (eval_profile.id, seen.get(key))
        seen[key] = eval_profile.id
    assert len(seen) == 9


def test_reservist_busy_is_fourteen_local_days() -> None:
    busy = _by_id("reservist").profile.busy
    assert len(busy) == 1
    start = dt.datetime(2026, 12, 13, tzinfo=TZ)
    assert busy[0].start == start
    assert busy[0].end - busy[0].start == dt.timedelta(days=14)
    assert busy[0].end == dt.datetime(2026, 12, 27, tzinfo=TZ)
    assert busy[0].start.utcoffset() == dt.timedelta(0)


def test_parent_has_daily_commitments() -> None:
    assert len(_by_id("parent").profile.commitments) == 7


def test_marathon_timeline() -> None:
    assert _by_id("marathon").timeline.exam_offsets_days == (7, 13, 19, 24, 30, 35)


def test_moed_b_timeline() -> None:
    t = _by_id("moed_b").timeline
    assert (t.days_to_exam, t.sitting) == (21, "moed_b")
    assert _by_id("full_time").timeline.sitting == "a"


def test_gap_profiles() -> None:
    adhd, extra = _by_id("adhd"), _by_id("extra_time")
    assert (adhd.gap, adhd.gap_value) == ("max_block_minutes", 25)
    assert (extra.gap, extra.gap_value) == ("exam_extra_time_percent", 25)
    assert _by_id("full_time").gap is None


def test_rejects_unknown_key(tmp_path: Path) -> None:
    path = _file(tmp_path, lambda p: p.update({"mystery": 1}))
    with pytest.raises(ProfileError, match="full_time") as info:
        load_profiles(path)
    # The message names the id and field, never the offending key.
    assert "mystery" not in str(info.value)


def test_rejects_bad_time(tmp_path: Path) -> None:
    path = _file(tmp_path, lambda p: p.update({"wake": "25:99"}))
    with pytest.raises(ProfileError, match="wake"):
        load_profiles(path)


def test_unknown_profile_id() -> None:
    with pytest.raises(ProfileError):
        profile_by_id(load_profiles(), "nope")


def test_every_case_profile_exists() -> None:
    profiles = load_profiles()
    for case in load_cases():
        assert profile_by_id(profiles, case.profile).id == case.profile


def test_study_days_exist() -> None:
    exam = Exam(id=stable_id("x"), exam_date=NOW.date() + dt.timedelta(days=28), difficulty=3)
    for p in load_profiles():
        days = study_days(p.profile, [exam], NOW)
        assert any(d.windows for d in days), p.id
