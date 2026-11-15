from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx2 import Response

from app.config import Settings
from app.main import create_app
from tests.tokens import StaticKeys, TokenFactory, add_auth_probe, bearer

WEB_ORIGIN = "http://localhost:5173"


@pytest.fixture
def cors_client(jwks: dict[str, Any]) -> TestClient:
    settings = Settings(
        supabase_url="https://test-ref.supabase.co", cors_origins=[WEB_ORIGIN], _env_file=None
    )
    return TestClient(add_auth_probe(create_app(settings, signing_keys=StaticKeys(jwks))))


def _preflight(client: TestClient, origin: str) -> Response:
    return client.options(
        "/me",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )


def test_preflight_from_the_web_origin_is_allowed(cors_client: TestClient) -> None:
    response = _preflight(cors_client, WEB_ORIGIN)
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == WEB_ORIGIN
    assert "authorization" in response.headers["access-control-allow-headers"].lower()
    assert "access-control-allow-credentials" not in response.headers


def test_preflight_from_another_origin_is_rejected(cors_client: TestClient) -> None:
    response = _preflight(cors_client, "http://localhost:5174")
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_me_from_the_web_origin_carries_cors_headers(
    cors_client: TestClient, make_token: TokenFactory
) -> None:
    response = cors_client.get("/probe", headers={**bearer(make_token()), "Origin": WEB_ORIGIN})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == WEB_ORIGIN
    assert "origin" in response.headers["vary"].lower()


def test_401_from_the_web_origin_is_readable_by_the_browser(cors_client: TestClient) -> None:
    response = cors_client.get("/me", headers={"Origin": WEB_ORIGIN})
    assert response.status_code == 401
    assert response.headers["content-type"] == "application/problem+json"
    assert response.headers["access-control-allow-origin"] == WEB_ORIGIN


def test_no_origin_is_allowed_by_default(client: TestClient, make_token: TokenFactory) -> None:
    response = client.get("/probe", headers={**bearer(make_token()), "Origin": WEB_ORIGIN})
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers
