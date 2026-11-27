"""Tests for the task lists: synthetic, saved and Moed B (S46a Task 3)."""

import json
import math
import re
from pathlib import Path
from typing import Any

from app.ai.schema import AnalysisOutput
from app.domain.analysis import trim_to_budget
from app.domain.moed_b import SourceTask, SourceTopic, build_moed_b_tasks
from app.domain.planner import TaskKind, TaskStatus
from eval.bank import tasklists
from eval.bank.cases import Case, load_cases
from eval.bank.clock import stable_id
from eval.bank.paths import SAVED_RUNS_FILE
from eval.bank.tasklists import (
    ListTask,
    ListTopic,
    TaskList,
    export_saved_runs,
    load_saved_runs,
    moed_b_list,
    scale_saved,
    synthetic_list,
)

FORBIDDEN_TEXT = ("משימה ראשונה", "נימוק שלא יודפס", "שם נושא סודי", "evidence text", "M1")
HEBREW = re.compile("[֐-׿]")


def _case(case_id: str) -> Case:
    return next(c for c in load_cases() if c.id.startswith(case_id))


def _total(task_list: TaskList) -> int:
    return sum(t.minutes for t in task_list.tasks)


def test_synthetic_recipe_counts() -> None:
    case = _case("s03")
    lst = synthetic_list(case, 3000, 1.0)
    assert lst.id == f"{case.id}:f100"
    assert lst.source == "synthetic"
    assert lst.course_type == case.course.type
    assert lst.exam_minutes == 120
    assert lst.budget == 3000
    kinds = [t.kind for t in lst.tasks]
    assert kinds.count(TaskKind.REVIEW) == 1
    sims = [t for t in lst.tasks if t.kind is TaskKind.SIMULATION]
    assert [t.minutes for t in sims] == [120, 120]
    assert kinds.count(TaskKind.SIMULATION_REVIEW) == 2
    assert [t.key for t in lst.tasks] == [f"k{i:03d}" for i in range(1, len(lst.tasks) + 1)]
    # t12 is the missing topic: no tasks and not in the list's topics.
    assert [t.key for t in lst.topics] == [f"t{i:02d}" for i in range(1, 12)]
    by_key = {t.key: t for t in lst.tasks}
    for topic in lst.topics:
        learn = [t for t in lst.tasks if t.topic == topic.key and t.kind is TaskKind.LEARN]
        practice = [t for t in lst.tasks if t.topic == topic.key and t.kind is TaskKind.PRACTICE]
        assert learn
        assert practice
        for p in practice:
            assert p.depends_on == learn[-1].key
    for task in lst.tasks:
        if task.kind is not TaskKind.SIMULATION:
            assert 30 <= task.minutes <= 90
        if task.kind is TaskKind.SIMULATION_REVIEW:
            assert task.depends_on is not None
            assert by_key[task.depends_on].kind is TaskKind.SIMULATION
    assert {t.focus for t in lst.tasks if t.kind is TaskKind.LEARN} == {7}
    assert {t.focus for t in lst.tasks if t.kind is TaskKind.PRACTICE} == {8}
    assert {t.focus for t in sims} == {9}


def test_synthetic_fill_half_is_about_half() -> None:
    case = _case("s01")
    lst = synthetic_list(case, 6000, 0.5)
    assert lst.id == f"{case.id}:f50"
    assert abs(_total(lst) - 3000) <= 0.15 * 3000


def _output_from(lst: TaskList) -> AnalysisOutput:
    def task_key(key: str) -> str:
        return f"K{int(key[1:])}"

    def topic_key(key: str) -> str:
        return f"T{int(key[1:])}"

    return AnalysisOutput.model_validate(
        {
            "topics": [
                {"key": topic_key(t.key), "name": "נושא", "weight": t.weight, "evidence": ""}
                for t in lst.topics
            ],
            "tasks": [
                {
                    "key": task_key(t.key),
                    "title": "משימה",
                    "kind": t.kind.value,
                    "topic_key": None if t.topic is None else topic_key(t.topic),
                    "minutes": t.minutes,
                    "focus": t.focus,
                    "depends_on": None if t.depends_on is None else task_key(t.depends_on),
                    "material_key": None,
                    "reason": "",
                }
                for t in lst.tasks
            ],
            "gaps": [],
        }
    )


def test_trim_matches_trim_to_budget() -> None:
    case = _case("s03")
    untrimmed = tasklists._untrimmed(case, 700, 1.0)
    budget = 700
    assert _total(untrimmed) > math.ceil(budget * 1.1)
    result = trim_to_budget(_output_from(untrimmed), budget)
    assert not isinstance(result, list)
    expected_dropped = {f"K{int(k[1:])}" for k in (t.key for t in untrimmed.tasks)} - {
        t.key for t in result.output.tasks
    }
    assert expected_dropped  # the case really trims
    mine = synthetic_list(case, budget, 1.0)
    mine_dropped = {f"K{int(t.key[1:])}" for t in untrimmed.tasks} - {
        f"K{int(t.key[1:])}" for t in mine.tasks
    }
    assert mine_dropped == expected_dropped
    assert _total(mine) == result.total_minutes


def test_take_home_simulation_capped_at_300() -> None:
    case = _case("s09")
    assert case.course.exam_minutes > 300
    lst = synthetic_list(case, 6000, 1.0)
    sims = [t for t in lst.tasks if t.kind is TaskKind.SIMULATION]
    assert [t.minutes for t in sims] == [300]


def test_oral_without_past_exams_has_one_simulation() -> None:
    case = _case("s08")
    assert not [m for m in case.materials if m.kind == "past_exam"]
    lst = synthetic_list(case, 3000, 1.0)
    sims = [t for t in lst.tasks if t.kind is TaskKind.SIMULATION]
    assert len(sims) == 1
    assert sims[0].minutes == 30  # clamped up to the 30-minute floor


def test_s12_stays_over_budget() -> None:
    case = _case("s12")
    lst = synthetic_list(case, 1200, 1.0)
    kinds = [t.kind for t in lst.tasks]
    assert kinds.count(TaskKind.SIMULATION) == 10
    assert kinds.count(TaskKind.SIMULATION_REVIEW) == 10
    assert _total(lst) > math.ceil(1200 * 1.1)


def _write_results(
    directory: Path, name: str, model: str, case: str, *, title: str = "משימה ראשונה"
) -> None:
    payload: dict[str, Any] = {
        "model": model,
        "results": [
            {
                "case": case,
                "ok": True,
                "topics": [
                    {"key": "T5", "name": "שם נושא סודי", "weight": 4, "evidence": "evidence text"},
                    {"key": "T9", "name": "שם נושא סודי", "weight": 2, "evidence": "evidence text"},
                ],
                "tasks": [
                    {
                        "key": "K3",
                        "title": title,
                        "kind": "learn",
                        "topic_key": "T5",
                        "minutes": 60,
                        "focus": 7,
                        "depends_on": None,
                        "material_key": "M1",
                        "reason": "נימוק שלא יודפס",
                    },
                    {
                        "key": "K8",
                        "title": title,
                        "kind": "practice",
                        "topic_key": "T9",
                        "minutes": 45,
                        "focus": 8,
                        "depends_on": "K3",
                        "material_key": None,
                        "reason": "נימוק שלא יודפס",
                    },
                    {
                        "key": "K9",
                        "title": title,
                        "kind": "review",
                        "topic_key": "T404",
                        "minutes": 30,
                        "focus": 4,
                        "depends_on": "K404",
                        "material_key": None,
                        "reason": "",
                    },
                ],
                "reason": "נימוק שלא יודפס",
            },
            {"case": case + "_x", "ok": False, "tasks": [], "topics": []},
            {"case": case + "_y", "ok": True, "tasks": [], "topics": []},
        ],
    }
    (directory / name).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _cases_file(directory: Path) -> Path:
    path = directory / "cases.json"
    path.write_text(
        json.dumps(
            [
                {"id": "case_a", "budget_minutes": 1000, "exam": {"name": "שם נושא סודי"}},
                {"id": "case_a_x", "budget_minutes": 500},
                {"id": "case_a_y", "budget_minutes": 500},
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return path


def test_export_saved_runs_anonymises(tmp_path: Path) -> None:
    results = tmp_path / "results"
    results.mkdir()
    _write_results(
        results, "20261115T000000Z-claude-sonnet-5-5.json", "claude-sonnet-5-5", "case_a"
    )
    _write_results(results, "20261115T000001Z-gemma3:12b.json", "gemma3:12b", "case_a")
    # A file with another shape (no top-level results) is skipped, not a crash.
    (results / "20261115T000002Z-generate.json").write_text(
        json.dumps({"model": "claude-sonnet-5-5", "exams": []}), encoding="utf-8"
    )
    out = tmp_path / "saved_runs.json"
    count = export_saved_runs(results, _cases_file(tmp_path), out)
    assert count == 1
    text = out.read_text(encoding="utf-8")
    for forbidden in FORBIDDEN_TEXT:
        assert forbidden not in text
    assert not HEBREW.search(text)
    data = json.loads(text)
    assert data["schema"] == 1
    (run,) = data["runs"]
    assert run["id"] == "saved:case_a:claude_sonnet_5_5"
    assert run["budget"] == 1000
    assert [t["key"] for t in run["topics"]] == ["t01", "t02"]
    assert [t["weight"] for t in run["topics"]] == [4, 2]
    assert [t["key"] for t in run["tasks"]] == ["k001", "k002", "k003"]
    assert run["tasks"][0] == {
        "key": "k001",
        "kind": "learn",
        "minutes": 60,
        "focus": 7,
        "depends_on": None,
        "topic": "t01",
    }
    assert run["tasks"][1]["depends_on"] == "k001"
    assert run["tasks"][1]["topic"] == "t02"
    # An unknown topic or dependency becomes null.
    assert run["tasks"][2]["topic"] is None
    assert run["tasks"][2]["depends_on"] is None
    # Every string is a code: nothing that could be a title or a name.
    strings: list[str] = []

    def walk(node: object) -> None:
        if isinstance(node, str):
            strings.append(node)
        elif isinstance(node, dict):
            for key, value in node.items():
                strings.append(key)
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(data)
    assert all(re.fullmatch(r"[a-z0-9][a-z0-9_:.\-]{0,79}", s) for s in strings)


def test_export_dedupes_latest(tmp_path: Path) -> None:
    results = tmp_path / "results"
    results.mkdir()
    _write_results(
        results, "20261115T000000Z-claude-sonnet-5-5.json", "claude-sonnet-5-5", "case_a"
    )
    later = results / "20261115T000009Z-claude-sonnet-5-5.json"
    _write_results(results, later.name, "claude-sonnet-5-5", "case_a")
    payload = json.loads(later.read_text(encoding="utf-8"))
    payload["results"][0]["tasks"][0]["minutes"] = 75
    later.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    _write_results(results, "20261115T000005Z-claude-haiku-5-5.json", "claude-haiku-5-5", "case_a")
    out = tmp_path / "saved_runs.json"
    assert export_saved_runs(results, _cases_file(tmp_path), out) == 2
    runs = json.loads(out.read_text(encoding="utf-8"))["runs"]
    assert [r["id"] for r in runs] == [
        "saved:case_a:claude_haiku_5_5",
        "saved:case_a:claude_sonnet_5_5",
    ]
    sonnet = runs[1]
    assert sonnet["tasks"][0]["minutes"] == 75


def test_load_saved_runs_missing_file_is_empty(tmp_path: Path) -> None:
    assert load_saved_runs(tmp_path / "nope.json") == ()


def test_load_saved_runs_roundtrip(tmp_path: Path) -> None:
    results = tmp_path / "results"
    results.mkdir()
    _write_results(
        results, "20261115T000000Z-claude-sonnet-5-5.json", "claude-sonnet-5-5", "case_a"
    )
    out = tmp_path / "saved_runs.json"
    export_saved_runs(results, _cases_file(tmp_path), out)
    (run,) = load_saved_runs(out)
    assert run.source == "saved"
    assert run.course_type == "problem_solving"
    assert run.exam_minutes is None
    assert run.budget == 1000
    assert [(t.key, t.weight) for t in run.topics] == [("t01", 4), ("t02", 2)]
    assert run.tasks[1] == ListTask(
        key="k002", kind=TaskKind.PRACTICE, minutes=45, focus=8, depends_on="k001", topic="t02"
    )


def test_committed_saved_runs_are_clean() -> None:
    assert SAVED_RUNS_FILE.is_file()
    text = SAVED_RUNS_FILE.read_text(encoding="utf-8")
    assert not HEBREW.search(text)
    runs = load_saved_runs()
    assert len(runs) == 18
    for run in runs:
        assert run.tasks
        keys = {t.key for t in run.tasks}
        assert all(t.depends_on is None or t.depends_on in keys for t in run.tasks)


def _saved_four() -> TaskList:
    return TaskList(
        id="saved:demo:model",
        source="saved",
        course_type="problem_solving",
        topics=(ListTopic(key="t01", weight=3),),
        tasks=(
            ListTask(
                key="k001", kind=TaskKind.LEARN, minutes=60, focus=7, depends_on=None, topic="t01"
            ),
            ListTask(
                key="k002",
                kind=TaskKind.PRACTICE,
                minutes=60,
                focus=8,
                depends_on="k001",
                topic="t01",
            ),
            ListTask(
                key="k003",
                kind=TaskKind.SIMULATION,
                minutes=120,
                focus=9,
                depends_on=None,
                topic=None,
            ),
            ListTask(
                key="k004",
                kind=TaskKind.SIMULATION_REVIEW,
                minutes=60,
                focus=6,
                depends_on="k003",
                topic=None,
            ),
        ),
        exam_minutes=None,
        budget=300,
    )


def test_scale_saved_matches_plan_eval_rule() -> None:
    run = _saved_four()
    # Double budget: scale 2 -> one copy, factor 2; simulation untouched, the rest x2 (cap 90).
    doubled = scale_saved(run, 600)
    assert doubled.id == run.id
    assert doubled.budget == 600
    assert [t.key for t in doubled.tasks] == ["k001c0", "k002c0", "k003c0", "k004c0"]
    assert [t.minutes for t in doubled.tasks] == [90, 90, 120, 90]
    assert doubled.tasks[1].depends_on == "k001c0"
    assert doubled.tasks[3].depends_on == "k003c0"
    assert doubled.tasks[0].topic == "t01"
    # Five times the budget: scale 5 -> three copies, factor 5/3.
    five = scale_saved(run, 1500)
    copies = math.ceil(5 / 2.0)
    assert copies == 3
    assert len(five.tasks) == 4 * copies
    assert [t.key for t in five.tasks[:4]] == ["k001c0", "k002c0", "k003c0", "k004c0"]
    assert five.tasks[4].key == "k001c1"
    assert five.tasks[8].depends_on is None
    assert five.tasks[9].depends_on == "k001c2"
    factor = 5 / 3
    expected = min(90, 5 * round(60 * factor / 5))
    assert five.tasks[0].minutes == expected
    assert five.tasks[2].minutes == 120
    assert _total(five) <= math.ceil(1500 * 1.1)


def test_scale_saved_trims_over_budget_from_the_end() -> None:
    run = _saved_four()
    scaled = scale_saved(run, 200)  # scale 2/3: 40+40+120+40 = 240 > 220
    assert _total(scaled) <= math.ceil(200 * 1.1)
    kinds = [t.kind for t in scaled.tasks]
    assert TaskKind.PRACTICE not in kinds


def test_moed_b_list_uses_product_builder() -> None:
    case = _case("s03")
    base = synthetic_list(case, 3000, 1.0)
    result = moed_b_list(base, 900, 480)
    assert result.id == base.id + ":moed_b"
    assert result.course_type == base.course_type
    assert result.topics == base.topics

    topics = [
        SourceTopic(id=stable_id(base.id, "topic", t.key), name=t.key, weight=t.weight, position=i)
        for i, t in enumerate(base.topics)
    ]
    tasks = [
        SourceTask(
            id=stable_id(base.id, "task", t.key),
            title=t.key,
            kind=t.kind,
            minutes=t.minutes,
            topic_id=None if t.topic is None else stable_id(base.id, "topic", t.topic),
            status=TaskStatus.TODO,
            position=i,
            depends_on=None if t.depends_on is None else stable_id(base.id, "task", t.depends_on),
        )
        for i, t in enumerate(base.tasks)
    ]
    heaviest = sorted(range(len(topics)), key=lambda i: (-topics[i].weight, i))[:2]
    expected = build_moed_b_tasks(
        topics,
        tasks,
        weak_topic_ids={topics[i].id for i in heaviest},
        notes=None,
        budget_minutes=900,
        max_simulation_minutes=480,
    )
    assert [(t.kind, t.minutes, t.focus) for t in result.tasks] == [
        (nt.kind, nt.minutes, nt.focus) for nt in expected.tasks
    ]
    assert [t.key for t in result.tasks] == [f"b{nt.key:03d}" for nt in expected.tasks]
    keys = {t.key for t in result.tasks}
    assert all(t.depends_on is None or t.depends_on in keys for t in result.tasks)
    topic_keys = {t.key for t in base.topics}
    assert all(t.topic is None or t.topic in topic_keys for t in result.tasks)
    assert any(t.topic is not None for t in result.tasks)
