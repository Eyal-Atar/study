from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import SigningKeySource, TokenVerifier, jwks_client
from app.config import Settings
from app.errors import register_error_handlers
from app.routers import health, me


def create_app(
    settings: Settings | None = None, *, signing_keys: SigningKeySource | None = None
) -> FastAPI:
    settings = settings if settings is not None else Settings()
    keys = signing_keys if signing_keys is not None else jwks_client(settings)
    app = FastAPI(title="StudyFlow API")
    app.state.settings = settings
    app.state.token_verifier = TokenVerifier(keys, issuer=settings.jwt_issuer)
    register_error_handlers(app)
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
