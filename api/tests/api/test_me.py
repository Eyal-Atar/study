from collections.abc import Callable
from typing import Any

import psycopg
import pytest
from fastapi.testclient import TestClient

from tests.fixtures_db import ApiUser
from tests.tokens import bearer

MakeApiUser = Callable[[], ApiUser]
Token = Callable[..., str]

DEFAULTS = {
    "timezone": "Asia/Jerusalem",
    "wake_time": "08:00",
    "sleep_time": "23:00",
    "daily_study_minutes": 240,
    "study_windows": ["morning", "afternoon"],
    "rest_days_before_exam": 1,
    "notify_lead_minutes": 10,
    "display_name": None,
    "onboarding_completed_at": None,
    "study_start_delay_minutes": 60,
    "hobby_start": None,
    "hobby_minutes": None,
}


def _count(db: psycopg.Connection) -> int:
    row = db.execute("SELECT count(*) FROM app.profiles").fetchone()
    assert row is not None
    return int(row[0])


def test_first_get_creates_the_profile(
    api: TestClient, make_api_user: MakeApiUser, db: psycopg.Connection
) -> None:
    user = make_api_user()
    assert _count(db) == 0
    response = api.get("/me", headers=user.headers)
    assert response.status_code == 200
    assert response.json() == {
        "id": str(user.id),
        "email": "student@example.com",
        **DEFAULTS,
    }
    assert _count(db) == 1
    assert api.get("/me", headers=user.headers).status_code == 200
    assert _count(db) == 1


def test_email_is_null_without_an_email_claim(
    api: TestClient, make_api_user: MakeApiUser, make_token: Token
) -> None:
    user = make_api_user()
    headers = bearer(make_token(sub=str(user.id), drop=("email",)))
    assert api.get("/me", headers=headers).json()["email"] is None


def test_patch_timezone_and_plan_affected(api: TestClient, make_api_user: MakeApiUser) -> None:
    user = make_api_user()
    first = api.patch("/me", json={"timezone": "Europe/London"}, headers=user.headers)
    assert first.status_code == 200
    assert first.json()["plan_affected"] is True
    assert first.json()["timezone"] == "Europe/London"
    named = api.patch("/me", json={"display_name": "  דנה "}, headers=user.headers)
    assert named.json()["plan_affected"] is False
    assert named.json()["display_name"] == "דנה"
    same = api.patch("/me", json={"timezone": "Europe/London"}, headers=user.headers)
    assert same.json()["plan_affected"] is False
    assert api.get("/me", headers=user.headers).json()["timezone"] == "Europe/London"


def test_patch_windows_are_canonical_and_a_reorder_is_not_a_change(
    api: TestClient, make_api_user: MakeApiUser
) -> None:
    user = make_api_user()
    first = api.patch(
        "/me", json={"study_windows": ["night", "morning"]}, headers=user.headers
    ).json()
    assert first["study_windows"] == ["morning", "night"]
    assert first["plan_affected"] is True
    again = api.patch(
        "/me", json={"study_windows": ["morning", "night"]}, headers=user.headers
    ).json()
    assert again["plan_affected"] is False


@pytest.mark.parametrize(
    "body",
    [
        {"timezone": "asia/jerusalem"},
        {"timezone": "Asia/Jerusalem "},
        {"timezone": "ASIA/JERUSALEM"},
        {"daily_study_minutes": 20},
        {"study_windows": []},
        {"study_windows": ["morning", "morning"]},
        {"wake_time": "08:00:30"},
        {"wake_time": "23:00"},
        {"display_name": "   "},
        {"display_name": None},
        {"display_name": "a\u0000b"},
        {"unknown_field": 1},
        {},
    ],
)
def test_patch_rejects_invalid_values(
    api: TestClient, make_api_user: MakeApiUser, body: dict[str, Any]
) -> None:
    user = make_api_user()
    before = api.get("/me", headers=user.headers).json()
    response = api.patch("/me", json=body, headers=user.headers)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert api.get("/me", headers=user.headers).json() == before


def test_two_users_see_their_own_profile(api: TestClient, make_api_user: MakeApiUser) -> None:
    first, second = make_api_user(), make_api_user()
    api.patch("/me", json={"display_name": "A", "daily_study_minutes": 300}, headers=first.headers)
    other = api.get("/me", headers=second.headers).json()
    assert other["display_name"] is None
    assert other["daily_study_minutes"] == 240
    assert api.get("/me", headers=first.headers).json()["display_name"] == "A"
