"""Server — FastAPI app creation, middleware, startup."""

from dotenv import load_dotenv
load_dotenv()

import os
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from server.database import init_db
from server.config import FRONTEND_DIR, SESSION_SECRET_KEY

from auth.routes import router as auth_router
from users.routes import router as users_router
from exams.routes import router as exams_router
from tasks.routes import router as tasks_router
from brain.routes import router as brain_router
from notifications.routes import router as notifications_router

app = FastAPI(title="StudyFlow API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

# Session middleware for OAuth and cookie-based auth
app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET_KEY,
    max_age=3600,  # 1 hour for OAuth temporary session
    https_only=os.environ.get("ENVIRONMENT") == "production",
)


@app.on_event("startup")
def startup():
    init_db()


# ─── Static files (CSS/JS/icons) ────────────────────────────
app.mount("/css", StaticFiles(directory=os.path.join(FRONTEND_DIR, "css")), name="css")
app.mount("/js", StaticFiles(directory=os.path.join(FRONTEND_DIR, "js")), name="js")
app.mount("/static", StaticFiles(directory=os.path.join(FRONTEND_DIR, "static")), name="static")


# ─── API routes ──────────────────────────────────────────────
app.include_router(auth_router, prefix="/auth", tags=["auth"])
app.include_router(users_router, tags=["users"])
app.include_router(exams_router, tags=["exams"])
app.include_router(tasks_router, tags=["tasks"])
app.include_router(brain_router, tags=["brain"])
app.include_router(notifications_router, tags=["notifications"])


# ─── PWA files ───────────────────────────────────────────────
@app.get("/manifest.json")
def serve_manifest():
    """Serve PWA manifest at root path (required for 'Add to Home Screen')."""
    return FileResponse(
        os.path.join(FRONTEND_DIR, "manifest.json"),
        media_type="application/manifest+json"
    )


@app.get("/sw.js")
def serve_service_worker():
    """Serve Service Worker at root scope (required for full-app SW scope)."""
    return FileResponse(
        os.path.join(FRONTEND_DIR, "sw.js"),
        media_type="application/javascript",
        headers={"Service-Worker-Allowed": "/"}
    )


# ─── Frontend ────────────────────────────────────────────────
@app.get("/")
def serve_frontend():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"), media_type="text/html")


@app.get("/onboarding")
def serve_frontend_onboarding():
    """Serve frontend for onboarding screen (SPA routing)."""
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"), media_type="text/html")


@app.get("/dashboard")
def serve_frontend_dashboard():
    """Serve frontend for dashboard screen (SPA routing)."""
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"), media_type="text/html")


@app.get("/health")
def health_check():
    return {"status": "ok", "version": "1.0.0"}
