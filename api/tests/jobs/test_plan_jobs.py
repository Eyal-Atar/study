"""The generate_plan and reanalyze_exam jobs: analyze each new exam, then plan the board."""

import datetime as dt
import json
import time
from collections.abc import Callable, Mapping, Sequence
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg.rows import DictRow

import app.jobs.plan_jobs as plan_jobs
import app.services.analysis as analysis_module
from app.ai.client import AiError, AnalysisReply
from app.config import Settings
from app.domain.materials import JOB_GENERATE_PLAN, JOB_REANALYZE_EXAM
from app.domain.planner import Exam, exam_budgets
from app.jobs.ingest import HANDLERS, ON_CRASHED
from app.jobs.queue import JobRow
from app.jobs.worker import JobContext, Worker
from app.services.profiles import ensure_profile, to_planner_profile
from tests.ai.fake_client import FakeAnalysisClient, reply
from tests.ai.samples import valid_output_dict
from tests.api.factories import NOW, TEST_PROFILE, insert_exam, scalar, set_profile
from tests.fixtures_db import FrozenClock
from tests.jobs.conftest import MakeJob
from tests.jobs.test_analysis import AddMaterial

type MakeWorker = Callable[..., Worker]
type ReadJob = Callable[[UUID], JobRow]

EXAM_A = dt.date(2027, 1, 10)
EXAM_B = dt.date(2027, 1, 20)


def valid() -> AnalysisReply:
    return reply(json.dumps(valid_output_dict(), ensure_ascii=False))


def invalid() -> AnalysisReply:
    return reply("not json")


class HookedClient(FakeAnalysisClient):
    """A fake that runs a side effect inside complete, before it answers."""

    def __init__(
        self,
        replies: Sequence[AnalysisReply | AiError],
        hook: Callable[[Callable[[], None] | None], None],
    ) -> None:
        super().__init__(replies)
        self._hook = hook

    def complete(self, **kwargs: Any) -> AnalysisReply:
        self._hook(kwargs.get("keepalive"))
        return super().complete(**kwargs)


class QuietClient(HookedClient):
    """A hooked fake that never calls keepalive: a call with no streamed events."""

    def complete(self, **kwargs: Any) -> AnalysisReply:
        return super().complete(**(kwargs | {"keepalive": None}))


@pytest.fixture
def user(make_user: Callable[[], Any], db: psycopg.Connection, clock: FrozenClock) -> Any:
    clock.set(NOW)
    created = make_user()
    set_profile(db, created.id, **TEST_PROFILE)
    return created


@pytest.fixture
def add_material(db: psycopg.Connection, storage: Any) -> AddMaterial:
    return AddMaterial(db, storage)


@pytest.fixture
def new_exam(db: psycopg.Connection, user: Any, add_material: AddMaterial) -> Callable[..., UUID]:
    """An exam with a syllabus and a past exam, ready: M1 and M2 of the sample output."""

    def make(exam_date: dt.date = EXAM_A, *, difficulty: int = 3) -> UUID:
        exam_id = insert_exam(db, user.id, exam_date=exam_date, difficulty=difficulty)
        add_material(user, exam_id, kind="past_exam")
        add_material(user, exam_id, kind="syllabus")
        return exam_id

    return make


@pytest.fixture
def run(
    make_worker: MakeWorker, make_job: MakeJob, read_job: ReadJob, user: Any
) -> Callable[..., JobRow]:
    """Queue a job and run it once with this fake client; the job as it ended."""

    def go(
        client: FakeAnalysisClient | None,
        payload: Mapping[str, Any],
        *,
        kind: str = JOB_GENERATE_PLAN,
        factory: Callable[[Settings], Any] | None = None,
        job_id: UUID | None = None,
    ) -> JobRow:
        if job_id is None:
            job_id = make_job(user, kind, payload)
        worker = make_worker(
            HANDLERS,
            on_crashed=ON_CRASHED,
            ai_client_factory=factory if factory is not None else (lambda _settings: client),
        )
        assert worker.run_once()
        return read_job(job_id)

    return go


def _generate(*exams: UUID) -> dict[str, Any]:
    return {"exam_ids": [str(exam) for exam in exams]}


def _count(db: psycopg.Connection, query: str, *params: object) -> int:
    value: int = scalar(db, query, *params)
    return value


def _ai_tasks(db: psycopg.Connection, exam: UUID) -> int:
    return _count(
        db,
        "SELECT count(*) FROM app.tasks WHERE exam_id = %s AND source = 'ai' "
        "AND deleted_at IS NULL",
        exam,
    )


def _usage(db: psycopg.Connection, job_id: UUID) -> int:
    return _count(db, "SELECT count(*) FROM app.ai_usage WHERE job_id = %s", job_id)


def _insert_ai_task(db: psycopg.Connection, user: Any, exam: UUID) -> None:
    db.execute(
        "INSERT INTO app.tasks (user_id, exam_id, title, kind, estimated_minutes, source) "
        "VALUES (%s, %s, 'משימה', 'learn', 60, 'ai')",
        (user.id, exam),
    )


def _retry(clock: FrozenClock) -> None:
    clock.advance(minutes=10)  # past any backoff


# --- the happy path ----------------------------------------------------------------------


def test_generate_analyzes_and_plans(
    run: Callable[..., JobRow], new_exam: Callable[..., UUID], db: psycopg.Connection
) -> None:
    a, b = new_exam(EXAM_A), new_exam(EXAM_B)
    client = FakeAnalysisClient([valid(), valid()])

    job = run(client, _generate(a, b))

    assert job.status == "done", job.error
    assert job.result is not None
    exams = job.result["exams"]
    assert [e["exam_id"] for e in exams] == [str(a), str(b)]
    assert [e["status"] for e in exams] == ["analyzed", "analyzed"]
    assert exams[0]["tasks"] == 7
    assert exams[0]["topics"] == 3
    assert exams[0]["gaps"] == [{"topic": "טורים", "note": "לא מופיע בחומרים"}]
    assert UUID(exams[0]["analysis_id"])
    assert _count(db, "SELECT count(*) FROM app.blocks") > 0
    plan = job.result["plan"]
    assert plan["blocks"] == _count(db, "SELECT count(*) FROM app.blocks")
    version = db.execute(
        "SELECT reason FROM app.plan_versions WHERE id = %s", (plan["version_id"],)
    ).fetchone()
    assert version == ("plan_generated",)
    assert _count(db, "SELECT count(*) FROM app.ai_usage WHERE job_id = %s", job.id) == 2
    assert _count(db, "SELECT count(DISTINCT exam_id) FROM app.ai_usage") == 2


def test_progress_moves_forward(
    run: Callable[..., JobRow],
    new_exam: Callable[..., UUID],
    owner_db: psycopg.Connection[DictRow],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    a, b = new_exam(EXAM_A), new_exam(EXAM_B)
    reported: list[tuple[str, int]] = []
    original = JobContext.progress

    def record(self: JobContext, stage: str, percent: int) -> None:
        reported.append((stage, percent))
        original(self, stage, percent)

    monkeypatch.setattr(JobContext, "progress", record)
    seen: list[int] = []

    def hook(_keepalive: Callable[[], None] | None) -> None:
        row = owner_db.execute(
            "SELECT percent FROM app.jobs WHERE kind = %s", (JOB_GENERATE_PLAN,)
        ).fetchone()
        assert row is not None
        seen.append(row["percent"])

    job = run(HookedClient([valid(), valid()], hook), _generate(a, b))

    assert job.status == "done", job.error
    percents = [percent for _stage, percent in reported]
    assert percents == sorted(percents)
    assert percents[0] == 2
    assert reported[-1] == ("planning", 88)
    # The analysis's own stages reach jobs.stage, each inside its exam's share.
    assert {stage for stage, _ in reported} == {
        "reading_materials",
        "analyzing",
        "validating",
        "saving",
        "planning",
    }
    validating = [percent for stage, percent in reported if stage == "validating"]
    assert len(validating) == 2
    assert 5 <= validating[0] < 45 <= validating[1] < 85
    assert len(seen) == 2 and seen[0] < seen[1] < 88
    assert seen[1] >= 45  # the second exam reports in the second half
    assert job.percent == 100


# --- failures and retries ----------------------------------------------------------------


def test_retry_after_a_transient_failure_skips_the_analyzed_exam(
    run: Callable[..., JobRow],
    new_exam: Callable[..., UUID],
    db: psycopg.Connection,
    clock: FrozenClock,
) -> None:
    a, b = new_exam(EXAM_A), new_exam(EXAM_B)
    client = FakeAnalysisClient([valid(), AiError("ai_unavailable", retry=True), valid()])

    first = run(client, _generate(a, b))
    assert first.status == "queued"
    assert first.error == "ai_unavailable"
    assert _ai_tasks(db, a) == 7
    assert len(client.calls) == 2

    _retry(clock)
    second = run(client, {}, job_id=first.id)

    assert second.status == "done", second.error
    assert len(client.calls) == 3  # only B was asked again
    assert second.result is not None
    exams = second.result["exams"]
    # A was analyzed by this job's first attempt, and is reported as such.
    assert [e["status"] for e in exams] == ["analyzed", "analyzed"]
    assert exams[0]["tasks"] == 7
    assert _ai_tasks(db, a) == 7
    assert _ai_tasks(db, b) == 7
    assert _usage(db, first.id) == 2


def test_permanent_failure_is_not_paid_again(
    run: Callable[..., JobRow],
    new_exam: Callable[..., UUID],
    db: psycopg.Connection,
    clock: FrozenClock,
) -> None:
    a, b = new_exam(EXAM_A), new_exam(EXAM_B)
    client = FakeAnalysisClient(
        [invalid(), invalid(), AiError("ai_unavailable", retry=True), valid()]
    )

    first = run(client, _generate(a, b))
    assert first.status == "queued"
    assert len(client.calls) == 3

    _retry(clock)
    second = run(client, {}, job_id=first.id)

    assert second.status == "done", second.error
    assert len(client.calls) == 4  # A was not asked again
    assert second.result is not None
    exams = second.result["exams"]
    assert exams[0]["status"] == "failed"
    assert exams[0]["error"] == "analysis_invalid"
    assert exams[1]["status"] == "analyzed"
    failed = _count(
        db, "SELECT count(*) FROM app.analyses WHERE exam_id = %s AND status = 'failed'", a
    )
    assert failed == 1
    assert _usage(db, first.id) == 3


def test_all_exams_failed_fails_the_job(
    run: Callable[..., JobRow], new_exam: Callable[..., UUID], db: psycopg.Connection
) -> None:
    a, b = new_exam(EXAM_A), new_exam(EXAM_B)
    client = FakeAnalysisClient([invalid(), invalid(), invalid(), invalid()])

    job = run(client, _generate(a, b))

    assert job.status == "failed"
    assert job.error == "analysis_invalid"
    assert _usage(db, job.id) == 4
    assert _count(db, "SELECT count(*) FROM app.blocks") == 0
    assert _count(db, "SELECT count(*) FROM app.plan_versions") == 0


def test_transient_failure_on_the_last_attempt_is_the_exam_failure(
    run: Callable[..., JobRow],
    new_exam: Callable[..., UUID],
    make_job: MakeJob,
    user: Any,
    db: psycopg.Connection,
) -> None:
    a, b = new_exam(EXAM_A), new_exam(EXAM_B)
    job_id = make_job(user, JOB_GENERATE_PLAN, _generate(a, b), attempts=2)
    client = FakeAnalysisClient([valid(), AiError("ai_unavailable", retry=True)])

    job = run(client, {}, job_id=job_id)

    assert job.status == "done", job.error
    assert job.result is not None
    assert job.result["exams"][1] | {"budget_minutes": 0} == {
        "exam_id": str(b),
        "status": "failed",
        "error": "ai_unavailable",
        "topics": 0,
        "tasks": 0,
        "gaps": [],
        "warnings": [],
        "dropped": [],
        "total_minutes": 0,
        "budget_minutes": 0,
    }
    assert (
        _count(db, "SELECT count(*) FROM app.analyses WHERE exam_id = %s AND status = 'failed'", b)
        == 1
    )


def test_one_failed_exam_still_plans_the_others(
    run: Callable[..., JobRow], new_exam: Callable[..., UUID], db: psycopg.Connection
) -> None:
    a, b = new_exam(EXAM_A), new_exam(EXAM_B)
    client = FakeAnalysisClient([valid(), invalid(), invalid()])

    job = run(client, _generate(a, b))

    assert job.status == "done", job.error
    assert job.result is not None
    exams = job.result["exams"]
    assert exams[0]["status"] == "analyzed"
    assert exams[1]["status"] == "failed"
    assert exams[1]["error"] == "analysis_invalid"
    assert "analysis_id" not in exams[1]
    assert _count(db, "SELECT count(*) FROM app.blocks") > 0
    assert _usage(db, job.id) == 3


def test_no_credit_fails_at_once(
    run: Callable[..., JobRow], new_exam: Callable[..., UUID], db: psycopg.Connection
) -> None:
    a, b = new_exam(EXAM_A), new_exam(EXAM_B)
    client = FakeAnalysisClient([AiError("ai_no_credit")])

    job = run(client, _generate(a, b))

    assert job.status == "failed"
    assert job.error == "ai_no_credit"
    assert job.attempts == 1
    assert len(client.calls) == 1
    assert _usage(db, job.id) == 0
    assert _count(db, "SELECT count(*) FROM app.analyses") == 0


def test_no_credit_after_a_paid_call_records_the_call(
    run: Callable[..., JobRow], new_exam: Callable[..., UUID], db: psycopg.Connection
) -> None:
    a = new_exam(EXAM_A)
    client = FakeAnalysisClient([invalid(), AiError("ai_no_credit")])

    job = run(client, _generate(a))

    assert job.status == "failed"
    assert job.error == "ai_no_credit"
    assert _usage(db, job.id) == 1


def test_not_configured_fails_at_once(
    run: Callable[..., JobRow], new_exam: Callable[..., UUID]
) -> None:
    a = new_exam(EXAM_A)

    def factory(_settings: Settings) -> Any:
        raise AiError("ai_not_configured")

    job = run(None, _generate(a), factory=factory)

    assert job.status == "failed"
    assert job.error == "ai_not_configured"
    assert job.attempts == 1


@pytest.mark.parametrize("payload", [{}, {"exam_ids": "x"}, {"exam_ids": ["nope"]}, _generate()])
def test_bad_payload_is_exam_missing(run: Callable[..., JobRow], payload: dict[str, Any]) -> None:
    job = run(FakeAnalysisClient([]), payload)

    assert job.status == "failed"
    assert job.error == "exam_missing"


def test_exam_analyzed_meanwhile_is_skipped(
    run: Callable[..., JobRow],
    new_exam: Callable[..., UUID],
    db: psycopg.Connection,
    user: Any,
) -> None:
    a = new_exam(EXAM_A)
    _insert_ai_task(db, user, a)
    client = FakeAnalysisClient([])

    job = run(client, _generate(a))

    assert job.status == "done", job.error
    assert job.result is not None
    assert job.result["exams"][0]["status"] == "skipped"
    assert client.calls == []


def test_deleted_and_past_exams_are_skipped(
    run: Callable[..., JobRow],
    new_exam: Callable[..., UUID],
    db: psycopg.Connection,
) -> None:
    gone, past, live = new_exam(EXAM_A), new_exam(dt.date(2026, 11, 1)), new_exam(EXAM_B)
    db.execute("UPDATE app.exams SET deleted_at = now() WHERE id = %s", (gone,))
    client = FakeAnalysisClient([valid()])

    job = run(client, _generate(gone, past, live, uuid4()))

    assert job.status == "done", job.error
    assert job.result is not None
    assert [e["status"] for e in job.result["exams"]] == [
        "skipped",
        "skipped",
        "analyzed",
        "skipped",
    ]
    assert len(client.calls) == 1


def test_exam_deleted_during_the_call_is_skipped(
    run: Callable[..., JobRow], new_exam: Callable[..., UUID], db: psycopg.Connection
) -> None:
    a, b = new_exam(EXAM_A), new_exam(EXAM_B)

    def hook(_keepalive: Callable[[], None] | None) -> None:
        db.execute("UPDATE app.exams SET deleted_at = now() WHERE id = %s", (a,))

    job = run(HookedClient([valid(), valid()], hook), _generate(a, b))

    assert job.status == "done", job.error
    assert job.result is not None
    assert [e["status"] for e in job.result["exams"]] == ["skipped", "analyzed"]
    assert _usage(db, job.id) == 2


# --- budgets, the lock and the result size ------------------------------------------------


def test_budgets_count_the_analyzed_exams(
    run: Callable[..., JobRow],
    new_exam: Callable[..., UUID],
    db: psycopg.Connection,
    owner_db: psycopg.Connection[DictRow],
    user: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    day = dt.date(2026, 11, 30)
    old, new = new_exam(day), new_exam(day)
    _insert_ai_task(db, user, old)
    budgets: list[int] = []
    analyze = analysis_module.analyze_exam

    def spy(**kwargs: Any) -> Any:
        budgets.append(kwargs["budget_minutes"])
        return analyze(**kwargs)

    monkeypatch.setattr(plan_jobs, "analyze_exam", spy)
    profile = to_planner_profile(ensure_profile(owner_db, user.id))
    alone = exam_budgets(profile, [Exam(id=new, exam_date=day, difficulty=3)], NOW)[new]
    both = exam_budgets(
        profile,
        [Exam(id=old, exam_date=day, difficulty=3), Exam(id=new, exam_date=day, difficulty=3)],
        NOW,
    )[new]

    job = run(FakeAnalysisClient([valid()]), _generate(new))

    assert job.status == "done", job.error
    assert budgets == [both]
    assert both < alone


def test_keepalive_during_the_call_keeps_the_lock(
    run: Callable[..., JobRow],
    new_exam: Callable[..., UUID],
    owner_db: psycopg.Connection[DictRow],
    clock: FrozenClock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    a = new_exam(EXAM_A)
    monkeypatch.setattr(plan_jobs, "TICK_SECONDS", 0.01)
    beats: list[dt.datetime] = []

    def hook(keepalive: Callable[[], None] | None) -> None:
        clock.advance(seconds=400)
        assert keepalive is not None
        keepalive()  # the context's keepalive (a no-op while the ticker runs)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            row = owner_db.execute(
                "SELECT locked_at FROM app.jobs WHERE kind = %s", (JOB_GENERATE_PLAN,)
            ).fetchone()
            assert row is not None
            if row["locked_at"] == clock.now:
                beats.append(row["locked_at"])
                return
            time.sleep(0.01)

    job = run(HookedClient([valid()], hook), _generate(a))

    assert job.status == "done", job.error
    assert beats == [NOW + dt.timedelta(seconds=400)]


def test_ticker_keeps_the_lock_through_a_quiet_call(
    run: Callable[..., JobRow],
    new_exam: Callable[..., UUID],
    owner_db: psycopg.Connection[DictRow],
    clock: FrozenClock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A long thinking phase sends no event: only the ticker renews the lock."""
    a = new_exam(EXAM_A)
    monkeypatch.setattr(plan_jobs, "TICK_SECONDS", 0.01)
    renewed: list[bool] = []

    def hook(_keepalive: Callable[[], None] | None) -> None:
        clock.advance(seconds=400)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            row = owner_db.execute(
                "SELECT locked_at FROM app.jobs WHERE kind = %s", (JOB_GENERATE_PLAN,)
            ).fetchone()
            assert row is not None
            if row["locked_at"] == clock.now:
                renewed.append(True)
                return
            time.sleep(0.01)
        renewed.append(False)

    job = run(QuietClient([valid()], hook), _generate(a))

    assert job.status == "done", job.error
    assert renewed == [True]


def _big_output(gap_count: int = 20) -> dict[str, Any]:
    tasks: list[dict[str, Any]] = [
        {
            "key": "K1",
            "title": "סקירת הסילבוס",
            "kind": "review",
            "topic_key": None,
            "minutes": 30,
            "focus": 5,
            "depends_on": None,
            "material_key": "M1",
            "reason": "ר",
        },
        {
            "key": "K2",
            "title": "סימולציה",
            "kind": "simulation",
            "topic_key": None,
            "minutes": 30,
            "focus": 5,
            "depends_on": None,
            "material_key": "M2",
            "reason": "ר",
        },
        {
            "key": "K3",
            "title": "תחקיר",
            "kind": "simulation_review",
            "topic_key": None,
            "minutes": 30,
            "focus": 5,
            "depends_on": "K2",
            "material_key": None,
            "reason": "ר",
        },
    ]
    for i in range(4, 151):
        tasks.append(
            {
                "key": f"K{i}",
                "title": f"תרגול {i}",
                "kind": "practice",
                "topic_key": "T1",
                "minutes": 30,
                "focus": 5,
                "depends_on": None,
                "material_key": None,
                "reason": "ר" * 300,
            }
        )
    return {
        "topics": [{"key": "T1", "name": "נושא", "weight": 3, "evidence": ""}],
        "tasks": tasks,
        "gaps": [{"topic": "א" * 120, "note": "ב" * 300} for _ in range(gap_count)],
    }


def test_result_fits_jobs_result_size(
    run: Callable[..., JobRow], new_exam: Callable[..., UUID], db: psycopg.Connection
) -> None:
    # Near exams: the budget is small, so most of the tasks are dropped (a long `dropped`).
    exams = [new_exam(dt.date(2026, 11, 25)) for _ in range(3)]
    big = reply(json.dumps(_big_output(), ensure_ascii=False))

    job = run(FakeAnalysisClient([big, big, big]), _generate(*exams))

    assert job.status == "done", job.error
    assert job.result is not None
    assert [e["status"] for e in job.result["exams"]] == ["analyzed"] * 3
    assert job.result["exams"][0]["dropped"]


def test_fit_result_bounds_the_largest_result() -> None:
    exam = {
        "exam_id": str(uuid4()),
        "status": "analyzed",
        "analysis_id": str(uuid4()),
        "topics": 40,
        "tasks": 150,
        "gaps": [{"topic": "א" * 120, "note": "ב" * 300} for _ in range(20)],
        "warnings": ["w" * 30] * 20,
        "dropped": [f"K{i}" for i in range(150)],
        "total_minutes": 6000,
        "budget_minutes": 6000,
    }
    unscheduled = [
        {"task_id": str(uuid4()), "reason": "dependency_not_scheduled"} for _ in range(200)
    ]
    result = {
        "exams": [dict(exam) for _ in range(3)],
        "plan": {
            "version_id": str(uuid4()),
            "blocks": 900,
            "unscheduled": unscheduled,
            "unscheduled_count": 450,
            "shortfalls": [
                {"exam_id": str(uuid4()), "minutes": 900, "daily_minutes": 240} for _ in range(3)
            ],
            "warnings": ["x" * 30] * 10,
        },
    }

    fitted = plan_jobs.fit_result(result)

    size = len(json.dumps(fitted, ensure_ascii=False).encode())
    assert size <= plan_jobs.MAX_RESULT_BYTES
    assert fitted["plan"]["unscheduled_count"] == 450
    assert fitted["exams"][0]["tasks"] == 150


def test_fit_result_leaves_a_small_result_alone() -> None:
    result = {"exams": [{"gaps": [{"topic": "א", "note": ""}]}], "plan": {"unscheduled": []}}

    assert plan_jobs.fit_result(result) == result


# --- materials still being read ----------------------------------------------------------


def test_generate_waits_for_materials_still_ingesting(
    run: Callable[..., JobRow],
    new_exam: Callable[..., UUID],
    add_material: AddMaterial,
    user: Any,
    db: psycopg.Connection,
) -> None:
    a = new_exam(EXAM_A)
    add_material(user, a, kind="past_exam", status="queued")
    client = FakeAnalysisClient([valid()])

    job = run(client, _generate(a))

    assert job.status == "queued"
    assert job.error == "materials_processing"
    assert client.calls == []
    assert _usage(db, job.id) == 0
    assert _count(db, "SELECT count(*) FROM app.analyses") == 0


def test_generate_waits_for_the_second_exams_materials(
    run: Callable[..., JobRow],
    new_exam: Callable[..., UUID],
    add_material: AddMaterial,
    user: Any,
    db: psycopg.Connection,
    clock: FrozenClock,
) -> None:
    a, b = new_exam(EXAM_A), new_exam(EXAM_B)
    processing = add_material(user, b, kind="past_exam", status="processing")
    client = FakeAnalysisClient([valid(), valid()])

    first = run(client, _generate(a, b))
    assert first.status == "queued"
    assert first.error == "materials_processing"
    assert len(client.calls) == 1  # A only
    assert _ai_tasks(db, a) == 7

    db.execute("DELETE FROM app.materials WHERE id = %s", (processing,))
    _retry(clock)
    second = run(client, {}, job_id=first.id)

    assert second.status == "done", second.error
    assert len(client.calls) == 2  # A was not asked again
    assert second.result is not None
    assert [e["status"] for e in second.result["exams"]] == ["analyzed", "analyzed"]


def test_generate_on_the_last_attempt_analyzes_without_the_materials(
    run: Callable[..., JobRow],
    new_exam: Callable[..., UUID],
    add_material: AddMaterial,
    make_job: MakeJob,
    user: Any,
) -> None:
    a = new_exam(EXAM_A)
    add_material(user, a, kind="past_exam", status="processing")
    job_id = make_job(user, JOB_GENERATE_PLAN, _generate(a), attempts=2)
    client = FakeAnalysisClient([valid()])

    job = run(client, {}, job_id=job_id)

    assert job.status == "done", job.error
    assert len(client.calls) == 1
    assert job.result is not None
    exam = job.result["exams"][0]
    assert exam["status"] == "analyzed"
    assert "materials_not_ready" in exam["warnings"]


def test_reanalyze_waits_for_materials_still_ingesting(
    run: Callable[..., JobRow],
    new_exam: Callable[..., UUID],
    add_material: AddMaterial,
    user: Any,
    db: psycopg.Connection,
) -> None:
    a = new_exam(EXAM_A)
    add_material(user, a, kind="past_exam", status="queued")
    client = FakeAnalysisClient([valid()])

    job = run(client, {"exam_id": str(a)}, kind=JOB_REANALYZE_EXAM)

    assert job.status == "queued"
    assert job.error == "materials_processing"
    assert client.calls == []
    assert _usage(db, job.id) == 0


def test_reanalyze_on_the_last_attempt_analyzes_without_the_materials(
    run: Callable[..., JobRow],
    new_exam: Callable[..., UUID],
    add_material: AddMaterial,
    make_job: MakeJob,
    user: Any,
) -> None:
    a = new_exam(EXAM_A)
    add_material(user, a, kind="past_exam", status="queued")
    job_id = make_job(user, JOB_REANALYZE_EXAM, {"exam_id": str(a)}, attempts=2)
    client = FakeAnalysisClient([valid()])

    job = run(client, {}, job_id=job_id)

    assert job.status == "done", job.error
    assert len(client.calls) == 1
    assert job.result is not None
    assert "materials_not_ready" in job.result["warnings"]


def test_failed_materials_do_not_hold_the_job(
    run: Callable[..., JobRow],
    new_exam: Callable[..., UUID],
    add_material: AddMaterial,
    user: Any,
) -> None:
    a = new_exam(EXAM_A)
    add_material(user, a, kind="past_exam", status="failed")

    job = run(FakeAnalysisClient([valid()]), _generate(a))

    assert job.status == "done", job.error


# --- reanalysis ---------------------------------------------------------------------------


def test_reanalyze_saves_a_draft(
    run: Callable[..., JobRow],
    new_exam: Callable[..., UUID],
    db: psycopg.Connection,
    user: Any,
) -> None:
    a = new_exam(EXAM_A)
    _insert_ai_task(db, user, a)
    tasks_before = db.execute("SELECT * FROM app.tasks ORDER BY id").fetchall()

    job = run(FakeAnalysisClient([valid()]), {"exam_id": str(a)}, kind=JOB_REANALYZE_EXAM)

    assert job.status == "done", job.error
    assert job.result is not None
    analysis_id = UUID(job.result["analysis_id"])
    assert job.result["exam_id"] == str(a)
    assert job.result["tasks"] == 7
    assert job.result["topics"] == 3
    assert job.result["gaps"] == [{"topic": "טורים", "note": "לא מופיע בחומרים"}]
    assert set(job.result) == {
        "analysis_id",
        "exam_id",
        "tasks",
        "topics",
        "gaps",
        "warnings",
        "dropped",
        "total_minutes",
        "budget_minutes",
    }
    status = db.execute("SELECT status FROM app.analyses WHERE id = %s", (analysis_id,)).fetchone()
    assert status == ("draft",)
    assert db.execute("SELECT * FROM app.tasks ORDER BY id").fetchall() == tasks_before
    assert _usage(db, job.id) == 1


def test_reanalyze_transient_failure_is_retried(
    run: Callable[..., JobRow], new_exam: Callable[..., UUID]
) -> None:
    a = new_exam(EXAM_A)

    job = run(
        FakeAnalysisClient([AiError("ai_unavailable", retry=True)]),
        {"exam_id": str(a)},
        kind=JOB_REANALYZE_EXAM,
    )

    assert job.status == "queued"
    assert job.error == "ai_unavailable"


@pytest.mark.parametrize(
    ("replies", "code"),
    [([invalid(), invalid()], "analysis_invalid"), ([AiError("ai_no_credit")], "ai_no_credit")],
)
def test_reanalyze_failure_fails_the_job(
    run: Callable[..., JobRow],
    new_exam: Callable[..., UUID],
    db: psycopg.Connection,
    replies: list[AnalysisReply | AiError],
    code: str,
) -> None:
    a = new_exam(EXAM_A)

    job = run(FakeAnalysisClient(replies), {"exam_id": str(a)}, kind=JOB_REANALYZE_EXAM)

    assert job.status == "failed"
    assert job.error == code
    assert job.attempts == 1
    assert _usage(db, job.id) == (2 if code == "analysis_invalid" else 0)


@pytest.mark.parametrize("payload", [{}, {"exam_id": "nope"}, {"exam_id": str(uuid4())}])
def test_reanalyze_bad_exam_is_exam_missing(
    run: Callable[..., JobRow], payload: dict[str, Any]
) -> None:
    job = run(FakeAnalysisClient([]), payload, kind=JOB_REANALYZE_EXAM)

    assert job.status == "failed"
    assert job.error == "exam_missing"


# --- fix round 1: the planning time, the usage at the call, the failed row, the client ----


def test_planning_uses_the_time_after_the_calls(
    run: Callable[..., JobRow],
    new_exam: Callable[..., UUID],
    db: psycopg.Connection,
    clock: FrozenClock,
) -> None:
    start = dt.datetime(2026, 11, 16, 9, 0, tzinfo=dt.UTC)  # inside the morning window
    a = new_exam(EXAM_A)
    clock.set(start)

    def hook(_keepalive: Callable[[], None] | None) -> None:
        clock.advance(minutes=20)

    job = run(HookedClient([valid()], hook), _generate(a))

    assert job.status == "done", job.error
    first = scalar(db, "SELECT min(starts_at) FROM app.blocks WHERE status = 'planned'")
    assert first is not None
    assert first >= start + dt.timedelta(minutes=20)


def test_claim_lost_during_a_paid_call_records_the_usage(
    run: Callable[..., JobRow],
    new_exam: Callable[..., UUID],
    owner_db: psycopg.Connection[DictRow],
    db: psycopg.Connection,
    read_job: ReadJob,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    a = new_exam(EXAM_A)
    monkeypatch.setattr(plan_jobs, "TICK_SECONDS", 0.01)
    job_ids: list[UUID] = []

    def hook(_keepalive: Callable[[], None] | None) -> None:
        # Another worker claims the job during the call; the ticker finds the fence closed.
        row = owner_db.execute(
            "UPDATE app.jobs SET attempts = attempts + 1 WHERE kind = %s RETURNING id",
            (JOB_GENERATE_PLAN,),
        ).fetchone()
        assert row is not None
        job_ids.append(row["id"])
        time.sleep(0.2)

    # Quiet: no streamed event reports the loss mid-call, so the reply comes back paid and
    # the loss shows when the ticker stops.
    job = run(QuietClient([valid()], hook), _generate(a))

    assert job.status == "running"  # left alone for the worker that holds it now
    assert job.attempts == 2
    assert _usage(db, job.id) == 1
    assert _ai_tasks(db, a) == 0
    assert job_ids == [job.id]


def test_usage_is_one_row_per_call(
    run: Callable[..., JobRow], new_exam: Callable[..., UUID], db: psycopg.Connection
) -> None:
    a, b = new_exam(EXAM_A), new_exam(EXAM_B)

    job = run(FakeAnalysisClient([valid(), invalid(), invalid()]), _generate(a, b))

    assert job.status == "done", job.error
    assert _count(db, "SELECT count(*) FROM app.ai_usage WHERE exam_id = %s", a) == 1
    assert _count(db, "SELECT count(*) FROM app.ai_usage WHERE exam_id = %s", b) == 2
    assert _usage(db, job.id) == 3


def test_reanalysis_usage_is_one_row_per_call(
    run: Callable[..., JobRow], new_exam: Callable[..., UUID], db: psycopg.Connection
) -> None:
    a = new_exam(EXAM_A)

    job = run(
        FakeAnalysisClient([invalid(), valid()]), {"exam_id": str(a)}, kind=JOB_REANALYZE_EXAM
    )

    assert job.status == "done", job.error
    assert _count(db, "SELECT count(*) FROM app.ai_usage WHERE exam_id = %s", a) == 2


def test_failed_row_that_cannot_be_written_does_not_retry(
    run: Callable[..., JobRow],
    new_exam: Callable[..., UUID],
    db: psycopg.Connection,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    a, b = new_exam(EXAM_A), new_exam(EXAM_B)

    def broken(*_args: Any) -> None:
        raise psycopg.errors.QueryCanceled("statement timeout")

    monkeypatch.setattr(plan_jobs, "record_failed_analysis", broken)

    job = run(FakeAnalysisClient([invalid(), invalid(), valid()]), _generate(a, b))

    assert job.status == "done", job.error
    assert job.result is not None
    assert job.result["exams"][0]["status"] == "failed"
    assert job.result["exams"][0]["error"] == "analysis_invalid"
    assert job.result["exams"][1]["status"] == "analyzed"


def test_failed_row_that_cannot_be_written_fails_a_single_exam_job_for_good(
    run: Callable[..., JobRow],
    new_exam: Callable[..., UUID],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    a = new_exam(EXAM_A)

    def broken(*_args: Any) -> None:
        raise psycopg.errors.QueryCanceled("statement timeout")

    monkeypatch.setattr(plan_jobs, "record_failed_analysis", broken)

    job = run(FakeAnalysisClient([invalid(), invalid()]), _generate(a))

    assert job.status == "failed"
    assert job.error == "analysis_invalid"
    assert job.attempts == 1


def test_planning_alone_needs_no_client(
    run: Callable[..., JobRow],
    new_exam: Callable[..., UUID],
    db: psycopg.Connection,
    user: Any,
) -> None:
    a = new_exam(EXAM_A)
    _insert_ai_task(db, user, a)

    def factory(_settings: Settings) -> Any:
        raise AiError("ai_not_configured")

    job = run(None, _generate(a), factory=factory)

    assert job.status == "done", job.error
    assert job.result is not None
    assert job.result["exams"][0]["status"] == "skipped"
