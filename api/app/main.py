from fastapi import FastAPI

from app.config import Settings
from app.routers import health


def create_app(settings: Settings | None = None) -> FastAPI:
    app = FastAPI(title="StudyFlow API")
    app.state.settings = settings if settings is not None else Settings()
    app.include_router(health.router)
    return app
