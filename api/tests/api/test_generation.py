"""POST /plans/generate and POST /exams/{id}/reanalyze: a job per request, under a daily quota.

The quota day is the local day in Asia/Jerusalem (the settings), not the profile's. The
jobs a test needs in the past are written as the owner with an explicit created_at, since
the table defaults it to the database's real clock, which the frozen clock does not follow.
"""

import datetime as dt
import threading
import time
from collections.abc import Callable
from typing import Any
from uuid import UUID

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from app.config import Settings
from app.services.generation import quota_day_start, quota_resets_at
from tests.api.factories import (
    DELETED_AT,
    NOW,
    TEST_PROFILE,
    Z,
    insert_exam,
    insert_task,
    scalar,
    set_profile,
)
from tests.fixtures_db import ApiUser, FrozenClock

MakeApiUser = Callable[[], ApiUser]

# NOW is Monday 2026-11-16 05:00 UTC, 07:00 in Jerusalem (UTC+2 in November): the quota
# day started at 2026-11-15 22:00 UTC and ends at 2026-11-16 22:00 UTC.
DAY_START = Z(2026, 11, 15, 22)
RESETS_AT = Z(2026, 11, 16, 22)


@pytest.fixture
def user(make_api_user: MakeApiUser, db: psycopg.Connection, clock: FrozenClock) -> ApiUser:
    created = make_api_user()
    set_profile(db, created.id, **TEST_PROFILE)
    clock.set(NOW)
    return created


@pytest.fixture
def exam(db: psycopg.Connection, user: ApiUser) -> UUID:
    return insert_exam(db, user.id, name="אלגוריתמים", exam_date="2026-12-01")


def make_job(
    db: psycopg.Connection,
    user_id: UUID,
    kind: str = "generate_plan",
    *,
    status: str = "done",
    created_at: dt.datetime = NOW,
    payload: dict[str, Any] | None = None,
    error: str | None = None,
) -> UUID:
    row = db.execute(
        "INSERT INTO app.jobs (user_id, kind, payload, status, created_at, run_at, error) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
        (user_id, kind, Jsonb(payload or {}), status, created_at, created_at, error),
    ).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def add_usage(db: psycopg.Connection, user_id: UUID, job_id: UUID) -> None:
    db.execute(
        "INSERT INTO app.ai_usage (user_id, job_id, model, input_tokens, output_tokens) "
        "VALUES (%s, %s, 'test-model', 100, 50)",
        (user_id, job_id),
    )


def ai_task(db: psycopg.Connection, user_id: UUID, exam_id: UUID, *, deleted: bool = False) -> UUID:
    task_id = insert_task(db, user_id, exam_id)
    db.execute(
        "UPDATE app.tasks SET source = 'ai', deleted_at = %s WHERE id = %s",
        (DELETED_AT if deleted else None, task_id),
    )
    return task_id


def job_count(db: psycopg.Connection, user_id: UUID) -> int:
    count: int = scalar(db, "SELECT count(*) FROM app.jobs WHERE user_id = %s", user_id)
    return count


def job_row(db: psycopg.Connection, job_id: UUID) -> tuple[Any, ...]:
    row = db.execute(
        "SELECT kind, payload, status, user_id FROM app.jobs WHERE id = %s", (job_id,)
    ).fetchone()
    assert row is not None
    return tuple(row)


def generate(api: TestClient, user: ApiUser, **kwargs: Any) -> Any:
    return api.post("/plans/generate", headers=user.headers, **kwargs)


def reanalyze(api: TestClient, user: ApiUser, exam_id: UUID) -> Any:
    return api.post(f"/exams/{exam_id}/reanalyze", headers=user.headers)


def assert_quota_exceeded(response: Any) -> None:
    assert response.status_code == 429, response.text
    body = response.json()
    assert body["code"] == "ai_quota_exceeded"
    assert body["limit"] == 3
    assert dt.datetime.fromisoformat(body["resets_at"]) == RESETS_AT


# --- the quota day -----------------------------------------------------------------------


def test_quota_day_is_jerusalem_midnight(settings: Settings) -> None:
    assert quota_day_start(NOW, settings) == DAY_START
    assert quota_resets_at(NOW, settings) == RESETS_AT
    # 23:59 in Jerusalem is still the same day; midnight starts the next.
    assert quota_day_start(Z(2026, 11, 16, 21, 59), settings) == DAY_START
    assert quota_day_start(RESETS_AT, settings) == RESETS_AT
    assert quota_day_start(NOW, settings).tzinfo == dt.UTC


def test_quota_day_follows_the_settings_timezone(settings: Settings) -> None:
    utc = settings.model_copy(update={"ai_quota_timezone": "UTC"})
    assert quota_day_start(NOW, utc) == Z(2026, 11, 16)
    assert quota_resets_at(NOW, utc) == Z(2026, 11, 17)


# --- POST /plans/generate ----------------------------------------------------------------


def test_generate_enqueues_the_unanalyzed_exams(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    analyzed = insert_exam(db, user.id, name="הסתברות", exam_date="2026-11-25")
    ai_task(db, user.id, analyzed)
    response = generate(api, user)
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["created"] is True
    kind, payload, status, owner = job_row(db, UUID(body["job_id"]))
    assert (kind, status, owner) == ("generate_plan", "queued", user.id)
    assert payload == {"exam_ids": [str(exam)]}


def test_generate_accepts_an_empty_body(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    response = generate(api, user, json={})
    assert response.status_code == 202, response.text
    assert response.json()["created"] is True


def test_generate_takes_every_unanalyzed_exam_by_date(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    earlier = insert_exam(db, user.id, name="שפת C", exam_date="2026-11-20")
    # Only a live AI task marks an exam as analyzed: a user task or a deleted AI task does not.
    insert_task(db, user.id, earlier)
    ai_task(db, user.id, exam, deleted=True)
    today = insert_exam(db, user.id, name="היום", exam_date="2026-11-16")
    insert_exam(db, user.id, name="עבר", exam_date="2026-11-15")
    insert_exam(db, user.id, name="נמחק", exam_date="2026-11-30", deleted=True)
    response = generate(api, user)
    assert response.status_code == 202, response.text
    _, payload, _, _ = job_row(db, UUID(response.json()["job_id"]))
    assert payload == {"exam_ids": [str(today), str(earlier), str(exam)]}


def test_generate_uses_the_profiles_today_for_past_exams(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    # 05:00 UTC on the 16th is still 18:00 on the 15th in Pago Pago (UTC-11): an exam on
    # the 15th has not passed for this profile.
    set_profile(db, user.id, timezone="Pacific/Pago_Pago")
    local_today = insert_exam(db, user.id, exam_date="2026-11-15")
    insert_exam(db, user.id, exam_date="2026-11-14")
    response = generate(api, user)
    assert response.status_code == 202, response.text
    _, payload, _, _ = job_row(db, UUID(response.json()["job_id"]))
    assert payload == {"exam_ids": [str(local_today)]}


def test_generate_without_anything_to_analyze(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    ai_task(db, user.id, exam)
    response = generate(api, user)
    assert response.status_code == 409, response.text
    body = response.json()
    assert body["code"] == "nothing_to_analyze"
    assert body["title"] == "כל המבחנים כבר נותחו. אפשר לתכנן מחדש את הלוח."
    assert job_count(db, user.id) == 0


def test_generate_without_exams(api: TestClient, db: psycopg.Connection, user: ApiUser) -> None:
    response = generate(api, user)
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "nothing_to_analyze"
    assert job_count(db, user.id) == 0


def test_fourth_request_of_the_day_is_refused(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    # The first exactly at the day's start: the boundary is inclusive.
    for created_at in (DAY_START, Z(2026, 11, 16, 1), Z(2026, 11, 16, 4)):
        make_job(db, user.id, created_at=created_at)
    response = generate(api, user)
    assert_quota_exceeded(response)
    assert response.json()["title"] == "הגעתם למספר יצירות התוכנית היומי. אפשר לנסות שוב מחר."
    assert job_count(db, user.id) == 3


def test_jobs_of_any_status_count_except_failed_without_usage(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    make_job(db, user.id, status="done")
    make_job(db, user.id, "reanalyze_exam", status="running", payload={"exam_id": "x"})
    make_job(db, user.id, "reanalyze_exam", status="queued", payload={"exam_id": "y"})
    assert_quota_exceeded(generate(api, user))


def test_other_kinds_do_not_count(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    for _ in range(3):
        make_job(db, user.id, "ingest_material")
    assert generate(api, user).status_code == 202


def test_other_users_jobs_do_not_count(
    api: TestClient,
    db: psycopg.Connection,
    make_api_user: MakeApiUser,
    user: ApiUser,
    exam: UUID,
) -> None:
    other = make_api_user()
    for _ in range(3):
        make_job(db, other.id)
    assert generate(api, user).status_code == 202


def test_failed_job_without_usage_does_not_count(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    make_job(db, user.id)
    make_job(db, user.id)
    make_job(db, user.id, status="failed")
    response = generate(api, user)
    assert response.status_code == 202, response.text
    assert response.json()["created"] is True


def test_failed_job_with_usage_counts(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    make_job(db, user.id)
    make_job(db, user.id)
    failed = make_job(db, user.id, status="failed")
    add_usage(db, user.id, failed)
    assert_quota_exceeded(generate(api, user))


def test_crashed_job_without_usage_counts(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    # A worker that died inside the Claude call wrote no usage row, but may have spent money.
    make_job(db, user.id)
    make_job(db, user.id)
    make_job(db, user.id, status="failed", error="worker_crashed")
    assert_quota_exceeded(generate(api, user))


def test_yesterdays_jobs_do_not_count(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    # 21:59 UTC is 23:59 in Jerusalem, the day before.
    for _ in range(3):
        make_job(db, user.id, created_at=Z(2026, 11, 15, 21, 59))
    assert generate(api, user).status_code == 202


def test_quota_day_follows_jerusalem_not_the_profile(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    # In Kiritimati (UTC+14) the 16th started at 10:00 UTC on the 15th, so these jobs are
    # "today" for the profile, but yesterday in Jerusalem.
    set_profile(db, user.id, timezone="Pacific/Kiritimati")
    jobs = [make_job(db, user.id, created_at=Z(2026, 11, 15, 21, 59)) for _ in range(3)]
    assert generate(api, user).status_code == 202
    db.execute("DELETE FROM app.jobs WHERE user_id = %s AND id <> ALL(%s)", (user.id, jobs))
    db.execute("UPDATE app.jobs SET created_at = %s WHERE user_id = %s", (DAY_START, user.id))
    assert_quota_exceeded(generate(api, user))


def test_active_generation_is_returned_not_counted(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    first = generate(api, user)
    assert first.status_code == 202, first.text
    second = generate(api, user)
    assert second.status_code == 202, second.text
    assert second.json() == {"job_id": first.json()["job_id"], "created": False}
    assert job_count(db, user.id) == 1


@pytest.mark.parametrize("status", ["queued", "running"])
def test_active_generation_is_returned_even_at_the_quota(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID, status: str
) -> None:
    make_job(db, user.id)
    make_job(db, user.id)
    active = make_job(db, user.id, status=status, payload={"exam_ids": [str(exam)]})
    response = generate(api, user)
    assert response.status_code == 202, response.text
    assert response.json() == {"job_id": str(active), "created": False}
    assert job_count(db, user.id) == 3


def test_active_generation_is_returned_with_nothing_to_analyze(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    # A refresh of the "building your plan" screen, after the job already wrote AI tasks.
    active = make_job(db, user.id, status="running", payload={"exam_ids": [str(exam)]})
    ai_task(db, user.id, exam)
    response = generate(api, user)
    assert response.status_code == 202, response.text
    assert response.json() == {"job_id": str(active), "created": False}


def test_finished_generation_is_not_returned(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    done = make_job(db, user.id, status="done")
    response = generate(api, user)
    assert response.status_code == 202, response.text
    assert response.json()["created"] is True
    assert response.json()["job_id"] != str(done)


def test_generate_for_a_user_without_a_profile(
    api: TestClient, db: psycopg.Connection, make_api_user: MakeApiUser, clock: FrozenClock
) -> None:
    clock.set(NOW)
    fresh = make_api_user()
    response = generate(api, fresh)
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "nothing_to_analyze"
    assert job_count(db, fresh.id) == 0


def _race(
    api: TestClient,
    db: psycopg.Connection,
    migrated_database_url: str,
    requests: list[Callable[[], Any]],
) -> list[Any]:
    """Run the requests at once while app.jobs is locked, so both are inside at the same time.

    A request that got past the quota check waits at its INSERT; without the per-user lock
    both would count the same jobs and pass together.
    """
    barrier = threading.Barrier(len(requests))
    results: list[Any] = []
    errors: list[BaseException] = []

    def run(request: Callable[[], Any]) -> None:
        try:
            barrier.wait(5)
            results.append(request())
        except BaseException as error:  # reported to the test thread
            errors.append(error)

    threads = [threading.Thread(target=run, args=(request,)) for request in requests]
    waiting = 0
    with psycopg.connect(migrated_database_url) as holder:
        holder.execute("LOCK TABLE app.jobs IN EXCLUSIVE MODE")
        for thread in threads:
            thread.start()
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            waiting = scalar(
                db,
                "SELECT count(*) FROM pg_stat_activity "
                "WHERE datname = current_database() AND wait_event_type = 'Lock'",
            )
            if waiting >= len(requests):
                break
            time.sleep(0.02)
        holder.commit()
    for thread in threads:
        thread.join(20)
    # Without both requests blocked at once the test would pass serially, proving nothing.
    assert waiting >= len(requests)
    assert not any(thread.is_alive() for thread in threads)
    assert errors == []
    return results


def test_concurrent_requests_respect_the_quota(
    api: TestClient,
    db: psycopg.Connection,
    migrated_database_url: str,
    user: ApiUser,
    exam: UUID,
) -> None:
    make_job(db, user.id)
    make_job(db, user.id)
    results = _race(
        api, db, migrated_database_url, [lambda: generate(api, user), lambda: generate(api, user)]
    )
    assert [response.status_code for response in results] == [202, 202]
    bodies = [response.json() for response in results]
    assert sorted(body["created"] for body in bodies) == [False, True]
    assert bodies[0]["job_id"] == bodies[1]["job_id"]
    assert job_count(db, user.id) == 3


def test_concurrent_generate_and_reanalyze_respect_the_quota(
    api: TestClient,
    db: psycopg.Connection,
    migrated_database_url: str,
    user: ApiUser,
    clock: FrozenClock,
) -> None:
    # The job the first request writes gets the database's real clock as created_at, so
    # this test runs on the real time for the quota day to contain it.
    now = dt.datetime.now(dt.UTC)
    clock.set(now)
    exam_date = (now + dt.timedelta(days=30)).date()
    first = insert_exam(db, user.id, exam_date=exam_date)
    second = insert_exam(db, user.id, exam_date=exam_date)
    ai_task(db, user.id, second)
    make_job(db, user.id, created_at=now)
    make_job(db, user.id, created_at=now)
    results = _race(
        api,
        db,
        migrated_database_url,
        [lambda: generate(api, user), lambda: reanalyze(api, user, second)],
    )
    assert sorted(response.status_code for response in results) == [202, 429]
    assert job_count(db, user.id) == 3
    assert scalar(db, "SELECT count(*) FROM app.exams WHERE id = %s", first) == 1


# --- POST /exams/{exam_id}/reanalyze -----------------------------------------------------


def test_reanalyze_enqueues_the_exam(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    # Reanalysis is for an exam that was already analyzed: its AI tasks do not stop it.
    ai_task(db, user.id, exam)
    response = reanalyze(api, user, exam)
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["created"] is True
    kind, payload, status, owner = job_row(db, UUID(body["job_id"]))
    assert (kind, status, owner) == ("reanalyze_exam", "queued", user.id)
    assert payload == {"exam_id": str(exam)}


def test_reanalyze_exam_of_today(api: TestClient, db: psycopg.Connection, user: ApiUser) -> None:
    exam_today = insert_exam(db, user.id, exam_date="2026-11-16")
    assert reanalyze(api, user, exam_today).status_code == 202


def test_reanalyze_past_exam_is_422(api: TestClient, db: psycopg.Connection, user: ApiUser) -> None:
    past = insert_exam(db, user.id, exam_date="2026-11-15")
    response = reanalyze(api, user, past)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "exam_in_past"
    assert job_count(db, user.id) == 0


def test_reanalyze_deleted_exam_is_404(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    deleted = insert_exam(db, user.id, exam_date="2026-12-01", deleted=True)
    response = reanalyze(api, user, deleted)
    assert response.status_code == 404, response.text
    assert response.json()["code"] == "not_found"
    assert job_count(db, user.id) == 0


def test_reanalyze_unknown_exam_is_404(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    response = reanalyze(api, user, UUID(int=1))
    assert response.status_code == 404, response.text
    assert job_count(db, user.id) == 0


def test_reanalyze_returns_the_active_job_of_the_same_exam(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    first = reanalyze(api, user, exam)
    assert first.status_code == 202, first.text
    second = reanalyze(api, user, exam)
    assert second.status_code == 202, second.text
    assert second.json() == {"job_id": first.json()["job_id"], "created": False}
    assert job_count(db, user.id) == 1


def test_reanalyze_of_another_exam_is_a_new_job(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    other = insert_exam(db, user.id, exam_date="2026-11-25")
    make_job(db, user.id, "reanalyze_exam", status="queued", payload={"exam_id": str(other)})
    response = reanalyze(api, user, exam)
    assert response.status_code == 202, response.text
    assert response.json()["created"] is True
    assert job_count(db, user.id) == 2


def test_reanalyze_shares_the_quota_with_generate(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    for _ in range(3):
        make_job(db, user.id, "generate_plan")
    assert_quota_exceeded(reanalyze(api, user, exam))
    db.execute("UPDATE app.jobs SET kind = 'reanalyze_exam' WHERE user_id = %s", (user.id,))
    assert_quota_exceeded(generate(api, user))
    assert job_count(db, user.id) == 3


def test_reanalyze_active_job_is_returned_at_the_quota(
    api: TestClient, db: psycopg.Connection, user: ApiUser, exam: UUID
) -> None:
    make_job(db, user.id)
    make_job(db, user.id)
    active = make_job(
        db, user.id, "reanalyze_exam", status="running", payload={"exam_id": str(exam)}
    )
    response = reanalyze(api, user, exam)
    assert response.status_code == 202, response.text
    assert response.json() == {"job_id": str(active), "created": False}


def test_quota_limit_comes_from_the_settings(
    api: TestClient,
    db_app: FastAPI,
    db: psycopg.Connection,
    settings: Settings,
    user: ApiUser,
    exam: UUID,
) -> None:
    db_app.state.settings = settings.model_copy(update={"ai_daily_generation_limit": 1})
    make_job(db, user.id)
    response = generate(api, user)
    assert response.status_code == 429, response.text
    assert response.json()["limit"] == 1
