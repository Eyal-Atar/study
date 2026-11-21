"""S45: POST /exams/{id}/moed-b opens a focused second sitting from the exam's materials."""

import datetime as dt
from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.rows import dict_row

from app.domain.closure import ExamState, Outcome, closure_options, exam_state
from tests.api.factories import (
    NOW,
    TEST_PROFILE,
    Z,
    insert_analysis,
    insert_block,
    insert_exam,
    insert_task,
    scalar,
    set_profile,
)
from tests.fixtures_db import ApiUser, FrozenClock

MakeApiUser = Callable[[], ApiUser]
UTC = ZoneInfo("UTC")
FIRST_DATE = "2026-11-14"  # Moed A, two days before NOW (2026-11-16)
NEW_DATE = "2026-11-30"


@pytest.fixture
def user(make_api_user: MakeApiUser, db: psycopg.Connection, clock: FrozenClock) -> ApiUser:
    created = make_api_user()
    set_profile(db, created.id, **TEST_PROFILE)
    clock.set(NOW)
    return created


@pytest.fixture
def other(make_api_user: MakeApiUser, db: psycopg.Connection) -> ApiUser:
    created = make_api_user()
    set_profile(db, created.id, **TEST_PROFILE)
    return created


def waiting_exam(
    db: psycopg.Connection,
    user_id: UUID,
    *,
    closure: str | None = "moed_b",
    exam_date: str = FIRST_DATE,
    deleted: bool = False,
    name: str = "Algorithms",
) -> UUID:
    exam = insert_exam(db, user_id, name=name, exam_date=exam_date, deleted=deleted)
    if closure is not None:
        db.execute(
            "UPDATE app.exams SET closure = %s, closed_at = %s WHERE id = %s",
            (closure, NOW, exam),
        )
    return exam


def insert_topic(
    db: psycopg.Connection,
    user_id: UUID,
    exam_id: UUID,
    name: str,
    position: int,
    weight: int = 3,
    analysis: UUID | None = None,
) -> UUID:
    """A topic of the exam's current analysis (made applied on first use), or of `analysis`."""
    if analysis is None:
        found = db.execute(
            "SELECT id FROM app.analyses WHERE exam_id = %s AND status = 'applied' "
            "ORDER BY applied_at DESC LIMIT 1",
            (exam_id,),
        ).fetchone()
        analysis = insert_analysis(db, user_id, exam_id) if found is None else found[0]
    return UUID(
        str(
            scalar(
                db,
                "INSERT INTO app.topics (user_id, exam_id, name, weight, position, analysis_id) "
                "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                user_id,
                exam_id,
                name,
                weight,
                position,
                analysis,
            )
        )
    )


def place(db: psycopg.Connection, task: UUID, *, position: int, topic: UUID | None = None) -> None:
    db.execute(
        "UPDATE app.tasks SET position = %s, topic_id = %s WHERE id = %s", (position, topic, task)
    )


def open_moed_b(
    api: TestClient, user: ApiUser, exam: UUID, **body: Any
) -> tuple[int, dict[str, Any]]:
    payload = {"exam_date": NEW_DATE, **body}
    response = api.post(f"/exams/{exam}/moed-b", json=payload, headers=user.headers)
    result: dict[str, Any] = response.json()
    return response.status_code, result


def rows(db: psycopg.Connection, query: str, *params: object) -> list[dict[str, Any]]:
    with db.cursor(row_factory=dict_row) as cursor:
        return cursor.execute(query, params).fetchall()


def test_opening_moed_b_builds_the_focused_plan_and_schedules_it(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = waiting_exam(db, user.id)
    graphs = insert_topic(db, user.id, exam, "Graphs", 1)
    trees = insert_topic(db, user.id, exam, "Trees", 2, weight=2)
    heaps = insert_topic(db, user.id, exam, "Heaps", 3, weight=4)
    learn_graphs = insert_task(db, user.id, exam, title="Learn graphs", minutes=90, status="done")
    place(db, learn_graphs, position=1, topic=graphs)
    drills = insert_task(db, user.id, exam, title="Graph drills", kind="practice")
    place(db, drills, position=2, topic=graphs)
    learn_trees = insert_task(db, user.id, exam, title="Learn trees", minutes=60)
    place(db, learn_trees, position=3, topic=trees)
    mock = insert_task(db, user.id, exam, title="Mock 2025", kind="simulation", minutes=120)
    place(db, mock, position=4)
    mock_review = insert_task(
        db, user.id, exam, title="Mock review", kind="simulation_review", minutes=45,
        depends_on=mock,
    )  # fmt: skip
    place(db, mock_review, position=5)
    done_block = insert_block(
        db, user.id, learn_graphs, Z(2026, 11, 10, 9), Z(2026, 11, 10, 10, 30), status="done"
    )
    db.execute(
        "INSERT INTO app.xp_events (user_id, block_id, xp, study_date) "
        "VALUES (%s, %s, 90, '2026-11-10')",
        (user.id, done_block),
    )
    # A leftover future block of a Moed A task: Moed B's replan takes it out.
    insert_block(db, user.id, drills, Z(2026, 11, 17, 9), Z(2026, 11, 17, 10))

    status, body = open_moed_b(
        api, user, exam, grade=55, hard_topic_ids=[str(trees)], hard_notes="  the mock  "
    )
    assert status == 200, body
    assert body["exam"] == {
        "id": str(exam),
        "name": "Algorithms",
        "exam_date": NEW_DATE,
        "first_exam_date": FIRST_DATE,
        "first_grade": 55,
        "sitting": 2,
        "state": "active",
        "color_index": body["exam"]["color_index"],
    }
    assert body["tasks_created"] == 6
    assert body["weak_topics"] == [{"id": str(trees), "name": "Trees"}]
    assert body["trimmed"] == 0
    assert body["unscheduled"] == []
    assert body["shortfalls"] == []

    new = rows(
        db,
        "SELECT id, title, kind, estimated_minutes, focus, depends_on_task_id, topic_id, "
        "position, source, status FROM app.tasks "
        "WHERE exam_id = %s AND sitting = 2 ORDER BY position",
        exam,
    )
    assert [(t["title"], t["kind"], t["estimated_minutes"], t["focus"]) for t in new] == [
        ("Mock 2025", "simulation", 120, 8),
        ("Mock review", "simulation_review", 45, 8),
        ("Trees", "review", 45, 8),
        ("Trees", "practice", 60, 8),
        ("Graphs", "review", 75, 5),
        ("Heaps", "review", 90, 5),
    ]
    assert [t["position"] for t in new] == [1, 2, 3, 4, 5, 6]
    assert {(t["source"], t["status"]) for t in new} == {("ai", "todo")}
    ids = [t["id"] for t in new]
    assert [t["depends_on_task_id"] for t in new] == [None, ids[0], None, None, ids[3], ids[3]]
    assert [t["topic_id"] for t in new] == [None, None, trees, trees, graphs, heaps]

    exam_row = rows(db, "SELECT * FROM app.exams WHERE id = %s", exam)[0]
    assert exam_row["sitting"] == 2
    assert str(exam_row["exam_date"]) == NEW_DATE
    assert str(exam_row["first_exam_date"]) == FIRST_DATE
    assert exam_row["closure"] is None and exam_row["closed_at"] is None
    assert exam_row["closure_notified_at"] is None
    assert exam_row["moed_b_notes"] == "the mock"
    assert exam_row["moed_b_topic_ids"] == [trees]

    # Every new task is planned before the new date; Moed A's tasks have no future block.
    planned = rows(
        db,
        "SELECT b.task_id, b.ends_at, t.sitting, b.plan_version_id FROM app.blocks b "
        "JOIN app.tasks t ON t.id = b.task_id WHERE b.user_id = %s AND b.status = 'planned'",
        user.id,
    )
    assert {b["task_id"] for b in planned} == set(ids)
    assert all(b["sitting"] == 2 for b in planned)
    assert all(b["ends_at"] <= Z(2026, 11, 30) for b in planned)
    assert {b["plan_version_id"] for b in planned} == {UUID(body["version_id"])}

    # Moed A's done work is untouched.
    assert scalar(db, "SELECT status FROM app.blocks WHERE id = %s", done_block) == "done"
    assert scalar(db, "SELECT status FROM app.tasks WHERE id = %s", learn_graphs) == "done"
    assert scalar(db, "SELECT sitting FROM app.tasks WHERE id = %s", learn_graphs) == 1
    assert scalar(db, "SELECT xp FROM app.xp_events WHERE block_id = %s", done_block) == 90


def test_one_version_keeps_the_exam_as_it_was(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = waiting_exam(db, user.id)
    status, body = open_moed_b(api, user, exam)
    assert status == 200, body
    versions = rows(
        db, "SELECT id, reason, exam_id, exam_before FROM app.plan_versions WHERE user_id = %s",
        user.id,
    )  # fmt: skip
    assert len(versions) == 1
    version = versions[0]
    assert (version["id"], version["reason"], version["exam_id"]) == (
        UUID(body["version_id"]),
        "moed_b_opened",
        exam,
    )
    before = version["exam_before"]
    assert before["exam_date"] == FIRST_DATE
    assert before["sitting"] == 1
    assert before["closure"] == "moed_b"
    assert dt.datetime.fromisoformat(before["closed_at"]) == NOW
    assert before["closure_notified_at"] is None
    assert before["first_exam_date"] is None
    assert before["first_grade"] is None
    assert before["moed_b_notes"] is None
    assert before["moed_b_topic_ids"] == []


def test_without_topics_or_simulations_the_defaults_and_learn_reviews_are_used(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = waiting_exam(db, user.id)
    chapter = insert_task(db, user.id, exam, title="Chapter 1", minutes=100)
    place(db, chapter, position=1)
    status, body = open_moed_b(api, user, exam, hard_notes="   ")
    assert status == 200, body
    titles = [
        r["title"]
        for r in rows(
            db,
            "SELECT title FROM app.tasks WHERE sitting = 2 AND exam_id = %s ORDER BY position",
            exam,
        )
    ]
    assert titles == ["Full practice exam", "Practice exam review", "Chapter 1"]
    assert body["weak_topics"] == []
    notes = scalar(db, "SELECT moed_b_notes FROM app.exams WHERE id = %s", exam)
    assert notes is None


def test_free_text_picks_a_topic(api: TestClient, user: ApiUser, db: psycopg.Connection) -> None:
    exam = waiting_exam(db, user.id)
    insert_topic(db, user.id, exam, "Greedy", 1)
    dp = insert_topic(db, user.id, exam, "תכנון דינמי", 2)
    status, body = open_moed_b(api, user, exam, hard_notes="השאלה על תכנון דינמי הפילה אותי")
    assert status == 200, body
    assert body["weak_topics"] == [{"id": str(dp), "name": "תכנון דינמי"}]
    assert scalar(db, "SELECT moed_b_topic_ids FROM app.exams WHERE id = %s", exam) == [dp]


def test_the_new_date_opens_a_closure_that_only_allows_done(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = waiting_exam(db, user.id)
    assert open_moed_b(api, user, exam)[0] == 200
    row = rows(db, "SELECT exam_date, closure, sitting FROM app.exams WHERE id = %s", exam)[0]
    before = Z(2026, 11, 30, 18, 59)
    after = Z(2026, 11, 30, 19, 0)
    assert exam_state(row["exam_date"], row["closure"], before, UTC) is ExamState.ACTIVE
    state = exam_state(row["exam_date"], row["closure"], after, UTC)
    assert state is ExamState.PENDING
    assert closure_options(state, row["sitting"]) == (Outcome.DONE,)


@pytest.mark.parametrize(
    ("closure", "exam_date"),
    [
        (None, "2026-11-20"),  # active
        (None, FIRST_DATE),  # pending: the date passed, not closed yet
        ("done", FIRST_DATE),
    ],
)
def test_only_an_exam_waiting_for_moed_b_opens_it(
    api: TestClient, user: ApiUser, db: psycopg.Connection, closure: str | None, exam_date: str
) -> None:
    exam = waiting_exam(db, user.id, closure=closure, exam_date=exam_date)
    status, body = open_moed_b(api, user, exam)
    assert status == 409, body
    assert body["code"] == "invalid_state"
    assert scalar(db, "SELECT sitting FROM app.exams WHERE id = %s", exam) == 1
    assert scalar(db, "SELECT count(*) FROM app.plan_versions WHERE user_id = %s", user.id) == 0


def test_moed_b_cannot_be_opened_twice(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = waiting_exam(db, user.id)
    assert open_moed_b(api, user, exam)[0] == 200
    status, body = open_moed_b(api, user, exam, exam_date="2026-12-10")
    assert status == 409, body


def test_another_users_or_a_deleted_exam_is_not_found(
    api: TestClient, user: ApiUser, other: ApiUser, db: psycopg.Connection
) -> None:
    theirs = waiting_exam(db, other.id)
    gone = waiting_exam(db, user.id, deleted=True)
    for exam in (theirs, gone, uuid4()):
        status, body = open_moed_b(api, user, exam)
        assert status == 404, body
    assert scalar(db, "SELECT sitting FROM app.exams WHERE id = %s", theirs) == 1


@pytest.mark.parametrize("exam_date", ["2026-11-16", "2026-11-10"])
def test_a_past_new_date_is_rejected(
    api: TestClient, user: ApiUser, db: psycopg.Connection, exam_date: str
) -> None:
    exam = waiting_exam(db, user.id)
    status, body = open_moed_b(api, user, exam, exam_date=exam_date)
    assert status == 422, body
    assert body["code"] == "exam_in_past"


def test_a_new_date_too_far_ahead_is_rejected(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = waiting_exam(db, user.id)
    status, body = open_moed_b(api, user, exam, exam_date="2028-11-17")
    assert status == 422, body
    assert body["errors"][0]["type"] == "too_far_ahead"


def test_a_topic_of_another_exam_is_rejected(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = waiting_exam(db, user.id)
    mine = insert_topic(db, user.id, exam, "Mine", 1)
    other_exam = insert_exam(db, user.id, exam_date="2026-12-20")
    foreign = insert_topic(db, user.id, other_exam, "Foreign", 1)
    status, body = open_moed_b(api, user, exam, hard_topic_ids=[str(mine), str(foreign)])
    assert status == 422, body
    assert body["errors"] == [{"loc": ["body", "hard_topic_ids"], "type": "unknown_topic"}]
    assert scalar(db, "SELECT sitting FROM app.exams WHERE id = %s", exam) == 1


@pytest.mark.parametrize(
    "extra",
    [
        {"grade": 101},
        {"grade": -1},
        {"hard_notes": "x" * 1001},
        {"hard_notes": "a\x00b"},
        {"hard_topic_ids": [str(uuid4()) for _ in range(51)]},
        {"hard_topic_ids": ["not-a-uuid"]},
        {"surprise": 1},
        {"exam_date": None},
    ],
)
def test_request_validation(
    api: TestClient, user: ApiUser, db: psycopg.Connection, extra: dict[str, Any]
) -> None:
    exam = waiting_exam(db, user.id)
    status, body = open_moed_b(api, user, exam, **extra)
    assert status == 422, body


def test_a_tight_new_date_trims_general_review(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    set_profile(db, user.id, daily_study_minutes=120)
    exam = waiting_exam(db, user.id)
    topics = [insert_topic(db, user.id, exam, f"Topic {i}", i, weight=5) for i in range(1, 11)]
    status, body = open_moed_b(
        api, user, exam, exam_date="2026-11-19", hard_topic_ids=[str(topics[0])]
    )
    assert status == 200, body
    assert body["trimmed"] > 0
    created = scalar(db, "SELECT count(*) FROM app.tasks WHERE exam_id = %s AND sitting = 2", exam)
    assert created == body["tasks_created"] == 2 + 2 + 10 - 1 - body["trimmed"]
    # The simulations and the weak topic always stay.
    kinds = [
        r["kind"]
        for r in rows(
            db,
            "SELECT kind FROM app.tasks WHERE exam_id = %s AND sitting = 2 ORDER BY position",
            exam,
        )
    ]
    assert kinds[:4] == ["simulation", "simulation_review", "review", "practice"]


def test_undo_of_moed_b_brings_the_waiting_exam_back(
    api: TestClient, user: ApiUser, db: psycopg.Connection, clock: FrozenClock
) -> None:
    exam = waiting_exam(db, user.id)
    algebra = insert_topic(db, user.id, exam, "Trees", 1)
    status, body = open_moed_b(api, user, exam, grade=48, hard_topic_ids=[str(algebra)])
    assert status == 200, body
    assert (
        scalar(
            db,
            "SELECT count(*) FROM app.blocks b JOIN app.tasks t ON t.id = b.task_id "
            "WHERE t.exam_id = %s AND t.sitting = 2",
            exam,
        )
        > 0
    )

    undone = api.post("/plan/undo", json={"version_id": body["version_id"]}, headers=user.headers)
    assert undone.status_code == 200, undone.text
    exam_row = rows(
        db,
        "SELECT sitting, exam_date::text, closure, first_exam_date, first_grade, "
        "moed_b_topic_ids FROM app.exams WHERE id = %s",
        exam,
    )[0]
    assert exam_row == {
        "sitting": 1,
        "exam_date": FIRST_DATE,
        "closure": "moed_b",
        "first_exam_date": None,
        "first_grade": None,
        "moed_b_topic_ids": [],
    }
    assert (
        scalar(
            db,
            "SELECT count(*) FROM app.tasks WHERE exam_id = %s AND sitting = 2 "
            "AND deleted_at IS NULL",
            exam,
        )
        == 0
    )
    assert (
        scalar(
            db,
            "SELECT count(*) FROM app.blocks b JOIN app.tasks t ON t.id = b.task_id "
            "WHERE t.exam_id = %s AND b.status = 'planned'",
            exam,
        )
        == 0
    )
    listed = api.get("/closures", headers=user.headers).json()
    assert [item["exam_id"] for item in listed["waiting"]] == [str(exam)]

    # Opening again works, and once a Moed B block is done, undo is refused.
    status, again = open_moed_b(api, user, exam)
    assert status == 200, again
    block = scalar(
        db,
        "SELECT b.id FROM app.blocks b JOIN app.tasks t ON t.id = b.task_id "
        "WHERE t.exam_id = %s AND t.sitting = 2 ORDER BY b.starts_at LIMIT 1",
        exam,
    )
    db.execute("UPDATE app.blocks SET status = 'done' WHERE id = %s", (block,))
    refused = api.post("/plan/undo", json={"version_id": again["version_id"]}, headers=user.headers)
    assert refused.status_code == 409
    assert refused.json()["code"] == "invalid_state"


def test_moed_b_uses_only_the_current_topic_generation(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = waiting_exam(db, user.id)
    old = insert_analysis(db, user.id, exam, "superseded")
    insert_topic(db, user.id, exam, "Graphs", 1, analysis=old)
    insert_topic(db, user.id, exam, "Trees", 2, analysis=old)
    current = insert_analysis(db, user.id, exam)
    insert_topic(db, user.id, exam, "Graphs", 1, analysis=current)
    insert_topic(db, user.id, exam, "Trees", 2, analysis=current)

    status, body = open_moed_b(api, user, exam)

    assert status == 200, body
    titles = rows(
        db,
        "SELECT title FROM app.tasks WHERE exam_id = %s AND sitting = 2 AND kind = 'review' "
        "AND source = 'ai' AND deleted_at IS NULL ORDER BY position",
        exam,
    )
    assert sorted(r["title"] for r in titles) == ["Graphs", "Trees"]


def test_weak_topics_are_capped_at_50_selected_first_then_notes(
    api: TestClient, user: ApiUser, db: psycopg.Connection
) -> None:
    exam = waiting_exam(db, user.id)
    ids = [insert_topic(db, user.id, exam, f"Topic number {i:03d}", i) for i in range(1, 52)]

    status, body = open_moed_b(
        api,
        user,
        exam,
        hard_topic_ids=[str(i) for i in ids[:50]],
        hard_notes="also Topic number 051 was hard",
    )

    assert status == 200, body
    assert len(body["weak_topics"]) == 50
    assert str(ids[50]) not in [t["id"] for t in body["weak_topics"]]
