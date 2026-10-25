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


@pytest.mark.parametrize("url", ["https://test-ref.supabase.co/auth/v1", "test-ref.supabase.co"])
def test_project_url_must_be_the_bare_project_url(url: str) -> None:
    with pytest.raises(ValidationError):
        Settings(supabase_url=url, _env_file=None)
