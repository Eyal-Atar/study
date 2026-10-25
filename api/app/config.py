from urllib.parse import urlsplit

from pydantic import HttpUrl, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    supabase_url: HttpUrl
    cors_origins: list[str] = []

    @field_validator("supabase_url")
    @classmethod
    def _must_be_the_bare_project_url(cls, value: HttpUrl) -> HttpUrl:
        if value.path not in (None, "", "/"):
            raise ValueError(
                "SUPABASE_URL must be the project URL, for example "
                "https://<ref>.supabase.co, with no path"
            )
        if value.query or value.fragment or value.username or value.password:
            raise ValueError(
                "SUPABASE_URL must be the bare project URL, with no query, fragment or credentials"
            )
        return value

    @field_validator("cors_origins")
    @classmethod
    def _must_be_browser_origins(cls, values: list[str]) -> list[str]:
        for value in values:
            parts = urlsplit(value)
            if (
                parts.scheme not in ("http", "https")
                or not parts.netloc
                or "@" in parts.netloc
                or value != f"{parts.scheme}://{parts.netloc}"
                or value != value.lower()
            ):
                raise ValueError(
                    "CORS_ORIGINS must list browser origins such as http://localhost:5173: "
                    f"scheme, host and optional port, lowercase, no path or trailing slash "
                    f"(got {value!r})"
                )
        return values

    @property
    def jwt_issuer(self) -> str:
        return f"{str(self.supabase_url).rstrip('/')}/auth/v1"

    @property
    def jwks_url(self) -> str:
        return f"{self.jwt_issuer}/.well-known/jwks.json"
