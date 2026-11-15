"""A realistic valid analysis, shared by the schema, domain and service tests."""

from typing import Any

from app.ai.schema import AnalysisOutput
from app.domain.materials import MaterialKind

MATERIALS: dict[str, MaterialKind] = {
    "M1": MaterialKind.SYLLABUS,
    "M2": MaterialKind.PAST_EXAM,
}


def _task(
    key: str, title: str, kind: str, topic: str | None, minutes: int, **extra: Any
) -> dict[str, Any]:
    return {
        "key": key,
        "title": title,
        "kind": kind,
        "topic_key": topic,
        "minutes": minutes,
        "focus": extra.pop("focus", 6),
        "depends_on": extra.pop("depends_on", None),
        "material_key": extra.pop("material_key", None),
        "reason": extra.pop("reason", "חשוב למבחן"),
    }


def valid_output_dict() -> dict[str, Any]:
    return {
        "topics": [
            {"key": "T1", "name": "גבולות", "weight": 5, "evidence": "מועד א 2025 שאלה 1"},
            {"key": "T2", "name": "נגזרות", "weight": 3, "evidence": "מועד א 2025 שאלה 2"},
            {"key": "T3", "name": "אינטגרלים", "weight": 1, "evidence": ""},
        ],
        "tasks": [
            _task("K1", "סקירת הסילבוס", "review", None, 45, material_key="M1"),
            _task("K2", "למידת גבולות", "learn", "T1", 60),
            _task("K3", "למידת נגזרות", "learn", "T2", 60),
            _task("K4", "תרגול גבולות", "practice", "T1", 45),
            _task("K5", "תרגול אינטגרלים", "practice", "T3", 45),
            _task("K6", "סימולציית מבחן", "simulation", None, 120, material_key="M2"),
            _task("K7", "תחקיר הסימולציה", "simulation_review", None, 45, depends_on="K6"),
        ],
        "gaps": [{"topic": "טורים", "note": "לא מופיע בחומרים"}],
    }


def valid_output() -> AnalysisOutput:
    return AnalysisOutput.model_validate(valid_output_dict())
