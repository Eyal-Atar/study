from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, HttpUrl, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.domain.notifications import load_vapid_key
from app.domain.time import InvalidTimezoneError, parse_timezone

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
    # hide_input_in_errors: a model validator's error would otherwise print every input,
    # secrets included (SecretStr hides the value only after validation).
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", hide_input_in_errors=True
    )

    supabase_url: HttpUrl
    cors_origins: list[str] = []
    database_url: str | None = None
    # The worker's settings. The worker connects as the schema owner; the API never reads these.
    worker_database_url: str | None = None
    supabase_secret_key: SecretStr | None = None
    max_material_bytes: int = Field(default=20_971_520, gt=0)
    max_material_pages: int = Field(default=80, gt=0)
    max_materials_per_exam: int = Field(default=15, gt=0)
    max_chars_per_page: int = Field(default=20_000, gt=0)
    scanned_page_max_chars: int = Field(default=40, ge=0)
    worker_poll_seconds: float = Field(default=2.0, gt=0)
    job_lock_timeout_seconds: int = Field(default=600, gt=0)
    # Course analysis with Claude (worker and eval only). Model names come from the environment.
    anthropic_api_key: SecretStr | None = None
    ai_model_analysis: str | None = None
    ai_model_light: str | None = None
    # Reading a timetable photo (S35): its own model, so the eval can choose it without moving
    # AI_MODEL_LIGHT for the rest of the system.
    ai_model_timetable: str | None = None
    ai_analysis_effort: Literal["low", "medium", "high", "xhigh", "max"] = "medium"
    # Streaming, so a long answer does not time out; the limit includes the thinking.
    ai_analysis_max_tokens: int = Field(default=64000, gt=0)
    # The SDK's timeout applies to each read from the network, not to the whole request.
    ai_timeout_seconds: float = Field(default=180.0, gt=0)
    ai_max_retries: int = Field(default=2, ge=0, le=5)
    # Plan generation: attempts per local day, where the day is in ai_quota_timezone.
    ai_daily_generation_limit: int = Field(default=3, ge=0)
    # Timetable parsing: requests per local day (the same day and rule as generations), the
    # call's limits, and the file's. The API's 5 MB limit for one image is measured on the
    # base64 text, which is 4/3 of the file, so a file may be at most 3.75 MiB.
    ai_daily_timetable_limit: int = Field(default=5, ge=0)
    ai_timetable_effort: Literal["low", "medium", "high", "xhigh", "max"] = "low"
    ai_timetable_max_tokens: int = Field(default=16000, gt=0)
    max_timetable_image_bytes: int = Field(default=5 * 1024 * 1024 * 3 // 4, gt=0)
    max_timetable_pdf_pages: int = Field(default=4, gt=0)
    ai_quota_timezone: str = "Asia/Jerusalem"
    max_analysis_minutes: int = Field(default=6000, gt=0)
    max_analysis_scanned_pages: int = Field(default=100, ge=0)
    max_analysis_text_chars: int = Field(default=300_000, gt=0)
    # 20 MiB of scans: base64 adds a third (about 26.7 MiB), and with the text the
    # request stays under the API's 32 MB limit.
    max_analysis_scan_bytes: int = Field(default=20_971_520, gt=0)
    # Web Push (worker only): the VAPID pair as base64url (the private key is the 32-byte
    # scalar, the public key the 65-byte uncompressed point) and the contact subject.
    # All three or none; none means the worker sends no reminders.
    vapid_private_key: SecretStr | None = None
    vapid_public_key: str | None = None
    vapid_subject: str | None = None
    push_timeout_seconds: float = Field(default=10.0, gt=0)
    # How late a reminder may still go out, after the worker was down.
    push_grace_minutes: int = Field(default=10, gt=0)

    @field_validator(
        "database_url",
        "worker_database_url",
        "supabase_secret_key",
        "anthropic_api_key",
        "ai_model_analysis",
        "ai_model_light",
        "ai_model_timetable",
        "vapid_private_key",
        "vapid_public_key",
        "vapid_subject",
        mode="before",
    )
    @classmethod
    def _empty_string_is_none(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value

    @field_validator("ai_quota_timezone")
    @classmethod
    def _must_be_an_iana_timezone(cls, value: str) -> str:
        try:
            parse_timezone(value)
        except InvalidTimezoneError:
            raise ValueError(
                f"AI_QUOTA_TIMEZONE must be an IANA timezone name (got {value!r})"
            ) from None
        return value

    @model_validator(mode="after")
    def _a_claude_call_must_end_before_the_job_lock_expires(self) -> Settings:
        worst_case = self.ai_timeout_seconds * (self.ai_max_retries + 1)
        if worst_case >= self.job_lock_timeout_seconds:
            raise ValueError(
                f"AI_TIMEOUT_SECONDS x (AI_MAX_RETRIES + 1) = {worst_case:g} must be below "
                f"JOB_LOCK_TIMEOUT_SECONDS = {self.job_lock_timeout_seconds}, or a stuck call "
                "outlives the job lock and a second worker takes the job"
            )
        return self

    @model_validator(mode="after")
    def _vapid_is_all_or_nothing_and_one_pair(self) -> Settings:
        private, public, subject = self.vapid_private_key, self.vapid_public_key, self.vapid_subject
        if private is None and public is None and subject is None:
            return self
        if private is None or public is None or subject is None:
            raise ValueError(
                "VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY and VAPID_SUBJECT must be set together, "
                "or all left empty"
            )
        # The messages of load_vapid_key never include the key.
        load_vapid_key(private.get_secret_value(), public)
        if not any(
            subject.startswith(prefix) and len(subject) > len(prefix)
            for prefix in ("mailto:", "https://")
        ):
            raise ValueError("VAPID_SUBJECT must be a mailto: or https:// contact")
        return self

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
    def push_configured(self) -> bool:
        # All three, not just the key: model_copy(update=...) skips the validators.
        return (
            self.vapid_private_key is not None
            and self.vapid_public_key is not None
            and self.vapid_subject is not None
        )

    @property
    def jwt_issuer(self) -> str:
        return f"{str(self.supabase_url).rstrip('/')}/auth/v1"

    @property
    def jwks_url(self) -> str:
        return f"{self.jwt_issuer}/.well-known/jwks.json"
