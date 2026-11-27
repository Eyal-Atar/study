"""Tests for the profile library (S46a Task 2)."""

import copy
import datetime as dt
import json
from pathlib import Path
from typing import Any

import pytest

from app.domain.planner import Exam, Profile, study_days
from eval.bank.cases import load_cases
from eval.bank.clock import NOW, TZ, stable_id
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
    assert all(c.start == dt.time(16) and c.end == dt.time(22) for c in commitments)
    assert all(c.valid_from == NOW.date() for c in commitments)


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
