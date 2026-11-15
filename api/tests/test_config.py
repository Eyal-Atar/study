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
        " http://localhost:5173",
        "http://localhost:5173 ",
        "http://localhost ",
        "http://localhost:abc",
        "http://localhost:",
        "http://localhost:05173",
        "http://localhost:99999",
        "http://x:80",
        "https://x:443",
    ],
)
def test_cors_origin_must_be_exactly_what_a_browser_sends(origin: str) -> None:
    with pytest.raises(ValidationError, match="CORS_ORIGINS must list browser origins"):
        Settings(supabase_url="https://test-ref.supabase.co", cors_origins=[origin], _env_file=None)


@pytest.mark.parametrize(
    "origin",
    [
        "http://localhost:5173",
        "https://app.example.com",
        "http://127.0.0.1:8000",
        "http://[::1]:5173",
        "https://x:8443",
        # 443 is the default port of https only, so a browser keeps it in an http origin.
        "http://x:443",
    ],
)
def test_cors_origin_accepts_what_a_browser_sends(origin: str) -> None:
    settings = Settings(
        supabase_url="https://test-ref.supabase.co", cors_origins=[origin], _env_file=None
    )
    assert settings.cors_origins == [origin]


def test_empty_worker_connection_and_key_are_none(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WORKER_DATABASE_URL", " ")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "")
    settings = Settings(supabase_url="https://test-ref.supabase.co", _env_file=None)
    assert settings.worker_database_url is None
    assert settings.supabase_secret_key is None


def test_secret_key_is_hidden_from_repr(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_abc")
    settings = Settings(supabase_url="https://test-ref.supabase.co", _env_file=None)
    assert settings.supabase_secret_key is not None
    assert settings.supabase_secret_key.get_secret_value() == "sb_secret_abc"
    assert "sb_secret_abc" not in repr(settings)


@pytest.mark.parametrize(
    "name", ["JOB_LOCK_TIMEOUT_SECONDS", "WORKER_POLL_SECONDS", "MAX_MATERIAL_BYTES"]
)
def test_worker_limits_must_be_positive(monkeypatch: pytest.MonkeyPatch, name: str) -> None:
    monkeypatch.setenv(name, "0")
    with pytest.raises(ValidationError):
        Settings(supabase_url="https://test-ref.supabase.co", _env_file=None)
