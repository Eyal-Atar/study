"""The run, the aggregation, the Markdown report and the comparison of the case bank.

One run puts every board through ``plan()`` with the schedule metrics and the two missed-day
probes (the planner track), then lives whole exam periods on the boards with the virtual
students. ``summarize`` turns both into one dict of numbers; ``render_markdown`` prints it
and, given the summary of an earlier run, puts the baseline beside every number and lists the
regressions. Rules that hold for everything written here:

- Numbers and codes only. ``check_codes_only`` is the gate every file passes before it is
  written: each string, keys included, is an id or a code, never a title or a name.
- Every aggregate is a mean over the values that are not None, and it comes with the number
  of values behind it (``value_counts``): a planner that leaves a whole gap between two exams
  empty must not look better on ``between_next_share`` just because that board stops
  counting. The Markdown puts that number beside the mean wherever it is below the number of
  boards (or periods) of the group, and always beside the two ``between_*`` means.
- The same input gives the same summary, except the time fields (``generated_at``, ``timing``).
"""

import datetime as dt
import hashlib
import math
import re
import statistics
import time
from collections import Counter
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final

from app.domain.planner import plan
from eval.bank.boards import Board, planner_tasks
from eval.bank.metrics import SCHEDULE_METRIC_IDS, Value, schedule_metrics
from eval.bank.paths import API_DIR
from eval.bank.students import (
    BEHAVIORS,
    Behavior,
    PeriodResult,
    first_study_day,
    missed_day_probe,
    simulate_period,
)

SCHEMA: Final = 1
PLANNER_LIMIT_SECONDS: Final = 60.0
STUDENTS_LIMIT_SECONDS: Final = 600.0  # for 1,000 periods
STUDENTS_LIMIT_PERIODS: Final = 1000

PROBE_IDS: Final = (
    "miss_first_core_reported",
    "miss_first_churn",
    "miss_mid_core_reported",
    "miss_mid_churn",
)
ROW_METRIC_IDS: Final = (*SCHEDULE_METRIC_IDS, *PROBE_IDS)
STUDENT_METRIC_IDS: Final = (
    "coverage",
    "coverage_learned",
    "replans",
    "churn",
    "churn_per_replan",
    "core_left_minutes",
    "core_reported_minutes",
    "review_failures",
)
BEHAVIOR_METRIC_IDS: Final = (*STUDENT_METRIC_IDS, "coverage_p10")

# "up": higher is better, "down": lower is better, "info": reported, never judged.
DIRECTION: Final[Mapping[str, str]] = {
    "unscheduled_minutes": "down",
    "unscheduled_core_minutes": "down",
    "active_days": "info",
    "empty_days": "down",
    "empty_day_share": "down",
    "longest_empty_run": "down",
    "day_util_mean": "up",
    "day_util_p10": "up",
    "days_util_ge90_share": "up",
    "last20_core_share": "up",
    "between_util": "up",
    "between_next_share": "up",
    "topics_met_twice_share": "up",
    "topic_gap_median_days": "info",
    "max_new_minutes_day": "down",
    "new_over60_day_share": "down",
    "planned_coverage": "up",
    "dropped_weight_mean": "down",
    "all_weight_mean": "info",
    "uncovered_by_list_share": "info",
    "gap_blocks_over_25_share": "down",
    "gap_blocks_over_45_share": "down",
    "gap_sims_short_share": "down",
    "miss_first_core_reported": "down",
    "miss_mid_core_reported": "down",
    "miss_first_churn": "down",
    "miss_mid_churn": "down",
    "coverage": "up",
    "coverage_p10": "up",
    "coverage_learned": "up",
    "replans": "info",
    "churn": "down",
    "churn_per_replan": "down",
    "core_left_minutes": "down",
    "core_reported_minutes": "down",
    "review_failures": "down",
}
ARROWS: Final = {"up": "↑", "down": "↓", "info": "·"}

# How much a mean must move before it counts as a change: a share or a weight (0 to 5) by
# 0.01, minutes by 5, a count of days or blocks by half. The class is the metric's unit.
THRESHOLD: Final = {"ratio": 0.01, "minutes": 5.0, "count": 0.5}
MINUTES_METRICS: Final = frozenset(
    {
        "unscheduled_minutes",
        "unscheduled_core_minutes",
        "max_new_minutes_day",
        "miss_first_core_reported",
        "miss_mid_core_reported",
        "core_left_minutes",
        "core_reported_minutes",
    }
)
COUNT_METRICS: Final = frozenset(
    {
        "active_days",
        "empty_days",
        "longest_empty_run",
        "topic_gap_median_days",
        "miss_first_churn",
        "miss_mid_churn",
        "replans",
        "churn",
        "churn_per_replan",
        "review_failures",
    }
)
# The count behind these means is always shown: a board with no value is left out of them.
ALWAYS_COUNTED: Final = frozenset({"between_util", "between_next_share"})

# (id, metric, scope, target code). "overall" is the planner track over every board;
# "behavior:<id>" is the students of that behaviour.
TARGETS: Final = (
    ("s47_empty_days", "empty_days", "overall", "eq_0"),
    ("s47_days_util_ge90_share", "days_util_ge90_share", "overall", "eq_1"),
    ("s47_last20_core_share", "last20_core_share", "overall", "ge_0.15"),
    ("s47_between_util", "between_util", "overall", "higher_than_baseline"),
    ("s47_between_next_share", "between_next_share", "overall", "higher_than_baseline"),
    ("s47_miss_first_core_reported", "miss_first_core_reported", "overall", "lower_than_baseline"),
    ("s47_miss_mid_core_reported", "miss_mid_core_reported", "overall", "lower_than_baseline"),
    ("s47_longest_empty_run", "longest_empty_run", "overall", "le_3"),
    ("s48_coverage_typical", "coverage", "behavior:typical", "higher_than_baseline"),
    ("s48_coverage_struggling", "coverage", "behavior:struggling", "higher_than_baseline"),
    (
        "s48_churn_per_replan_typical",
        "churn_per_replan",
        "behavior:typical",
        "not_higher_than_baseline",
    ),
    (
        "s48_churn_per_replan_struggling",
        "churn_per_replan",
        "behavior:struggling",
        "not_higher_than_baseline",
    ),
)
# The metrics of the targets, for the short table on the screen.
TARGET_METRICS: Final = (
    "empty_days",
    "days_util_ge90_share",
    "day_util_mean",
    "last20_core_share",
    "between_util",
    "between_next_share",
    "longest_empty_run",
    "miss_first_core_reported",
    "miss_mid_core_reported",
)

_CODE: Final = re.compile(r"^[a-z0-9][a-z0-9_:.\-]{0,79}$")
_STAMP: Final = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

# Period failures are counted under these codes; no message text is ever kept.
ERROR_EXAM_BEFORE_START: Final = "exam_before_first_study_day"
ERROR_OTHER: Final = "period_value_error"


# --- the planner track ------------------------------------------------------------------


def run_planner_track(boards: Sequence[Board]) -> list[dict[str, Value | str]]:
    """One row per board: ``plan()`` at the board's clock, its schedule metrics, the two
    missed-day probes and the seconds ``plan()`` took."""
    rows: list[dict[str, Value | str]] = []
    for board in boards:
        started = time.perf_counter()
        result = plan(board.profile, board.exams, planner_tasks(board), (), board.now)
        plan_seconds = time.perf_counter() - started
        row: dict[str, Value | str] = {
            "board_id": board.id,
            "list_id": board.list_id,
            "profile_id": board.profile_id,
            "course_type": board.course_type,
            "source": board.source,
            "fill": board.fill,
        }
        row.update(schedule_metrics(board, result))
        for which in ("first", "mid"):
            probe = missed_day_probe(board, result, which)
            row[f"miss_{which}_core_reported"] = None if probe is None else probe.core_reported
            row[f"miss_{which}_churn"] = None if probe is None else probe.churn
        row["plan_seconds"] = plan_seconds
        rows.append(row)
    return rows


# --- the students ------------------------------------------------------------------------


def sample_indexes(total: int, n: int) -> list[int]:
    """n evenly spread indexes of range(total): ``floor(k x total / n)``; all when n >= total."""
    if n < 1:
        raise ValueError("the number of periods must be at least 1")
    if n >= total:
        return list(range(total))
    return [k * total // n for k in range(n)]


def run_students(
    boards: Sequence[Board],
    behaviors: Sequence[Behavior],
    *,
    seed: int,
    reps: int,
    periods: int | None,
    errors: Counter[str] | None = None,
) -> list[PeriodResult]:
    """Every (board, behaviour, rep) period, in the order of ``(board.id, behavior.id, rep)``;
    with ``periods``, only that many, evenly spread over the list.

    The seed of a period is ``"<seed>/<board>/<behaviour>/<rep>"``. A period that cannot run
    (an exam on or before the first study day) is left out and counted in ``errors`` under a
    code; the run goes on.
    """
    plan_of = sorted(
        (
            (board, behavior, rep)
            for board in boards
            for behavior in behaviors
            for rep in range(reps)
        ),
        key=lambda item: (item[0].id, item[1].id, item[2]),
    )
    if periods is not None:
        plan_of = [plan_of[i] for i in sample_indexes(len(plan_of), periods)]
    results: list[PeriodResult] = []
    for board, behavior, rep in plan_of:
        try:
            results.append(
                simulate_period(
                    board, behavior, seed=f"{seed}/{board.id}/{behavior.id}/{rep}", rep=rep
                )
            )
        except ValueError:
            if errors is not None:
                errors[_error_code(board)] += 1
    return results


def _error_code(board: Board) -> str:
    first = first_study_day(board.profile, board.now)
    if any(exam.exam_date <= first for exam in board.exams):
        return ERROR_EXAM_BEFORE_START
    return ERROR_OTHER


# --- the summary -------------------------------------------------------------------------


def planner_fingerprint() -> str:
    """sha256 over the file names and bytes of ``app/domain/planner/*.py``, in name order.

    It says which planner a result belongs to; each name and each file is followed by a NUL.
    """
    digest = hashlib.sha256()
    for path in sorted((API_DIR / "app" / "domain" / "planner").glob("*.py"), key=lambda p: p.name):
        digest.update(path.name.encode("utf-8") + b"\0")
        digest.update(path.read_bytes() + b"\0")
    return digest.hexdigest()


def _round(value: float) -> float:
    return round(value, 4)


def _mean(values: Iterable[float | int | None]) -> tuple[float | None, int]:
    """fmean over the values that are not None, rounded to 4 places, and how many there were."""
    present = [value for value in values if value is not None]
    if not present:
        return None, 0
    return _round(statistics.fmean(present)), len(present)


def _p10(values: Iterable[float | None]) -> tuple[float | None, int]:
    """The value at ``ceil(0.1 n) - 1`` of the sorted values that are not None."""
    present = sorted(value for value in values if value is not None)
    if not present:
        return None, 0
    return _round(present[(len(present) + 9) // 10 - 1]), len(present)


def _p95(values: Sequence[float]) -> float:
    """Nearest rank: the value at ``ceil(0.95 n) - 1`` of the sorted values."""
    ordered = sorted(values)
    return ordered[math.ceil(0.95 * len(ordered)) - 1] if ordered else 0.0


def _aggregate[T](
    items: Sequence[T], metrics: Sequence[str], pick: Callable[[T, str], float | int | None]
) -> tuple[dict[str, float | None], dict[str, int]]:
    """Means of each metric over the items, and the counts: ``rows`` and values per metric."""
    means: dict[str, float | None] = {}
    counts: dict[str, int] = {"rows": len(items)}
    for metric in metrics:
        means[metric], counts[metric] = _mean(pick(item, metric) for item in items)
    return means, counts


def _row_value(row: Mapping[str, Any], metric: str) -> float | int | None:
    value = row.get(metric)
    if value is None or isinstance(value, str):
        return None
    return float(value) if isinstance(value, float) else int(value)


def _period_value(period: PeriodResult, metric: str) -> float | int | None:
    value: float | int | None = getattr(period, metric)
    return value


def _planner_section(
    rows: Sequence[Mapping[str, Any]],
) -> tuple[dict[str, Any], dict[str, Any]]:
    section: dict[str, Any] = {}
    counts: dict[str, Any] = {}
    section["overall"], counts["overall"] = _aggregate(rows, ROW_METRIC_IDS, _row_value)
    for name, field in (
        ("by_course_type", "course_type"),
        ("by_profile", "profile_id"),
        ("by_case", "list_id"),
    ):
        section[name] = {}
        counts[name] = {}
        for key in sorted({str(row[field]) for row in rows}):
            group = [row for row in rows if row[field] == key]
            section[name][key], counts[name][key] = _aggregate(group, ROW_METRIC_IDS, _row_value)
    return section, counts


def _behavior_stats(
    periods: Sequence[PeriodResult], *, with_p10: bool
) -> tuple[dict[str, float | None], dict[str, int]]:
    means, counts = _aggregate(periods, STUDENT_METRIC_IDS, _period_value)
    if with_p10:
        means["coverage_p10"], counts["coverage_p10"] = _p10(p.coverage for p in periods)
    return means, counts


def _students_section(
    periods: Sequence[PeriodResult], course_types: Mapping[str, str]
) -> tuple[dict[str, Any], dict[str, Any]]:
    present = {p.behavior_id for p in periods}
    order = [b.id for b in BEHAVIORS if b.id in present]
    order += sorted(present - set(order))
    by_behavior: dict[str, Any] = {}
    by_behavior_n: dict[str, Any] = {}
    for behavior in order:
        group = [p for p in periods if p.behavior_id == behavior]
        by_behavior[behavior], by_behavior_n[behavior] = _behavior_stats(group, with_p10=True)
    types: dict[str, str] = {}
    for period in periods:
        course_type = course_types.get(period.board_id)
        if course_type is None:
            raise ValueError("a period belongs to a board with no row")
        types[period.board_id] = course_type
    by_type: dict[str, Any] = {}
    by_type_n: dict[str, Any] = {}
    for course_type in sorted(set(types.values())):
        by_type[course_type] = {}
        by_type_n[course_type] = {}
        for behavior in order:
            group = [
                p for p in periods if p.behavior_id == behavior and types[p.board_id] == course_type
            ]
            if group:
                stats, counts = _behavior_stats(group, with_p10=False)
                by_type[course_type][behavior] = stats
                by_type_n[course_type][behavior] = counts
    section = {"by_behavior": by_behavior, "by_course_type": by_type}
    section_n = {"by_behavior": by_behavior_n, "by_course_type": by_type_n}
    return section, section_n


def _targets(planner: Mapping[str, Any], behaviors: Mapping[str, Any]) -> list[dict[str, Any]]:
    targets: list[dict[str, Any]] = []
    for target_id, metric, scope, code in TARGETS:
        group = planner["overall"] if scope == "overall" else behaviors.get(scope.split(":")[1], {})
        targets.append(
            {
                "id": target_id,
                "metric": metric,
                "scope": scope,
                "value": group.get(metric),
                "target": code,
            }
        )
    return targets


def summarize(
    rows: Sequence[Mapping[str, Any]],
    periods: Sequence[PeriodResult],
    *,
    seed: int,
    timings: Mapping[str, float],
    counts: Mapping[str, int],
    now: dt.datetime | None = None,
) -> dict[str, Any]:
    """The whole result of a run as numbers and codes (see the module docstring)."""
    stamp = (now or dt.datetime.now(dt.UTC)).astimezone(dt.UTC)
    planner, planner_n = _planner_section(rows)
    course_types = {str(row["board_id"]): str(row["course_type"]) for row in rows}
    students, students_n = _students_section(periods, course_types)
    students_seconds = float(timings.get("students_seconds", 0.0))
    timing = {
        "planner_track_seconds": _round(float(timings.get("planner_track_seconds", 0.0))),
        "students_seconds": _round(students_seconds),
        "plan_p95_seconds": _round(_p95([float(r["plan_seconds"]) for r in rows])),
        "students_seconds_per_1000": (
            _round(students_seconds * STUDENTS_LIMIT_PERIODS / len(periods)) if periods else None
        ),
    }
    return {
        "schema": SCHEMA,
        "generated_at": stamp.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "seed": seed,
        "planner_fingerprint": planner_fingerprint(),
        "counts": dict(counts),
        "timing": timing,
        "planner": planner,
        "students": students,
        "targets": _targets(planner, students["by_behavior"]),
        "value_counts": {"planner": planner_n, "students": students_n},
    }


# --- the gate ----------------------------------------------------------------------------


def check_codes_only(obj: object) -> None:
    """Raise ValueError unless every string of obj, dict keys included, is an id or a code.

    The only free-form value is the top-level ``generated_at`` (a UTC timestamp). Numbers
    must be finite. The message names the place in the structure, never the text.
    """
    _walk(obj, "$", top=True)


def _walk(obj: object, path: str, *, top: bool = False) -> None:
    if isinstance(obj, str):
        if not _CODE.match(obj):
            raise ValueError(f"not a code at {path}")
    elif obj is None or isinstance(obj, bool | int):
        return
    elif isinstance(obj, float):
        if not math.isfinite(obj):
            raise ValueError(f"not a finite number at {path}")
    elif isinstance(obj, Mapping):
        for key, value in obj.items():
            if not isinstance(key, str) or not _CODE.match(key):
                raise ValueError(f"a key is not a code at {path}")
            if top and key == "generated_at":
                if not isinstance(value, str) or not _STAMP.match(value):
                    raise ValueError(f"not a timestamp at {path}.{key}")
                continue
            _walk(value, f"{path}.{key}")
    elif isinstance(obj, list | tuple):
        for index, value in enumerate(obj):
            _walk(value, f"{path}[{index}]")
    else:
        raise ValueError(f"a value of a type that is not allowed at {path}")


# --- targets, performance verdicts ----------------------------------------------------------


def fewer_values(
    n: int | None, rows: int | None, base_n: int | None, base_rows: int | None
) -> bool:
    """True when fewer boards (or periods) have a value now than in the baseline's same rows.

    Only compared when the group has the same number of rows on both sides: a different set
    of boards is another situation (the run's header warns about it), not fewer values.
    """
    if n is None or base_n is None or rows is None or rows != base_rows:
        return False
    return n < base_n


def target_status(
    code: str,
    value: float | None,
    base: float | None,
    *,
    n: int | None = None,
    rows: int | None = None,
    base_n: int | None = None,
    base_rows: int | None = None,
) -> str:
    """met, not met, or n/a.

    n/a: no value, or a target against a baseline that is not there. A target against the
    baseline is also n/a ("n/a (n changed)") when fewer values are behind the mean than in the
    baseline's same rows: a mean over fewer boards says nothing. A relative target with no
    value now but one in the baseline is not met.
    """
    relative = code.endswith("_than_baseline")
    if value is None:
        return "not met" if relative and base is not None else "n/a"
    if code == "eq_0":
        return _met(value == 0)
    if code == "eq_1":
        return _met(value == 1)
    if code.startswith("ge_"):
        return _met(value >= float(code[3:]))
    if code.startswith("le_"):
        return _met(value <= float(code[3:]))
    if base is None:
        return "n/a"
    if fewer_values(n, rows, base_n, base_rows):
        return "n/a (n changed)"
    if code == "lower_than_baseline":
        return _met(value < base)
    if code == "higher_than_baseline":
        return _met(value > base)
    if code == "not_higher_than_baseline":
        return _met(value <= base)
    raise ValueError("unknown target code")


def _met(ok: bool) -> str:
    return "met" if ok else "not met"


def timing_verdicts(summary: Mapping[str, Any]) -> tuple[str, str]:
    """The two performance lines: the planner track against 60 s, and the students against
    600 s per 1,000 periods (the rate, so a sample is judged fairly)."""
    timing = summary.get("timing", {})
    track = float(timing.get("planner_track_seconds", 0.0))
    planner_line = (
        f"planner track: {'passes' if track <= PLANNER_LIMIT_SECONDS else 'FAILS'} threshold "
        f"({track:.1f} s; limit {PLANNER_LIMIT_SECONDS:.0f} s)"
    )
    n = int(summary.get("counts", {}).get("periods", 0))
    seconds = float(timing.get("students_seconds", 0.0))
    limit = f"limit {STUDENTS_LIMIT_SECONDS:.0f} s for {STUDENTS_LIMIT_PERIODS}"
    if n == 0:
        return planner_line, f"students: no periods ran ({limit})"
    rate = seconds * STUDENTS_LIMIT_PERIODS / n
    verdict = "passes" if rate <= STUDENTS_LIMIT_SECONDS else "FAILS"
    students_line = (
        f"students: {verdict} threshold ({n} periods in {seconds:.1f} s; "
        f"{rate:.1f} s per {STUDENTS_LIMIT_PERIODS}; {limit})"
    )
    return planner_line, students_line


# --- the comparison ----------------------------------------------------------------------


@dataclass(frozen=True, slots=True, kw_only=True)
class Change:
    """One mean against its baseline. ``delta`` is now minus base, in the metric's own sign.

    ``now`` is None for a lost value (a mean with nothing behind it now); ``now_n`` and
    ``base_n`` are the values behind each mean (None when the summary has no counts).
    """

    group: str
    metric: str
    now: float | None
    base: float
    delta: float | None
    verdict: str  # improved | worsened | unchanged | fewer_values | lost_values
    now_n: int | None = None
    base_n: int | None = None


# Verdicts that go to the Regressions table.
REGRESSION_VERDICTS: Final = ("worsened", "fewer_values", "lost_values")


def _unit(metric: str) -> str:
    if metric in MINUTES_METRICS:
        return "minutes"
    if metric in COUNT_METRICS:
        return "count"
    return "ratio"


def _compared_groups(summary: Mapping[str, Any]) -> dict[str, tuple[str, ...]]:
    """Group label to the path of its metric dict (and of its value counts)."""
    planner = summary.get("planner", {})
    students = summary.get("students", {})
    groups: dict[str, tuple[str, ...]] = {"overall": ("planner", "overall")}
    for course_type in planner.get("by_course_type", {}):
        groups[f"course_type={course_type}"] = ("planner", "by_course_type", course_type)
    for behavior in students.get("by_behavior", {}):
        groups[f"behavior={behavior}"] = ("students", "by_behavior", behavior)
    for course_type, behaviors in students.get("by_course_type", {}).items():
        for behavior in behaviors:
            groups[f"course_type={course_type}/behavior={behavior}"] = (
                "students",
                "by_course_type",
                course_type,
                behavior,
            )
    return groups


def _int_or_none(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def compare_summaries(summary: Mapping[str, Any], baseline: Mapping[str, Any]) -> list[Change]:
    """Every (group, metric) with a direction that has a value in the baseline.

    By the metric's direction and threshold (see THRESHOLD): improved, worsened or unchanged.
    But a mean never counts as better when fewer values are behind it: with the same rows in
    the group, a lower count of values (a board that left the mean because the planner emptied
    its gap) turns improved or unchanged into ``fewer_values``; a worsened mean stays worsened.
    A mean that is None now while the baseline has one is ``lost_values``. A metric with no
    value in the baseline has nothing to compare with and is left out.
    """
    base_groups = _compared_groups(baseline)
    changes: list[Change] = []
    for group, path in _compared_groups(summary).items():
        metrics = _dig(summary, path)
        base_path = base_groups.get(group)
        base_metrics = _dig(baseline, base_path) if base_path else {}
        counts = _counts_of(summary, path)
        base_counts = _counts_of(baseline, base_path) if base_path else {}
        for metric, now in metrics.items():
            direction = DIRECTION.get(metric, "info")
            base = base_metrics.get(metric)
            if direction == "info" or base is None:
                continue
            now_n = _int_or_none(counts.get(metric))
            base_n = _int_or_none(base_counts.get(metric))
            if now is None:
                changes.append(
                    Change(
                        group=group,
                        metric=metric,
                        now=None,
                        base=float(base),
                        delta=None,
                        verdict="lost_values",
                        now_n=now_n,
                        base_n=base_n,
                    )
                )
                continue
            delta = float(now) - float(base)
            gain = delta if direction == "up" else -delta
            limit = THRESHOLD[_unit(metric)] + 1e-9
            verdict = "unchanged" if abs(gain) <= limit else "improved" if gain > 0 else "worsened"
            if verdict != "worsened" and fewer_values(
                now_n,
                _int_or_none(counts.get("rows")),
                base_n,
                _int_or_none(base_counts.get("rows")),
            ):
                verdict = "fewer_values"
            changes.append(
                Change(
                    group=group,
                    metric=metric,
                    now=float(now),
                    base=float(base),
                    delta=delta,
                    verdict=verdict,
                    now_n=now_n,
                    base_n=base_n,
                )
            )
    return changes


# --- the Markdown ---------------------------------------------------------------------------


def _fmt(value: float) -> str:
    text = f"{round(float(value), 4):.4f}".rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text


def _signed(value: float) -> str:
    text = _fmt(value)
    return text if text == "0" or text.startswith("-") else f"+{text}"


def _dig(obj: Mapping[str, Any] | None, path: Sequence[str]) -> Mapping[str, Any]:
    current: Any = obj or {}
    for key in path:
        current = current.get(key, {}) if isinstance(current, Mapping) else {}
    return current if isinstance(current, Mapping) else {}


def _counts_of(summary: Mapping[str, Any] | None, path: Sequence[str]) -> Mapping[str, Any]:
    return _dig(_dig(summary, ("value_counts",)), path)


def _value(metric: str, value: float | None, counts: Mapping[str, Any]) -> str:
    """The mean as text, with [n=...] where values were left out (or always, for between)."""
    if value is None:
        return "-"
    text = _fmt(value)
    n = counts.get(metric)
    rows = counts.get("rows")
    if n is not None and (metric in ALWAYS_COUNTED or (rows is not None and n < rows)):
        text += f" [n={n}]"
    return text


def _cell(
    metric: str,
    now: float | None,
    now_counts: Mapping[str, Any],
    base: float | None,
    base_counts: Mapping[str, Any],
    *,
    compared: bool,
) -> str:
    text = _value(metric, now, now_counts)
    if not compared:
        return text
    base_text = _value(metric, base, base_counts)
    change = "n/a" if now is None or base is None else _signed(float(now) - float(base))
    if now is None and base is None:
        return "-"
    return f"{text} ({base_text}, {change})"


def _table(headers: Sequence[str], rows: Sequence[Sequence[str]]) -> list[str]:
    lines = ["| " + " | ".join(headers) + " |", "| " + " | ".join("---" for _ in headers) + " |"]
    lines.extend("| " + " | ".join(row) + " |" for row in rows)
    return lines


def _header(metric: str) -> str:
    return f"{metric} {ARROWS[DIRECTION.get(metric, 'info')]}"


def _group_table(
    summary: Mapping[str, Any],
    baseline: Mapping[str, Any] | None,
    groups: Sequence[tuple[str, Sequence[str]]],
    metrics: Sequence[str],
    label: str,
) -> list[str]:
    """One row per group (a label and the path of its metric dict), one column per metric.

    Metrics that no group has are left out, so a hand-made summary renders too.
    """
    shown = [m for m in metrics if any(m in _dig(summary, path) for _, path in groups)]
    rows: list[list[str]] = []
    for name, path in groups:
        values = _dig(summary, path)
        counts = _counts_of(summary, path)
        base_values = _dig(baseline, path)
        base_counts = _counts_of(baseline, path)
        row = [name, str(counts.get("rows", "-"))]
        for metric in shown:
            row.append(
                _cell(
                    metric,
                    values.get(metric),
                    counts,
                    base_values.get(metric),
                    base_counts,
                    compared=baseline is not None,
                )
            )
        rows.append(row)
    return _table([label, "rows", *(_header(m) for m in shown)], rows)


def _target_rows(summary: Mapping[str, Any], baseline: Mapping[str, Any] | None) -> list[list[str]]:
    rows: list[list[str]] = []
    for target in summary.get("targets", []):
        path = _scope_path(target["scope"])
        metric = target["metric"]
        now = target.get("value")
        base = _dig(baseline, path).get(metric)
        counts = _counts_of(summary, path)
        base_counts = _counts_of(baseline, path)
        rows.append(
            [
                target["id"],
                metric,
                target["scope"],
                _cell(metric, now, counts, base, base_counts, compared=baseline is not None),
                target["target"],
                target_status(
                    target["target"],
                    now,
                    base,
                    n=_int_or_none(counts.get(metric)),
                    rows=_int_or_none(counts.get("rows")),
                    base_n=_int_or_none(base_counts.get(metric)),
                    base_rows=_int_or_none(base_counts.get("rows")),
                ),
            ]
        )
    return rows


def _scope_path(scope: str) -> tuple[str, ...]:
    if scope == "overall":
        return ("planner", "overall")
    return ("students", "by_behavior", scope.split(":")[1])


_TARGET_HEADERS: Final = ("target", "metric", "scope", "today", "goal", "status")


def render_markdown(
    summary: Mapping[str, Any],
    baseline: Mapping[str, Any] | None = None,
    *,
    is_baseline: bool = False,
) -> str:
    """The report: the targets, the planner track by course type, profile and list, the
    students, the performance and, with a baseline, every cell as ``now (base, delta)``
    plus the regressions. Numbers and codes only."""
    compared = baseline is not None
    planner = summary.get("planner", {})
    students = summary.get("students", {})
    lines = [
        "# Case bank baseline: planner track (S46a)"
        if is_baseline
        else "# Case bank: planner track",
        "",
        f"Generated {summary.get('generated_at', '-')}, seed {summary.get('seed', '-')}, "
        f"planner fingerprint {summary.get('planner_fingerprint', '-')}.",
        "Counts: "
        + ", ".join(f"{key} {value}" for key, value in summary.get("counts", {}).items())
        + ".",
        "Every mean skips boards (or periods) with no value; where fewer values than rows are "
        "behind it, the count follows as [n=...] (always, for the two between_ means).",
    ]
    if baseline is not None:
        lines.append(
            f"Baseline: generated {baseline.get('generated_at', '-')}, seed "
            f"{baseline.get('seed', '-')}, planner fingerprint "
            f"{baseline.get('planner_fingerprint', '-')}. Each cell is now (base, change)."
        )
        unlike = [
            name
            for name, now, base in (
                ("seed", summary.get("seed"), baseline.get("seed")),
                ("counts", summary.get("counts"), baseline.get("counts")),
            )
            if now != base
        ]
        if unlike:
            lines.append(
                f"Warning: the {' and '.join(unlike)} differ from the baseline's, so the "
                "comparison may mislead."
            )

    lines += ["", "## Targets (S47, S48)", ""]
    target_rows = _target_rows(summary, baseline)
    day_util = planner.get("overall", {}).get("day_util_mean")
    day_util_counts = _counts_of(summary, ("planner", "overall"))
    target_rows.append(
        [
            "s47_day_util_mean",
            "day_util_mean",
            "overall",
            _cell(
                "day_util_mean",
                day_util,
                day_util_counts,
                _dig(baseline, ("planner", "overall")).get("day_util_mean"),
                _counts_of(baseline, ("planner", "overall")),
                compared=compared,
            ),
            "info (beside days_util_ge90_share)",
            "n/a",
        ]
    )
    lines += _table(_TARGET_HEADERS, target_rows)

    types = list(planner.get("by_course_type", {}))
    groups: list[tuple[str, Sequence[str]]] = [("overall", ("planner", "overall"))]
    groups += [(t, ("planner", "by_course_type", t)) for t in types]
    lines += ["", "## Planner track by course type", ""]
    lines += _group_table(summary, baseline, groups, ROW_METRIC_IDS, "course type")

    lines += ["", "## Planner track by profile", ""]
    profile_groups = [(p, ("planner", "by_profile", p)) for p in planner.get("by_profile", {})]
    lines += _group_table(summary, baseline, profile_groups, ROW_METRIC_IDS, "profile")

    lines += ["", "## Planner track by list", ""]
    case_groups = [(c, ("planner", "by_case", c)) for c in planner.get("by_case", {})]
    lines += _group_table(summary, baseline, case_groups, ROW_METRIC_IDS, "list")

    lines += ["", "## Students by behavior", ""]
    behavior_groups = [(b, ("students", "by_behavior", b)) for b in students.get("by_behavior", {})]
    lines += _group_table(summary, baseline, behavior_groups, BEHAVIOR_METRIC_IDS, "behavior")

    lines += ["", "## Students by course type: typical and struggling", ""]
    type_groups: list[tuple[str, Sequence[str]]] = []
    for course_type, behaviors in students.get("by_course_type", {}).items():
        for behavior in ("typical", "struggling"):
            if behavior in behaviors:
                type_groups.append(
                    (
                        f"{course_type} / {behavior}",
                        ("students", "by_course_type", course_type, behavior),
                    )
                )
    lines += _group_table(
        summary, baseline, type_groups, STUDENT_METRIC_IDS, "course type / behavior"
    )

    lines += ["", "## Performance", ""]
    timing = summary.get("timing", {})
    lines += _table(
        ["measure", "seconds"],
        [[key, "-" if value is None else _fmt(value)] for key, value in timing.items()],
    )
    lines += ["", *(f"- {line}" for line in timing_verdicts(summary))]

    if baseline is not None:
        lines += ["", "## Regressions", ""]
        lines += _regressions(summary, baseline)
    return "\n".join(lines) + "\n"


def _regressions(summary: Mapping[str, Any], baseline: Mapping[str, Any]) -> list[str]:
    changes = compare_summaries(summary, baseline)
    tally = Counter(change.verdict for change in changes)
    lines = [
        f"Compared {len(changes)} values (course type x metric, behavior x metric): "
        f"{tally['improved']} improved, {tally['worsened']} worsened, "
        f"{tally['unchanged']} unchanged, {tally['fewer_values']} fewer_values, "
        f"{tally['lost_values']} lost_values. A change counts above 0.01 for a share, 5 minutes "
        "for minutes and 0.5 for a count of days or blocks. fewer_values: the mean did not get "
        "worse but fewer boards or periods have a value than in the baseline (same rows); "
        "lost_values: the baseline has a value and now there is none. Both are regressions.",
        "",
    ]
    listed = [change for change in changes if change.verdict in REGRESSION_VERDICTS]
    if not listed:
        return [*lines, "none"]
    rows = [
        [
            change.group,
            _header(change.metric),
            change.verdict,
            "-" if change.now is None else _fmt(change.now),
            _fmt(change.base),
            "-" if change.delta is None else _signed(change.delta),
            "-" if change.now_n is None else str(change.now_n),
            "-" if change.base_n is None else str(change.base_n),
        ]
        for change in listed
    ]
    headers = ["group", "metric", "verdict", "now", "base", "change", "n now", "n base"]
    return [*lines, *_table(headers, rows)]


def render_console(summary: Mapping[str, Any], baseline: Mapping[str, Any] | None = None) -> str:
    """The short table for the screen: the targets, and their metrics for every course type."""
    planner = summary.get("planner", {})
    groups: list[tuple[str, Sequence[str]]] = [("overall", ("planner", "overall"))]
    groups += [(t, ("planner", "by_course_type", t)) for t in planner.get("by_course_type", {})]
    lines = _table(_TARGET_HEADERS, _target_rows(summary, baseline))
    lines += [""]
    lines += _group_table(summary, baseline, groups, TARGET_METRICS, "course type")
    return "\n".join(lines)
