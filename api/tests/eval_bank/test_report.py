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
        # The summaries; the rows files beside them end in -rows.json.
        self.json_files = sorted(
            p for p in self.results.glob("bank-*.json") if not p.name.endswith("-rows.json")
        )
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


def _with_counts(summary: dict[str, Any], by_type: dict[str, dict[str, int]]) -> dict[str, Any]:
    out = copy.deepcopy(summary)
    out["value_counts"] = {"planner": {"by_course_type": by_type}}
    return out


def _regression_section(text: str) -> str:
    return text.split("## Regressions", 1)[1].split("\n## ", 1)[0]


def test_compare_flags_a_mean_that_rose_over_fewer_values() -> None:
    # essay: between_next_share rose 0.4 to 0.6, but over 1 board instead of 3 of the same 3
    # (the planner emptied the gap on two boards, which then left the mean). oral: the same
    # rise over 3 of 3 on both sides is a real improvement. open_book: 1 of 2 boards now
    # against 3 of 3 before are different board sets, not fewer values inside the same rows.
    base = _with_counts(
        _fake(
            {
                "essay": {"between_next_share": 0.4, "last20_core_share": 0.2},
                "oral": {"between_next_share": 0.4},
                "open_book": {"between_next_share": 0.4},
            }
        ),
        {
            "essay": {"rows": 3, "between_next_share": 3, "last20_core_share": 3},
            "oral": {"rows": 3, "between_next_share": 3},
            "open_book": {"rows": 3, "between_next_share": 3},
        },
    )
    now = _with_counts(
        _fake(
            {
                "essay": {"between_next_share": 0.6, "last20_core_share": 0.3},
                "oral": {"between_next_share": 0.6},
                "open_book": {"between_next_share": 0.6},
            }
        ),
        {
            "essay": {"rows": 3, "between_next_share": 1, "last20_core_share": 3},
            "oral": {"rows": 3, "between_next_share": 3},
            "open_book": {"rows": 2, "between_next_share": 1},
        },
    )
    changes = {(c.group, c.metric): c for c in report.compare_summaries(now, base)}
    flagged = changes[("course_type=essay", "between_next_share")]
    assert flagged.verdict == "fewer_values"
    assert (flagged.now_n, flagged.base_n) == (1, 3)
    assert changes[("course_type=essay", "last20_core_share")].verdict == "improved"
    assert changes[("course_type=oral", "between_next_share")].verdict == "improved"
    assert changes[("course_type=open_book", "between_next_share")].verdict == "improved"
    text = report.render_markdown(now, base)
    section = _regression_section(text)
    assert "essay" in section
    assert "between_next_share" in section
    assert "fewer_values" in section
    assert "oral" not in section
    assert "open_book" not in section
    # The counts are in the table: 1 now, 3 in the baseline.
    row = next(line for line in section.splitlines() if "essay" in line)
    assert row.rstrip().endswith("| 1 | 3 |")


def test_compare_a_value_lost_is_a_regression() -> None:
    # Every essay board emptied its gap: between_util is None now, 0.8 in the baseline.
    base = _with_counts(
        _fake({"essay": {"between_util": 0.8}, "oral": {"between_util": 0.8}}),
        {"essay": {"rows": 2, "between_util": 2}, "oral": {"rows": 2, "between_util": 2}},
    )
    now = _with_counts(
        _fake({"essay": {"between_util": None}, "oral": {"between_util": 0.9}}),
        {"essay": {"rows": 2, "between_util": 0}, "oral": {"rows": 2, "between_util": 2}},
    )
    changes = {(c.group, c.metric): c for c in report.compare_summaries(now, base)}
    lost = changes[("course_type=essay", "between_util")]
    assert lost.verdict == "lost_values"
    assert lost.now is None
    assert lost.base == 0.8
    assert (lost.now_n, lost.base_n) == (0, 2)
    assert changes[("course_type=oral", "between_util")].verdict == "improved"
    section = _regression_section(report.render_markdown(now, base))
    assert "essay" in section
    assert "lost_values" in section
    assert "oral" not in section
    assert "1 lost_values" in section  # the tally line


def test_target_status_is_not_met_by_fewer_values() -> None:
    # higher than the baseline, but over 1 of 3 boards against 3 of 3: no verdict.
    fewer = {"n": 1, "rows": 3, "base_n": 3, "base_rows": 3}
    assert report.target_status("higher_than_baseline", 0.7, 0.6, **fewer) == "n/a (n changed)"
    assert report.target_status("lower_than_baseline", 0.5, 0.6, **fewer) == "n/a (n changed)"
    assert report.target_status("not_higher_than_baseline", 0.5, 0.6, **fewer) == (
        "n/a (n changed)"
    )
    same = {"n": 3, "rows": 3, "base_n": 3, "base_rows": 3}
    assert report.target_status("higher_than_baseline", 0.7, 0.6, **same) == "met"
    # Other board sets (rows differ): the count is not compared.
    other = {"n": 1, "rows": 2, "base_n": 3, "base_rows": 3}
    assert report.target_status("higher_than_baseline", 0.7, 0.6, **other) == "met"
    # An absolute target does not look at the baseline.
    assert report.target_status("ge_0.15", 0.2, 0.1, **fewer) == "met"
    # Nothing now, something before: a relative target is not met.
    assert report.target_status("higher_than_baseline", None, 0.6, **same) == "not met"
    assert report.target_status("higher_than_baseline", None, None, **same) == "n/a"


def test_targets_table_shows_n_changed() -> None:
    now = _with_counts(_fake({}), {})
    base = copy.deepcopy(now)
    now["targets"] = [
        {
            "id": "s47_between_next_share",
            "metric": "between_next_share",
            "scope": "overall",
            "value": 0.7,
            "target": "higher_than_baseline",
        }
    ]
    now["planner"]["overall"] = {"between_next_share": 0.7}
    base["planner"]["overall"] = {"between_next_share": 0.6}
    now["value_counts"] = {"planner": {"overall": {"rows": 3, "between_next_share": 1}}}
    base["value_counts"] = {"planner": {"overall": {"rows": 3, "between_next_share": 3}}}
    text = report.render_markdown(now, base)
    line = next(line for line in text.splitlines() if line.startswith("| s47_between_next_share"))
    assert "n/a (n changed)" in line


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
        "miss_first_core_added",
        "miss_first_churn",
        "miss_mid_core_reported",
        "miss_mid_core_added",
        "miss_mid_churn",
        "plan_seconds",
    ):
        assert key in row
    assert isinstance(row["plan_seconds"], float)
    assert isinstance(row["miss_first_core_added"], int)
    assert isinstance(row["miss_mid_core_added"], int)


# --- final fix wave: the new probe metrics, thresholds, the guard, the CLI -------------


def test_every_listed_metric_has_a_direction_and_a_threshold() -> None:
    # A metric missing from DIRECTION silently becomes info and is never judged.
    listed = (*report.ROW_METRIC_IDS, *report.STUDENT_METRIC_IDS, *report.BEHAVIOR_METRIC_IDS)
    for metric in listed:
        assert metric in report.DIRECTION, metric
        if report.DIRECTION[metric] != "info":
            assert metric in report.THRESHOLDS, metric
    for metric in ("miss_first_core_added", "miss_mid_core_added"):
        assert metric in report.ROW_METRIC_IDS
        assert report.DIRECTION[metric] == "down"
        assert metric in report.MINUTES_METRICS
    assert set(report.THRESHOLDS) == {m for m, d in report.DIRECTION.items() if d != "info"}
    assert all(report.threshold(m) == 5.0 for m in report.MINUTES_METRICS)


def test_the_probe_columns_sit_next_to_each_other() -> None:
    ids = report.PROBE_IDS
    assert ids == (
        "miss_first_core_reported",
        "miss_first_core_added",
        "miss_first_churn",
        "miss_mid_core_reported",
        "miss_mid_core_added",
        "miss_mid_churn",
    )
    assert "miss_first_core_added" in report.TARGET_METRICS


def test_new_probe_targets() -> None:
    summary = report.summarize(
        [_row("a:full_time", "essay", miss_first_core_added=60, miss_mid_core_added=0)],
        [],
        seed=1,
        timings={"planner_track_seconds": 1.0, "students_seconds": 0.0},
        counts={"boards": 1, "periods": 0},
    )
    targets = {t["id"]: t for t in summary["targets"]}
    first = targets["s47_miss_first_core_added"]
    assert (first["metric"], first["scope"], first["target"], first["value"]) == (
        "miss_first_core_added",
        "overall",
        "lower_than_baseline",
        60.0,
    )
    assert targets["s47_miss_mid_core_added"]["target"] == "lower_than_baseline"
    text = report.render_markdown(summary)
    header = next(line for line in text.splitlines() if line.startswith("| course type"))
    assert "miss_first_core_reported ↓ | miss_first_core_added ↓ | miss_first_churn ↓" in header


def test_thresholds_by_metric() -> None:
    expected = {
        "coverage": 0.02,
        "coverage_p10": 0.02,
        "coverage_learned": 0.02,
        "churn": 0.5,
        "churn_per_replan": 0.5,
        "review_failures": 0.5,
        "empty_days": 0.05,
        "longest_empty_run": 0.05,
        "miss_first_churn": 0.05,
        "miss_mid_churn": 0.05,
        "unscheduled_minutes": 5.0,
        "miss_first_core_added": 5.0,
        "core_left_minutes": 5.0,
        "day_util_mean": 0.01,
        "between_next_share": 0.01,
        "dropped_weight_mean": 0.01,
    }
    for metric, value in expected.items():
        assert report.threshold(metric) == value, metric


def test_compare_uses_each_metrics_threshold() -> None:
    # empty_days is deterministic: +0.04 is unchanged, +0.06 is worse (0.05). typical
    # coverage moves by seed: +0.015 is unchanged, +0.025 is better (0.02). churn_per_replan
    # 3.84 -> 4.14 (+0.30, seed noise) is unchanged, 3.84 -> 4.40 (+0.56) is worse (0.5).
    base = _fake(
        {"essay": {"empty_days": 2.0}, "oral": {"empty_days": 2.0}},
        behaviors={
            "typical": {"coverage": 0.795, "churn_per_replan": 3.84},
            "struggling": {"coverage": 0.795, "churn_per_replan": 3.84},
        },
    )
    now = _fake(
        {"essay": {"empty_days": 2.04}, "oral": {"empty_days": 2.06}},
        behaviors={
            "typical": {"coverage": 0.81, "churn_per_replan": 4.14},
            "struggling": {"coverage": 0.82, "churn_per_replan": 4.40},
        },
    )
    verdicts = {(c.group, c.metric): c.verdict for c in report.compare_summaries(now, base)}
    assert verdicts[("course_type=essay", "empty_days")] == "unchanged"
    assert verdicts[("course_type=oral", "empty_days")] == "worsened"
    assert verdicts[("behavior=typical", "coverage")] == "unchanged"
    assert verdicts[("behavior=struggling", "coverage")] == "improved"
    assert verdicts[("behavior=typical", "churn_per_replan")] == "unchanged"
    assert verdicts[("behavior=struggling", "churn_per_replan")] == "worsened"


def test_relative_targets_use_the_threshold() -> None:
    # A change inside the threshold is no change: not met for "higher" or "lower", met for
    # "not higher".
    cov = report.threshold("coverage")  # 0.02
    assert report.target_status("higher_than_baseline", 0.81, 0.795, threshold=cov) == "not met"
    assert report.target_status("higher_than_baseline", 0.82, 0.795, threshold=cov) == "met"
    churn = report.threshold("churn_per_replan")  # 0.5
    assert report.target_status("not_higher_than_baseline", 4.14, 3.84, threshold=churn) == "met"
    assert report.target_status("not_higher_than_baseline", 4.4, 3.84, threshold=churn) == (
        "not met"
    )
    minutes = report.threshold("miss_first_core_added")  # 5
    assert report.target_status("lower_than_baseline", 196.0, 199.1, threshold=minutes) == (
        "not met"
    )
    assert report.target_status("lower_than_baseline", 190.0, 199.1, threshold=minutes) == "met"
    share = report.threshold("between_util")  # 0.01
    assert report.target_status("higher_than_baseline", 0.505, 0.5, threshold=share) == "not met"
    assert report.target_status("higher_than_baseline", 0.52, 0.5, threshold=share) == "met"


def test_targets_table_judges_by_the_threshold() -> None:
    base = _fake({}, behaviors={"typical": {"coverage": 0.795}})
    now = copy.deepcopy(base)
    now["students"]["by_behavior"]["typical"]["coverage"] = 0.81  # +0.015: inside 0.02
    now["targets"] = [
        {
            "id": "s48_coverage_typical",
            "metric": "coverage",
            "scope": "behavior:typical",
            "value": 0.81,
            "target": "higher_than_baseline",
        }
    ]
    line = next(
        line
        for line in report.render_markdown(now, base).splitlines()
        if line.startswith("| s48_coverage_typical")
    )
    assert line.rstrip().endswith("| not met |")


def test_console_shows_the_warning_and_the_regression_count() -> None:
    # NOW_SUMMARY against BASE: three worsened (see test_compare_classifies_each_metric...).
    text = report.render_console(NOW_SUMMARY, BASE)
    assert "Regressions: 3 (worsened 3, fewer_values 0, lost_values 0)" in text
    assert "differ" not in text
    other = copy.deepcopy(BASE)
    other["counts"] = {"boards": 462, "periods": 1188}
    text = report.render_console(BASE, other)
    assert "Warning: the counts differ from the baseline's" in text
    assert "Regressions: 0" in text
    # Without a baseline neither line is printed.
    alone = report.render_console(BASE)
    assert "Regressions" not in alone
    assert "Warning" not in alone


def test_planner_track_reads_synthetic_cases_only(monkeypatch: pytest.MonkeyPatch) -> None:
    # Part B adds real and trap cases to the same folder; they must not enter the means.
    seen: list[object] = []
    real = load_cases

    def spy(*args: Any, **kwargs: Any) -> Any:
        seen.append(kwargs.get("kinds"))
        return real(*args, **kwargs)

    monkeypatch.setattr(bank_eval, "load_cases", spy)
    cases, _, _, _ = bank_eval._inputs(quick=True, saved_path=SAVED_RUNS_FILE)
    assert seen == [("synthetic",)]
    assert {case.kind for case in cases} == {"synthetic"}


@pytest.mark.parametrize(
    "flags",
    [["--quick"], ["--periods", "5"], ["--saved", "x.json"], ["--reps", "1"], ["--reps", "2"]],
)
def test_main_refuses_a_sampled_baseline(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, flags: list[str]
) -> None:
    monkeypatch.setattr(bank_eval, "EVAL_DIR", tmp_path / "eval")
    monkeypatch.setattr(bank_eval, "RESULTS_DIR", tmp_path / "results")

    def boom(*args: object, **kwargs: object) -> None:
        raise AssertionError("the run started")

    monkeypatch.setattr(report, "run_planner_track", boom)
    assert bank_eval.main(["planner", "--write-baseline", *flags]) == 2
    assert not (tmp_path / "eval").exists()
    assert not (tmp_path / "results").exists()


def test_rows_are_written_beside_the_summary(tmp_path: Path) -> None:
    eval_dir = tmp_path / "eval"
    results = tmp_path / "results"
    eval_dir.mkdir()
    summary = _fake({"essay": {"empty_days": 1.0}})
    rows = [_row("a:full_time", "essay", empty_days=1)]
    stamp = dt.datetime(2026, 11, 27, 10, 0, 0, tzinfo=dt.UTC)
    written = bank_eval.write_outputs(
        summary,
        "text",
        rows=rows,
        results_dir=results,
        eval_dir=eval_dir,
        baseline=True,
        stamp=stamp,
    )
    today = f"{dt.date.today():%Y-%m-%d}"
    assert {p.name for p in written} >= {
        "bank-20261127T100000Z-rows.json",
        f"baseline-{today}-rows.json",
    }
    data = json.loads((eval_dir / f"baseline-{today}-rows.json").read_text(encoding="utf-8"))
    assert data["schema"] == 1
    assert data["generated_at"] == summary["generated_at"]
    assert len(data["rows"]) == 1
    assert "plan_seconds" not in data["rows"][0]
    assert data["rows"][0]["board_id"] == "a:full_time"
    assert data["rows"][0]["empty_days"] == 1
    report.check_codes_only(data)
    # A row with text in it stops everything: nothing is written.
    bad = [_row("Some Course Name", "essay")]
    other = tmp_path / "other"
    with pytest.raises(ValueError):
        bank_eval.write_outputs(
            summary, "text", rows=bad, results_dir=other, eval_dir=other, baseline=True
        )
    assert not other.exists()


def test_a_baseline_refuses_an_existing_rows_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    eval_dir = tmp_path / "eval"
    eval_dir.mkdir()
    (eval_dir / f"baseline-{dt.date.today():%Y-%m-%d}-rows.json").write_text("{}", "utf-8")
    monkeypatch.setattr(bank_eval, "EVAL_DIR", eval_dir)
    monkeypatch.setattr(bank_eval, "RESULTS_DIR", tmp_path / "results")

    def boom(*args: object, **kwargs: object) -> None:
        raise AssertionError("the run started")

    monkeypatch.setattr(report, "run_planner_track", boom)
    assert bank_eval.main(["planner", "--write-baseline"]) == 2
    assert not (tmp_path / "results").exists()


def test_quick_run_writes_its_rows(quick_run: QuickRun) -> None:
    files = sorted(quick_run.results.glob("bank-*-rows.json"))
    assert len(files) == 1
    data = json.loads(files[0].read_text(encoding="utf-8"))
    report.check_codes_only(data)
    assert len(data["rows"]) == 2
    for row in data["rows"]:
        assert "plan_seconds" not in row
        for metric in report.ROW_METRIC_IDS:
            assert metric in row
    # The summary keeps its own file: the rows are not in it.
    assert "rows" not in quick_run.summary
