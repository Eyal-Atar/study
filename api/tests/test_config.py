import pytest
from pydantic import ValidationError

from app.config import Settings


@pytest.mark.parametrize("url", ["https://test-ref.supabase.co", "https://test-ref.supabase.co/"])
def test_auth_urls_derive_from_the_project_url(url: str) -> None:
    settings = Settings(supabase_url=url, _env_file=None)
    assert settings.jwt_issuer == "https://test-ref.supabase.co/auth/v1"
    assert settings.jwks_url == "https://test-ref.supabase.co/auth/v1/.well-known/jwks.json"


def test_project_url_comes_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://env-ref.supabase.co")
    assert Settings(_env_file=None).jwt_issuer == "https://env-ref.supabase.co/auth/v1"


def test_missing_project_url_fails_at_startup(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    with pytest.raises(ValidationError, match="supabase_url"):
        Settings(_env_file=None)


@pytest.mark.parametrize(
    "url",
    [
        "https://test-ref.supabase.co/auth/v1",
        "test-ref.supabase.co",
        "https://test-ref.supabase.co/?x=1",
        "https://test-ref.supabase.co/#frag",
        "https://user:pw@test-ref.supabase.co",
    ],
)
def test_project_url_must_be_the_bare_project_url(url: str) -> None:
    with pytest.raises(ValidationError):
        Settings(supabase_url=url, _env_file=None)


def test_cors_origins_default_to_none() -> None:
    assert Settings(supabase_url="https://test-ref.supabase.co", _env_file=None).cors_origins == []


def test_cors_origins_come_from_a_json_list(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://env-ref.supabase.co")
    monkeypatch.setenv("CORS_ORIGINS", '["http://localhost:5173", "https://app.example.com"]')
    assert Settings(_env_file=None).cors_origins == [
        "http://localhost:5173",
        "https://app.example.com",
    ]


@pytest.mark.parametrize(
    "origin",
    [
        "http://localhost:5173/",
        "http://localhost:5173/app",
        "*",
        "localhost:5173",
        "HTTP://localhost:5173",
        "http://LOCALHOST:5173",
        "ftp://localhost:5173",
        "http://localhost:5173?x=1",
        "http://localhost:5173#top",
        "http://user@localhost:5173",
    ],
)
def test_cors_origin_must_be_exactly_what_a_browser_sends(origin: str) -> None:
    with pytest.raises(ValidationError, match="CORS_ORIGINS"):
        Settings(supabase_url="https://test-ref.supabase.co", cors_origins=[origin], _env_file=None)
