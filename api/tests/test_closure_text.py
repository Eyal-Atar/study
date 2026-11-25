"""The exam closure push text and payload."""

import json
from uuid import UUID

from app.domain.closure_text import closure_payload, closure_text

EXAM_ID = UUID("11111111-2222-3333-4444-555555555555")


def test_the_text_is_exact() -> None:
    text = closure_text("Probability")
    assert text.title == "You made it through Probability."
    assert text.body == "Tell me what to do with it, and I'll sort out what comes next."


def test_a_long_name_is_cut_at_eighty_characters() -> None:
    text = closure_text("x" * 200)
    assert text.title == f"You made it through {'x' * 79}…."


def test_a_hebrew_name_is_kept_as_is() -> None:
    assert closure_text("  הסתברות  ").title == "You made it through הסתברות."


def test_the_payload_is_compact_json_with_the_exam_tag() -> None:
    raw = closure_payload(EXAM_ID, closure_text("הסתברות"))
    assert json.loads(raw) == {
        "title": "You made it through הסתברות.",
        "body": "Tell me what to do with it, and I'll sort out what comes next.",
        "url": "/today",
        "tag": f"exam-closure:{EXAM_ID}",
    }
    assert "הסתברות" in raw.decode("utf-8")
    assert b": " not in raw
