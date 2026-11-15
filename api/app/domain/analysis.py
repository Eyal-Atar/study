"""Pure rules for Claude's course analysis: content validation and budget trimming."""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

from app.ai.schema import AnalysisOutput, TaskOut
from app.domain.materials import WARNING_TEXT_TRUNCATED as _SHARED_TEXT_TRUNCATED
from app.domain.materials import MaterialKind

MAX_FOCUSED_MINUTES: Final = 90
MIN_FOCUSED_MINUTES: Final = 30
MAX_SIMULATION_MINUTES: Final = 300
BUDGET_TOLERANCE: Final = 0.10
MAX_ERRORS: Final = 20

WARNING_UNDER_BUDGET: Final = "under_budget"
WARNING_TRIMMED: Final = "trimmed_to_budget"
WARNING_MATERIALS_NOT_READY: Final = "materials_not_ready"
WARNING_SCANNED_PAGES_SKIPPED: Final = "scanned_pages_skipped"
WARNING_TEXT_TRUNCATED: Final = _SHARED_TEXT_TRUNCATED
WARNING_BUDGET_RAISED: Final = "budget_raised_to_minimum"

_HEBREW: Final = re.compile("[֐-׿]")
_TOPIC_REQUIRED: Final = frozenset({"learn", "practice"})


# A simulation runs on a past exam, or on a solution file of one: solution files usually
# hold the questions too, and every model in the S11 eval simulated from them.
SIMULATION_MATERIAL_KINDS: Final = frozenset({MaterialKind.PAST_EXAM, MaterialKind.SOLUTION})


def budget_range(budget: int) -> tuple[int, int]:
    # Integer arithmetic: 420 * 1.1 is 462.00000000000006 in floats.
    tenths = round(BUDGET_TOLERANCE * 10)
    return (budget * (10 - tenths) // 10, -(-budget * (10 + tenths) // 10))


def minimum_budget(materials: Mapping[str, MaterialKind]) -> int:
    """The least time the required tasks take, each at its shortest.

    A review task when there is a syllabus or a summary, and a simulation with its debrief
    for each past exam, or one generic pair when there is none. A budget below this cannot
    hold the tasks validate_analysis requires.
    """
    kinds = list(materials.values())
    review = 1 if {MaterialKind.SYLLABUS, MaterialKind.SUMMARY} & set(kinds) else 0
    pairs = max(1, kinds.count(MaterialKind.PAST_EXAM))
    return (review + 2 * pairs) * MIN_FOCUSED_MINUTES


def _minutes_ok(task: TaskOut) -> bool:
    if task.kind == "simulation":
        return MIN_FOCUSED_MINUTES <= task.minutes <= MAX_SIMULATION_MINUTES
    return MIN_FOCUSED_MINUTES <= task.minutes <= MAX_FOCUSED_MINUTES


def _cycles(tasks: list[TaskOut]) -> list[list[str]]:
    deps: dict[str, str] = {}
    for task in tasks:
        if task.depends_on is not None and task.depends_on != task.key:
            deps.setdefault(task.key, task.depends_on)
    done: set[str] = set()
    found: list[list[str]] = []
    for start in deps:
        path: list[str] = []
        seen: set[str] = set()
        node: str | None = start
        while node is not None and node not in done and node not in seen:
            seen.add(node)
            path.append(node)
            node = deps.get(node)
        if node is not None and node in seen:
            found.append(sorted(path[path.index(node) :]))
        done.update(path)
    return found


def validate_analysis(
    output: AnalysisOutput, *, materials: Mapping[str, MaterialKind]
) -> list[str]:
    errors: list[str] = []
    tasks = output.tasks
    topic_keys = {topic.key for topic in output.topics}
    task_by_key: dict[str, TaskOut] = {}

    seen_keys: set[str] = set()
    for key in [t.key for t in output.topics] + [t.key for t in tasks]:
        if key in seen_keys:
            errors.append(f"duplicate_key:{key}")
        seen_keys.add(key)
    for task in tasks:
        task_by_key.setdefault(task.key, task)

    for task in tasks:
        key = task.key
        if task.topic_key is not None and task.topic_key not in topic_keys:
            errors.append(f"unknown_topic:{key}->{task.topic_key}")
        if task.topic_key is None and task.kind in _TOPIC_REQUIRED:
            errors.append(f"missing_topic:{key}")
        if task.depends_on == key:
            errors.append(f"self_dependency:{key}")
        elif task.depends_on is not None and task.depends_on not in task_by_key:
            errors.append(f"unknown_dependency:{key}->{task.depends_on}")
        if task.material_key is not None:
            kind = materials.get(task.material_key)
            if kind is None:
                errors.append(f"unknown_material:{key}->{task.material_key}")
            elif task.kind == "simulation" and kind not in SIMULATION_MATERIAL_KINDS:
                errors.append(f"material_on_wrong_kind:{key}->{task.material_key}")
        if not _HEBREW.search(task.title):
            errors.append(f"title_not_hebrew:{key}")
        if not _minutes_ok(task):
            errors.append(f"minutes_out_of_range:{key}")

    for cycle in _cycles(list(tasks)):
        errors.append(f"dependency_cycle:{','.join(cycle)}")

    kinds = set(materials.values())
    if kinds & {MaterialKind.SYLLABUS, MaterialKind.SUMMARY} and not any(
        t.kind == "review" for t in tasks
    ):
        errors.append("missing_review_task")

    simulations = [t for t in tasks if t.kind == "simulation"]
    for material_key, kind in materials.items():
        if kind is MaterialKind.PAST_EXAM and not any(
            s.material_key == material_key for s in simulations
        ):
            errors.append(f"missing_simulation:{material_key}")

    reviewed = {t.depends_on for t in tasks if t.kind == "simulation_review"}
    for sim in simulations:
        if sim.key not in reviewed:
            errors.append(f"simulation_without_review:{sim.key}")
    for task in tasks:
        if task.kind != "simulation_review":
            continue
        target = task_by_key.get(task.depends_on) if task.depends_on else None
        if target is None or target.kind != "simulation":
            errors.append(f"review_without_simulation:{task.key}")

    has_past_exam = MaterialKind.PAST_EXAM in kinds
    generic = 0
    for sim in simulations:
        if sim.material_key is None:
            generic += 1
            if has_past_exam or generic > 1:
                errors.append(f"unexpected_simulation:{sim.key}")

    return errors[:MAX_ERRORS]


@dataclass(frozen=True)
class TrimResult:
    output: AnalysisOutput
    dropped: tuple[str, ...]
    total_minutes: int


def trim_to_budget(output: AnalysisOutput, budget: int) -> TrimResult | list[str]:
    hi = budget_range(budget)[1]
    weights = {topic.key: topic.weight for topic in output.topics}
    tasks = list(output.tasks)
    dropped: list[str] = []
    total = sum(t.minutes for t in tasks)
    while total > hi:
        depended = {t.depends_on for t in tasks if t.depends_on is not None}
        best: int | None = None
        best_weight = 0
        for index, task in enumerate(tasks):
            if task.kind != "practice" or task.key in depended:
                continue
            weight = weights.get(task.topic_key, 0) if task.topic_key else 0
            if best is None or weight <= best_weight:
                best, best_weight = index, weight
        if best is None:
            return [f"over_budget:{total}>{hi}"]
        total -= tasks[best].minutes
        dropped.append(tasks.pop(best).key)
    if not dropped:
        return TrimResult(output=output, dropped=(), total_minutes=total)
    return TrimResult(
        output=output.model_copy(update={"tasks": tasks}),
        dropped=tuple(dropped),
        total_minutes=total,
    )
