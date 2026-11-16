"""Push subscriptions: register (or refresh) a browser's subscription, and remove it."""

import base64
import os
from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4

import psycopg
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from app.domain.notifications import uncompressed_point
from tests.api.factories import scalar
from tests.fixtures_db import ApiUser

MakeApiUser = Callable[[], ApiUser]

ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123"


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def new_keys() -> dict[str, str]:
    """A fresh browser key pair: an uncompressed P-256 point and a 16-byte auth secret."""
    point = uncompressed_point(ec.generate_private_key(ec.SECP256R1()).public_key())
    return {"p256dh": _b64(point), "auth": _b64(os.urandom(16))}


# Built once, at import: the parameter lists below need a valid key next to a broken one.
VALID_P256DH = new_keys()["p256dh"]


def _body(endpoint: str = ENDPOINT, **changes: Any) -> dict[str, Any]:
    body: dict[str, Any] = {"endpoint": endpoint, "keys": new_keys(), "user_agent": "Chrome"}
    body.update(changes)
    return body


def _rows(db: psycopg.Connection, user_id: UUID) -> list[tuple[Any, ...]]:
    return [
        tuple(row)
        for row in db.execute(
            "SELECT id, endpoint, p256dh, auth, user_agent, failure_count "
            "FROM app.push_subscriptions WHERE user_id = %s ORDER BY id",
            (user_id,),
        ).fetchall()
    ]


@pytest.fixture
def user(make_api_user: MakeApiUser) -> ApiUser:
    return make_api_user()


def test_new_subscription_is_201_and_stored(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    body = _body()
    response = api.post("/push/subscriptions", json=body, headers=user.headers)
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["created"] is True
    assert _rows(db, user.id) == [
        (
            UUID(data["id"]),
            ENDPOINT,
            body["keys"]["p256dh"],
            body["keys"]["auth"],
            "Chrome",
            0,
        )
    ]


def test_same_endpoint_again_is_200_with_new_keys_and_a_reset_failure_count(
    api: TestClient, db: psycopg.Connection, user: ApiUser
) -> None:
    first = api.post("/push/subscriptions", json=_body(), headers=user.headers).json()
    db.execute("UPDATE app.push_subscriptions SET failure_count = 3 WHERE id = %s", (first["id"],))
    again = _body(user_agent="  Firefox  ")
    response = api.post("/push/subscriptions", json=again, headers=user.headers)
    assert response.status_code == 200, response.text
    assert response.json() == {"id": first["id"], "created": False}
    assert _rows(db, user.id) == [
        (
            UUID(first["id"]),
            ENDPOINT,
            again["keys"]["p256dh"],
            again["keys"]["auth"],
            "Firefox",
            0,
        )
    ]


def test_user_agent_is_optional(api: TestClient, db: psycopg.Connection, user: ApiUser) -> None:
    body = _body()
    del body["user_agent"]
    response = api.post("/push/subscriptions", json=body, headers=user.headers)
    assert response.status_code == 201, response.text
    assert scalar(db, "SELECT user_agent FROM app.push_subscriptions") is None


def test_endpoint_of_another_user_moves_to_the_new_one(
    api: TestClient, db: psycopg.Connection, make_api_user: MakeApiUser
) -> None:
    a, b = make_api_user(), make_api_user()
    a_other = "https://updates.push.services.mozilla.com/wpush/v2/a-only"
    assert api.post("/push/subscriptions", json=_body(), headers=a.headers).status_code == 201
    assert (
        api.post("/push/subscriptions", json=_body(a_other), headers=a.headers).status_code == 201
    )
    response = api.post("/push/subscriptions", json=_body(), headers=b.headers)
    assert response.status_code == 201, response.text
    assert response.json()["created"] is True
    # A's row with the shared endpoint is gone; A's other browser is untouched.
    assert [row[1] for row in _rows(db, a.id)] == [a_other]
    assert [row[1] for row in _rows(db, b.id)] == [ENDPOINT]


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://fcm.googleapis.com/fcm/send/abc",
        "https://evil.example.com/fcm/send/abc",
        "https://fcm.googleapis.com:8443/fcm/send/abc",
        "https://169.254.169.254/latest/meta-data",
        "https://fcm.googleapis.com.evil.example/fcm/send/abc",
    ],
)
def test_invalid_endpoint_is_422(
    api: TestClient, db: psycopg.Connection, user: ApiUser, endpoint: str
) -> None:
    response = api.post("/push/subscriptions", json=_body(endpoint), headers=user.headers)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "push_endpoint_invalid"
    assert _rows(db, user.id) == []


@pytest.mark.parametrize(
    "keys",
    [
        {"p256dh": _b64(b"\x04" + b"\x01" * 31), "auth": _b64(b"a" * 16)},
        {"p256dh": VALID_P256DH, "auth": _b64(b"a" * 8)},
        {"p256dh": VALID_P256DH, "auth": "not base64url!!!"},
        {"p256dh": _b64(b"\x04" + b"\x01" * 64), "auth": _b64(b"a" * 16)},
    ],
)
def test_invalid_keys_are_422(
    api: TestClient, db: psycopg.Connection, user: ApiUser, keys: dict[str, str]
) -> None:
    response = api.post("/push/subscriptions", json=_body(keys=keys), headers=user.headers)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "push_endpoint_invalid"
    assert _rows(db, user.id) == []


@pytest.mark.parametrize(
    "body",
    [
        {**_body(), "extra": 1},
        {**_body(), "keys": {**new_keys(), "extra": "x"}},
        {**_body(), "keys": {"p256dh": new_keys()["p256dh"]}},
        {"keys": new_keys()},
        {**_body(), "user_agent": "a" * 501},
        {**_body(), "endpoint": "https://fcm.googleapis.com/" + "a" * 2048},
        {**_body(), "user_agent": "a\u0000b"},
        {**_body(), "endpoint": None},
    ],
)
def test_malformed_body_is_a_validation_error(
    api: TestClient, db: psycopg.Connection, user: ApiUser, body: dict[str, Any]
) -> None:
    response = api.post("/push/subscriptions", json=body, headers=user.headers)
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "validation_error"
    assert _rows(db, user.id) == []


def test_delete_own_is_204_then_404(api: TestClient, db: psycopg.Connection, user: ApiUser) -> None:
    created = api.post("/push/subscriptions", json=_body(), headers=user.headers).json()
    url = f"/push/subscriptions/{created['id']}"
    response = api.delete(url, headers=user.headers)
    assert response.status_code == 204, response.text
    assert response.content == b""
    assert _rows(db, user.id) == []
    again = api.delete(url, headers=user.headers)
    assert again.status_code == 404
    assert again.json()["code"] == "not_found"


def test_delete_unknown_is_404(api: TestClient, user: ApiUser) -> None:
    response = api.delete(f"/push/subscriptions/{uuid4()}", headers=user.headers)
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_delete_of_another_user_is_404_and_the_row_stays(
    api: TestClient, db: psycopg.Connection, make_api_user: MakeApiUser
) -> None:
    a, b = make_api_user(), make_api_user()
    created = api.post("/push/subscriptions", json=_body(), headers=a.headers).json()
    before = _rows(db, a.id)
    response = api.delete(f"/push/subscriptions/{created['id']}", headers=b.headers)
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
    assert _rows(db, a.id) == before
