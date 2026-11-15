"""The Claude client behind a Protocol. The API key and the prompt never reach logs or errors."""

import logging
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol, cast

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
        keepalive: Callable[[], None] | None = None,
    ) -> AnalysisReply: ...


def _log(error: Exception, status: int | None, request_id: str | None) -> None:
    logger.warning(
        "claude call failed: %s status=%s request_id=%s", type(error).__name__, status, request_id
    )


def _error_field(body: object, name: str) -> object:
    """A field of body["error"], or None when the body is not shaped like an API error."""
    if not isinstance(body, dict):
        return None
    inner = body.get("error")
    return inner.get(name) if isinstance(inner, dict) else None


def _is_no_credit(error: anthropic.APIStatusError, status: int, error_type: object) -> bool:
    if isinstance(
        error, (anthropic.EnforcedSpendLimitReachedError, anthropic.OrganizationOnHoldError)
    ):
        return True
    if status == 402 or error_type == "billing_error":
        return True
    if status == 400:
        message = _error_field(error.body, "message")
        return isinstance(message, str) and "credit balance" in message.lower()
    return False


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
            max_retries=settings.ai_max_retries,
        )

    def complete(
        self,
        *,
        system: str,
        messages: Sequence[Mapping[str, Any]],
        schema: Mapping[str, Any],
        keepalive: Callable[[], None] | None = None,
    ) -> AnalysisReply:
        try:
            with self._client.messages.stream(
                model=self._model,
                max_tokens=self._max_tokens,
                system=system,
                messages=cast("list[anthropic.types.MessageParam]", list(messages)),
                output_config=cast(
                    "anthropic.types.OutputConfigParam",
                    {
                        "effort": self._effort,
                        "format": {"type": "json_schema", "schema": dict(schema)},
                    },
                ),
            ) as stream:
                # The API sends ping events during long thinking, so a live request keeps
                # calling keepalive.
                for _event in stream:
                    if keepalive is not None:
                        keepalive()
                message = stream.get_final_message()
                request_id = stream.request_id
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as error:
            _log(error, error.status_code, error.request_id)
            raise AiError("ai_not_configured") from None
        except anthropic.APIStatusError as error:
            status = error.status_code
            error_type = _error_field(error.body, "type")
            if _is_no_credit(error, status, error_type):
                # Not the student's fault and not temporary: whoever runs the service must see it.
                logger.error(
                    "claude account has no credit: %s status=%s request_id=%s",
                    type(error).__name__,
                    status,
                    error.request_id,
                )
                raise AiError("ai_no_credit") from None
            _log(error, status, error.request_id)
            # An error event inside a stream arrives as a 200 response.
            if (
                status == 429
                or status >= 500
                or status < 400
                or error_type in ("overloaded_error", "api_error", "rate_limit_error")
            ):
                raise AiError("ai_unavailable", retry=True) from None
            raise AiError("ai_rejected") from None
        except anthropic.APIConnectionError as error:  # includes APITimeoutError
            _log(error, None, None)
            raise AiError("ai_unavailable", retry=True) from None
        except anthropic.APIError as error:
            _log(error, None, None)
            raise AiError("ai_rejected") from None

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
