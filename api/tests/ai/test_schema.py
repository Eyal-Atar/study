# ruff: noqa: RUF001
import json
from pathlib import Path
from typing import Any

import pytest

from app.ai.schema import AnalysisOutput, output_schema, parse_output
from tests.ai.samples import valid_output, valid_output_dict

_REMOVED = {
    "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength",
    "maxLength", "pattern", "minItems", "maxItems", "default", "description",
}  # fmt: skip


def _parse(data: dict[str, Any]) -> AnalysisOutput | list[str]:
    return parse_output(json.dumps(data, ensure_ascii=False))


def _with_task(**changes: object) -> dict[str, Any]:
    data = valid_output_dict()
    data["tasks"][3].update(changes)
    return data


def test_valid_response_parses() -> None:
    assert _parse(valid_output_dict()) == valid_output()


def test_invalid_json() -> None:
    assert parse_output("{nope") == ["invalid_json"]


def test_extra_field_is_rejected() -> None:
    data = valid_output_dict()
    data["extra"] = 1
    assert _parse(data) == ["(extra): extra_forbidden"]


def test_extra_key_name_does_not_leak() -> None:
    data = valid_output_dict()
    data["tasks"][0]["SECRETKEY"] = 1
    errors = _parse(data)
    assert errors == ["tasks.0.(extra): extra_forbidden"]
    assert all("SECRETKEY" not in e for e in errors)


def test_minutes_too_large() -> None:
    assert _parse(_with_task(minutes=601)) == ["tasks.3.minutes: less_than_equal"]


def test_focus_zero() -> None:
    assert _parse(_with_task(focus=0)) == ["tasks.3.focus: greater_than_equal"]


@pytest.mark.parametrize("key", ["K0", "X1"])
def test_bad_task_key(key: str) -> None:
    assert _parse(_with_task(key=key)) == ["tasks.3.key: string_pattern_mismatch"]


@pytest.mark.parametrize("title", ["שורה\nשורה", "פעמון\x07"])
def test_title_with_newline_or_control_char(title: str) -> None:
    assert _parse(_with_task(title=title)) == ["tasks.3.title: value_error"]


def test_nul_is_normalized_and_kept() -> None:
    result = _parse(_with_task(title="תר\x00גול"))
    assert isinstance(result, AnalysisOutput)
    assert result.tasks[3].title == "תרגול"


def test_newline_allowed_in_reason() -> None:
    result = _parse(_with_task(reason="א\nב"))
    assert isinstance(result, AnalysisOutput)


def test_errors_do_not_contain_values() -> None:
    errors = _parse(_with_task(title="סוד\x07"))
    assert isinstance(errors, list)
    assert all("סוד" not in e for e in errors)


def test_errors_are_capped() -> None:
    data = valid_output_dict()
    data["tasks"] = [dict(data["tasks"][0], minutes=1000)] * 60
    errors = _parse(data)
    assert isinstance(errors, list)
    assert len(errors) == 20


def test_output_schema_matches_fixture() -> None:
    expected = json.loads((Path(__file__).parent / "output_schema.json").read_text("utf-8"))
    assert output_schema() == expected


def test_output_schema_is_deterministic_and_clean() -> None:
    assert json.dumps(output_schema()) == json.dumps(output_schema())

    def walk(node: object) -> None:
        if isinstance(node, dict):
            if node.get("type") == "object":
                assert node["additionalProperties"] is False
                assert node["required"] == list(node["properties"])
            for key, value in node.items():
                if key in ("properties", "$defs"):
                    for sub in value.values():
                        walk(sub)
                    continue
                assert key not in _REMOVED and key != "title"
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(output_schema())
    task = output_schema()["$defs"]["TaskOut"]["properties"]
    assert "title" in task
