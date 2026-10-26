from urllib.parse import urlsplit

from pydantic import HttpUrl, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The port a browser leaves out of the Origin header, per scheme.
_DEFAULT_PORTS = {"http": 80, "https": 443}


def _browser_origin(value: str) -> str | None:
    """The Origin header a browser sends for the site at value, or None if value has no origin."""
    parts = urlsplit(value)
    try:
        port = parts.port
    except ValueError:  # a port that is not a number, or is out of range
        return None
    host = parts.hostname  # lowercase, without credentials or brackets
    if parts.scheme not in _DEFAULT_PORTS or not host:
        return None
    if ":" in host:  # IPv6, which the Origin header writes in brackets
        host = f"[{host}]"
    if port is None or port == _DEFAULT_PORTS[parts.scheme]:
        return f"{parts.scheme}://{host}"
    return f"{parts.scheme}://{host}:{port}"


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
        # CORSMiddleware compares the Origin header as a string, and a browser writes each origin
        # in one form only: any other spelling of the same origin would never match.
        for value in values:
            if value != value.strip() or value != _browser_origin(value):
                raise ValueError(
                    "CORS_ORIGINS must list browser origins such as http://localhost:5173: "
                    "scheme, host and optional port, lowercase, with no path, trailing slash, "
                    f"spaces, default port or leading zero in the port (got {value!r})"
                )
        return values

    @property
    def jwt_issuer(self) -> str:
        return f"{str(self.supabase_url).rstrip('/')}/auth/v1"

    @property
    def jwks_url(self) -> str:
        return f"{self.jwt_issuer}/.well-known/jwks.json"
