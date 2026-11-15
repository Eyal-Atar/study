from typing import Any

import pytest

from app.ai.schema import AnalysisOutput
from app.domain.analysis import (
    TrimResult,
    budget_range,
    trim_to_budget,
    validate_analysis,
)
from app.domain.materials import MaterialKind
from tests.ai.samples import MATERIALS, valid_output, valid_output_dict


def _task(key: str, kind: str = "learn", **kw: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "key": key, "title": "משימה", "kind": kind, "topic_key": "T1", "minutes": 60,
        "focus": 5, "depends_on": None, "material_key": None, "reason": "",
    }  # fmt: skip
    base.update(kw)
    return base


def _out(tasks: list[dict[str, Any]], weights: dict[str, int] | None = None) -> AnalysisOutput:
    weights = weights or {"T1": 3}
    topics = [{"key": k, "name": "נושא", "weight": w, "evidence": ""} for k, w in weights.items()]
    return AnalysisOutput.model_validate({"topics": topics, "tasks": tasks, "gaps": []})


def _mutated(index: int, **changes: Any) -> AnalysisOutput:
    data = valid_output_dict()
    data["tasks"][index].update(changes)
    return AnalysisOutput.model_validate(data)


def _errors(output: AnalysisOutput, materials: dict[str, MaterialKind] | None = None) -> list[str]:
    return validate_analysis(output, materials=MATERIALS if materials is None else materials)


def test_valid_output_has_no_errors() -> None:
    assert _errors(valid_output()) == []


def test_budget_range() -> None:
    assert budget_range(420) == (378, 462)
    assert budget_range(101) == (90, 112)


def test_duplicate_key() -> None:
    data = valid_output_dict()
    data["tasks"][2]["key"] = "K1"
    assert "duplicate_key:K1" in _errors(AnalysisOutput.model_validate(data))


def test_unknown_topic() -> None:
    assert "unknown_topic:K2->T9" in _errors(_mutated(1, topic_key="T9"))


def test_unknown_dependency() -> None:
    assert "unknown_dependency:K4->K40" in _errors(_mutated(3, depends_on="K40"))


def test_self_dependency() -> None:
    assert _errors(_mutated(3, depends_on="K4")) == ["self_dependency:K4"]


def test_dependency_cycle() -> None:
    data = valid_output_dict()
    data["tasks"][1]["depends_on"] = "K3"
    data["tasks"][2]["depends_on"] = "K2"
    errors = _errors(AnalysisOutput.model_validate(data))
    assert errors == ["dependency_cycle:K2,K3"]


def test_unknown_material() -> None:
    assert "unknown_material:K2->M7" in _errors(_mutated(1, material_key="M7"))


def test_title_not_hebrew() -> None:
    assert _errors(_mutated(1, title="Limits")) == ["title_not_hebrew:K2"]


@pytest.mark.parametrize("kind", ["learn", "practice"])
def test_missing_topic(kind: str) -> None:
    index = 1 if kind == "learn" else 3
    assert _errors(_mutated(index, topic_key=None)) == [f"missing_topic:K{index + 1}"]


@pytest.mark.parametrize(("index", "minutes"), [(1, 20), (1, 91), (6, 29), (5, 301)])
def test_minutes_out_of_range(index: int, minutes: int) -> None:
    assert _errors(_mutated(index, minutes=minutes)) == [f"minutes_out_of_range:K{index + 1}"]


def test_simulation_minutes_up_to_300_allowed() -> None:
    assert _errors(_mutated(5, minutes=300)) == []


def test_missing_review_task() -> None:
    data = valid_output_dict()
    data["tasks"][0]["kind"] = "learn"
    data["tasks"][0]["topic_key"] = "T1"
    assert _errors(AnalysisOutput.model_validate(data)) == ["missing_review_task"]


def test_missing_simulation() -> None:
    materials = {**MATERIALS, "M3": MaterialKind.PAST_EXAM}
    assert _errors(valid_output(), materials) == ["missing_simulation:M3"]


def test_simulation_without_review() -> None:
    data = valid_output_dict()
    data["tasks"].append(_task("K8", "simulation", minutes=60, topic_key=None, material_key="M2"))
    errors = _errors(AnalysisOutput.model_validate(data))
    assert errors == ["simulation_without_review:K8"]


def test_review_without_simulation() -> None:
    data = valid_output_dict()
    data["tasks"].append(_task("K9", "simulation_review", topic_key=None, depends_on="K2"))
    assert _errors(AnalysisOutput.model_validate(data)) == ["review_without_simulation:K9"]


def test_material_on_wrong_kind() -> None:
    assert _errors(_mutated(5, material_key="M1")) == [
        "material_on_wrong_kind:K6->M1",
        "missing_simulation:M2",
    ]


def test_unexpected_simulation_with_past_exam() -> None:
    data = valid_output_dict()
    data["tasks"].append(_task("K8", "simulation", topic_key=None, material_key=None))
    data["tasks"].append(_task("K9", "simulation_review", topic_key=None, depends_on="K8"))
    assert _errors(AnalysisOutput.model_validate(data)) == ["unexpected_simulation:K8"]


def test_no_past_exam_allows_one_generic_simulation() -> None:
    tasks = [
        _task("K1", "review", topic_key=None),
        _task("K2", "simulation", topic_key=None),
        _task("K3", "simulation_review", topic_key=None, depends_on="K2"),
    ]
    materials = {"M1": MaterialKind.SYLLABUS}
    assert _errors(_out(tasks), materials) == []
    tasks += [
        _task("K4", "simulation", topic_key=None),
        _task("K5", "simulation_review", topic_key=None, depends_on="K4"),
    ]
    assert _errors(_out(tasks), materials) == ["unexpected_simulation:K4"]


def test_no_materials_allows_generic_simulation() -> None:
    tasks = [
        _task("K1", "simulation", topic_key=None),
        _task("K2", "simulation_review", topic_key=None, depends_on="K1"),
    ]
    assert _errors(_out(tasks), {}) == []


def test_errors_are_capped_and_value_free() -> None:
    tasks = [_task(f"K{i}", title="Eng", topic_key="T9") for i in range(1, 40)]
    errors = _errors(_out(tasks), {})
    assert len(errors) == 20


# trimming


def _practice(key: str, topic: str, minutes: int = 60, **kw: Any) -> dict[str, Any]:
    return _task(key, "practice", topic_key=topic, minutes=minutes, **kw)


def test_within_range_is_unchanged() -> None:
    result = trim_to_budget(valid_output(), 420)
    assert isinstance(result, TrimResult)
    assert result.output is not None
    assert result.dropped == ()
    assert result.total_minutes == 420
    assert result.output == valid_output()


def test_under_budget_is_not_an_error() -> None:
    result = trim_to_budget(valid_output(), 5000)
    assert isinstance(result, TrimResult)
    assert result.dropped == ()


def test_over_budget_drops_low_weight_practice_first() -> None:
    # 420 minutes, budget 300 -> hi = 330: drop K5 (weight 1, 45), then K4 (weight 5, 45)
    result = trim_to_budget(valid_output(), 300)
    assert isinstance(result, TrimResult)
    assert result.dropped == ("K5", "K4")
    assert result.total_minutes == 330
    assert [t.key for t in result.output.tasks] == ["K1", "K2", "K3", "K6", "K7"]


def test_tie_drops_the_later_task() -> None:
    out = _out([_task("K1"), _practice("K2", "T1"), _practice("K3", "T1")], {"T1": 2})
    result = trim_to_budget(out, 150)  # total 180, hi 165
    assert isinstance(result, TrimResult)
    assert result.dropped == ("K3",)


def test_trim_never_drops_a_task_others_depend_on() -> None:
    out = _out([_task("K1"), _practice("K2", "T1"), _task("K3", depends_on="K2")], {"T1": 1})
    assert trim_to_budget(out, 100) == ["over_budget:180>110"]


def test_trim_reconsiders_after_each_drop() -> None:
    out = _out(
        [
            _practice("K1", "T2"),
            _practice("K2", "T1", depends_on="K1"),
            _task("K3", topic_key="T2"),
        ],
        {"T1": 1, "T2": 5},
    )
    # total 180; budget 100 -> hi 110. K1 is protected until K2 drops.
    result = trim_to_budget(out, 100)
    assert isinstance(result, TrimResult)
    assert result.dropped == ("K2", "K1")
    assert result.total_minutes == 60


def test_still_over_budget_is_an_error() -> None:
    assert trim_to_budget(valid_output(), 100) == ["over_budget:330>110"]
