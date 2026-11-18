"""POST /timetables and POST /timetables/{job_id}/apply (S35): a timetable photo to commitments.

The browser uploads the file to the materials bucket first, at a path the server builds from
the user's id and the upload id. The registration queues a parse_timetable job under its own
daily quota; the approval writes the items the user kept, possibly edited, as commitments.
Jobs a test needs in a given state are written as the owner (the API only enqueues).
"""

import datetime as dt
from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from app.config import Settings
from tests.api.factories import NOW, TEST_PROFILE, Z, scalar, set_profile
from tests.fixtures_db import ApiUser, FrozenClock

MakeApiUser = Callable[[], ApiUser]

# NOW is 07:00 in Jerusalem (the quota timezone): the quota day ends at 22:00 UTC.
RESETS_AT = Z(2026, 11, 16, 22)


@pytest.fixture
def user(make_api_user: MakeApiUser, db: psycopg.Connection, clock: FrozenClock) -> ApiUser:
    created = make_api_user()
    set_profile(db, created.id, **TEST_PROFILE)
    clock.set(NOW)
    return created


def _register(
    api: TestClient,
    user: ApiUser,
    *,
    upload_id: UUID | None = None,
    mime: str = "image/png",
    size_bytes: int = 200_000,
    **extra: Any,
) -> Any:
    body = {
        "id": str(upload_id if upload_id is not None else uuid4()),
        "mime": mime,
        "size_bytes": size_bytes,
        **extra,
    }
    return api.post("/timetables", json=body, headers=user.headers)


def _job(db: psycopg.Connection, job_id: UUID | str) -> tuple[Any, ...]:
    row = db.execute(
        "SELECT user_id, kind, payload, status FROM app.jobs WHERE id = %s", (job_id,)
    ).fetchone()
    assert row is not None
    return tuple(row)


def make_job(
    db: psycopg.Connection,
    user_id: UUID,
    *,
    kind: str = "parse_timetable",
    status: str = "done",
    created_at: dt.datetime = NOW,
    error: str | None = None,
    result: dict[str, Any] | None = None,
) -> UUID:
    row = db.execute(
        "INSERT INTO app.jobs (user_id, kind, payload, status, created_at, run_at, error, result) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
        (
            user_id,
            kind,
            Jsonb({"upload_id": str(uuid4())}),
            status,
            created_at,
            created_at,
            error,
            None if result is None else Jsonb(result),
        ),
    ).fetchone()
    assert row is not None
    return UUID(str(row[0]))


def _apply(api: TestClient, user: ApiUser, job_id: UUID, body: dict[str, Any]) -> Any:
    return api.post(f"/timetables/{job_id}/apply", json=body, headers=user.headers)


def _item(**overrides: Any) -> dict[str, Any]:
    return {
        "title": "אלגוריתמים",
        "kind": "class",
        "weekday": 0,
        "start_time": "10:00",
        "end_time": "12:00",
        **overrides,
    }


def _commitments(db: psycopg.Connection, user_id: UUID) -> list[tuple[Any, ...]]:
    return [
        tuple(row)
        for row in db.execute(
            "SELECT title, kind, weekday, start_time, end_time, valid_from, valid_until, "
            "source_job_id FROM app.commitments WHERE user_id = %s AND deleted_at IS NULL "
            "ORDER BY weekday, start_time",
            (user_id,),
        ).fetchall()
    ]


# --- registration --------------------------------------------------------------------------


def test_register_queues_a_job_with_the_path_built_by_the_server(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    upload = uuid4()
    response = _register(api, user, upload_id=upload, mime="image/jpeg")
    assert response.status_code == 202, response.text
    body = response.json()
    assert set(body) == {"job_id"}
    user_id, kind, payload, status = _job(db, body["job_id"])
    assert (user_id, kind, status) == (user.id, "parse_timetable", "queued")
    assert payload == {
        "upload_id": str(upload),
        "storage_path": f"{user.id}/timetables/{upload}",
        "mime": "image/jpeg",
    }
    # Nothing is written to the commitments until the user approves.
    assert _commitments(db, user.id) == []


def test_the_browser_cannot_send_a_path(api: TestClient, user: ApiUser) -> None:
    response = _register(api, user, storage_path="someone-else/timetables/x")
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "validation_error"


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({"mime": "image/gif"}, id="unsupported_mime"),
        pytest.param({"size_bytes": 0}, id="empty"),
        pytest.param({"id": "not-a-uuid"}, id="bad_id"),
    ],
)
def test_register_validation(api: TestClient, user: ApiUser, body: dict[str, Any]) -> None:
    payload = {"id": str(uuid4()), "mime": "image/png", "size_bytes": 1000, **body}
    response = api.post("/timetables", json=payload, headers=user.headers)
    assert response.status_code == 422, response.text


def test_size_limits(
    api: TestClient, user: ApiUser, db: psycopg.Connection, settings: Settings
) -> None:
    image_limit = settings.max_timetable_image_bytes
    pdf_limit = settings.max_material_bytes
    assert image_limit < pdf_limit
    for mime, size, limit in (
        ("image/png", image_limit + 1, image_limit),
        ("image/jpeg", image_limit + 1, image_limit),
        ("application/pdf", pdf_limit + 1, pdf_limit),
    ):
        response = _register(api, user, mime=mime, size_bytes=size)
        assert response.status_code == 422, response.text
        assert response.json()["code"] == "file_too_large"
        assert response.json()["limit_bytes"] == limit
    assert scalar(db, "SELECT count(*) FROM app.jobs WHERE user_id = %s", user.id) == 0
    # At the limit is fine; a PDF may be larger than an image.
    assert _register(api, user, mime="image/png", size_bytes=image_limit).status_code == 202
    pdf = _register(api, user, mime="application/pdf", size_bytes=image_limit + 1)
    assert pdf.status_code == 202, pdf.text


def test_the_same_upload_twice_is_409(
    api: TestClient, user: ApiUser, make_api_user: MakeApiUser, db: psycopg.Connection
) -> None:
    upload = uuid4()
    assert _register(api, user, upload_id=upload).status_code == 202
    again = _register(api, user, upload_id=upload)
    assert again.status_code == 409, again.text
    assert again.json()["code"] == "already_exists"
    # The path holds the user's id: another user's upload with the same id is theirs.
    other = make_api_user()
    set_profile(db, other.id, **TEST_PROFILE)
    assert _register(api, other, upload_id=upload).status_code == 202


def test_quota_is_its_own(
    api: TestClient, user: ApiUser, db: psycopg.Connection, settings: Settings
) -> None:
    assert settings.ai_daily_timetable_limit == 5
    # Plan generations do not take from the timetable quota.
    for _ in range(settings.ai_daily_generation_limit):
        make_job(db, user.id, kind="generate_plan")
    # Yesterday's jobs do not count.
    make_job(db, user.id, created_at=Z(2026, 11, 15, 21, 59))
    for _ in range(settings.ai_daily_timetable_limit):
        assert _register(api, user).status_code == 202

    response = _register(api, user)
    assert response.status_code == 429, response.text
    body = response.json()
    assert body["code"] == "ai_quota_exceeded"
    assert body["limit"] == 5
    assert dt.datetime.fromisoformat(body["resets_at"]) == RESETS_AT


def test_a_failure_that_cost_nothing_is_not_counted(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    for _ in range(4):
        make_job(db, user.id)
    free = make_job(db, user.id, status="failed", error="timetable_unreadable")
    crashed = make_job(db, user.id, status="failed", error="worker_crashed")
    assert {free, crashed}
    # Four done and one crashed (which may have spent money) count; the free failure does not.
    assert _register(api, user).status_code == 429

    db.execute("DELETE FROM app.jobs WHERE id = %s", (crashed,))
    assert _register(api, user).status_code == 202


def test_timetable_jobs_do_not_take_from_the_plan_quota(
    api: TestClient, user: ApiUser, db: psycopg.Connection, settings: Settings
) -> None:
    for _ in range(settings.ai_daily_timetable_limit):
        make_job(db, user.id)
    db.execute(
        "INSERT INTO app.exams (user_id, name, exam_date, difficulty) "
        "VALUES (%s, 'מבחן', '2026-12-01', 3)",
        (user.id,),
    )
    response = api.post("/plans/generate", headers=user.headers)
    assert response.status_code == 202, response.text


# --- approval ------------------------------------------------------------------------------


def test_apply_writes_the_approved_items(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    job = make_job(db, user.id)
    response = _apply(
        api,
        user,
        job,
        {
            "items": [
                _item(),
                # Edited by the user: another title, a later end, a shift past midnight.
                _item(title="משמרת", kind="work", weekday=4, start_time="22:00", end_time="06:00"),
            ]
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["plan_affected"] is True
    assert [
        (c["title"], c["weekday"], c["start_time"], c["end_time"]) for c in body["commitments"]
    ] == [
        ("אלגוריתמים", 0, "10:00", "12:00"),
        ("משמרת", 4, "22:00", "06:00"),
    ]
    assert all(c["source_job_id"] == str(job) for c in body["commitments"])
    assert all(c["valid_from"] == "2026-11-16" for c in body["commitments"])
    assert _commitments(db, user.id) == [
        ("אלגוריתמים", "class", 0, dt.time(10), dt.time(12), dt.date(2026, 11, 16), None, job),
        ("משמרת", "work", 4, dt.time(22), dt.time(6), dt.date(2026, 11, 16), None, job),
    ]
    # A commitment change is global: no plan version, the web offers a replan.
    assert scalar(db, "SELECT count(*) FROM app.plan_versions") == 0


def test_valid_dates_apply_to_items_without_their_own(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    job = make_job(db, user.id)
    response = _apply(
        api,
        user,
        job,
        {
            "items": [
                _item(),
                _item(weekday=2, valid_from="2026-11-20", valid_until="2026-12-31"),
            ],
            "valid_from": "2026-11-18",
            "valid_until": "2027-01-10",
        },
    )
    assert response.status_code == 201, response.text
    assert [(row[5], row[6]) for row in _commitments(db, user.id)] == [
        (dt.date(2026, 11, 18), dt.date(2027, 1, 10)),
        (dt.date(2026, 11, 20), dt.date(2026, 12, 31)),
    ]


def test_null_valid_until_means_no_end(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    job = make_job(db, user.id)
    response = _apply(api, user, job, {"items": [_item()], "valid_until": None})
    assert response.status_code == 201, response.text
    assert _commitments(db, user.id)[0][6] is None


def test_an_item_that_sent_no_end_keeps_it_over_a_shared_valid_until(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    job = make_job(db, user.id)
    response = _apply(
        api,
        user,
        job,
        {"items": [_item(valid_until=None), _item(weekday=2)], "valid_until": "2027-01-10"},
    )
    assert response.status_code == 201, response.text
    assert [row[6] for row in _commitments(db, user.id)] == [None, dt.date(2027, 1, 10)]


def test_apply_twice_is_already_applied(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    job = make_job(db, user.id)
    assert _apply(api, user, job, {"items": [_item()]}).status_code == 201
    again = _apply(api, user, job, {"items": [_item(weekday=3)]})
    assert again.status_code == 409, again.text
    assert again.json()["code"] == "already_applied"
    assert len(_commitments(db, user.id)) == 1

    # Once the user deleted them all, the photo may be approved again.
    db.execute("UPDATE app.commitments SET deleted_at = now() WHERE user_id = %s", (user.id,))
    assert _apply(api, user, job, {"items": [_item()]}).status_code == 201


@pytest.mark.parametrize("status", ["queued", "running"])
def test_a_job_not_done_yet_is_409(
    api: TestClient, user: ApiUser, db: psycopg.Connection, status: str
) -> None:
    job = make_job(db, user.id, status=status)
    response = _apply(api, user, job, {"items": [_item()]})
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "job_not_ready"


def test_a_failed_job_is_invalid_state(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    job = make_job(db, user.id, status="failed", error="timetable_unreadable")
    response = _apply(api, user, job, {"items": [_item()]})
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "invalid_state"
    assert _commitments(db, user.id) == []


def test_another_users_job_or_another_kind_is_404(
    api: TestClient, user: ApiUser, make_api_user: MakeApiUser, db: psycopg.Connection
) -> None:
    other = make_api_user()
    set_profile(db, other.id, **TEST_PROFILE)
    theirs = make_job(db, other.id)
    plan = make_job(db, user.id, kind="generate_plan")
    for job in (theirs, plan, uuid4()):
        response = _apply(api, user, job, {"items": [_item()]})
        assert response.status_code == 404, response.text
        assert response.json()["code"] == "not_found"
    assert _commitments(db, user.id) == []
    assert _commitments(db, other.id) == []


def test_item_errors_carry_their_index(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    job = make_job(db, user.id)
    response = _apply(
        api,
        user,
        job,
        {
            "items": [
                _item(),
                _item(end_time="10:00"),
                _item(start_time="10:00", end_time="10:10"),
                _item(valid_from="2026-12-01", valid_until="2026-11-30"),
            ]
        },
    )
    assert response.status_code == 422, response.text
    errors = response.json()["errors"]
    assert errors == [
        {"loc": ["body", "items", 1, "end_time"], "type": "same_as_start_time"},
        {"loc": ["body", "items", 2, "end_time"], "type": "too_short"},
        {"loc": ["body", "items", 3, "valid_until"], "type": "before_valid_from"},
    ]
    assert _commitments(db, user.id) == []


def test_a_shared_valid_until_before_an_items_start_is_its_error(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    job = make_job(db, user.id)
    response = _apply(
        api,
        user,
        job,
        {"items": [_item(), _item(valid_from="2027-02-01")], "valid_until": "2027-01-10"},
    )
    assert response.status_code == 422, response.text
    assert response.json()["errors"] == [
        {"loc": ["body", "items", 1, "valid_until"], "type": "before_valid_from"}
    ]


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({"items": []}, id="no_items"),
        pytest.param({"items": [_item()] * 61}, id="too_many_items"),
        pytest.param({"items": [_item(weekday=7)]}, id="bad_weekday"),
        pytest.param({"items": [_item(kind="party")]}, id="bad_kind"),
        pytest.param({"items": [_item(start_time="10:00:30")]}, id="not_a_whole_minute"),
        pytest.param({"items": [_item(title="  ")]}, id="blank_title"),
        pytest.param({"items": [_item()], "extra": 1}, id="extra_field"),
    ],
)
def test_body_validation(
    api: TestClient, user: ApiUser, db: psycopg.Connection, body: dict[str, Any]
) -> None:
    job = make_job(db, user.id)
    response = _apply(api, user, job, body)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "validation_error"
