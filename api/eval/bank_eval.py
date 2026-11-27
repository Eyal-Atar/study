"""Case bank eval: the planner track and the virtual students. Numbers only.

Usage, from api/:
    uv run python eval/bank_eval.py check
    uv run python eval/bank_eval.py planner [--seed 1] [--reps 1] [--periods N] [--saved PATH]
        [--write-baseline] [--compare PATH] [--quick]

``check`` loads the cases, the profiles and the saved analyses, builds the boards and prints the
counts; it never calls ``plan()``.

``planner`` runs every board through ``plan()`` with the schedule metrics and the missed-day
probes, then lives the exam periods of the virtual students (the boards of the synthetic
cases at fill 1.0 and of the ``claude-sonnet-5-5`` saved runs, times the six behaviours, times
``--reps``). It writes ``results/bank-<UTC>.json`` and ``.md`` (git-ignored). With
``--write-baseline`` it also writes ``eval/baseline-<today>.json`` and ``.md`` and refuses to
overwrite an existing one. With ``--compare PATH`` (an earlier JSON) every number is shown
beside its baseline and the regressions are listed. ``--quick`` is a small subset for tests
and local work. Exit code 0 on success, 1 when a period could not run, 2 on a refusal.

No network, no database, no ``ANTHROPIC_API_KEY``. No title, topic name or course name is read
into the output: ids, codes and numbers only (``report.check_codes_only``).
"""

import argparse
import datetime as dt
import json
import sys
import time
from collections import Counter
from collections.abc import Sequence
from pathlib import Path

# Running a file puts its own folder on sys.path, not api/; add api/ so that `app` imports.
API_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_DIR))

from eval.bank import report  # noqa: E402
from eval.bank.boards import FILLS, Board, build_boards  # noqa: E402
from eval.bank.cases import Case, load_cases  # noqa: E402
from eval.bank.paths import EVAL_DIR, RESULTS_DIR, SAVED_RUNS_FILE  # noqa: E402
from eval.bank.profiles import EvalProfile, load_profiles  # noqa: E402
from eval.bank.students import BEHAVIORS, Behavior  # noqa: E402
from eval.bank.tasklists import TaskList, load_saved_runs  # noqa: E402

QUICK_CASES = ("s01", "s03", "s12")
QUICK_PROFILES = ("full_time", "worker", "marathon")
QUICK_BEHAVIORS = ("ideal", "typical", "struggling")
# The students live on the saved runs of this model only (the id ends with it).
STUDENT_MODEL_SUFFIX = ":claude_sonnet_5_5"


def baseline_paths(eval_dir: Path, today: dt.date) -> tuple[Path, Path]:
    return (
        eval_dir / f"baseline-{today:%Y-%m-%d}.json",
        eval_dir / f"baseline-{today:%Y-%m-%d}.md",
    )


def write_outputs(
    summary: dict[str, object],
    markdown: str,
    *,
    results_dir: Path,
    eval_dir: Path,
    baseline: bool,
    stamp: dt.datetime | None = None,
) -> list[Path]:
    """Write the JSON and the Markdown to results/, and with ``baseline`` to eval/ as well.

    ``check_codes_only`` runs first, so nothing is written for a summary with text in it.
    An existing baseline file is never overwritten: FileExistsError, and nothing is written.
    """
    report.check_codes_only(summary)
    when = (stamp or dt.datetime.now(dt.UTC)).astimezone(dt.UTC)
    text = json.dumps(summary, indent=1, allow_nan=False) + "\n"
    targets = [
        (results_dir / f"bank-{when:%Y%m%dT%H%M%SZ}.json", text),
        (results_dir / f"bank-{when:%Y%m%dT%H%M%SZ}.md", markdown),
    ]
    if baseline:
        json_path, md_path = baseline_paths(eval_dir, dt.date.today())
        for path in (json_path, md_path):
            if path.exists():
                raise FileExistsError(f"{path.name} already exists")
        targets += [(json_path, text), (md_path, markdown)]
    written: list[Path] = []
    for path, content in targets:
        path.parent.mkdir(parents=True, exist_ok=True)
        # "x": a baseline that appeared since the check above is an error, not an overwrite.
        with path.open("x" if path.parent == eval_dir else "w", encoding="utf-8") as handle:
            handle.write(content)
        written.append(path)
    return written


def _inputs(
    *, quick: bool, saved_path: Path
) -> tuple[tuple[Case, ...], tuple[EvalProfile, ...], tuple[TaskList, ...], tuple[Board, ...]]:
    cases = load_cases()
    profiles = load_profiles()
    saved = load_saved_runs(saved_path)
    fills: Sequence[float] = FILLS
    if quick:
        cases = tuple(c for c in cases if c.id.split("_")[0] in QUICK_CASES)
        profiles = tuple(p for p in profiles if p.id in QUICK_PROFILES)
        saved = ()
        fills = (1.0,)
    return cases, profiles, saved, build_boards(cases, saved, profiles, fills=fills)


def _student_boards(boards: Sequence[Board]) -> list[Board]:
    """Fill 1.0 of the synthetic cases, and the saved runs of the students' model."""
    return [
        board
        for board in boards
        if (board.source == "synthetic" and board.fill == 1.0)
        or (board.source == "saved" and board.list_id.endswith(STUDENT_MODEL_SUFFIX))
    ]


def _check() -> int:
    cases, profiles, saved, boards = _inputs(quick=False, saved_path=SAVED_RUNS_FILE)
    students = _student_boards(boards)
    print(f"cases: {len(cases)}")
    print(f"profiles: {len(profiles)}")
    print(f"saved runs: {len(saved)}")
    print(f"boards: {len(boards)}")
    print(f"student boards: {len(students)}")
    print(f"periods at 1 rep: {len(students) * len(BEHAVIORS)}")
    return 0


def _planner(args: argparse.Namespace) -> int:
    saved_path: Path = args.saved or SAVED_RUNS_FILE
    if args.write_baseline:
        if args.quick:
            print("error: a baseline needs the whole bank; leave out --quick", file=sys.stderr)
            return 2
        for path in baseline_paths(EVAL_DIR, dt.date.today()):
            if path.exists():
                print(f"error: {path.name} exists and is never overwritten", file=sys.stderr)
                return 2
    baseline: dict[str, object] | None = None
    if args.compare is not None:
        try:
            baseline = json.loads(Path(args.compare).read_text(encoding="utf-8"))
        except OSError, ValueError:
            print("error: the --compare file is not a readable JSON file", file=sys.stderr)
            return 2
        if not isinstance(baseline, dict) or baseline.get("schema") != report.SCHEMA:
            print("error: the --compare file is not a bank result of this schema", file=sys.stderr)
            return 2

    cases, profiles, saved, boards = _inputs(quick=args.quick, saved_path=saved_path)
    behaviors: list[Behavior] = [b for b in BEHAVIORS if not args.quick or b.id in QUICK_BEHAVIORS]

    started = time.perf_counter()
    rows = report.run_planner_track(boards)
    planner_seconds = time.perf_counter() - started

    errors: Counter[str] = Counter()
    started = time.perf_counter()
    periods = report.run_students(
        _student_boards(boards),
        behaviors,
        seed=args.seed,
        reps=args.reps,
        periods=args.periods,
        errors=errors,
    )
    students_seconds = time.perf_counter() - started

    counts: dict[str, int] = {
        "cases": len(cases),
        "profiles": len(profiles),
        "saved_runs": len(saved),
        "boards": len(boards),
        "periods": len(periods),
        "period_errors": sum(errors.values()),
    }
    counts.update({f"period_errors_{code}": n for code, n in sorted(errors.items())})
    now = dt.datetime.now(dt.UTC)
    summary = report.summarize(
        rows,
        periods,
        seed=args.seed,
        timings={"planner_track_seconds": planner_seconds, "students_seconds": students_seconds},
        counts=counts,
        now=now,
    )
    # A baseline with a period missing is not written: it would be compared against forever.
    write_baseline = bool(args.write_baseline) and not errors
    markdown = report.render_markdown(summary, baseline, is_baseline=write_baseline)
    written = write_outputs(
        summary,
        markdown,
        results_dir=RESULTS_DIR,
        eval_dir=EVAL_DIR,
        baseline=write_baseline,
        stamp=now,
    )

    print(report.render_console(summary, baseline))
    print()
    for line in report.timing_verdicts(summary):
        print(line)
    if errors:
        codes = ", ".join(f"{code} {n}" for code, n in sorted(errors.items()))
        print(f"period errors: {sum(errors.values())} ({codes})")
        if args.write_baseline:
            print("the baseline was not written because of the period errors")
    print()
    for path in written:
        print(f"wrote {path}")
    return 1 if errors else 0


def _positive(text: str) -> int:
    value = int(text)
    if value < 1:
        raise argparse.ArgumentTypeError("must be at least 1")
    return value


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Case bank eval (numbers only).")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check", help="load and count the cases, profiles, saved runs and boards")
    run = sub.add_parser("planner", help="the planner track and the virtual students")
    run.add_argument("--seed", type=int, default=1)
    run.add_argument("--reps", type=_positive, default=1)
    run.add_argument("--periods", type=_positive, default=None, help="an even sample of N periods")
    run.add_argument("--saved", type=Path, default=None, help="saved runs file")
    run.add_argument("--write-baseline", action="store_true")
    run.add_argument("--compare", type=Path, default=None, help="an earlier result JSON")
    run.add_argument("--quick", action="store_true", help="a small subset for tests")
    args = parser.parse_args(argv)
    if args.command == "check":
        return _check()
    return _planner(args)


if __name__ == "__main__":
    sys.exit(main())
