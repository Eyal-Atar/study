"""Plan generation eval: materials -> analysis with Claude -> a scheduled plan. Numbers only.

Usage, from api/:
    uv run python eval/generate_eval.py [--cases a,b] [--reanalyze]                 # estimate
    uv run python eval/generate_eval.py --run --max-usd 1.5 [--cases ...] [--reanalyze]

One user, a realistic profile (Asia/Jerusalem, 240 minutes a day, evening and night windows,
one rest day before an exam) and one exam per case of analysis_cases.json (default:
calculus_scanned and exam2025a_three_moeds), 3, 5, 7, ... weeks after today.

Without --run it makes no network call, needs no key and no database: it prints the cost
estimate of each exam's analysis (the same estimate as analysis_eval.py, with the budget that
exam_budgets gives the exam on this board) for AI_MODEL_ANALYSIS from api/.env.

With --run it drops and recreates the database `studyflow_eval` on the local Postgres
(TEST_DATABASE_URL, local only, as the tests), migrates it, creates the user, the profile, the
exams and the materials, runs the real ingest_material on each file (served from disk by a
local Storage), asks for a plan through request_generation as the API does, and runs the real
Worker with HANDLERS and AnthropicAnalysisClient.from_settings until the job ends. It stops
before any call when estimate x 2.2 + spent passes --max-usd. Then it prints the job, each
exam, the cost from app.ai_usage x models.json and the plan's metrics; --reanalyze adds one
reanalysis of the first exam (and a preview, when the analyses service exists).

The screen gets ids of cases, codes and numbers only; the full results, titles included, go
to eval/results/<UTC>-generate.json (git-ignored). The key is never printed.
"""

import argparse
import dataclasses
import datetime as dt
import importlib
import json
import re
import sys
import time
from collections import Counter
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from unittest import mock
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

# Running a file puts its own folder (eval/) on sys.path, not api/; add api/ for `app`.
API_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_DIR))

import psycopg  # noqa: E402
from alembic import command  # noqa: E402
from analysis_eval import (  # noqa: E402
    MATERIALS_DIR,
    RESULTS_DIR,
    SAFETY,
    Prepared,
    load_settings,
    prepare,
    usage_usd,
)
from psycopg.conninfo import make_conninfo  # noqa: E402
from psycopg.rows import DictRow, dict_row  # noqa: E402

from app.ai.client import (  # noqa: E402
    AiError,
    AnalysisClient,
    AnalysisReply,
    AnthropicAnalysisClient,
    Usage,
)
from app.auth import CurrentUser  # noqa: E402
from app.config import Settings  # noqa: E402
from app.db.session import user_transaction  # noqa: E402
from app.domain.materials import MaterialKind, sniff_mime  # noqa: E402
from app.domain.planner import Exam, Profile, StudyWindow, exam_budgets  # noqa: E402
from app.domain.time import local_date  # noqa: E402
from app.jobs.ingest import HANDLERS, ON_CRASHED  # noqa: E402
from app.jobs.storage import FileMissing, FileTooLarge  # noqa: E402
from app.jobs.worker import Worker  # noqa: E402
from app.services.exams import create_exam  # noqa: E402
from app.services.generation import request_generation, request_reanalysis  # noqa: E402
from app.services.materials import register_material  # noqa: E402
from app.services.profiles import update_profile  # noqa: E402
from app.services.replans import preview_replan  # noqa: E402
from tests.db.support import (  # noqa: E402
    admin_database_url,
    alembic_config,
    create_database,
    require_local_database_url,
)

# The module itself, to patch the names it imported (timing only, in this script).
plan_jobs: Any = importlib.import_module("app.jobs.plan_jobs")

EVAL_DIR = Path(__file__).resolve().parent
DB_NAME = "studyflow_eval"
# The model S11 chose (eval/README.md), when neither --model nor AI_MODEL_ANALYSIS names one.
DEFAULT_MODEL = "claude-sonnet-5-5"
DEFAULT_CASES = ("calculus_scanned", "exam2025a_three_moeds")
TIMEZONE = "Asia/Jerusalem"
PROFILE: dict[str, Any] = {
    "timezone": TIMEZONE,
    "wake_time": dt.time(7, 0),
    "sleep_time": dt.time(23, 30),
    "daily_study_minutes": 240,
    "study_windows": ["evening", "night"],
    "rest_days_before_exam": 1,
}
FIRST_EXAM_WEEKS = 3
WEEKS_BETWEEN_EXAMS = 2
JOB_TIMEOUT_SECONDS = 1800
POLL_SECONDS = 1.0
# Each call is checked before it is made: spent + its estimate x CALL_SAFETY <= max_usd.
CALL_SAFETY = 1.5

type Conn = psycopg.Connection[DictRow]


def planner_profile() -> Profile:
    return Profile(
        timezone=ZoneInfo(TIMEZONE),
        wake_time=PROFILE["wake_time"],
        sleep_time=PROFILE["sleep_time"],
        daily_study_minutes=PROFILE["daily_study_minutes"],
        study_windows=frozenset(StudyWindow(w) for w in PROFILE["study_windows"]),
        rest_days_before_exam=PROFILE["rest_days_before_exam"],
    )


@dataclass
class Planned:
    """One case as an exam of this board: its date, the budget it gets and its estimate."""

    case: dict[str, Any]
    exam_date: dt.date
    budget: int
    prepared: Prepared
    exam_id: UUID | None = None
    material_ids: list[UUID] = field(default_factory=list)

    @property
    def case_id(self) -> str:
        return str(self.case["id"])


def plan_cases(
    cases: Sequence[dict[str, Any]], settings: Settings, now: dt.datetime
) -> list[Planned]:
    profile = planner_profile()
    today = local_date(now, profile.timezone)
    dates = [
        today + dt.timedelta(weeks=FIRST_EXAM_WEEKS + WEEKS_BETWEEN_EXAMS * i)
        for i in range(len(cases))
    ]
    exams = [
        Exam(id=uuid4(), exam_date=date, difficulty=int(case["exam"]["difficulty"]))
        for case, date in zip(cases, dates, strict=True)
    ]
    budgets = exam_budgets(profile, exams, now)
    planned: list[Planned] = []
    for case, exam in zip(cases, exams, strict=True):
        shaped = dict(
            case,
            exam=dict(case["exam"], exam_date=exam.exam_date.isoformat()),
            budget_minutes=budgets[exam.id],
            today=today.isoformat(),
        )
        planned.append(
            Planned(
                case=case,
                exam_date=exam.exam_date,
                budget=budgets[exam.id],
                prepared=prepare(shaped, settings),
            )
        )
    return planned


def print_estimate(
    planned: Sequence[Planned], model: str, price: dict[str, float], reanalyze: bool
) -> float:
    print(f"model={model} profile=240min/day evening+night rest_days=1 tz={TIMEZONE}")
    print(
        f"{'case':<24} {'weeks':>5} {'budget':>6} {'text_pg':>7} {'scan_pg':>7} "
        f"{'chars':>8} {'in_tok':>8} {'out_tok':>8} {'usd':>7}"
    )
    today = planned[0].exam_date - dt.timedelta(weeks=FIRST_EXAM_WEEKS)
    total = 0.0
    for item in planned:
        p = item.prepared
        usd = p.estimate_usd(price)
        total += usd
        weeks = (item.exam_date - today).days // 7
        print(
            f"{item.case_id:<24} {weeks:>5} {p.budget:>6} {p.text_pages:>7} "
            f"{p.scanned_pages:>7} {p.chars:>8} {p.input_tokens():>8} {p.output_tokens():>8} "
            f"{usd:>7.3f}"
        )
    if reanalyze:
        again = planned[0].prepared.estimate_usd(price)
        total += again
        print(
            f"{'reanalysis:' + planned[0].case_id:<24} {'':>5} {'':>6} {'':>7} {'':>7} "
            f"{'':>8} {'':>8} {'':>8} {again:>7.3f}"
        )
    print(f"estimate: total_usd={total:.3f} with_safety_x{SAFETY}={total * SAFETY:.3f}")
    return total


class DiskStorage:
    """Storage that serves each registered storage_path from a file on disk."""

    def __init__(self) -> None:
        self.files: dict[str, Path] = {}

    def download(self, path: str, *, max_bytes: int) -> bytes:
        source = self.files.get(path)
        if source is None or not source.is_file():
            raise FileMissing("eval storage: not registered")
        if source.stat().st_size > max_bytes:
            raise FileTooLarge(f"eval storage: over {max_bytes}")
        return source.read_bytes()

    def delete(self, path: str) -> None:
        self.files.pop(path, None)


# --- the fake client (hidden --fake): S11 answers, so the whole path runs for free ---------


def s11_answers(model: str) -> dict[str, dict[str, Any]]:
    """case id -> the latest ok S11 record, from the analysis model's files if it has any."""
    files = sorted(
        (f for f in RESULTS_DIR.glob("*.json") if "-generate" not in f.stem), reverse=True
    )
    mine = [f for f in files if f.stem.endswith(f"-{model}")]
    found: dict[str, dict[str, Any]] = {}
    for path in mine + [f for f in files if f not in mine]:  # the model's own first, newest first
        data = json.loads(path.read_text(encoding="utf-8"))
        for record in data.get("results", []):
            if record.get("ok") and record["case"] not in found:
                found[record["case"]] = record
    return found


class S11Client:
    """An AnalysisClient that answers each exam with its S11 answer (matched by exam name)."""

    def __init__(self, planned: Sequence[Planned], model: str) -> None:
        answers = s11_answers(model)
        self._model = model
        self._replies: list[tuple[str, dict[str, Any]]] = []
        for item in planned:
            record = answers.get(item.case_id)
            if record is None:
                raise SystemExit(f"--fake: no ok S11 result for {item.case_id} in eval/results")
            # As the name appears in the JSON of the request (a quote is escaped).
            name = json.dumps(str(item.case["exam"]["name"]), ensure_ascii=False)[1:-1]
            self._replies.append((name, record))
        self.calls = 0

    def complete(
        self,
        *,
        system: str,
        messages: Sequence[Mapping[str, Any]],
        schema: Mapping[str, Any],
        keepalive: Callable[[], None] | None = None,
    ) -> AnalysisReply:
        self.calls += 1
        if keepalive is not None:
            keepalive()
        first = json.dumps(messages[0], ensure_ascii=False)
        # The longest matching name, so that a name inside another one does not win.
        matches = [(name, rec) for name, rec in self._replies if name in first]
        if not matches:
            raise RuntimeError("--fake: no S11 answer matches this exam")
        record = max(matches, key=lambda m: len(m[0]))[1]
        text = json.dumps(
            {"topics": record["topics"], "tasks": record["tasks"], "gaps": record["gaps"]},
            ensure_ascii=False,
        )
        last = (record.get("usage") or [{}])[-1]
        usage = Usage(
            model=self._model,
            input_tokens=int(last.get("input_tokens", 0)),
            output_tokens=int(last.get("output_tokens", 0)),
            cache_creation_input_tokens=int(last.get("cache_creation_input_tokens", 0)),
            cache_read_input_tokens=int(last.get("cache_read_input_tokens", 0)),
        )
        return AnalysisReply(
            text=text,
            stop_reason="end_turn",
            usage=usage,
            content=[{"type": "text", "text": text}],
            request_id="req_fake",
        )


SLUG = re.compile(r"[a-z][a-z_]{0,59}")


def code(value: object) -> str:
    """A job or ingest error code for the screen: a slug, '-' for none, else '<invalid>'."""
    if value is None or value == "":
        return "-"
    return str(value) if isinstance(value, str) and SLUG.fullmatch(value) else "<invalid>"


class CappedClient:
    """Wraps the worker's client: before each call, spent + its estimate x CALL_SAFETY must
    stay within max_usd, or the call is refused with AiError (no retry) and nothing is paid.

    Spent is this process's running sum of the replies' usage, priced by models.json.
    """

    def __init__(
        self,
        inner: AnalysisClient,
        planned: Sequence[Planned],
        prices: Mapping[str, dict[str, float]],
        model: str,
        max_usd: float,
    ) -> None:
        self._inner = inner
        self._prices = prices
        self._max_usd = max_usd
        price = prices[model]
        self._estimates = [
            (
                json.dumps(str(p.case["exam"]["name"]), ensure_ascii=False)[1:-1],
                p.prepared.estimate_usd(price),
            )
            for p in planned
        ]
        self.spent = 0.0
        self.refused = 0

    def _estimate(self, messages: Sequence[Mapping[str, Any]]) -> float:
        first = json.dumps(messages[0], ensure_ascii=False) if messages else ""
        matches = [(name, usd) for name, usd in self._estimates if name in first]
        if matches:
            return max(matches, key=lambda m: len(m[0]))[1]
        return max(usd for _, usd in self._estimates)  # unknown exam: the dearest one

    def complete(
        self,
        *,
        system: str,
        messages: Sequence[Mapping[str, Any]],
        schema: Mapping[str, Any],
        keepalive: Callable[[], None] | None = None,
    ) -> AnalysisReply:
        estimate = self._estimate(messages)
        if self.spent + estimate * CALL_SAFETY > self._max_usd:
            self.refused += 1
            print(
                f"cap reached: spent={self.spent:.3f} + estimate={estimate:.3f} x{CALL_SAFETY} "
                f"> max_usd={self._max_usd:.2f}; call refused"
            )
            raise AiError("ai_unavailable", retry=False)
        reply = self._inner.complete(
            system=system, messages=messages, schema=schema, keepalive=keepalive
        )
        price = self._prices.get(reply.usage.model)
        if price is not None:
            self.spent += usage_usd(price, reply.usage)
        return reply


# --- the run ----------------------------------------------------------------------------


@dataclass
class Timings:
    exams: dict[UUID, float] = field(default_factory=dict)
    plan_ms: list[float] = field(default_factory=list)


@contextmanager
def timed_job(timings: Timings) -> Iterator[None]:
    """Time each exam's analysis and the job's replan (patched in this script only)."""
    real_analyze = plan_jobs.analyze_exam
    real_replan = plan_jobs.replan

    def analyze(**kwargs: Any) -> Any:
        started = time.perf_counter()
        try:
            return real_analyze(**kwargs)
        finally:
            timings.exams[kwargs["exam_id"]] = time.perf_counter() - started

    def replan(*args: Any, **kwargs: Any) -> Any:
        started = time.perf_counter()
        try:
            return real_replan(*args, **kwargs)
        finally:
            timings.plan_ms.append((time.perf_counter() - started) * 1000)

    with (
        mock.patch.object(plan_jobs, "analyze_exam", analyze),
        mock.patch.object(plan_jobs, "replan", replan),
    ):
        yield


def as_user(conn: Conn, user_id: UUID) -> Any:
    return user_transaction(conn, CurrentUser(id=user_id, email=None, claims={}))


def job_row(owner: Conn, job_id: UUID) -> dict[str, Any]:
    row = owner.execute(
        "SELECT id, kind, status, error, attempts, result, started_at, finished_at "
        "FROM app.jobs WHERE id = %s",
        (job_id,),
    ).fetchone()
    if row is None:
        raise RuntimeError("job not found")
    return dict(row)


def drain(worker: Worker, owner: Conn, until: UUID | None = None) -> None:
    """Run jobs until none is queued or running (or until the given job has ended)."""
    deadline = time.monotonic() + JOB_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if until is not None and job_row(owner, until)["status"] in ("done", "failed"):
            return
        if worker.run_once():
            continue
        pending = owner.execute(
            "SELECT count(*) AS n FROM app.jobs WHERE status IN ('queued', 'running')"
        ).fetchone()
        if until is None and (pending is None or pending["n"] == 0):
            return
        time.sleep(POLL_SECONDS)  # a retry waits for its backoff
    raise SystemExit("timed out waiting for the jobs")


def spent_usd(owner: Conn, prices: Mapping[str, dict[str, float]]) -> dict[str, Any]:
    rows = owner.execute(
        "SELECT job_id, exam_id, model, input_tokens, output_tokens, "
        "cache_creation_input_tokens, cache_read_input_tokens FROM app.ai_usage"
    ).fetchall()
    by_exam: dict[str, float] = {}
    by_job: dict[str, float] = {}
    total = 0.0
    unpriced = 0
    for row in rows:
        price = prices.get(row["model"])
        if price is None:
            unpriced += 1
            continue
        usage = Usage(
            model=row["model"],
            input_tokens=row["input_tokens"],
            output_tokens=row["output_tokens"],
            cache_creation_input_tokens=row["cache_creation_input_tokens"],
            cache_read_input_tokens=row["cache_read_input_tokens"],
        )
        cost = usage_usd(price, usage)
        total += cost
        by_exam[str(row["exam_id"])] = by_exam.get(str(row["exam_id"]), 0.0) + cost
        by_job[str(row["job_id"])] = by_job.get(str(row["job_id"]), 0.0) + cost
    return {
        "total": total,
        "calls": len(rows),
        "unpriced_calls": unpriced,
        "by_exam": by_exam,
        "by_job": by_job,
        "tokens_in": sum(r["input_tokens"] for r in rows),
        "tokens_out": sum(r["output_tokens"] for r in rows),
    }


def plan_metrics(api: Conn, user_id: UUID, now: dt.datetime) -> dict[str, Any]:
    with as_user(api, user_id) as conn:
        blocks = conn.execute(
            "SELECT b.task_id, t.exam_id, b.starts_at, b.ends_at FROM app.blocks AS b "
            "JOIN app.tasks AS t ON t.id = b.task_id AND t.user_id = b.user_id "
            "WHERE b.user_id = %s AND b.status = 'planned' ORDER BY b.starts_at",
            (user_id,),
        ).fetchall()
        tasks = conn.execute(
            "SELECT id, exam_id, kind, estimated_minutes FROM app.tasks "
            "WHERE user_id = %s AND deleted_at IS NULL AND status = 'todo'",
            (user_id,),
        ).fetchall()
        started = time.perf_counter()
        preview = preview_replan(conn, user_id, now)
        preview_ms = (time.perf_counter() - started) * 1000
    tz = ZoneInfo(TIMEZONE)
    minutes = [int((b["ends_at"] - b["starts_at"]).total_seconds() // 60) for b in blocks]
    days = {b["starts_at"].astimezone(tz).date() for b in blocks}
    per_exam: dict[str, dict[str, int]] = {}
    for block, length in zip(blocks, minutes, strict=True):
        entry = per_exam.setdefault(str(block["exam_id"]), {"blocks": 0, "minutes": 0})
        entry["blocks"] += 1
        entry["minutes"] += length
    task_minutes: dict[str, int] = {}
    for task in tasks:
        key = str(task["exam_id"])
        task_minutes[key] = task_minutes.get(key, 0) + task["estimated_minutes"]
    return {
        "blocks": len(blocks),
        "scheduled_minutes": sum(minutes),
        "tasks": len(tasks),
        "task_minutes": sum(t["estimated_minutes"] for t in tasks),
        "per_exam": per_exam,
        "task_minutes_per_exam": task_minutes,
        "study_days": len(days),
        "first_day": min(days).isoformat() if days else None,
        "last_day": max(days).isoformat() if days else None,
        "replan_preview_ms": preview_ms,
        "replan_preview_changed": preview.changed,
        "replan_preview_unscheduled": len(preview.unscheduled),
    }


def exam_titles(api: Conn, user_id: UUID, exam_id: UUID) -> dict[str, Any]:
    """The exam's tasks and topics with their titles: for the results file only."""
    with as_user(api, user_id) as conn:
        tasks = conn.execute(
            "SELECT title, kind, estimated_minutes, focus FROM app.tasks "
            "WHERE user_id = %s AND exam_id = %s AND deleted_at IS NULL "
            "ORDER BY position NULLS LAST, created_at",
            (user_id, exam_id),
        ).fetchall()
        topics = conn.execute(
            "SELECT name, weight FROM app.topics WHERE user_id = %s AND exam_id = %s "
            "ORDER BY position",
            (user_id, exam_id),
        ).fetchall()
    return {"tasks": [dict(t) for t in tasks], "topics": [dict(t) for t in topics]}


def try_preview(api: Conn, user_id: UUID, analysis_id: UUID, now: dt.datetime) -> dict[str, Any]:
    try:
        module = importlib.import_module("app.services.analyses")
        preview = module.preview_analysis
    except ImportError, AttributeError:
        print("reanalysis preview: skipped, app.services.analyses.preview_analysis not found")
        return {"skipped": "not_importable"}
    try:
        with as_user(api, user_id) as conn:
            result = preview(conn, user_id, analysis_id, now)
    except Exception as error:
        print(f"reanalysis preview: failed {type(error).__name__}")
        return {"failed": type(error).__name__}
    counts: dict[str, Any] = {}
    # preview_analysis returns (outcome, basis); keep only the outcome's numbers.
    outcome = result[0] if isinstance(result, tuple) else result
    if not dataclasses.is_dataclass(outcome):
        print(f"reanalysis preview: unexpected result {type(outcome).__name__}")
        return {"failed": "unexpected_result"}
    for name in (f.name for f in dataclasses.fields(outcome)):
        value = getattr(outcome, name)
        if isinstance(value, bool | int | float):
            counts[name] = value
        elif isinstance(value, list | tuple | dict | set | frozenset):
            counts[name] = len(value)
    print("reanalysis preview: " + " ".join(f"{k}={v}" for k, v in counts.items()))
    return {"counts": counts}


def setup() -> tuple[str, UUID]:
    """Recreate studyflow_eval, migrate it, and add the user, profile, exams and materials."""
    # This database is dropped: never postgres or a test run's database, and only locally.
    if DB_NAME == "postgres" or DB_NAME.startswith("studyflow_test"):
        raise SystemExit(f"refusing to drop database {DB_NAME}")
    admin = require_local_database_url(admin_database_url())
    url = create_database(admin, DB_NAME)
    command.upgrade(alembic_config(url), "head")
    user_id = uuid4()
    with psycopg.connect(url, autocommit=True) as owner:
        owner.execute(
            "INSERT INTO auth.users (id, email) VALUES (%s, %s)",
            (user_id, f"{user_id}@example.com"),
        )
    return url, user_id


def add_board(
    api: Conn,
    user_id: UUID,
    planned: Sequence[Planned],
    storage: DiskStorage,
    settings: Settings,
    now: dt.datetime,
) -> None:
    with as_user(api, user_id) as conn:
        update_profile(conn, user_id, PROFILE)
        for item in planned:
            exam = item.case["exam"]
            row = create_exam(
                conn, user_id, now, str(exam["name"]), item.exam_date, int(exam["difficulty"])
            )
            item.exam_id = row["id"]
            for spec in item.case["materials"]:
                if "path" not in spec:
                    raise SystemExit(f"{item.case_id}: only file materials are supported here")
                path = MATERIALS_DIR / spec["path"]
                data = path.read_bytes()
                mime = sniff_mime(data)
                if mime is None:
                    raise SystemExit(f"{item.case_id}: a material is not a supported file")
                material_id = uuid4()
                register_material(
                    conn,
                    user_id,
                    item.exam_id,
                    material_id=material_id,
                    filename=path.name,
                    kind=MaterialKind(spec["kind"]),
                    mime=mime,
                    size_bytes=len(data),
                    settings=settings,
                )
                storage.files[f"{user_id}/{item.exam_id}/{material_id}"] = path
                item.material_ids.append(material_id)


def run(
    planned: list[Planned],
    settings: Settings,
    prices: dict[str, dict[str, float]],
    estimate: float,
    args: argparse.Namespace,
) -> int:
    model = settings.ai_model_analysis or ""
    now = dt.datetime.now(dt.UTC)
    url, user_id = setup()
    storage = DiskStorage()
    report: dict[str, Any] = {
        "model": model,
        "fake": bool(args.fake),
        "profile": {k: str(v) if isinstance(v, dt.time) else v for k, v in PROFILE.items()},
        "estimate_usd": estimate,
        "max_usd": args.max_usd,
    }
    inner: Callable[[Settings], AnalysisClient] = AnthropicAnalysisClient.from_settings
    if args.fake:
        fake = S11Client(planned, model)
        inner = lambda _settings: fake  # noqa: E731
    capped: list[CappedClient] = []

    def factory(job_settings: Settings) -> AnalysisClient:
        # Built once per job; the running sum carries over from the jobs before it.
        client = CappedClient(inner(job_settings), planned, prices, model, args.max_usd)
        client.spent = sum(c.spent for c in capped)
        capped.append(client)
        return client

    api_url = make_conninfo(url, user="studyflow_api")
    with (
        psycopg.connect(url, row_factory=dict_row, autocommit=True) as owner,
        psycopg.connect(api_url, row_factory=dict_row, autocommit=True) as api,
    ):
        add_board(api, user_id, planned, storage, settings, now)
        worker = Worker(
            url,
            storage=storage,
            settings=settings,
            handlers=HANDLERS,
            on_crashed=ON_CRASHED,
            ai_client_factory=factory,
        )
        worker.connect()
        try:
            started = time.perf_counter()
            drain(worker, owner)
            ingest = owner.execute(
                "SELECT ingest_status, ingest_error, page_count, scanned_pages "
                "FROM app.materials WHERE user_id = %s",
                (user_id,),
            ).fetchall()
            statuses = Counter(
                code(r["ingest_status"])
                + (f":{code(r['ingest_error'])}" if r["ingest_error"] else "")
                for r in ingest
            )
            pages = sum(r["page_count"] or 0 for r in ingest)
            scanned = sum(r["scanned_pages"] or 0 for r in ingest)
            print(
                f"ingest: materials={len(ingest)} "
                + " ".join(f"{k}={v}" for k, v in sorted(statuses.items()))
                + f" pages={pages} scanned={scanned} seconds={time.perf_counter() - started:.1f}"
            )
            report["ingest"] = {"statuses": dict(statuses), "pages": pages, "scanned": scanned}

            now = dt.datetime.now(dt.UTC)
            with as_user(api, user_id) as conn:
                generation = request_generation(conn, user_id, now, settings)
            timings = Timings()
            started = time.perf_counter()
            with timed_job(timings):
                drain(worker, owner, until=generation.job_id)
            job_seconds = time.perf_counter() - started
            job = job_row(owner, generation.job_id)
            print(
                f"job: status={code(job['status'])} error={code(job['error'])} "
                f"attempts={job['attempts']} seconds={job_seconds:.1f}"
            )
            report["job"] = {k: v for k, v in job.items() if k not in ("started_at", "finished_at")}
            report["job"]["seconds"] = job_seconds
            report["job"]["id"] = str(job["id"])
            result = job["result"] or {}

            cost = spent_usd(owner, prices)
            names = {str(item.exam_id): item.case_id for item in planned}
            report["exams"] = []
            for entry in result.get("exams", []):
                exam_id = entry["exam_id"]
                case_id = names.get(exam_id, "?")
                seconds = timings.exams.get(UUID(exam_id))
                exam_cost = cost["by_exam"].get(exam_id, 0.0)
                print(
                    f"exam {case_id}: status={code(entry['status'])} "
                    f"error={code(entry.get('error'))} "
                    f"topics={entry['topics']} tasks={entry['tasks']} gaps={len(entry['gaps'])} "
                    f"minutes={entry['total_minutes']}/{entry['budget_minutes']} "
                    f"warnings={','.join(map(code, entry['warnings'])) or '-'} "
                    f"dropped={len(entry['dropped'])} "
                    f"seconds={'-' if seconds is None else f'{seconds:.1f}'} "
                    f"cost={exam_cost:.3f}"
                )
                report["exams"].append(
                    dict(entry, case=case_id, seconds=seconds, cost_usd=exam_cost)
                    | exam_titles(api, user_id, UUID(exam_id))
                )

            plan = result.get("plan", {})
            reasons = Counter(item["reason"] for item in plan.get("unscheduled", []))
            shortfalls = plan.get("shortfalls", [])
            metrics = plan_metrics(api, user_id, dt.datetime.now(dt.UTC))
            plan_ms = timings.plan_ms[-1] if timings.plan_ms else None
            print(
                f"plan: blocks={metrics['blocks']} scheduled_min={metrics['scheduled_minutes']} "
                f"task_min={metrics['task_minutes']} tasks={metrics['tasks']} "
                f"study_days={metrics['study_days']} "
                f"unscheduled={plan.get('unscheduled_count', 0)} "
                f"({','.join(f'{code(k)}:{v}' for k, v in sorted(reasons.items())) or '-'}) "
                f"shortfalls={len(shortfalls)} "
                f"shortfall_min={sum(s['minutes'] for s in shortfalls)} "
                f"warnings={','.join(map(code, plan.get('warnings', []))) or '-'}"
            )
            for item in planned:
                key = str(item.exam_id)
                share = metrics["per_exam"].get(key, {"blocks": 0, "minutes": 0})
                print(
                    f"plan {item.case_id}: blocks={share['blocks']} "
                    f"scheduled_min={share['minutes']} "
                    f"task_min={metrics['task_minutes_per_exam'].get(key, 0)}"
                )
            print(
                f"plan timing: job_replan_ms={'-' if plan_ms is None else f'{plan_ms:.0f}'} "
                f"preview_replan_ms={metrics['replan_preview_ms']:.0f} "
                f"preview_changed={'yes' if metrics['replan_preview_changed'] else 'no'}"
            )
            report["plan"] = plan | {
                "metrics": metrics,
                "unscheduled_by_reason": dict(reasons),
                "job_replan_ms": plan_ms,
            }

            if args.reanalyze:
                report["reanalysis"] = reanalyze(
                    planned[0], worker, owner, api, user_id, settings, prices, args
                )
            cost = spent_usd(owner, prices)
            report["cost"] = cost
            print(
                f"cost: calls={cost['calls']} tokens={cost['tokens_in']}/{cost['tokens_out']} "
                f"spent_usd={cost['total']:.3f} estimate_usd={estimate:.3f} "
                f"max_usd={args.max_usd:.2f}"
                + (f" unpriced_calls={cost['unpriced_calls']}" if cost["unpriced_calls"] else "")
                + (" (fake: S11 tokens, no call made)" if args.fake else "")
            )
        finally:
            worker.close()

    RESULTS_DIR.mkdir(exist_ok=True)
    stamp = dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%SZ")
    path = RESULTS_DIR / f"{stamp}-generate{'-fake' if args.fake else ''}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(f"results written to eval/results/{path.name}")
    return 0


def reanalyze(
    item: Planned,
    worker: Worker,
    owner: Conn,
    api: Conn,
    user_id: UUID,
    settings: Settings,
    prices: dict[str, dict[str, float]],
    args: argparse.Namespace,
) -> dict[str, Any]:
    if item.exam_id is None:
        raise RuntimeError("the exam was not created")
    spent = spent_usd(owner, prices)["total"]
    estimate = item.prepared.estimate_usd(prices[settings.ai_model_analysis or ""])
    if spent + estimate * SAFETY > args.max_usd:
        print(
            f"reanalysis {item.case_id}: skipped, spent={spent:.3f} estimate={estimate:.3f} "
            f"max_usd={args.max_usd:.2f}"
        )
        return {"skipped": True, "spent_usd": spent, "estimate_usd": estimate}
    now = dt.datetime.now(dt.UTC)
    with as_user(api, user_id) as conn:
        request = request_reanalysis(conn, user_id, item.exam_id, now, settings)
    started = time.perf_counter()
    drain(worker, owner, until=request.job_id)
    seconds = time.perf_counter() - started
    job = job_row(owner, request.job_id)
    result = job["result"] or {}
    job_cost = spent_usd(owner, prices)["by_job"].get(str(request.job_id), 0.0)
    print(
        f"reanalysis {item.case_id}: status={code(job['status'])} "
        f"error={code(job['error'])} "
        f"topics={result.get('topics', '-')} tasks={result.get('tasks', '-')} "
        f"minutes={result.get('total_minutes', '-')}/{result.get('budget_minutes', '-')} "
        f"warnings={','.join(map(code, result.get('warnings', []))) or '-'} "
        f"seconds={seconds:.1f} cost={job_cost:.3f}"
    )
    record: dict[str, Any] = {
        "status": job["status"],
        "error": job["error"],
        "result": result,
        "seconds": seconds,
        "cost_usd": job_cost,
    }
    if job["status"] == "done" and "analysis_id" in result:
        record["preview"] = try_preview(
            api, user_id, UUID(result["analysis_id"]), dt.datetime.now(dt.UTC)
        )
    return record


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--cases", help=f"comma-separated; default: {','.join(DEFAULT_CASES)}")
    parser.add_argument("--run", action="store_true", help="run it for real (needs a key)")
    parser.add_argument("--max-usd", type=float, default=1.5)
    parser.add_argument("--reanalyze", action="store_true", help="also reanalyze the first exam")
    parser.add_argument(
        "--model", help=f"default: AI_MODEL_ANALYSIS from api/.env, else {DEFAULT_MODEL}"
    )
    # Answers each exam with its S11 result from eval/results: no network, no key, no cost.
    parser.add_argument("--fake", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()

    prices: dict[str, dict[str, float]] = json.loads((EVAL_DIR / "models.json").read_text())
    all_cases: list[dict[str, Any]] = json.loads((EVAL_DIR / "analysis_cases.json").read_text())
    wanted = args.cases.split(",") if args.cases else list(DEFAULT_CASES)
    by_id = {c["id"]: c for c in all_cases}
    if any(w not in by_id for w in wanted):
        print("unknown case id")
        return 2
    cases = [by_id[w] for w in wanted]

    settings = load_settings()
    model = args.model or settings.ai_model_analysis or DEFAULT_MODEL
    price = prices.get(model)
    if price is None:
        print(f"no price for model {model}: add it to eval/models.json")
        return 2
    # The worker's client reads the model from the settings: this run's model goes there.
    settings = settings.model_copy(update={"ai_model_analysis": model})

    planned = plan_cases(cases, settings, dt.datetime.now(dt.UTC))
    estimate = print_estimate(planned, model, price, args.reanalyze)
    if not args.run:
        return 0
    if not args.fake:
        if settings.anthropic_api_key is None:
            print("ANTHROPIC_API_KEY is not set in api/.env")
            return 2
        if estimate * SAFETY > args.max_usd:
            print(
                f"stopped: estimate x{SAFETY} = {estimate * SAFETY:.3f} is over "
                f"max_usd={args.max_usd:.2f}; nothing was called"
            )
            return 1
    return run(planned, settings, prices, estimate, args)


if __name__ == "__main__":
    raise SystemExit(main())
