"""The AI jobs: generate a plan from every new exam, and analyze one exam again as a draft.

`generate_plan` analyzes each exam of its payload in turn (a first analysis, saved with its
topics and tasks), then plans the whole board in one transaction of the user and saves it
as a `plan_generated` version. Failures fall in three groups:

- the account's (`ai_not_configured`, `ai_no_credit`): the job fails at once with that code,
  without a retry and without planning;
- transient (`ai_unavailable`, `storage_unavailable`, any failure marked retry): the job is
  retried while it has attempts; the retry skips every exam this job already analyzed (it
  has AI tasks) or failed for good (an `analyses` row `failed` of this job), so nothing is
  paid twice. On the last attempt it is recorded as that exam's failure;
- the exam's (everything else): recorded as a `failed` analysis, and the job goes on.

If no exam ends analyzed or skipped, the job fails with the first exam's failure code: a
"done" with an empty board would hide that the AI failed.

Every paid call is written to app.ai_usage right after its exam, before the plan is
written, so a crash later does not lose the record of money already spent.

Each Claude call runs inside `ctx.keeping_alive()`: a ticker renews the job's lock while the
call is quiet (the SDK drops the API's ping events), and the call also gets
`ctx.keepalive` for its streamed events.

No crash callback (ON_CRASHED) is needed: a job that crashed on every attempt fails as
`worker_crashed`, and it leaves no row in an in-between state (an analysis is written in
one transaction, the plan in another).

Nothing here logs material text, titles, the prompt or the answer: ids, codes and numbers.
"""

import datetime as dt
import json
import logging
import time
from collections.abc import Callable, Mapping, Sequence
from typing import Any, Final
from uuid import UUID

from app.ai.client import AiError, AnalysisClient, AnalysisReply
from app.ai.schema import GapOut
from app.domain.planner import PlanResult, exam_budgets, replan
from app.domain.time import local_date
from app.jobs.worker import KEEPALIVE_SECONDS, JobContext, JobFailed
from app.services.analysis import (
    AnalysisFailed,
    AnalysisOutcome,
    analyze_exam,
    draft_analysis,
    failed_exams_of_job,
    record_failed_analysis,
)
from app.services.board import load_board
from app.services.plan_writes import VersionReason, apply_result
from app.services.profiles import Conn

logger = logging.getLogger(__name__)

ACCOUNT_CODES: Final = frozenset({"ai_not_configured", "ai_no_credit"})
EXAM_MISSING: Final = "exam_missing"
# Skipped as a success: the exam got AI tasks, or was deleted, while this job ran.
SKIP_CODES: Final = frozenset({"already_analyzed", EXAM_MISSING})

# How often the ticker renews the lock during a Claude call (a module value, for tests).
TICK_SECONDS: float = KEEPALIVE_SECONDS

# app.jobs.result is CHECK (pg_column_size(result) <= 65536); compact JSON is a close
# measure of the jsonb size, and the margin covers the difference.
MAX_RESULT_BYTES: Final = 56_000
MAX_UNSCHEDULED: Final = 200

# The overall progress: reading 2, the exams share 5..85, planning 88; finish sets 100.
EXAMS_START: Final = 5
EXAMS_SPAN: Final = 80


class _KeptAliveClient:
    """An AnalysisClient that runs every call inside the job's keepalive ticker."""

    def __init__(self, ctx: JobContext, client: AnalysisClient) -> None:
        self._ctx = ctx
        self._client = client

    def complete(
        self,
        *,
        system: str,
        messages: Sequence[Mapping[str, Any]],
        schema: Mapping[str, Any],
        keepalive: Callable[[], None] | None = None,
    ) -> AnalysisReply:
        with self._ctx.keeping_alive(interval=TICK_SECONDS):
            return self._client.complete(
                system=system, messages=messages, schema=schema, keepalive=keepalive
            )


def _client(ctx: JobContext) -> AnalysisClient:
    try:
        client = ctx.ai_client()
    except AiError as error:
        raise JobFailed(error.code) from None
    return _KeptAliveClient(ctx, client)


def _uuid(value: object) -> UUID:
    try:
        return UUID(str(value))
    except ValueError:
        raise JobFailed(EXAM_MISSING) from None


def _exam_ids(payload: Mapping[str, Any]) -> list[UUID]:
    raw = payload.get("exam_ids")
    if not isinstance(raw, list) or not raw:
        raise JobFailed(EXAM_MISSING)
    return list(dict.fromkeys(_uuid(value) for value in raw))


def _budgets(conn: Conn, user_id: UUID, now: dt.datetime) -> tuple[dict[UUID, int], dt.date]:
    """Every live upcoming exam's budget (analyzed ones too: they share the same days)."""
    board = load_board(conn, user_id, now)
    budgets = exam_budgets(board.profile, board.exams, now)
    return budgets, local_date(now, board.profile.timezone)


def _gaps(gaps: Sequence[GapOut]) -> list[dict[str, str]]:
    return [{"topic": gap.topic, "note": gap.note} for gap in gaps]


def _empty(exam_id: UUID, status: str, budget: int, error: str | None = None) -> dict[str, Any]:
    entry: dict[str, Any] = {"exam_id": str(exam_id), "status": status}
    if error is not None:
        entry["error"] = error
    entry.update(
        topics=0, tasks=0, gaps=[], warnings=[], dropped=[], total_minutes=0, budget_minutes=budget
    )
    return entry


def _analyzed(exam_id: UUID, outcome: AnalysisOutcome) -> dict[str, Any]:
    return {
        "exam_id": str(exam_id),
        "status": "analyzed",
        "analysis_id": str(outcome.analysis_id),
        "topics": len(outcome.topic_ids),
        "tasks": len(outcome.task_ids),
        "gaps": _gaps(outcome.gaps),
        "warnings": list(outcome.warnings),
        "dropped": list(outcome.dropped),
        "total_minutes": outcome.total_minutes,
        "budget_minutes": outcome.budget_minutes,
    }


def _earlier(
    conn: Conn, user_id: UUID, job_id: UUID, exam_id: UUID, budget: int
) -> dict[str, Any] | None:
    """What an earlier attempt of this job did to the exam: its analysis or its failure."""
    row = conn.execute(
        "SELECT id, status, error, output, warnings, dropped, total_minutes, budget_minutes "
        "FROM app.analyses WHERE user_id = %s AND job_id = %s AND exam_id = %s "
        "AND status IN ('applied', 'failed') ORDER BY created_at DESC, id LIMIT 1",
        (user_id, job_id, exam_id),
    ).fetchone()
    if row is None:
        return None
    if row["status"] == "failed":
        return _empty(exam_id, "failed", budget, row["error"])
    output = row["output"]
    return {
        "exam_id": str(exam_id),
        "status": "analyzed",
        "analysis_id": str(row["id"]),
        "topics": len(output.get("topics", [])),
        "tasks": len(output.get("tasks", [])),
        "gaps": [{"topic": g["topic"], "note": g["note"]} for g in output.get("gaps", [])],
        "warnings": list(row["warnings"] or []),
        "dropped": list(row["dropped"] or []),
        "total_minutes": row["total_minutes"] or 0,
        "budget_minutes": row["budget_minutes"] or 0,
    }


def _has_ai_tasks(conn: Conn, user_id: UUID, exam_id: UUID) -> bool:
    row = conn.execute(
        "SELECT EXISTS (SELECT 1 FROM app.tasks WHERE user_id = %s AND exam_id = %s "
        "AND source = 'ai' AND deleted_at IS NULL) AS found",
        (user_id, exam_id),
    ).fetchone()
    return bool(row is not None and row["found"])


def _exam_progress(ctx: JobContext, index: int, count: int) -> Callable[[str, int], None]:
    """The analysis's own progress (0..100), mapped into this exam's share of 5..85."""
    start = EXAMS_START + EXAMS_SPAN * index / count
    span = EXAMS_SPAN / count

    def report(stage: str, percent: int) -> None:
        ctx.progress(
            "saving" if stage == "saving" else "analyzing", int(start + span * percent / 100)
        )

    return report


def _shrink(result: dict[str, Any], gaps: int, unscheduled: int) -> dict[str, Any]:
    exams = [dict(exam, gaps=list(exam.get("gaps", []))[:gaps]) for exam in result["exams"]]
    plan = dict(
        result["plan"], unscheduled=list(result["plan"].get("unscheduled", []))[:unscheduled]
    )
    return dict(result, exams=exams, plan=plan)


def _size(result: Mapping[str, Any]) -> int:
    return len(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode())


def fit_result(result: dict[str, Any]) -> dict[str, Any]:
    """The result cut to fit app.jobs.result: fewer unscheduled tasks, then fewer gaps.

    The counts stay whole (unscheduled_count, tasks); the cut lists are kept in full in
    app.analyses (the gaps) and in the board (what is unscheduled).
    """
    for gaps, unscheduled in ((20, 200), (20, 100), (10, 100), (10, 50), (5, 50), (0, 0)):
        if _size(result) <= MAX_RESULT_BYTES:
            return result
        result = _shrink(result, gaps, unscheduled)
    return result


def _plan_result(version_id: UUID | None, result: PlanResult) -> dict[str, Any]:
    return {
        "version_id": None if version_id is None else str(version_id),
        "blocks": len(result.blocks),
        "unscheduled": [
            {"task_id": str(item.task_id), "reason": item.reason.value}
            for item in result.unscheduled[:MAX_UNSCHEDULED]
        ],
        "unscheduled_count": len(result.unscheduled),
        "shortfalls": [
            {"exam_id": str(s.exam_id), "minutes": s.minutes, "daily_minutes": s.daily_minutes}
            for s in result.shortfalls
        ],
        "warnings": [warning.code.value for warning in result.warnings],
    }


def _analyze_one(
    ctx: JobContext,
    client: AnalysisClient,
    exam_id: UUID,
    budget: int,
    today: dt.date,
    progress: Callable[[str, int], None],
) -> dict[str, Any]:
    """Analyze one exam: its result entry, or JobFailed when the job must stop."""
    user_id = ctx.job.user_id
    try:
        outcome = analyze_exam(
            transaction=ctx.user_transaction,
            storage=ctx.storage,
            client=client,
            settings=ctx.settings,
            user_id=user_id,
            exam_id=exam_id,
            budget_minutes=budget,
            today=today,
            progress=progress,
            keepalive=ctx.keepalive,
            job_id=ctx.job.id,
        )
    except AnalysisFailed as failed:
        ctx.record_usage(failed.usage, exam_id=exam_id)
        code = failed.code
        logger.info("job %s exam %s analysis failed: %s", ctx.job.id, exam_id, code)
        if code in ACCOUNT_CODES:
            raise JobFailed(code) from None
        if code in SKIP_CODES:
            return _empty(exam_id, "skipped", budget)
        if failed.retry and not ctx.last_attempt:
            raise JobFailed(code, retry=True) from None
        with ctx.user_transaction() as conn:
            record_failed_analysis(conn, user_id, exam_id, ctx.job.id, code)
        return _empty(exam_id, "failed", budget, code)
    ctx.record_usage(outcome.usage, exam_id=exam_id)
    return _analyzed(exam_id, outcome)


def generate_plan(ctx: JobContext) -> dict[str, Any]:
    exam_ids = _exam_ids(ctx.job.payload)
    user_id = ctx.job.user_id
    ctx.progress("reading_materials", 2)
    with ctx.user_transaction() as conn:
        budgets, today = _budgets(conn, user_id, ctx.now)
        failed_before = failed_exams_of_job(conn, user_id, ctx.job.id)
    client = _client(ctx)

    exams: list[dict[str, Any]] = []
    for index, exam_id in enumerate(exam_ids):
        budget = budgets.get(exam_id)
        if budget is None:  # deleted, past, or not this user's
            exams.append(_empty(exam_id, "skipped", 0))
            continue
        with ctx.user_transaction() as conn:
            has_ai_tasks = _has_ai_tasks(conn, user_id, exam_id)
            earlier = (
                _earlier(conn, user_id, ctx.job.id, exam_id, budget)
                if has_ai_tasks or exam_id in failed_before
                else None
            )
        if earlier is not None:  # this job's earlier attempt analyzed it or failed it
            exams.append(earlier)
            continue
        if has_ai_tasks:  # analyzed by another job meanwhile
            exams.append(_empty(exam_id, "skipped", budget))
            continue
        exams.append(
            _analyze_one(
                ctx, client, exam_id, budget, today, _exam_progress(ctx, index, len(exam_ids))
            )
        )

    if not any(exam["status"] in ("analyzed", "skipped") for exam in exams):
        first = next(exam["error"] for exam in exams if exam["status"] == "failed")
        raise JobFailed(first)

    ctx.progress("planning", 88)
    # One transaction: the board is locked from its load to the write. A progress report
    # cannot run inside it (it renews the lock as the owner), so "saving_plan" is not sent.
    with ctx.user_transaction() as conn:
        board = load_board(conn, user_id, ctx.now, lock=True)
        started = time.perf_counter()
        result = replan(board.profile, board.exams, board.tasks, board.existing, board.now)
        logger.info("job %s plan took %d ms", ctx.job.id, (time.perf_counter() - started) * 1000)
        version_id = apply_result(conn, user_id, board, result, VersionReason.PLAN_GENERATED)
    return fit_result({"exams": exams, "plan": _plan_result(version_id, result)})


def reanalyze_exam(ctx: JobContext) -> dict[str, Any]:
    user_id = ctx.job.user_id
    exam_id = _uuid(ctx.job.payload.get("exam_id"))
    with ctx.user_transaction() as conn:
        budgets, today = _budgets(conn, user_id, ctx.now)
    if exam_id not in budgets:  # deleted, past, or not this user's
        raise JobFailed(EXAM_MISSING)
    client = _client(ctx)
    try:
        outcome = draft_analysis(
            transaction=ctx.user_transaction,
            storage=ctx.storage,
            client=client,
            settings=ctx.settings,
            user_id=user_id,
            exam_id=exam_id,
            budget_minutes=budgets[exam_id],
            today=today,
            progress=ctx.progress,
            keepalive=ctx.keepalive,
            job_id=ctx.job.id,
        )
    except AnalysisFailed as failed:
        ctx.record_usage(failed.usage, exam_id=exam_id)
        logger.info("job %s exam %s reanalysis failed: %s", ctx.job.id, exam_id, failed.code)
        # The worker retries only while attempts remain; account codes never retry.
        raise JobFailed(
            failed.code, retry=failed.retry and failed.code not in ACCOUNT_CODES
        ) from None
    ctx.record_usage(outcome.usage, exam_id=exam_id)
    return {
        "analysis_id": str(outcome.analysis_id),
        "exam_id": str(exam_id),
        "tasks": outcome.tasks,
        "topics": outcome.topics,
        "gaps": _gaps(outcome.gaps),
        "warnings": list(outcome.warnings),
        "dropped": list(outcome.dropped),
        "total_minutes": outcome.total_minutes,
        "budget_minutes": outcome.budget_minutes,
    }
