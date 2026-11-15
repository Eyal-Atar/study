from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import SigningKeySource, TokenVerifier, jwks_client
from app.config import Settings
from app.db.pool import Database
from app.errors import CatchAllMiddleware, register_error_handlers
from app.routers import health, me


def _utc_now() -> datetime:
    return datetime.now(UTC)


def create_app(
    settings: Settings | None = None,
    *,
    signing_keys: SigningKeySource | None = None,
    database: Database | None = None,
    clock: Callable[[], datetime] | None = None,
) -> FastAPI:
    """Build the app. A `database` passed in is owned by the caller: never opened or closed here."""
    settings = settings if settings is not None else Settings()
    keys = signing_keys if signing_keys is not None else jwks_client(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if database is not None or not settings.database_url:
            yield
            return
        owned = Database(settings.database_url)
        owned.open()
        app.state.database = owned
        try:
            yield
        finally:
            app.state.database = None
            owned.close()

    app = FastAPI(title="StudyFlow API", lifespan=lifespan)
    app.state.settings = settings
    app.state.token_verifier = TokenVerifier(keys, issuer=settings.jwt_issuer)
    app.state.database = database
    app.state.clock = clock if clock is not None else _utc_now
    register_error_handlers(app)
    # Added first, so it sits inside CORSMiddleware and a 500 still gets CORS headers.
    app.add_middleware(CatchAllMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
        max_age=600,
    )
    app.include_router(health.router)
    app.include_router(me.router)
    return app
