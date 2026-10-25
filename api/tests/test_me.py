from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.tokens import USER_ID, TokenFactory, bearer


def test_me_returns_the_user_from_a_valid_token(
    client: TestClient, make_token: TokenFactory
) -> None:
    response = client.get("/me", headers=bearer(make_token()))
    assert response.status_code == 200
    assert response.json() == {"id": str(USER_ID), "email": "student@example.com"}


@pytest.mark.parametrize(
    "headers", [{}, {"Authorization": "Token abc"}, {"Authorization": "Bearer"}]
)
def test_me_without_a_bearer_token_is_401(client: TestClient, headers: dict[str, str]) -> None:
    response = client.get("/me", headers=headers)
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["code"] == "unauthenticated"


@pytest.mark.parametrize("overrides", [{"drop": ("email",)}, {"email": ""}])
def test_me_email_is_null_without_an_email(
    client: TestClient, make_token: TokenFactory, overrides: dict[str, Any]
) -> None:
    assert client.get("/me", headers=bearer(make_token(**overrides))).json()["email"] is None
