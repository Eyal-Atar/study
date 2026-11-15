"""The Claude client behind a Protocol. The API key and the prompt never reach logs or errors."""

import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

import anthropic
import httpx2

from app.config import Settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Usage:
    model: str
    input_tokens: int
    output_tokens: int
    cache_creation_input_tokens: int
    cache_read_input_tokens: int


@dataclass(frozen=True)
class AnalysisReply:
    text: str | None
    stop_reason: str | None
    usage: Usage
    content: Any  # response.content as is, for the retry turn
    request_id: str | None


class AiError(Exception):
    def __init__(self, code: str, *, retry: bool = False) -> None:
        super().__init__(code)
        self.code = code
        self.retry = retry


class AnalysisClient(Protocol):
    def complete(
        self,
        *,
        system: str,
        messages: Sequence[Mapping[str, Any]],
        schema: Mapping[str, Any],
    ) -> AnalysisReply: ...


def _log(error: Exception, status: int | None, request_id: str | None) -> None:
    logger.warning(
        "claude call failed: %s status=%s request_id=%s", type(error).__name__, status, request_id
    )


class AnthropicAnalysisClient:
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        effort: str,
        max_tokens: int,
        timeout: float,
        http_client: httpx2.Client | None = None,
        max_retries: int = 2,
    ) -> None:
        self._model = model
        self._effort = effort
        self._max_tokens = max_tokens
        self._client = anthropic.Anthropic(
            api_key=api_key, timeout=timeout, max_retries=max_retries, http_client=http_client
        )

    def __repr__(self) -> str:
        return f"AnthropicAnalysisClient(model={self._model!r}, effort={self._effort!r})"

    @classmethod
    def from_settings(cls, settings: Settings) -> AnthropicAnalysisClient:
        if settings.anthropic_api_key is None or not settings.ai_model_analysis:
            raise AiError("ai_not_configured")
        return cls(
            api_key=settings.anthropic_api_key.get_secret_value(),
            model=settings.ai_model_analysis,
            effort=settings.ai_analysis_effort,
            max_tokens=settings.ai_analysis_max_tokens,
            timeout=settings.ai_timeout_seconds,
        )

    def complete(
        self,
        *,
        system: str,
        messages: Sequence[Mapping[str, Any]],
        schema: Mapping[str, Any],
    ) -> AnalysisReply:
        try:
            with self._client.messages.stream(
                model=self._model,
                max_tokens=self._max_tokens,
                system=system,
                messages=list(messages),  # type: ignore[arg-type]
                output_config={  # type: ignore[arg-type]
                    "effort": self._effort,
                    "format": {"type": "json_schema", "schema": dict(schema)},
                },
            ) as stream:
                message = stream.get_final_message()
                request_id = stream.request_id
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as error:
            _log(error, error.status_code, error.request_id)
            raise AiError("ai_not_configured") from None
        except anthropic.APIStatusError as error:
            _log(error, error.status_code, error.request_id)
            status = error.status_code
            if status == 429 or status >= 500:
                raise AiError("ai_unavailable", retry=True) from None
            raise AiError("ai_rejected") from None
        except anthropic.APIConnectionError as error:  # includes APITimeoutError
            _log(error, None, None)
            raise AiError("ai_unavailable", retry=True) from None

        text = next((block.text for block in message.content if block.type == "text"), None)
        usage = message.usage
        return AnalysisReply(
            text=text,
            stop_reason=message.stop_reason,
            usage=Usage(
                model=message.model,
                input_tokens=usage.input_tokens,
                output_tokens=usage.output_tokens,
                cache_creation_input_tokens=usage.cache_creation_input_tokens or 0,
                cache_read_input_tokens=usage.cache_read_input_tokens or 0,
            ),
            content=message.content,
            request_id=request_id,
        )
