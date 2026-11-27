"""Tests for the run, the report, the comparison and the CLI (S46a Task 6).

The end-to-end tests run the real quick subset (s01, s03, s12 x full_time, worker, marathon
x fill 1.0, three behaviours) twice in the whole module, in a temp folder. Everything else
works on small hand-made rows and summaries whose expected numbers are worked out in the
comment of each test.
"""

import copy
import dataclasses
import datetime as dt
import json
import re
from collections import Counter
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from eval import bank_eval
from eval.bank import report
from eval.bank.boards import build_boards
from eval.bank.cases import load_cases
from eval.bank.clock import NOW
from eval.bank.metrics import SCHEDULE_METRIC_IDS
from eval.bank.paths import SAVED_RUNS_FILE
from eval.bank.profiles import load_profiles
from eval.bank.students import BEHAVIORS, PeriodResult

CODE = re.compile(r"^[a-z0-9][a-z0-9_:.\-]{0,79}$")
TOP_KEYS = (
    "schema",
    "generated_at",
    "seed",
    "planner_fingerprint",
    "counts",
    "timing",
    "planner",
    "students",
    "targets",
)


class QuickRun:
    """``main(["planner", "--quick", "--seed", N])`` in a temp folder.

    The quick subset of the CLI (nine boards, 27 periods, about 25 s of CPU, mostly the
    marathon boards) is too slow for a unit test, so the three QUICK_* constants are
    narrowed here; ``test_quick_selects_the_documented_subset`` checks the real ones.
    """

    def __init__(
        self,
        tmp: Path,
        seed: int,
        *,
        cases: tuple[str, ...],
        profiles: tuple[str, ...],
        behaviors: tuple[str, ...],
    ) -> None:
        self.results = tmp / "results"
        self.eval_dir = tmp / "eval"
        self.eval_dir.mkdir()
        patch = pytest.MonkeyPatch()
        patch.setattr(bank_eval, "RESULTS_DIR", self.results)
        patch.setattr(bank_eval, "EVAL_DIR", self.eval_dir)
        patch.setattr(bank_eval, "QUICK_CASES", cases)
        patch.setattr(bank_eval, "QUICK_PROFILES", profiles)
        patch.setattr(bank_eval, "QUICK_BEHAVIORS", behaviors)
        try:
            self.code = bank_eval.main(["planner", "--quick", "--seed", str(seed)])
        finally:
            patch.undo()
        self.json_files = sorted(self.results.glob("bank-*.json"))
        self.md_files = sorted(self.results.glob("bank-*.md"))

    @property
    def summary(self) -> dict[str, Any]:
        loaded: dict[str, Any] = json.loads(self.json_files[0].read_text(encoding="utf-8"))
        return loaded

    @property
    def markdown(self) -> str:
        return self.md_files[0].read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def quick_run(tmp_path_factory: pytest.TempPathFactory) -> QuickRun:
    # s03 on a single-exam and a six-exam profile: between_* has values on one board only.
    return QuickRun(
        tmp_path_factory.mktemp("first"),
        3,
        cases=("s03",),
        profiles=("full_time", "marathon"),
        behaviors=("ideal", "typical"),
    )


def _cheap_run(tmp: Path) -> QuickRun:
    return QuickRun(
        tmp,
        3,
        cases=("s12",),
        profiles=("full_time", "worker"),
        behaviors=("ideal", "typical", "struggling"),
    )


@pytest.fixture(scope="module")
def cheap_run(tmp_path_factory: pytest.TempPathFactory) -> QuickRun:
    return _cheap_run(tmp_path_factory.mktemp("cheap-a"))


@pytest.fixture(scope="module")
def cheap_run_again(tmp_path_factory: pytest.TempPathFactory) -> QuickRun:
    return _cheap_run(tmp_path_factory.mktemp("cheap-b"))


def _strip_timing(summary: dict[str, Any]) -> dict[str, Any]:
    stripped = copy.deepcopy(summary)
    for key in ("generated_at", "timing"):
        stripped.pop(key)
    return stripped


def _strings(obj: object) -> Iterator[str]:
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for key, value in obj.items():
            yield key
            yield from _strings(value)
    elif isinstance(obj, list):
        for value in obj:
            yield from _strings(value)


# --- the run, end to end -----------------------------------------------------------


def test_quick_run_end_to_end(quick_run: QuickRun) -> None:
    assert quick_run.code == 0
    assert len(quick_run.json_files) == 1
    assert len(quick_run.md_files) == 1
    assert list(quick_run.eval_dir.iterdir()) == []  # no baseline without --write-baseline

    summary = quick_run.summary
    for key in TOP_KEYS:
        assert key in summary
    report.check_codes_only(summary)
    assert summary["schema"] == 1
    assert summary["seed"] == 3
    assert re.fullmatch(r"[0-9a-f]{64}", summary["planner_fingerprint"])
    # s03 x two profiles x fill 1.0 = 2 boards; x 2 behaviours = 4 periods. The counts are
    # of what the run used: 1 case, 2 profiles, no saved runs.
    counts = summary["counts"]
    assert (counts["cases"], counts["profiles"], counts["saved_runs"]) == (1, 2, 0)
    assert (counts["boards"], counts["periods"]) == (2, 4)
    assert counts["period_errors"] == 0
    assert set(summary["timing"]) >= {
        "planner_track_seconds",
        "students_seconds",
        "plan_p95_seconds",
    }
    planner = summary["planner"]
    assert set(planner) == {"overall", "by_course_type", "by_profile", "by_case"}
    assert set(planner["overall"]) >= set(SCHEDULE_METRIC_IDS)
    assert "miss_first_core_reported" in planner["overall"]
    assert set(planner["by_profile"]) == {"full_time", "marathon"}
    assert set(planner["by_case"]) == {"s03_mcq_psychology_he:f100"}
    students = summary["students"]
    assert list(students["by_behavior"]) == ["ideal", "typical"]
    assert "coverage_p10" in students["by_behavior"]["typical"]
    assert set(students["by_course_type"]) == set(planner["by_course_type"])
    assert {t["id"] for t in summary["targets"]} >= {"s47_empty_days", "s48_coverage_typical"}
    # Every aggregate comes with its count: only the six-exam board has a between_ value.
    assert summary["value_counts"]["planner"]["overall"]["rows"] == 2
    assert summary["value_counts"]["planner"]["overall"]["between_util"] == 1
    assert summary["planner"]["by_profile"]["full_time"]["between_util"] is None
    assert "Case bank: planner track" in quick_run.markdown
    assert "# Case bank baseline" not in quick_run.markdown


def test_deterministic_except_timing(cheap_run: QuickRun, cheap_run_again: QuickRun) -> None:
    assert cheap_run.code == 0
    assert _strip_timing(cheap_run.summary) == _strip_timing(cheap_run_again.summary)
    assert cheap_run.summary["counts"]["periods"] == 6


def test_quick_selects_the_documented_subset() -> None:
    cases, profiles, saved, boards = bank_eval._inputs(quick=True, saved_path=SAVED_RUNS_FILE)
    assert bank_eval.QUICK_CASES == ("s01", "s03", "s12")
    assert bank_eval.QUICK_PROFILES == ("full_time", "worker", "marathon")
    assert bank_eval.QUICK_BEHAVIORS == ("ideal", "typical", "struggling")
    assert len(cases) == 3
    assert {p.id for p in profiles} == {"full_time", "worker", "marathon"}
    assert saved == ()  # no saved runs
    assert len(boards) == 9
    assert {b.fill for b in boards} == {1.0}
    assert len(bank_eval._student_boards(boards)) == 9
    # The whole bank: 132 synthetic boards at fill 1.0 and 66 of the students' model.
    _, _, _, every = bank_eval._inputs(quick=False, saved_path=SAVED_RUNS_FILE)
    assert len(every) == 462
    students = bank_eval._student_boards(every)
    assert len(students) == 198
    assert len(students) * len(BEHAVIORS) == 1188


def test_no_topic_or_course_name_in_outputs(quick_run: QuickRun) -> None:
    names: set[str] = set()
    for case in load_cases():
        names.add(case.course.name)
        names.update(topic.name for topic in case.expect.topics)
    assert len(names) > 100  # the check below must have something to look for
    raw = quick_run.json_files[0].read_text(encoding="utf-8") + quick_run.markdown
    for name in names:
        assert name not in raw
    # And every string of the JSON, keys included, is an id or a code.
    summary = quick_run.summary
    for text in _strings(summary):
        if text == summary["generated_at"]:
            continue
        assert CODE.match(text), "a string of the JSON is not a code"


# --- check_codes_only --------------------------------------------------------------


def test_check_codes_only_rejects_text() -> None:
    with pytest.raises(ValueError, match=r"\$\.name"):
        report.check_codes_only({"name": "Classical conditioning"})
    report.check_codes_only({"x": "s01_problems_calculus_he:f100:full_time"})
    report.check_codes_only({"generated_at": "2026-11-27T10:00:00Z", "n": [1, 2.5, None, True]})


def test_check_codes_only_message_never_holds_the_text() -> None:
    secret = "Some Topic Name"
    for bad in ({"list": [secret]}, {secret: 1}, {"a": {secret: {"b": 1}}}):
        with pytest.raises(ValueError) as caught:
            report.check_codes_only(bad)
        assert secret not in str(caught.value)
    with pytest.raises(ValueError, match=r"\$\.list\[0\]"):
        report.check_codes_only({"list": ["Nope"]})


def test_check_codes_only_rejects_bad_numbers_and_types() -> None:
    with pytest.raises(ValueError):
        report.check_codes_only({"x": float("nan")})
    with pytest.raises(ValueError):
        report.check_codes_only({"x": float("inf")})
    with pytest.raises(ValueError):
        report.check_codes_only({"x": object()})
    # generated_at is the only free-form value, and only in the right shape.
    with pytest.raises(ValueError):
        report.check_codes_only({"generated_at": "yesterday"})
    with pytest.raises(ValueError):
        report.check_codes_only({"a": {"generated_at": "2026-11-27T10:00:00Z"}})
    with pytest.raises(ValueError):
        report.check_codes_only({"x": "a" * 81})


# --- the sampling of --periods -----------------------------------------------------


def test_periods_sampling_is_even() -> None:
    assert report.sample_indexes(100, 10) == [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]
    assert report.sample_indexes(7, 3) == [0, 2, 4]  # floor(k x 7 / 3)
    assert report.sample_indexes(5, 5) == [0, 1, 2, 3, 4]
    assert report.sample_indexes(5, 50) == [0, 1, 2, 3, 4]
    with pytest.raises(ValueError):
        report.sample_indexes(5, 0)


# --- summarize on hand-made rows ----------------------------------------------------


def _row(board_id: str, course_type: str, **metrics: float | int | None) -> dict[str, Any]:
    row: dict[str, Any] = {
        "board_id": board_id,
        "list_id": board_id.split(":")[0],
        "profile_id": "full_time",
        "course_type": course_type,
        "source": "synthetic",
        "fill": 1.0,
        "plan_seconds": 0.5,
    }
    row.update({metric: None for metric in report.ROW_METRIC_IDS})
    row.update(metrics)
    return row


def _period(board_id: str, behavior: str, coverage: float | None, churn: int) -> PeriodResult:
    return PeriodResult(
        board_id=board_id,
        behavior_id=behavior,
        rep=0,
        coverage=coverage,
        coverage_learned=coverage,
        coverage_by_exam=(coverage,),
        replans=2,
        churn=churn,
        churn_per_replan=churn / 2,
        core_left_minutes=10,
        core_reported_minutes=20,
        review_moves=0,
        review_failures=1,
        seconds=0.1,
    )


def test_summarize_means_skip_none_and_count_what_is_behind_each() -> None:
    # Three essay boards: between_util is 0.5000 and None and 0.2500, so its mean is
    # 0.375 over 2 values; empty_days is 1, 2, 3 (mean 2.0); everything else is None.
    rows = [
        _row("a:full_time", "essay", between_util=0.5, empty_days=1),
        _row("b:full_time", "essay", between_util=None, empty_days=2),
        _row("c:full_time", "essay", between_util=0.25, empty_days=3),
        _row("d:full_time", "oral", between_util=None, empty_days=0),
    ]
    periods = [
        _period("a:full_time", "typical", 0.5, 4),
        _period("b:full_time", "typical", None, 6),
        _period("c:full_time", "typical", 0.30000001, 8),
        _period("d:full_time", "typical", 0.9, 0),
    ]
    summary = report.summarize(
        rows,
        periods,
        seed=1,
        timings={"planner_track_seconds": 2.0, "students_seconds": 4.0},
        counts={"boards": 4, "periods": 4},
        now=dt.datetime(2026, 11, 27, 10, 0, 0, tzinfo=dt.UTC),
    )
    assert summary["generated_at"] == "2026-11-27T10:00:00Z"
    planner = summary["planner"]
    assert planner["overall"]["empty_days"] == 1.5
    assert planner["overall"]["between_util"] == 0.375
    assert planner["by_course_type"]["essay"]["between_util"] == 0.375
    assert planner["by_course_type"]["essay"]["empty_days"] == 2.0
    assert planner["by_course_type"]["oral"]["between_util"] is None  # no value at all
    assert planner["overall"]["unscheduled_minutes"] is None
    counts = summary["value_counts"]["planner"]
    assert counts["overall"]["between_util"] == 2
    assert counts["overall"]["rows"] == 4
    assert counts["by_course_type"]["essay"]["between_util"] == 2
    assert counts["by_course_type"]["oral"]["between_util"] == 0
    assert summary["timing"]["plan_p95_seconds"] == 0.5
    # coverage: 0.5, 0.3 (rounded to 4 places) over 2 values per essay; the typical mean
    # over the three values 0.5, 0.3, 0.9 is 0.5667.
    typical = summary["students"]["by_behavior"]["typical"]
    assert typical["coverage"] == 0.5667
    assert summary["value_counts"]["students"]["by_behavior"]["typical"]["coverage"] == 3
    assert summary["value_counts"]["students"]["by_behavior"]["typical"]["rows"] == 4
    assert typical["churn"] == 4.5
    # p10 of [0.3, 0.5, 0.9]: the value at ceil(0.1 x 3) - 1 = 0 after sorting.
    assert typical["coverage_p10"] == 0.3
    by_type = summary["students"]["by_course_type"]["essay"]["typical"]
    assert by_type["coverage"] == 0.4
    report.check_codes_only(summary)


def test_summarize_targets_list() -> None:
    summary = report.summarize(
        [_row("a:full_time", "essay", empty_days=4, longest_empty_run=2)],
        [_period("a:full_time", "typical", 0.5, 4), _period("a:full_time", "struggling", 0.3, 6)],
        seed=1,
        timings={"planner_track_seconds": 1.0, "students_seconds": 1.0},
        counts={"boards": 1, "periods": 2},
    )
    targets = {t["id"]: t for t in summary["targets"]}
    assert targets["s47_empty_days"]["value"] == 4.0
    assert targets["s47_empty_days"]["target"] == "eq_0"
    assert targets["s47_empty_days"]["metric"] == "empty_days"
    assert targets["s47_empty_days"]["scope"] == "overall"
    assert targets["s47_days_util_ge90_share"]["target"] == "eq_1"
    assert targets["s47_last20_core_share"]["target"] == "ge_0.15"
    assert targets["s47_longest_empty_run"]["target"] == "le_3"
    assert targets["s47_longest_empty_run"]["value"] == 2.0
    assert targets["s47_between_util"]["target"] == "higher_than_baseline"
    assert targets["s47_between_next_share"]["target"] == "higher_than_baseline"
    assert targets["s47_miss_first_core_reported"]["target"] == "lower_than_baseline"
    assert targets["s47_miss_mid_core_reported"]["target"] == "lower_than_baseline"
    assert targets["s48_coverage_typical"]["scope"] == "behavior:typical"
    assert targets["s48_coverage_typical"]["target"] == "higher_than_baseline"
    assert targets["s48_coverage_struggling"]["value"] == 0.3
    assert targets["s48_churn_per_replan_typical"]["target"] == "not_higher_than_baseline"
    assert targets["s48_churn_per_replan_struggling"]["value"] == 3.0
    for target in targets.values():
        assert CODE.match(target["target"])


def test_between_means_show_their_counts_in_the_markdown() -> None:
    rows = [
        _row("a:full_time", "essay", between_util=0.5, between_next_share=0.6),
        _row("b:full_time", "essay"),
        _row("c:full_time", "essay"),
    ]
    summary = report.summarize(
        rows,
        [],
        seed=1,
        timings={"planner_track_seconds": 1.0, "students_seconds": 0.0},
        counts={"boards": 3, "periods": 0},
    )
    text = report.render_markdown(summary)
    assert "0.5 [n=1]" in text
    assert "0.6 [n=1]" in text
    # A mean over every row has no count next to it.
    assert "[n=3]" not in text


# --- the comparison ----------------------------------------------------------------


def _fake(
    by_type: dict[str, dict[str, float | None]],
    *,
    overall: dict[str, float | None] | None = None,
    behaviors: dict[str, dict[str, float | None]] | None = None,
) -> dict[str, Any]:
    behaviors = behaviors or {}
    return {
        "schema": 1,
        "generated_at": "2026-11-27T10:00:00Z",
        "seed": 1,
        "planner_fingerprint": "0" * 64,
        "counts": {"boards": 10, "periods": 5},
        "timing": {},
        "planner": {
            "overall": overall or {},
            "by_course_type": by_type,
            "by_profile": {},
            "by_case": {},
        },
        "students": {
            "by_behavior": behaviors,
            "by_course_type": {},
        },
        "targets": [],
        "value_counts": {},
    }


BASE = _fake(
    {
        "problem_solving": {
            "last20_core_share": 0.10,  # up is better
            "empty_days": 2.0,  # down is better
            "unscheduled_core_minutes": 100.0,  # down is better, minutes
            "day_util_mean": 0.80,
            "active_days": 20.0,  # info only
        },
        "essay": {
            "last20_core_share": 0.30,
            "empty_days": 1.0,
            "unscheduled_core_minutes": 10.0,
            "day_util_mean": 0.80,
            "active_days": 20.0,
        },
    },
    behaviors={"typical": {"coverage": 0.60}},
)
NOW_SUMMARY = _fake(
    {
        "problem_solving": {
            "last20_core_share": 0.25,  # +0.15: improved
            "empty_days": 2.0,  # same
            "unscheduled_core_minutes": 103.0,  # +3 minutes, within 5: unchanged
            "day_util_mean": 0.805,  # +0.005, within 0.01: unchanged
            "active_days": 30.0,  # info: never counted
        },
        "essay": {
            "last20_core_share": 0.20,  # -0.10: worsened
            "empty_days": 0.0,  # -1: improved (down is better)
            "unscheduled_core_minutes": 40.0,  # +30 minutes: worsened
            "day_util_mean": 0.80,  # same
            "active_days": 20.0,
        },
    },
    behaviors={"typical": {"coverage": 0.55}},  # -0.05: worsened
)


def test_compare_classifies_each_metric_by_its_direction() -> None:
    changes = {(c.group, c.metric): c for c in report.compare_summaries(NOW_SUMMARY, BASE)}
    verdicts = {key: change.verdict for key, change in changes.items()}
    assert verdicts[("course_type=problem_solving", "last20_core_share")] == "improved"
    assert verdicts[("course_type=problem_solving", "empty_days")] == "unchanged"
    assert verdicts[("course_type=problem_solving", "unscheduled_core_minutes")] == "unchanged"
    assert verdicts[("course_type=problem_solving", "day_util_mean")] == "unchanged"
    assert verdicts[("course_type=essay", "last20_core_share")] == "worsened"
    assert verdicts[("course_type=essay", "empty_days")] == "improved"
    assert verdicts[("course_type=essay", "unscheduled_core_minutes")] == "worsened"
    assert verdicts[("course_type=essay", "day_util_mean")] == "unchanged"
    assert verdicts[("behavior=typical", "coverage")] == "worsened"
    # Information-only metrics are not compared at all.
    assert not [key for key in verdicts if key[1] == "active_days"]
    delta = changes[("course_type=essay", "last20_core_share")]
    assert (delta.now, delta.base) == (0.20, 0.30)
    assert delta.delta == pytest.approx(-0.10)
    # Improved: problem_solving last20 and essay empty_days. Worsened: essay last20, essay
    # unscheduled minutes, typical coverage. Unchanged: the other four.
    tally = Counter(change.verdict for change in changes.values())
    assert tally == Counter(improved=2, worsened=3, unchanged=4)


def test_compare_marks_regressions() -> None:
    # last20_core_share rose in problem_solving and fell in essay.
    now = _fake(
        {
            "problem_solving": {"last20_core_share": 0.25},
            "essay": {"last20_core_share": 0.20},
        }
    )
    base = _fake(
        {
            "problem_solving": {"last20_core_share": 0.10},
            "essay": {"last20_core_share": 0.30},
        }
    )
    text = report.render_markdown(now, base)
    assert "## Regressions" in text
    section = text.split("## Regressions", 1)[1].split("\n## ", 1)[0]
    assert "essay" in section
    assert "last20_core_share" in section
    assert "problem_solving" not in section
    # Cells carry the baseline and the change: now (base, delta).
    assert "0.25 (0.1, +0.15)" in text
    assert "0.2 (0.3, -0.1)" in text


def test_compare_with_no_regressions_says_so() -> None:
    text = report.render_markdown(BASE, BASE)
    section = text.split("## Regressions", 1)[1].split("\n## ", 1)[0]
    assert "none" in section


def test_compare_warns_when_the_runs_are_not_alike() -> None:
    other = copy.deepcopy(BASE)
    other["counts"] = {"boards": 462, "periods": 1188}
    other["seed"] = 2
    text = report.render_markdown(BASE, other)
    assert "differ" in text.split("## Regressions")[0]


def test_targets_status_needs_the_baseline_only_for_relative_targets() -> None:
    summary = copy.deepcopy(BASE)
    summary["targets"] = [
        {
            "id": "s47_empty_days",
            "metric": "empty_days",
            "scope": "overall",
            "value": 0.0,
            "target": "eq_0",
        },
        {
            "id": "s47_last20_core_share",
            "metric": "last20_core_share",
            "scope": "overall",
            "value": 0.1,
            "target": "ge_0.15",
        },
        {
            "id": "s47_miss_first_core_reported",
            "metric": "miss_first_core_reported",
            "scope": "overall",
            "value": 50.0,
            "target": "lower_than_baseline",
        },
    ]
    text = report.render_markdown(summary)
    assert report.target_status("eq_0", 0.0, None) == "met"
    assert report.target_status("ge_0.15", 0.1, None) == "not met"
    assert report.target_status("le_3", 3.0, None) == "met"
    assert report.target_status("eq_1", None, None) == "n/a"
    assert report.target_status("lower_than_baseline", 50.0, None) == "n/a"
    assert report.target_status("lower_than_baseline", 50.0, 60.0) == "met"
    assert report.target_status("lower_than_baseline", 60.0, 60.0) == "not met"
    assert report.target_status("higher_than_baseline", 0.7, 0.6) == "met"
    assert report.target_status("not_higher_than_baseline", 3.0, 3.0) == "met"
    assert report.target_status("not_higher_than_baseline", 3.1, 3.0) == "not met"
    assert "eq_0" in text
    assert "lower_than_baseline" in text


# --- verdicts on performance ----------------------------------------------------------


def test_timing_verdicts_print_both_numbers() -> None:
    summary = {
        "counts": {"periods": 1188},
        "timing": {"planner_track_seconds": 20.0, "students_seconds": 410.0},
    }
    planner_line, students_line = report.timing_verdicts(summary)
    assert planner_line == "planner track: passes threshold (20.0 s; limit 60 s)"
    # 410 s x 1000 / 1188 = 345.1 s per 1000 periods.
    assert students_line == (
        "students: passes threshold (1188 periods in 410.0 s; 345.1 s per 1000; "
        "limit 600 s for 1000)"
    )
    slow = {
        "counts": {"periods": 100},
        "timing": {"planner_track_seconds": 61.0, "students_seconds": 61.0},
    }
    planner_line, students_line = report.timing_verdicts(slow)
    assert planner_line.startswith("planner track: FAILS threshold (61.0 s")
    assert students_line.startswith("students: FAILS threshold (100 periods in 61.0 s; 610.0")
    none = {"counts": {"periods": 0}, "timing": {"planner_track_seconds": 1.0}}
    assert report.timing_verdicts(none)[1].startswith("students: no periods")


# --- output files ------------------------------------------------------------------------


def test_write_baseline_refuses_overwrite(tmp_path: Path) -> None:
    eval_dir = tmp_path / "eval"
    results = tmp_path / "results"
    eval_dir.mkdir()
    summary = _fake({"essay": {"empty_days": 1.0}})
    stamp = dt.datetime(2026, 11, 27, 10, 0, 0, tzinfo=dt.UTC)
    written = bank_eval.write_outputs(
        summary, "text", results_dir=results, eval_dir=eval_dir, baseline=True, stamp=stamp
    )
    today = f"{dt.date.today():%Y-%m-%d}"
    assert {p.name for p in written} == {
        "bank-20261127T100000Z.json",
        "bank-20261127T100000Z.md",
        f"baseline-{today}.json",
        f"baseline-{today}.md",
    }
    first = (eval_dir / f"baseline-{today}.json").read_text(encoding="utf-8")
    assert json.loads(first)["schema"] == 1
    # A second baseline on the same day is an error and changes nothing.
    other = copy.deepcopy(summary)
    other["seed"] = 99
    with pytest.raises(FileExistsError):
        bank_eval.write_outputs(
            other, "other", results_dir=results, eval_dir=eval_dir, baseline=True, stamp=stamp
        )
    assert (eval_dir / f"baseline-{today}.json").read_text(encoding="utf-8") == first
    # Without --write-baseline only the results folder is written.
    again = bank_eval.write_outputs(
        other,
        "other",
        results_dir=results,
        eval_dir=eval_dir,
        baseline=False,
        stamp=stamp + dt.timedelta(seconds=1),
    )
    assert {p.parent for p in again} == {results}


def test_main_refuses_an_existing_baseline_before_running(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    eval_dir = tmp_path / "eval"
    eval_dir.mkdir()
    existing = eval_dir / f"baseline-{dt.date.today():%Y-%m-%d}.md"
    existing.write_text("keep", encoding="utf-8")
    monkeypatch.setattr(bank_eval, "EVAL_DIR", eval_dir)
    monkeypatch.setattr(bank_eval, "RESULTS_DIR", tmp_path / "results")

    def boom(*args: object, **kwargs: object) -> None:
        raise AssertionError("the run started")

    monkeypatch.setattr(report, "run_planner_track", boom)
    assert bank_eval.main(["planner", "--write-baseline"]) == 2
    assert existing.read_text(encoding="utf-8") == "keep"
    assert not (tmp_path / "results").exists()


def test_main_refuses_a_quick_baseline(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bank_eval, "EVAL_DIR", tmp_path / "eval")
    monkeypatch.setattr(bank_eval, "RESULTS_DIR", tmp_path / "results")
    assert bank_eval.main(["planner", "--quick", "--write-baseline"]) == 2
    assert not (tmp_path / "eval").exists()


# --- a period that cannot run ------------------------------------------------------------


def test_a_bad_board_is_counted_under_a_code_and_the_run_goes_on() -> None:
    cases = [c for c in load_cases() if c.id.startswith("s01")]
    profiles = [p for p in load_profiles() if p.id == "full_time"]
    good = build_boards(cases, (), profiles, fills=(1.0,))[0]
    # An exam on the clock's own date: on or before day 0 of the period.
    bad = dataclasses.replace(
        good, exams=(dataclasses.replace(good.exams[0], exam_date=NOW.date()),)
    )
    ideal = next(b for b in BEHAVIORS if b.id == "ideal")
    errors: Counter[str] = Counter()
    results = report.run_students([bad, good], [ideal], seed=1, reps=1, periods=None, errors=errors)
    assert [r.board_id for r in results] == [good.id]
    assert errors == Counter({"exam_before_first_study_day": 1})
    assert all(CODE.match(code) for code in errors)


def test_run_students_orders_by_board_behaviour_rep_and_samples() -> None:
    cases = [c for c in load_cases() if c.id.startswith("s01")]
    profiles = [p for p in load_profiles() if p.id == "full_time"]
    boards = build_boards(cases, (), profiles, fills=(1.0,))
    behaviors = [b for b in BEHAVIORS if b.id in ("typical", "ideal")]
    results = report.run_students(boards, behaviors, seed=5, reps=2, periods=None)
    keys = [(r.board_id, r.behavior_id, r.rep) for r in results]
    assert keys == [(boards[0].id, b, rep) for b in ("ideal", "typical") for rep in (0, 1)]
    sampled = report.run_students(boards, behaviors, seed=5, reps=2, periods=2)
    assert [(r.board_id, r.behavior_id, r.rep) for r in sampled] == [keys[0], keys[2]]
    # The seed of a period is "<seed>/<board>/<behaviour>/<rep>": the same period, run alone,
    # gives the same numbers as inside the run.
    assert [r.coverage for r in sampled] == [results[0].coverage, results[2].coverage]


# --- the planner track and the fingerprint -------------------------------------------------


def test_planner_fingerprint_is_stable_hex() -> None:
    first = report.planner_fingerprint()
    assert re.fullmatch(r"[0-9a-f]{64}", first)
    assert report.planner_fingerprint() == first


def test_planner_track_row_has_every_metric_and_the_probe_keys() -> None:
    cases = [c for c in load_cases() if c.id.startswith("s03")]
    profiles = [p for p in load_profiles() if p.id == "full_time"]
    boards = build_boards(cases, (), profiles, fills=(1.0,))
    rows = report.run_planner_track(boards)
    assert len(rows) == 1
    row = rows[0]
    assert row["board_id"] == boards[0].id
    assert row["list_id"] == boards[0].list_id
    assert row["profile_id"] == "full_time"
    assert row["course_type"] == boards[0].course_type
    assert row["source"] == "synthetic"
    assert row["fill"] == 1.0
    for metric in SCHEDULE_METRIC_IDS:
        assert metric in row
    for key in (
        "miss_first_core_reported",
        "miss_first_churn",
        "miss_mid_core_reported",
        "miss_mid_churn",
        "plan_seconds",
    ):
        assert key in row
    assert isinstance(row["plan_seconds"], float)
