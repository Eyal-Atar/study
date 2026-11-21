"""The push that asks how an exam went (S45). Pure, like the block reminder text."""

import json
from typing import Final
from uuid import UUID

from app.domain.notifications import EXAM_NAME_MAX_CHARS, REMINDER_URL, ReminderText, _truncate

CLOSURE_BODY: Final = "How did it feel? Tell me, and I'll sort out what comes next."


def closure_text(exam_name: str) -> ReminderText:
    """Archi's evening line. The name is shown as stored (Hebrew stays Hebrew), cut at 80."""
    return ReminderText(
        title=f"You made it through {_truncate(exam_name, EXAM_NAME_MAX_CHARS)}.",
        body=CLOSURE_BODY,
    )


def closure_payload(exam_id: UUID, text: ReminderText) -> bytes:
    """The JSON the service worker reads; the tag replaces an earlier push for this exam."""
    data = {
        "title": text.title,
        "body": text.body,
        "url": REMINDER_URL,
        "tag": f"exam-closure:{exam_id}",
    }
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
