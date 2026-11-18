"""The timetable parser's schema, prompt, validation and the two-call loop (no network)."""

import base64
import json
from typing import Any

import pytest

from app.ai.client import AiError, AnthropicAnalysisClient
from app.ai.timetable import (
    MAX_COMMITMENTS,
    SYSTEM_PROMPT,
    TimetableFailed,
    TimetableItem,
    TimetableUnreadable,
    check_output,
    file_block,
    output_schema,
    run_timetable,
)
from app.config import Settings
from tests.ai.fake_client import FakeAnalysisClient, reply

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
PDF = b"%PDF-1.7\n" + b"\x00" * 16
KEY = "sk-ant-secret-key"


def _item(**fields: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "title": "מבוא להסתברות - הרצאה",
        "kind": "class",
        "weekday": 0,
        "start": "10:15",
        "end": "11:45",
    }
    return base | fields


def _text(*items: dict[str, Any], readable: bool = True) -> str:
    return json.dumps({"readable": readable, "commitments": list(items)}, ensure_ascii=False)


# --- schema -----------------------------------------------------------------------------


def _walk(node: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if isinstance(node, dict):
        found.append(node)
        for key, value in node.items():
            if key != "properties":
                found.extend(_walk(value))
            else:
                for child in value.values():
                    found.extend(_walk(child))
    elif isinstance(node, list):
        for child in node:
            found.extend(_walk(child))
    return found


def test_schema_has_no_keywords_the_api_refuses() -> None:
    schema = output_schema()
    refused = {"minimum", "maximum", "minLength", "maxLength", "maxItems", "pattern"}
    for node in _walk(schema):
        assert not refused & set(node)
        if node.get("type") == "object":
            assert node["additionalProperties"] is False
            assert node["required"] == list(node["properties"])


def test_schema_names_the_fields_and_kinds() -> None:
    text = json.dumps(output_schema())
    for name in ("readable", "commitments", "title", "kind", "weekday", "start", "end"):
        assert f'"{name}"' in text
    for kind in ("work", "class", "other"):
        assert f'"{kind}"' in text


def test_prompt_states_the_rules() -> None:
    for phrase in ("Sunday", "ראשון", "data", "readable", "15", str(MAX_COMMITMENTS), "תרגול"):
        assert phrase in SYSTEM_PROMPT


# --- validation -------------------------------------------------------------------------


def test_valid_output_is_sorted_by_day_then_start_and_titles_are_stripped() -> None:
    result = check_output(
        _text(
            _item(weekday=2, start="08:30", end="10:00"),
            _item(title="  משמרת בקפה  ", kind="work", weekday=0, start="16:50", end="18:20"),
            _item(weekday=0, start="10:15", end="11:45"),
        )
    )
    assert isinstance(result, tuple)
    assert [(i.weekday, i.start) for i in result] == [(0, "10:15"), (0, "16:50"), (2, "08:30")]
    assert result[1] == TimetableItem(
        title="משמרת בקפה", kind="work", weekday=0, start="16:50", end="18:20"
    )
    assert result[1].to_json() == {
        "title": "משמרת בקפה",
        "kind": "work",
        "weekday": 0,
        "start": "16:50",
        "end": "18:20",
    }


def test_exact_duplicates_are_dropped() -> None:
    result = check_output(_text(_item(), _item(), _item(title=" מבוא להסתברות - הרצאה")))
    assert isinstance(result, tuple)
    assert len(result) == 1


def test_a_course_that_meets_twice_stays_two_items() -> None:
    result = check_output(_text(_item(weekday=0), _item(weekday=3)))
    assert isinstance(result, tuple)
    assert len(result) == 2


def test_crossing_midnight_is_allowed() -> None:
    result = check_output(_text(_item(kind="work", start="22:00", end="02:00")))
    assert isinstance(result, tuple)


@pytest.mark.parametrize(
    "text",
    [
        _text(readable=False),
        _text(_item(), readable=False),
        _text(),
    ],
)
def test_unreadable_or_empty_is_unreadable(text: str) -> None:
    assert check_output(text) is TimetableUnreadable


@pytest.mark.parametrize(
    ("fields", "error"),
    [
        ({"weekday": 7}, "commitments.0.weekday: less_than_equal"),
        ({"weekday": -1}, "commitments.0.weekday: greater_than_equal"),
        ({"kind": "lecture"}, "commitments.0.kind: literal_error"),
        ({"start": "9:00"}, "commitments.0.start: invalid_time"),
        ({"start": "24:00"}, "commitments.0.start: invalid_time"),
        ({"end": "10:15:00"}, "commitments.0.end: invalid_time"),
        ({"end": "10:60"}, "commitments.0.end: invalid_time"),
        ({"start": "10:00", "end": "10:00"}, "commitments.0: same_start_end"),
        ({"start": "10:00", "end": "10:10"}, "commitments.0: too_short"),
        ({"title": "   "}, "commitments.0.title: empty"),
        ({"title": "א" * 101}, "commitments.0.title: too_long"),
        ({"title": "a\nb"}, "commitments.0.title: control_character"),
        ({"title": "a\x07b"}, "commitments.0.title: control_character"),
    ],
)
def test_invalid_items_give_codes_with_the_index(fields: dict[str, Any], error: str) -> None:
    result = check_output(_text(_item(start="08:00", end="09:00"), _item(**fields)))
    assert isinstance(result, list)
    assert error.replace("commitments.0", "commitments.1") in result


def test_title_of_100_chars_after_strip_is_fine() -> None:
    result = check_output(_text(_item(title=f"  {'א' * 100}  ")))
    assert isinstance(result, tuple)


def test_errors_never_carry_model_text() -> None:
    raw = json.dumps(
        {
            "readable": True,
            "commitments": [_item(start="HACKED", extra_HACKED="x")],
            "HACKED_KEY": 1,
        }
    )
    result = check_output(raw)
    assert isinstance(result, list)
    assert result
    assert all("HACKED" not in error for error in result)


def test_too_many_items() -> None:
    items = [_item(start=f"{8 + i % 12:02d}:00", end=f"{8 + i % 12:02d}:30") for i in range(61)]
    result = check_output(_text(*items))
    assert result == ["commitments: too_long"]


def test_not_json() -> None:
    assert check_output("not json") == ["invalid_json"]
    assert check_output("[1, 2]") == ["(root): model_type"]


# --- the file block ---------------------------------------------------------------------


def test_image_block() -> None:
    block = file_block(PNG, "image/png")
    assert block == {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": "image/png",
            "data": base64.standard_b64encode(PNG).decode("ascii"),
        },
    }


def test_pdf_goes_as_a_document_block() -> None:
    block = file_block(PDF, "application/pdf")
    assert block["type"] == "document"
    assert block["source"]["media_type"] == "application/pdf"
    assert base64.standard_b64decode(block["source"]["data"]) == PDF


def test_other_types_are_refused() -> None:
    with pytest.raises(ValueError, match="not a timetable type"):
        file_block(b"GIF89a", "image/gif")


# --- the loop ---------------------------------------------------------------------------


def test_one_valid_reply_is_one_call() -> None:
    client = FakeAnalysisClient([reply(_text(_item()))])
    draft = run_timetable(client, PNG, "image/png")
    assert len(draft.commitments) == 1
    assert draft.model == "test-model"
    assert len(draft.usage) == 1
    (call,) = client.calls
    assert call["system"] == SYSTEM_PROMPT
    assert call["schema"] == output_schema()
    (message,) = call["messages"]
    assert message["role"] == "user"
    image, text = message["content"]
    assert image == file_block(PNG, "image/png")
    assert text["type"] == "text"


def test_an_invalid_reply_is_retried_once_with_the_errors() -> None:
    first = reply(_text(_item(weekday=9)))
    client = FakeAnalysisClient([first, reply(_text(_item()))])
    draft = run_timetable(client, PDF, "application/pdf")
    assert len(draft.commitments) == 1
    assert len(draft.usage) == 2
    retry = client.calls[1]["messages"]
    assert retry[0] == client.calls[0]["messages"][0]
    assert retry[1] == {"role": "assistant", "content": first.content}
    assert retry[2]["role"] == "user"
    assert "commitments.0.weekday: less_than_equal" in retry[2]["content"]


def test_two_invalid_replies_fail_as_invalid() -> None:
    client = FakeAnalysisClient([reply("nope"), reply(_text(_item(start="25:00")))])
    with pytest.raises(TimetableFailed) as info:
        run_timetable(client, PNG, "image/png")
    assert info.value.code == "timetable_invalid"
    assert info.value.retry is False
    assert len(info.value.usage) == 2


def test_a_truncated_reply_is_retried() -> None:
    client = FakeAnalysisClient(
        [reply('{"readable": true', stop_reason="max_tokens"), reply(_text(_item()))]
    )
    draft = run_timetable(client, PNG, "image/png")
    assert "response_truncated" in client.calls[1]["messages"][2]["content"]
    assert len(draft.usage) == 2


def test_unreadable_is_not_retried() -> None:
    client = FakeAnalysisClient([reply(_text(readable=False))])
    with pytest.raises(TimetableFailed) as info:
        run_timetable(client, PNG, "image/png")
    assert info.value.code == "timetable_unreadable"
    assert len(client.calls) == 1
    assert len(info.value.usage) == 1


def test_refusal() -> None:
    client = FakeAnalysisClient([reply("", stop_reason="refusal")])
    with pytest.raises(TimetableFailed) as info:
        run_timetable(client, PNG, "image/png")
    assert info.value.code == "ai_refused"
    assert len(info.value.usage) == 1


@pytest.mark.parametrize(
    ("error", "retry"),
    [
        (AiError("ai_unavailable", retry=True), True),
        (AiError("ai_no_credit"), False),
        (AiError("ai_not_configured"), False),
        (AiError("ai_rejected"), False),
    ],
)
def test_ai_errors_keep_their_code_and_the_usage_so_far(error: AiError, retry: bool) -> None:
    client = FakeAnalysisClient([reply("nope"), error])
    with pytest.raises(TimetableFailed) as info:
        run_timetable(client, PNG, "image/png")
    assert info.value.code == error.code
    assert info.value.retry is retry
    assert len(info.value.usage) == 1


# --- the client for the timetable -------------------------------------------------------


def _settings(**fields: Any) -> Settings:
    return Settings(supabase_url="https://test-ref.supabase.co", _env_file=None, **fields)


def test_timetable_client_needs_the_key_and_its_own_model() -> None:
    for fields in (
        {},
        {"anthropic_api_key": KEY},
        {"anthropic_api_key": KEY, "ai_model_analysis": "analysis-model"},
        {"ai_model_timetable": "timetable-model"},
    ):
        with pytest.raises(AiError) as info:
            AnthropicAnalysisClient.for_timetable(_settings(**fields))
        assert info.value.code == "ai_not_configured"


def test_timetable_client_uses_the_timetable_settings() -> None:
    settings = _settings(
        anthropic_api_key=KEY,
        ai_model_analysis="analysis-model",
        ai_model_timetable="timetable-model",
        ai_timetable_effort="high",
        ai_timetable_max_tokens=1234,
        ai_max_retries=1,
    )
    client = AnthropicAnalysisClient.for_timetable(settings)
    assert client.model == "timetable-model"
    assert client._effort == "high"
    assert client._max_tokens == 1234
    assert client._client.max_retries == 1
    assert KEY not in repr(client)
