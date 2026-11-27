"""Task lists for the planner track: synthetic, saved and Moed B.

A list holds codes and numbers only: topic names stay in ``case.json`` and never reach a
list, a saved run or any output. The synthetic recipe is code; the saved runs are the real
S11 analyses, frozen to ``eval/saved_runs.json`` with anonymous keys; a Moed B list is built
from either with the product's own builder.
"""

import json
import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final, Literal

from app.domain.moed_b import SourceTask, SourceTopic, build_moed_b_tasks
from app.domain.planner import TaskKind, TaskStatus
from eval.bank.cases import Case
from eval.bank.clock import stable_id
from eval.bank.paths import SAVED_RUNS_FILE

MIN_FOCUSED: Final = 30
MAX_FOCUSED: Final = 90
MAX_SIMULATION: Final = 300
REVIEW_MINUTES: Final = 60
SIM_REVIEW_MINUTES: Final = 60
LEARN_SHARE: Final = 0.4
MIN_TOPIC_MINUTES: Final = 60
FOCUS: Final = {
    TaskKind.REVIEW: 4,
    TaskKind.LEARN: 7,
    TaskKind.PRACTICE: 8,
    TaskKind.SIMULATION: 9,
    TaskKind.SIMULATION_REVIEW: 6,
}
# Saved-run scaling, copied from eval/plan_eval.py (which must not be imported).
MAX_STRETCH: Final = 2.0
MAX_TASKS_PER_EXAM: Final = 150
SAVED_COURSE_TYPE: Final = "problem_solving"
SAVED_SCHEMA: Final = 1
_ALLOWED_KINDS: Final = frozenset(k.value for k in TaskKind)
_DEFAULT_WEAK_TOPICS: Final = 2


@dataclass(frozen=True, slots=True, kw_only=True)
class ListTopic:
    """A topic of a list: its key and weight. No name: names never leave case.json."""

    key: str
    weight: int


@dataclass(frozen=True, slots=True, kw_only=True)
class ListTask:
    key: str
    kind: TaskKind
    minutes: int
    focus: int
    depends_on: str | None
    topic: str | None


@dataclass(frozen=True, slots=True, kw_only=True)
class TaskList:
    id: str
    source: Literal["synthetic", "saved"]
    course_type: str
    topics: tuple[ListTopic, ...]
    tasks: tuple[ListTask, ...]
    exam_minutes: int | None  # synthetic only
    budget: int  # the budget the list was made for (saved: the case's budget_minutes)


def _round5(value: float) -> int:
    return 5 * round(value / 5)


def _clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def _high(budget: int) -> int:
    """The budget's upper bound (+10%), in integer arithmetic like budget_range."""
    return -(-budget * 11 // 10)


# --- (a) synthetic lists ---------------------------------------------------------------


def _untrimmed(case: Case, budget: int, fill: float) -> TaskList:
    """The synthetic recipe before trimming (see ``synthetic_list``)."""
    missing = case.expect.missing_topic
    topics = tuple(
        ListTopic(key=t.key, weight=t.weight) for t in case.expect.topics if t.key != missing
    )
    kinds = [m.kind for m in case.materials]
    drafts: list[tuple[str, TaskKind, int, str | None, str | None]] = []
    # (local name, kind, minutes, topic, depends on local name)
    if "syllabus" in kinds or "summary" in kinds:
        drafts.append(("review", TaskKind.REVIEW, REVIEW_MINUTES, None, None))
    sims = max(1, kinds.count("past_exam"))
    sim_minutes = _clamp(_round5(case.course.exam_minutes), MIN_FOCUSED, MAX_SIMULATION)
    fixed = sum(d[2] for d in drafts) + sims * (sim_minutes + SIM_REVIEW_MINUTES)
    target = _round5(fill * budget)
    remaining = target - fixed
    total_weight = sum(t.weight for t in topics)
    for topic in topics:
        share = max(MIN_TOPIC_MINUTES, remaining * topic.weight / total_weight)
        learn, practice = share * LEARN_SHARE, share * (1 - LEARN_SHARE)
        n_learn = math.ceil(learn / MAX_FOCUSED)
        n_practice = math.ceil(practice / MAX_FOCUSED)
        learn_each = _clamp(_round5(learn / n_learn), MIN_FOCUSED, MAX_FOCUSED)
        practice_each = _clamp(_round5(practice / n_practice), MIN_FOCUSED, MAX_FOCUSED)
        for i in range(n_learn):
            name = f"{topic.key}.l{i}"
            before = None if i == 0 else f"{topic.key}.l{i - 1}"
            drafts.append((name, TaskKind.LEARN, learn_each, topic.key, before))
        last_learn = f"{topic.key}.l{n_learn - 1}"
        for i in range(n_practice):
            drafts.append(
                (f"{topic.key}.p{i}", TaskKind.PRACTICE, practice_each, topic.key, last_learn)
            )
    for i in range(sims):
        drafts.append((f"sim{i}", TaskKind.SIMULATION, sim_minutes, None, None))
        drafts.append(
            (f"sim{i}.r", TaskKind.SIMULATION_REVIEW, SIM_REVIEW_MINUTES, None, f"sim{i}")
        )
    keys = {d[0]: f"k{i:03d}" for i, d in enumerate(drafts, start=1)}
    tasks = tuple(
        ListTask(
            key=keys[name],
            kind=kind,
            minutes=minutes,
            focus=FOCUS[kind],
            depends_on=None if before is None else keys[before],
            topic=topic,
        )
        for name, kind, minutes, topic, before in drafts
    )
    return TaskList(
        id=f"{case.id}:f{round(fill * 100)}",
        source="synthetic",
        course_type=case.course.type,
        topics=topics,
        tasks=tasks,
        exam_minutes=case.course.exam_minutes,
        budget=budget,
    )


def _trim_practice(
    tasks: Sequence[ListTask], weights: Mapping[str, int], budget: int
) -> tuple[ListTask, ...]:
    """Drop practice tasks like ``app.domain.analysis.trim_to_budget``.

    While the total is over the upper bound, the practice task nothing depends on with the
    lowest topic weight goes (the last of equals); with none left the list stays over budget.
    """
    kept = list(tasks)
    total = sum(t.minutes for t in kept)
    high = _high(budget)
    while total > high:
        depended = {t.depends_on for t in kept if t.depends_on is not None}
        best: int | None = None
        best_weight = 0
        for index, task in enumerate(kept):
            if task.kind is not TaskKind.PRACTICE or task.key in depended:
                continue
            weight = weights.get(task.topic, 0) if task.topic else 0
            if best is None or weight <= best_weight:
                best, best_weight = index, weight
        if best is None:
            break
        total -= kept[best].minutes
        del kept[best]
    return tuple(kept)


def synthetic_list(case: Case, budget: int, fill: float) -> TaskList:
    """A list built by the fixed recipe: a review, topics (learn then practice), simulations.

    ``fill`` is the share of the budget the topic tasks aim at; over the budget's upper bound
    the list is trimmed like the analysis service does, and when only simulations are left to
    trim it stays over budget.
    """
    full = _untrimmed(case, budget, fill)
    weights = {t.key: t.weight for t in full.topics}
    tasks = _trim_practice(full.tasks, weights, budget)
    return TaskList(
        id=full.id,
        source=full.source,
        course_type=full.course_type,
        topics=full.topics,
        tasks=tasks,
        exam_minutes=full.exam_minutes,
        budget=budget,
    )


# --- (b) saved analyses ----------------------------------------------------------------


def _int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _str_or_none(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _saved_run(
    model: str, case: str, budget: int, result: Mapping[str, Any]
) -> dict[str, Any] | None:
    """One anonymised run, or None when the result is malformed. Reads codes and numbers only."""
    raw_topics = result.get("topics")
    raw_tasks = result.get("tasks")
    if not isinstance(raw_topics, list) or not isinstance(raw_tasks, list) or not raw_tasks:
        return None
    topic_keys: dict[str, str] = {}
    topics: list[dict[str, Any]] = []
    for raw in raw_topics:
        if not isinstance(raw, dict):
            return None
        key, weight = _str_or_none(raw.get("key")), _int(raw.get("weight"))
        if key is None or weight is None or key in topic_keys:
            return None
        topic_keys[key] = f"t{len(topics) + 1:02d}"
        topics.append({"key": topic_keys[key], "weight": weight})
    task_keys: dict[str, str] = {}
    for index, raw in enumerate(raw_tasks, start=1):
        key = raw.get("key") if isinstance(raw, dict) else None
        if not isinstance(key, str) or key in task_keys:
            return None
        task_keys[key] = f"k{index:03d}"
    tasks: list[dict[str, Any]] = []
    for raw in raw_tasks:
        kind = _str_or_none(raw.get("kind"))
        minutes, focus = _int(raw.get("minutes")), _int(raw.get("focus"))
        if kind not in _ALLOWED_KINDS or minutes is None or focus is None:
            return None
        depends = _str_or_none(raw.get("depends_on"))
        topic = _str_or_none(raw.get("topic_key"))
        tasks.append(
            {
                "key": task_keys[raw["key"]],
                "kind": kind,
                "minutes": minutes,
                "focus": focus,
                "depends_on": None if depends is None else task_keys.get(depends),
                "topic": None if topic is None else topic_keys.get(topic),
            }
        )
    slug = re.sub(r"[^a-z0-9]+", "_", model)
    return {
        "id": f"saved:{case}:{slug}",
        "budget": budget,
        "topics": topics,
        "tasks": tasks,
    }


def export_saved_runs(results_dir: Path, cases_file: Path, out: Path) -> int:
    """Freeze the valid Claude analyses of ``results_dir`` into ``out``; return how many.

    Files are read in name order; only files whose ``model`` starts with ``claude-`` and that
    have a ``results`` list count. Of each, the results with ``ok`` and tasks are kept; a later
    file replaces an earlier run of the same model and case. Only codes and numbers are read
    (``kind``, ``minutes``, ``focus``, ``depends_on``, ``topic_key``, ``key``, ``weight``,
    ``case``, ``ok``) and keys are renumbered, so nothing of the materials reaches ``out``.
    """
    budgets: dict[str, int] = {}
    for item in json.loads(cases_file.read_text(encoding="utf-8")):
        budget = _int(item.get("budget_minutes"))
        if isinstance(item.get("id"), str) and budget is not None:
            budgets[item["id"]] = budget
    runs: dict[tuple[str, str], dict[str, Any]] = {}
    for path in sorted(results_dir.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except OSError, ValueError:
            continue
        if not isinstance(payload, dict):
            continue
        model = payload.get("model")
        results = payload.get("results")
        if not isinstance(model, str) or not model.startswith("claude-"):
            continue
        if not isinstance(results, list):
            continue
        for result in results:
            if not isinstance(result, dict) or result.get("ok") is not True:
                continue
            case = result.get("case")
            if not isinstance(case, str) or case not in budgets:
                continue
            run = _saved_run(model, case, budgets[case], result)
            if run is not None:
                runs[(model, case)] = run
    ordered = sorted(runs.values(), key=lambda r: str(r["id"]))
    out.write_text(
        json.dumps({"schema": SAVED_SCHEMA, "runs": ordered}, indent=1) + "\n", encoding="utf-8"
    )
    return len(ordered)


def load_saved_runs(path: Path = SAVED_RUNS_FILE) -> tuple[TaskList, ...]:
    """The frozen saved analyses as lists; a missing file is an empty tuple."""
    if not path.is_file():
        return ()
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("schema") != SAVED_SCHEMA:
        raise ValueError("saved runs: unsupported schema")
    lists: list[TaskList] = []
    for run in raw["runs"]:
        lists.append(
            TaskList(
                id=run["id"],
                source="saved",
                course_type=SAVED_COURSE_TYPE,
                topics=tuple(ListTopic(key=t["key"], weight=t["weight"]) for t in run["topics"]),
                tasks=tuple(
                    ListTask(
                        key=t["key"],
                        kind=TaskKind(t["kind"]),
                        minutes=t["minutes"],
                        focus=t["focus"],
                        depends_on=t["depends_on"],
                        topic=t["topic"],
                    )
                    for t in run["tasks"]
                ),
                exam_minutes=None,
                budget=run["budget"],
            )
        )
    return tuple(lists)


def scale_saved(run: TaskList, budget: int) -> TaskList:
    """The saved run fitted to ``budget`` by the rule of ``plan_eval.exam_tasks`` (copied).

    Focused tasks stretch up to ``MAX_STRETCH``; past that the run repeats, so a longer study
    period gets more tasks rather than longer ones. Simulations keep their length. Over the
    upper bound (+10%) tasks nothing depends on go from the end, practice first.
    """
    scale = budget / run.budget
    copies = max(1, math.ceil(scale / MAX_STRETCH))
    copies = min(copies, max(1, MAX_TASKS_PER_EXAM // len(run.tasks)))
    factor = scale / copies
    keys = {t.key for t in run.tasks}
    tasks: list[ListTask] = []
    for copy in range(copies):
        for task in run.tasks:
            if task.kind is TaskKind.SIMULATION:
                minutes = _clamp(_round5(task.minutes), MIN_FOCUSED, MAX_SIMULATION)
            else:
                minutes = _clamp(_round5(task.minutes * factor), MIN_FOCUSED, MAX_FOCUSED)
            depends = task.depends_on if task.depends_on in keys else None
            tasks.append(
                ListTask(
                    key=f"{task.key}c{copy}",
                    kind=task.kind,
                    minutes=minutes,
                    focus=_clamp(task.focus, 1, 10),
                    depends_on=None if depends is None else f"{depends}c{copy}",
                    topic=task.topic,
                )
            )
    high = _high(budget)
    for droppable in ((TaskKind.PRACTICE,), (TaskKind.LEARN, TaskKind.REVIEW, TaskKind.CUSTOM)):
        while sum(t.minutes for t in tasks) > high:
            depended = {t.depends_on for t in tasks}
            last = next(
                (
                    i
                    for i in range(len(tasks) - 1, -1, -1)
                    if tasks[i].kind in droppable and tasks[i].key not in depended
                ),
                None,
            )
            if last is None:
                break
            del tasks[last]
    return TaskList(
        id=run.id,
        source=run.source,
        course_type=run.course_type,
        topics=run.topics,
        tasks=tuple(tasks),
        exam_minutes=run.exam_minutes,
        budget=budget,
    )


# --- (c) Moed B ------------------------------------------------------------------------


def moed_b_list(base: TaskList, budget: int, daily_minutes: int) -> TaskList:
    """The Moed B plan of ``base``, built by the product's ``build_moed_b_tasks``.

    The weak topics are the two heaviest (the first of equal weights). Titles are dropped:
    the builder gets the keys as names and its titles are never read back.
    """
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
    heaviest = sorted(range(len(topics)), key=lambda i: (-topics[i].weight, i))
    weak = {topics[i].id for i in heaviest[:_DEFAULT_WEAK_TOPICS]}
    plan = build_moed_b_tasks(
        topics,
        tasks,
        weak_topic_ids=weak,
        notes=None,
        budget_minutes=budget,
        max_simulation_minutes=daily_minutes,
    )
    topic_key = {t.id: t.name for t in topics}  # the name holds the key
    new_tasks = tuple(
        ListTask(
            key=f"b{nt.key:03d}",
            kind=nt.kind,
            minutes=nt.minutes,
            focus=nt.focus,
            depends_on=None if nt.depends_on_key is None else f"b{nt.depends_on_key:03d}",
            topic=None if nt.topic_id is None else topic_key.get(nt.topic_id),
        )
        for nt in plan.tasks
    )
    return TaskList(
        id=f"{base.id}:moed_b",
        source=base.source,
        course_type=base.course_type,
        topics=base.topics,
        tasks=new_tasks,
        exam_minutes=base.exam_minutes,
        budget=budget,
    )
