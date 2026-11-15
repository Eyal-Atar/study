"""Output schema of the course analysis: the Pydantic models are the single
source, ``output_schema()`` derives the JSON schema sent to the API."""

import json
import unicodedata
from typing import Annotated, Any, Final, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
    field_validator,
)

from app.domain.materials import normalize_text

AiTaskKind = Literal["learn", "practice", "review", "simulation", "simulation_review"]

MAX_REPORTED_ERRORS: Final = 20

# Keys the structured-outputs JSON schema does not accept (or that only add noise).
_UNSUPPORTED_KEYS: Final = frozenset(
    {
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "minLength",
        "maxLength",
        "pattern",
        "minItems",
        "maxItems",
        "title",
        "default",
        "description",
    }
)

_TopicKey = Annotated[str, StringConstraints(pattern=r"^T[1-9][0-9]{0,2}$")]
_TaskKey = Annotated[str, StringConstraints(pattern=r"^K[1-9][0-9]{0,2}$")]
_MaterialKey = Annotated[str, StringConstraints(pattern=r"^M[1-9][0-9]{0,1}$")]

_NO_NEWLINE_FIELDS: Final = frozenset({"name", "title", "topic"})


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    @field_validator("*", mode="before")
    @classmethod
    def _clean_text(cls, value: Any, info: Any) -> Any:
        if not isinstance(value, str):
            return value
        text = normalize_text(value)
        for char in text:
            if char != "\n" and unicodedata.category(char) == "Cc":
                raise ValueError("control character")
        if "\n" in text and info.field_name in _NO_NEWLINE_FIELDS:
            raise ValueError("newline in single-line field")
        return text


class TopicOut(_Model):
    key: _TopicKey
    name: Annotated[str, Field(min_length=1, max_length=120)]
    weight: Annotated[int, Field(ge=1, le=5)]
    evidence: Annotated[str, Field(max_length=500)]


class TaskOut(_Model):
    key: _TaskKey
    title: Annotated[str, Field(min_length=1, max_length=200)]
    kind: AiTaskKind
    topic_key: _TopicKey | None
    minutes: Annotated[int, Field(ge=5, le=600)]
    focus: Annotated[int, Field(ge=1, le=10)]
    depends_on: _TaskKey | None
    material_key: _MaterialKey | None
    reason: Annotated[str, Field(max_length=300)]


class GapOut(_Model):
    topic: Annotated[str, Field(min_length=1, max_length=120)]
    note: Annotated[str, Field(max_length=300)]


class AnalysisOutput(_Model):
    topics: Annotated[list[TopicOut], Field(max_length=40)]
    tasks: Annotated[list[TaskOut], Field(min_length=1, max_length=150)]
    gaps: Annotated[list[GapOut], Field(max_length=20)]


def _clean_schema(node: Any, *, in_properties: bool = False) -> Any:
    if isinstance(node, list):
        return [_clean_schema(item) for item in node]
    if not isinstance(node, dict):
        return node
    cleaned: dict[str, Any] = {}
    for key, value in node.items():
        # Inside "properties" the keys are field names, not schema keywords.
        if not in_properties and key in _UNSUPPORTED_KEYS:
            continue
        cleaned[key] = _clean_schema(
            value, in_properties=(key in ("properties", "$defs") and not in_properties)
        )
    if not in_properties and cleaned.get("type") == "object":
        cleaned["additionalProperties"] = False
        cleaned["required"] = list(cleaned.get("properties", {}))
    return cleaned


def output_schema() -> dict[str, Any]:
    """JSON schema for ``output_config.format``, derived from ``AnalysisOutput``."""
    schema: dict[str, Any] = _clean_schema(AnalysisOutput.model_json_schema())
    return schema


def parse_output(text: str) -> AnalysisOutput | list[str]:
    """Parse the model's reply; errors carry locations and types, never values."""
    try:
        data = json.loads(text)
    except ValueError, RecursionError:
        return ["invalid_json"]
    try:
        return AnalysisOutput.model_validate(data)
    except ValidationError as exc:
        errors = []
        for err in exc.errors():
            # The key of an unexpected field is model-provided text: mask it.
            loc = [str(part) for part in err["loc"]]
            if err["type"] == "extra_forbidden" and loc:
                loc[-1] = "(extra)"
            errors.append(f"{'.'.join(loc) or '(root)'}: {err['type']}")
        return errors[:MAX_REPORTED_ERRORS]
