import pytest
from fastapi.testclient import TestClient


@pytest.mark.parametrize(
    "headers", [{}, {"Authorization": "Token abc"}, {"Authorization": "Bearer"}]
)
@pytest.mark.parametrize("method", ["get", "patch"])
def test_me_without_a_bearer_token_is_401(
    client: TestClient, headers: dict[str, str], method: str
) -> None:
    response = client.request(method, "/me", headers=headers, json={"display_name": "x"})
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json()["code"] == "unauthenticated"
