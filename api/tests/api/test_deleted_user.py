"""A token that is still valid after its user was deleted from Auth gets 401, not 500."""

from collections.abc import Callable

import psycopg
from fastapi.testclient import TestClient

from tests.fixtures_db import ApiUser


def test_a_deleted_users_token_is_unauthenticated(
    api: TestClient, db: psycopg.Connection, make_api_user: Callable[[], ApiUser]
) -> None:
    user = make_api_user()
    assert api.get("/me", headers=user.headers).status_code == 200
    db.execute("DELETE FROM auth.users WHERE id = %s", (user.id,))

    response = api.get("/me", headers=user.headers)

    assert response.status_code == 401
    assert response.json()["code"] == "unauthenticated"
