from collections.abc import Callable, Mapping, Sequence
from typing import Any

from app.ai.client import AiError, AnalysisReply, Usage


def reply(
    text: str,
    *,
    stop_reason: str = "end_turn",
    input_tokens: int = 1000,
    output_tokens: int = 500,
) -> AnalysisReply:
    return AnalysisReply(
        text=text,
        stop_reason=stop_reason,
        usage=Usage(
            model="test-model",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_creation_input_tokens=0,
            cache_read_input_tokens=0,
        ),
        content=[{"type": "text", "text": text}],
        request_id="req_test",
    )


class FakeAnalysisClient:
    def __init__(self, replies: Sequence[AnalysisReply | AiError]) -> None:
        self._replies = list(replies)
        self.calls: list[dict[str, Any]] = []

    def complete(
        self,
        *,
        system: str,
        messages: Sequence[Mapping[str, Any]],
        schema: Mapping[str, Any],
        keepalive: Callable[[], None] | None = None,
    ) -> AnalysisReply:
        self.calls.append({"system": system, "messages": list(messages), "schema": schema})
        if len(self.calls) > len(self._replies):
            raise AssertionError("FakeAnalysisClient was called more often than it has replies")
        if keepalive is not None:
            keepalive()
        item = self._replies[len(self.calls) - 1]
        if isinstance(item, AiError):
            raise item
        return item
