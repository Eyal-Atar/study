import json
from typing import Any

import anthropic
import httpx2
import pytest

from app.ai.client import AiError, AnthropicAnalysisClient
from app.config import Settings

SCHEMA = {"type": "object", "properties": {"a": {"type": "string"}}}
KEY = "sk-ant-secret-key"


def _event(kind: str, data: dict[str, Any]) -> str:
    return f"event: {kind}\ndata: {json.dumps({'type': kind, **data})}\n\n"


def _sse(text: str = '{"a":"b"}') -> bytes:
    events = [
        _event(
            "message_start",
            {
                "message": {
                    "id": "msg_1",
                    "type": "message",
                    "role": "assistant",
                    "model": "test-model",
                    "content": [],
                    "stop_reason": None,
                    "stop_sequence": None,
                    "usage": {"input_tokens": 120, "output_tokens": 1},
                }
            },
        ),
        _event("content_block_start", {"index": 0, "content_block": {"type": "text", "text": ""}}),
        _event(
            "content_block_delta",
            {"index": 0, "delta": {"type": "text_delta", "text": text}},
        ),
        _event("content_block_stop", {"index": 0}),
        _event(
            "message_delta",
            {
                "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                "usage": {"output_tokens": 42},
            },
        ),
        _event("message_stop", {}),
    ]
    return "".join(events).encode()


def _client(transport: httpx2.MockTransport) -> AnthropicAnalysisClient:
    return AnthropicAnalysisClient(
        api_key=KEY,
        model="test-model",
        effort="medium",
        max_tokens=1000,
        timeout=5.0,
        http_client=anthropic.DefaultHttpxClient(transport=transport),
        max_retries=0,
    )


def _error_client(status: int, kind: str) -> AnthropicAnalysisClient:
    body = {"type": "error", "error": {"type": kind, "message": "x"}}
    return _client(httpx2.MockTransport(lambda request: httpx2.Response(status, json=body)))


def _call(client: AnthropicAnalysisClient) -> Any:
    return client.complete(
        system="sys", messages=[{"role": "user", "content": "hi"}], schema=SCHEMA
    )


def test_request_uses_the_configured_model_and_json_schema() -> None:
    bodies: list[dict[str, Any]] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        bodies.append(json.loads(request.content))
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=_sse())

    _call(_client(httpx2.MockTransport(handler)))
    body = bodies[0]
    assert body["model"] == "test-model"
    assert body["stream"] is True
    assert body["max_tokens"] == 1000
    assert body["system"] == "sys"
    assert body["output_config"]["effort"] == "medium"
    assert body["output_config"]["format"] == {"type": "json_schema", "schema": SCHEMA}
    for absent in ("tool_choice", "temperature", "thinking", "tools"):
        assert absent not in body
    assert "cache_control" not in json.dumps(body)


def test_reply_carries_text_usage_and_stop_reason() -> None:
    transport = httpx2.MockTransport(
        lambda request: httpx2.Response(
            200, headers={"content-type": "text/event-stream"}, content=_sse()
        )
    )
    result = _call(_client(transport))
    assert result.text == '{"a":"b"}'
    assert result.stop_reason == "end_turn"
    assert result.usage.model == "test-model"
    assert result.usage.input_tokens == 120
    assert result.usage.output_tokens == 42
    assert result.usage.cache_creation_input_tokens == 0
    assert result.usage.cache_read_input_tokens == 0
    assert result.content[0].type == "text"


def test_overloaded_is_ai_unavailable() -> None:
    with pytest.raises(AiError) as info:
        _call(_error_client(529, "overloaded_error"))
    assert info.value.code == "ai_unavailable"
    assert info.value.retry is True


def test_bad_request_is_ai_rejected() -> None:
    with pytest.raises(AiError) as info:
        _call(_error_client(400, "invalid_request_error"))
    assert info.value.code == "ai_rejected"
    assert info.value.retry is False


def test_auth_error_is_ai_not_configured() -> None:
    with pytest.raises(AiError) as info:
        _call(_error_client(401, "authentication_error"))
    assert info.value.code == "ai_not_configured"
    assert info.value.retry is False


def test_connection_error_is_ai_unavailable() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("down")

    with pytest.raises(AiError) as info:
        _call(_client(httpx2.MockTransport(handler)))
    assert info.value.code == "ai_unavailable"
    assert info.value.retry is True


def test_errors_log_class_and_status_only(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level("WARNING"), pytest.raises(AiError):
        _call(_error_client(529, "overloaded_error"))
    assert "OverloadedError" in caplog.text
    assert "529" in caplog.text
    assert KEY not in caplog.text


def test_repr_hides_the_key() -> None:
    assert KEY not in repr(_client(httpx2.MockTransport(lambda r: httpx2.Response(500))))


def _settings(key: str | None, model: str | None) -> Settings:
    return Settings(
        supabase_url="https://test-ref.supabase.co",
        anthropic_api_key=key,
        ai_model_analysis=model,
        _env_file=None,
    )


def test_from_settings_requires_key_and_model() -> None:
    for key, model in ((None, None), (KEY, None), (None, "test-model")):
        with pytest.raises(AiError) as info:
            AnthropicAnalysisClient.from_settings(_settings(key, model))
        assert info.value.code == "ai_not_configured"
    client = AnthropicAnalysisClient.from_settings(_settings(KEY, "test-model"))
    assert KEY not in repr(client)


@pytest.mark.parametrize(
    ("status", "kind", "code"),
    [
        (429, "rate_limit_error", "ai_unavailable"),
        (500, "api_error", "ai_unavailable"),
        (403, "permission_error", "ai_not_configured"),
    ],
)
def test_status_mapping(status: int, kind: str, code: str) -> None:
    with pytest.raises(AiError) as info:
        _call(_error_client(status, kind))
    assert info.value.code == code
    assert info.value.retry is (code == "ai_unavailable")


def test_timeout_is_ai_unavailable() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ReadTimeout("slow")

    with pytest.raises(AiError) as info:
        _call(_client(httpx2.MockTransport(handler)))
    assert info.value.code == "ai_unavailable"
    assert info.value.retry is True


def test_error_event_mid_stream_is_ai_unavailable() -> None:
    start = _sse().decode().split("event: content_block_start")[0]
    error = _event("error", {"error": {"type": "overloaded_error", "message": "x"}})
    transport = httpx2.MockTransport(
        lambda request: httpx2.Response(
            200, headers={"content-type": "text/event-stream"}, content=(start + error).encode()
        )
    )
    with pytest.raises(AiError) as info:
        _call(_client(transport))
    assert info.value.code == "ai_unavailable"
    assert info.value.retry is True
