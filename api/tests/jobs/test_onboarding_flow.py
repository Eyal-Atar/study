"""A whole onboarding through the API: a profile, two exams, their materials, then a plan.

The API writes the rows and the jobs; a real worker (the real handlers, memory storage and
a fake Claude client) does the work; the API shows the result. These tests run on the real
time, not on NOW: the API's jobs get created_at from the database's real clock, and the
daily quota counts jobs from that column against the request's now, so a frozen now in
another day would not see them.
"""

import datetime as dt
import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.ai.client import AiError, AnalysisReply
from app.jobs.ingest import HANDLERS, ON_CRASHED
from app.jobs.worker import Worker
from tests.ai.fake_client import FakeAnalysisClient, reply
from tests.ai.samples import valid_output_dict
from tests.api.factories import register_material, scalar
from tests.fixtures_db import ApiUser, FrozenClock
from tests.jobs.fake_storage import MemoryStorage
from tests.jobs.pdfs import make_pdf

type MakeApiUser = Callable[[], ApiUser]
type MakeWorker = Callable[..., Worker]

TZ = "Asia/Jerusalem"
PROFILE: dict[str, Any] = {
    "timezone": TZ,
    "wake_time": "07:00",
    "sleep_time": "23:00",
    "study_windows": ["morning", "afternoon", "evening"],
    "daily_study_minutes": 180,
    "rest_days_before_exam": 0,
}
SYLLABUS = (
    "Course syllabus: limits, derivatives and integrals.\n"
    "Week one covers limits and continuity of real functions."
)
PAST_EXAM = (
    "Final exam 2025, first sitting.\n"
    "Question one asks for a limit; question two asks for a derivative."
)
PLAN_CHUNK_DAYS = 62
SAMPLE_TASKS = len(valid_output_dict()["tasks"])


def valid() -> AnalysisReply:
    return reply(json.dumps(valid_output_dict(), ensure_ascii=False))


def invalid() -> AnalysisReply:
    return reply("not json")


def _ok(response: Any, status: int = 200) -> Any:
    assert response.status_code == status, response.text
    return response.json() if response.content else None


@dataclass(frozen=True)
class Onboarded:
    user: ApiUser
    today: dt.date
    exams: list[tuple[UUID, dt.date]]


@pytest.fixture
def real_now(clock: FrozenClock) -> dt.datetime:
    now = dt.datetime.now(dt.UTC)
    clock.set(now)
    return now


@pytest.fixture
def make_flow_worker(make_worker: MakeWorker) -> Callable[[Sequence[Any]], Worker]:
    """A worker with the real handlers whose Claude client answers with these replies."""

    def make(replies: Sequence[AnalysisReply | AiError]) -> Worker:
        client = FakeAnalysisClient(replies)
        return make_worker(
            HANDLERS, on_crashed=ON_CRASHED, ai_client_factory=lambda _settings: client
        )

    return make


def _catch_up(db: psycopg.Connection, clock: FrozenClock) -> None:
    """Move the frozen clock to the latest job's run_at if it is behind (the real clock)."""
    latest = scalar(db, "SELECT max(run_at) FROM app.jobs")
    if latest is not None and latest > clock.now:
        clock.set(latest)


def _run_all(worker: Worker, db: psycopg.Connection, clock: FrozenClock) -> int:
    _catch_up(db, clock)
    ran = 0
    while worker.run_once():
        ran += 1
        assert ran < 20, "the worker never ran out of jobs"
    return ran


def _job(api: TestClient, user: ApiUser, job_id: UUID | str) -> dict[str, Any]:
    body: dict[str, Any] = _ok(api.get(f"/jobs/{job_id}", headers=user.headers))
    return body


def _tasks(api: TestClient, user: ApiUser, exam_id: UUID) -> list[dict[str, Any]]:
    body: list[dict[str, Any]] = _ok(api.get(f"/exams/{exam_id}/tasks", headers=user.headers))
    return body


def _usage(db: psycopg.Connection, job_id: UUID | str) -> int:
    count: int = scalar(db, "SELECT count(*) FROM app.ai_usage WHERE job_id = %s", job_id)
    return count


def _onboard(
    api: TestClient,
    db: psycopg.Connection,
    storage: MemoryStorage,
    worker: Worker,
    clock: FrozenClock,
    make_api_user: MakeApiUser,
    *,
    exam_days: Sequence[int] = (21, 42),
) -> Onboarded:
    """Steps 1-3: the profile, the exams, and their syllabus and past exam ingested."""
    user = make_api_user()

    # 1. The profile: the defaults first, then the user's hours and windows.
    me = _ok(api.get("/me", headers=user.headers))
    assert me["id"] == str(user.id)
    patched = _ok(api.patch("/me", json=PROFILE, headers=user.headers))
    for field, value in PROFILE.items():
        assert patched[field] == value, field
    today = clock.now.astimezone(ZoneInfo(TZ)).date()

    # 2. The exams.
    exams: list[tuple[UUID, dt.date]] = []
    for index, days in enumerate(exam_days):
        exam_date = today + dt.timedelta(days=days)
        body = _ok(
            api.post(
                "/exams",
                json={"name": f"מבחן {index + 1}", "exam_date": exam_date.isoformat()},
                headers=user.headers,
            ),
            201,
        )
        exams.append((UUID(body["exam"]["id"]), exam_date))

    # 3. Each exam's materials: registered through the API, uploaded where it said.
    ingest_jobs: list[str] = []
    for exam_id, _ in exams:
        for kind, filename, text in (
            ("syllabus", "סילבוס.pdf", SYLLABUS),
            ("past_exam", "מבחן 2025.pdf", PAST_EXAM),
        ):
            data = make_pdf([text])
            material_id = uuid4()
            body = register_material(
                api,
                user,
                exam_id,
                material_id=material_id,
                filename=filename,
                kind=kind,
                size_bytes=len(data),
            )
            storage.files[f"{user.id}/{exam_id}/{material_id}"] = data
            ingest_jobs.append(body["job_id"])
    assert _run_all(worker, db, clock) == len(ingest_jobs)
    for job_id in ingest_jobs:
        assert _job(api, user, job_id)["status"] == "done"
    for exam_id, _ in exams:
        materials = _ok(api.get(f"/exams/{exam_id}/materials", headers=user.headers))
        assert sorted(m["kind"] for m in materials) == ["past_exam", "syllabus"]
        assert {m["ingest_status"] for m in materials} == {"ready"}
    return Onboarded(user=user, today=today, exams=exams)


def _generate(
    api: TestClient, db: psycopg.Connection, worker: Worker, clock: FrozenClock, user: ApiUser
) -> dict[str, Any]:
    """Step 4: ask for a plan, run the job, and return it as GET /jobs/{id} shows it."""
    body = _ok(api.post("/plans/generate", headers=user.headers), 202)
    assert body["created"] is True
    assert _job(api, user, body["job_id"])["status"] == "queued"
    assert _run_all(worker, db, clock) == 1
    return _job(api, user, body["job_id"])


def _plan(api: TestClient, user: ApiUser, first: dt.date, last: dt.date) -> dict[str, Any]:
    """GET /plan over first..last in chunks the API accepts; the blocks of all of them."""
    blocks: list[dict[str, Any]] = []
    unplaced: list[dict[str, Any]] | None = None
    start = first
    while start <= last:
        end = min(last, start + dt.timedelta(days=PLAN_CHUNK_DAYS - 1))
        body = _ok(
            api.get(
                "/plan",
                params={"from": start.isoformat(), "to": end.isoformat()},
                headers=user.headers,
            )
        )
        assert (body["from"], body["to"]) == (start.isoformat(), end.isoformat())
        blocks.extend(body["blocks"])
        # The unplaced tasks are the board's, not the range's: the same in every chunk.
        if unplaced is not None:
            assert body["unplaced"] == unplaced
        unplaced = body["unplaced"]
        undo = body["undo"]
        start = end + dt.timedelta(days=1)
    return {"blocks": blocks, "unplaced": unplaced or [], "undo": undo}


# --- the whole onboarding ----------------------------------------------------------------


def test_onboarding_through_the_api_ends_in_a_full_plan(
    api: TestClient,
    db: psycopg.Connection,
    storage: MemoryStorage,
    make_flow_worker: Callable[[Sequence[Any]], Worker],
    make_api_user: MakeApiUser,
    clock: FrozenClock,
    real_now: dt.datetime,
) -> None:
    worker = make_flow_worker([valid(), valid()])
    flow = _onboard(api, db, storage, worker, clock, make_api_user)
    user = flow.user

    # 4. The plan job: both exams analyzed, their gaps shown.
    job = _generate(api, db, worker, clock, user)
    assert job["status"] == "done", job["error"]
    assert job["percent"] == 100
    assert job["error"] is None
    result = job["result"]
    assert [exam["exam_id"] for exam in result["exams"]] == [str(e) for e, _ in flow.exams]
    for exam in result["exams"]:
        assert exam["status"] == "analyzed"
        assert exam["tasks"] == SAMPLE_TASKS
        assert exam["topics"] == 3
        assert exam["gaps"] == [{"topic": "טורים", "note": "לא מופיע בחומרים"}]
    assert _usage(db, job["id"]) == 2

    # 5. The plan: every task is placed or listed as unplaced; nothing on an exam's day.
    last_exam = max(date for _, date in flow.exams)
    plan = _plan(api, user, flow.today, last_exam)
    assert plan["undo"] is not None
    assert plan["undo"]["reason"] == "plan_generated"
    assert plan["undo"]["version_id"] == result["plan"]["version_id"]
    blocks = plan["blocks"]
    assert blocks
    assert len(blocks) == result["plan"]["blocks"]
    tasks = {task["id"]: task for exam_id, _ in flow.exams for task in _tasks(api, user, exam_id)}
    assert len(tasks) == SAMPLE_TASKS * len(flow.exams)
    assert {task["source"] for task in tasks.values()} == {"ai"}
    placed = {block["task_id"] for block in blocks}
    unplaced = {item["task_id"] for item in plan["unplaced"]}
    assert placed <= set(tasks)
    assert unplaced <= set(tasks)
    assert placed | unplaced == set(tasks)
    assert len(unplaced) == result["plan"]["unscheduled_count"]
    exam_dates = dict(flow.exams)
    for block in blocks:
        assert block["status"] == "planned"
        exam_date = exam_dates[UUID(block["exam_id"])]
        assert dt.date.fromisoformat(block["study_date"]) < exam_date, block
        assert dt.datetime.fromisoformat(block["starts_at"]) >= real_now - dt.timedelta(
            minutes=1
        ), block

    # ... and today's view is the plan's today. Before the 07:00 wake-up the study day is
    # still yesterday's (asleep, so nothing of it is left to plan).
    today = _ok(api.get("/today", headers=user.headers))
    yesterday = flow.today - dt.timedelta(days=1)
    assert today["date"] in (flow.today.isoformat(), yesterday.isoformat())
    todays = [b for b in blocks if b["study_date"] == today["date"]]
    assert [b["id"] for b in today["blocks"]] == [b["id"] for b in todays]
    assert today["done_minutes"] == 0


# --- the daily quota ---------------------------------------------------------------------


def test_fourth_ai_request_of_the_day_is_refused(
    api: TestClient,
    db: psycopg.Connection,
    storage: MemoryStorage,
    make_flow_worker: Callable[[Sequence[Any]], Worker],
    make_api_user: MakeApiUser,
    clock: FrozenClock,
    real_now: dt.datetime,
) -> None:
    worker = make_flow_worker([valid(), valid(), valid(), valid()])
    flow = _onboard(api, db, storage, worker, clock, make_api_user)
    user = flow.user
    (first, _), (second, _) = flow.exams
    assert _generate(api, db, worker, clock, user)["status"] == "done"

    # The plan was the first request; a generate now has nothing to analyze (409, before
    # the quota), so the next requests are reanalyses.
    for exam_id in (first, second):
        body = _ok(api.post(f"/exams/{exam_id}/reanalyze", headers=user.headers), 202)
        assert body["created"] is True
    assert _run_all(worker, db, clock) == 2

    # Run first: an active reanalysis of the same exam would be returned, not refused.
    refused = api.post(f"/exams/{first}/reanalyze", headers=user.headers)
    assert refused.status_code == 429, refused.text
    body = refused.json()
    assert body["code"] == "ai_quota_exceeded"
    assert body["limit"] == 3
    assert dt.datetime.fromisoformat(body["resets_at"]) > real_now
    assert (
        scalar(
            db,
            "SELECT count(*) FROM app.jobs WHERE user_id = %s AND kind <> %s",
            user.id,
            "ingest_material",
        )
        == 3
    )


# --- visible failures --------------------------------------------------------------------


def test_no_credit_fails_the_job_visibly(
    api: TestClient,
    db: psycopg.Connection,
    storage: MemoryStorage,
    make_flow_worker: Callable[[Sequence[Any]], Worker],
    make_api_user: MakeApiUser,
    clock: FrozenClock,
    real_now: dt.datetime,
) -> None:
    worker = make_flow_worker([AiError("ai_no_credit")])
    flow = _onboard(api, db, storage, worker, clock, make_api_user)

    job = _generate(api, db, worker, clock, flow.user)

    assert job["status"] == "failed"
    assert job["error"] == "ai_no_credit"
    assert job["result"] is None
    assert _usage(db, job["id"]) == 0
    assert _plan(api, flow.user, flow.today, flow.today)["blocks"] == []
    # Nothing was spent, so the failed job does not count: the user can ask again.
    again = _ok(api.post("/plans/generate", headers=flow.user.headers), 202)
    assert again["created"] is True


def test_two_invalid_answers_fail_the_job_and_both_are_recorded(
    api: TestClient,
    db: psycopg.Connection,
    storage: MemoryStorage,
    make_flow_worker: Callable[[Sequence[Any]], Worker],
    make_api_user: MakeApiUser,
    clock: FrozenClock,
    real_now: dt.datetime,
) -> None:
    worker = make_flow_worker([invalid(), invalid()])
    flow = _onboard(api, db, storage, worker, clock, make_api_user, exam_days=(21,))

    job = _generate(api, db, worker, clock, flow.user)

    assert job["status"] == "failed"
    assert job["error"] == "analysis_invalid"
    # Read as the schema owner: the answer and its repair were both paid for.
    assert _usage(db, job["id"]) == 2
    assert scalar(db, "SELECT count(*) FROM app.ai_usage WHERE user_id = %s", flow.user.id) == 2
    [(exam_id, _)] = flow.exams
    assert _tasks(api, flow.user, exam_id) == []


# --- reanalysis --------------------------------------------------------------------------


def test_reanalysis_is_previewed_applied_and_undone(
    api: TestClient,
    db: psycopg.Connection,
    storage: MemoryStorage,
    make_flow_worker: Callable[[Sequence[Any]], Worker],
    make_api_user: MakeApiUser,
    clock: FrozenClock,
    real_now: dt.datetime,
) -> None:
    worker = make_flow_worker([valid(), valid(), valid()])
    flow = _onboard(api, db, storage, worker, clock, make_api_user)
    user = flow.user
    (exam_id, _), _ = flow.exams
    assert _generate(api, db, worker, clock, user)["status"] == "done"
    before = _tasks(api, user, exam_id)
    assert len(before) == SAMPLE_TASKS
    done_task = before[0]
    _ok(api.patch(f"/tasks/{done_task['id']}", json={"status": "done"}, headers=user.headers))

    queued = _ok(api.post(f"/exams/{exam_id}/reanalyze", headers=user.headers), 202)
    assert _run_all(worker, db, clock) == 1
    job = _job(api, user, queued["job_id"])
    assert job["status"] == "done", job["error"]
    analysis_id = job["result"]["analysis_id"]
    # A draft changes nothing until it is applied.
    assert _tasks(api, user, exam_id) == [
        dict(task, status="done") if task["id"] == done_task["id"] else task for task in before
    ]

    preview = _ok(
        api.post(f"/analyses/{analysis_id}/apply", json={"preview": True}, headers=user.headers)
    )
    assert preview["version_id"] is None
    assert preview["kept"] == 1
    assert len(preview["replaced"]) == SAMPLE_TASKS - 1
    assert len(preview["added"]) == SAMPLE_TASKS

    applied = _ok(
        api.post(
            f"/analyses/{analysis_id}/apply",
            json={"preview": False, "basis": preview["basis"]},
            headers=user.headers,
        )
    )
    assert applied["version_id"] is not None
    assert [t["title"] for t in applied["added"]] == [t["title"] for t in preview["added"]]
    after = _tasks(api, user, exam_id)
    after_ids = {task["id"] for task in after}
    assert done_task["id"] in after_ids
    assert {t["id"] for t in before} & after_ids == {done_task["id"]}
    assert {t["task_id"] for t in applied["added"]} <= after_ids
    assert len(after) == SAMPLE_TASKS + 1

    # One undo brings back the tasks the draft replaced, and removes the new ones.
    _ok(api.post("/plan/undo", json={"version_id": applied["version_id"]}, headers=user.headers))
    restored = _tasks(api, user, exam_id)
    assert {t["id"] for t in restored} == {t["id"] for t in before}
    assert {t["id"]: t["status"] for t in restored}[done_task["id"]] == "done"
