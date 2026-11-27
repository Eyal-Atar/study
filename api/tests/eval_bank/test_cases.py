"""Tests for the case bank schema and its validating loader (S46a Task 1)."""

import copy
import json
from pathlib import Path
from typing import Any

import pytest

from eval.bank.cases import COURSE_TYPES, CaseError, load_case, load_cases

CASE_ID = "c01_demo_case"


def _valid() -> dict[str, Any]:
    return {
        "schema": 1,
        "id": CASE_ID,
        "kind": "synthetic",
        "course": {
            "name": "Demo",
            "type": "problem_solving",
            "format": "problems",
            "language": "he",
            "exam_minutes": 180,
            "days_to_exam": 35,
            "difficulty": 3,
        },
        "materials": [
            {"path": "syllabus.pdf", "kind": "syllabus", "origin": "synthetic"},
        ],
        "profile": "full_time",
        "expect": {
            "topics": [
                {"key": "t01", "name": "One", "weight": 5},
                {"key": "t02", "name": "Two", "weight": 4},
            ],
            "missing_topic": "t02",
            "format": "problems",
            "language": "he",
            "exam_minutes": 180,
            "kinds_min": {"recall": 2},
            "must_not": [{"code": "simulation_shorter_than_ratio", "ratio": 0.5}],
        },
        "notes_code": None,
    }


def _write(tmp_path: Path, data: dict[str, Any], dirname: str = CASE_ID) -> Path:
    case_dir = tmp_path / dirname
    case_dir.mkdir(parents=True, exist_ok=True)
    path = case_dir / "case.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def test_loads_all_repo_cases() -> None:
    cases = load_cases()
    assert len(cases) == 12
    assert [c.id for c in cases] == sorted(c.id for c in cases)
    assert {c.course.type for c in cases} == set(COURSE_TYPES)
    languages = {c.course.language for c in cases}
    assert {"ar", "en"} <= languages


def test_load_cases_filters_by_kind_and_skips_root_files(tmp_path: Path) -> None:
    _write(tmp_path, _valid())
    (tmp_path / "stray.json").write_text("{}", encoding="utf-8")
    assert len(load_cases(tmp_path)) == 1
    assert load_cases(tmp_path, kinds={"real"}) == ()
    assert len(load_cases(tmp_path, kinds={"synthetic"})) == 1


def test_loads_valid_case(tmp_path: Path) -> None:
    case = load_case(_write(tmp_path, _valid()))
    assert case.id == CASE_ID
    assert case.expect.missing_topic == "t02"
    assert case.expect.kinds_min == {"recall": 2}
    assert case.dir == tmp_path / CASE_ID


def test_rejects_unknown_key_top_level(tmp_path: Path) -> None:
    data = _valid()
    data["extra"] = 1
    with pytest.raises(CaseError):
        load_case(_write(tmp_path, data))


def test_rejects_unknown_key_in_course(tmp_path: Path) -> None:
    data = _valid()
    data["course"]["extra"] = 1
    with pytest.raises(CaseError):
        load_case(_write(tmp_path, data))


def test_rejects_id_not_matching_dir(tmp_path: Path) -> None:
    with pytest.raises(CaseError):
        load_case(_write(tmp_path, _valid(), dirname="c02_other_dir"))


@pytest.mark.parametrize(
    ("where", "value"),
    [
        ("type", "nope"),
        ("format", "nope"),
        ("language", "fr"),
        ("material_kind", "nope"),
    ],
)
def test_rejects_bad_enum(tmp_path: Path, where: str, value: str) -> None:
    data = _valid()
    if where == "material_kind":
        data["materials"][0]["kind"] = value
    else:
        data["course"][where] = value
    with pytest.raises(CaseError):
        load_case(_write(tmp_path, data))


def test_rejects_bool_weight(tmp_path: Path) -> None:
    data = _valid()
    data["expect"]["topics"][0]["weight"] = True
    with pytest.raises(CaseError):
        load_case(_write(tmp_path, data))


def test_rejects_duplicate_topic_key(tmp_path: Path) -> None:
    data = _valid()
    data["expect"]["topics"][1]["key"] = "t01"
    with pytest.raises(CaseError):
        load_case(_write(tmp_path, data))


def test_rejects_missing_topic_not_in_topics(tmp_path: Path) -> None:
    data = _valid()
    data["expect"]["missing_topic"] = "t09"
    with pytest.raises(CaseError):
        load_case(_write(tmp_path, data))


@pytest.mark.parametrize("bad", ["../x.pdf", "/abs.pdf"])
def test_rejects_path_escape(tmp_path: Path, bad: str) -> None:
    data = _valid()
    data["materials"][0]["path"] = bad
    with pytest.raises(CaseError):
        load_case(_write(tmp_path, data))


def test_check_files_requires_existing_material(tmp_path: Path) -> None:
    path = _write(tmp_path, copy.deepcopy(_valid()))
    load_case(path)
    with pytest.raises(CaseError):
        load_case(path, check_files=True)
    (path.parent / "syllabus.pdf").write_bytes(b"%PDF")
    load_case(path, check_files=True)


def test_error_message_has_no_case_text(tmp_path: Path) -> None:
    secret = "x" * 500
    data = _valid()
    data["expect"]["topics"][0]["name"] = secret
    with pytest.raises(CaseError) as info:
        load_case(_write(tmp_path, data))
    assert secret not in str(info.value)
    assert CASE_ID in str(info.value)
