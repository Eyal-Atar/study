"""Server — FastAPI app creation, middleware, startup."""

from dotenv import load_dotenv
load_dotenv(override=True)

import os
import hashlib
import re
from contextlib import asynccontextmanager
from fastapi import FastAPI, Response, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from server.database import init_db
from server.config import FRONTEND_DIR, PROJECT_DIR, SESSION_SECRET_KEY


def _compute_build_hash() -> str:
    """Hash the mtime+size of every frontend JS and CSS file.
    Changes automatically whenever any asset is modified."""
    h = hashlib.md5()
    for root, _, files in os.walk(os.path.join(FRONTEND_DIR, "js")):
        for f in sorted(files):
            if f.endswith(".js"):
                path = os.path.join(root, f)
                stat = os.stat(path)
                h.update(f"{f}:{stat.st_mtime}:{stat.st_size}".encode())
    for root, _, files in os.walk(os.path.join(FRONTEND_DIR, "css")):
        for f in sorted(files):
            if f.endswith(".css"):
                path = os.path.join(root, f)
                stat = os.stat(path)
                h.update(f"{f}:{stat.st_mtime}:{stat.st_size}".encode())
    return h.hexdigest()[:8]


BUILD_HASH = _compute_build_hash()

from auth.routes import router as auth_router
from users.routes import router as users_router
from exams.routes import router as exams_router
from tasks.routes import router as tasks_router
from brain.routes import router as brain_router
from notifications.routes import router as notifications_router
from notifications.scheduler import start_scheduler

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print("DEBUG: Application lifespan startup triggered", flush=True)
    init_db()
    print("DEBUG: Database initialized, starting scheduler", flush=True)
    scheduler = start_scheduler()
    yield
    # Shutdown
    print("DEBUG: Application lifespan shutdown triggered", flush=True)
    if scheduler and scheduler.running:
        scheduler.shutdown()

app = FastAPI(title="StudyFlow API", version="1.0.0", lifespan=lifespan)

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


# ─── Static files (Icons/Images) ────────────────────────────
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


def _serve_processed_asset(file_path: str, media_type: str) -> Response:
    """Read a frontend file and replace all version placeholders with the current build hash."""
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Asset not found")
    
    build_hash = _compute_build_hash()
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    # Replace ?v=AUTO or any ?v=... with current build hash
    content = re.sub(r"\?v=\w+", f"?v={build_hash}", content)
    
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )


@app.get("/sw.js")
def serve_service_worker():
    """Serve Service Worker with auto-injected build hash."""
    build_hash = _compute_build_hash()
    file_path = os.path.join(FRONTEND_DIR, "sw.js")
    # Custom replacement for the shell cache name
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
    content = re.sub(r"studyflow-shell-v\w+", f"studyflow-shell-{build_hash}", content)
    content = re.sub(r"\?v=\w+", f"?v={build_hash}", content)
    return Response(
        content=content,
        media_type="application/javascript",
        headers={
            "Service-Worker-Allowed": "/",
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )


@app.get("/js/{path:path}")
def serve_js(path: str):
    """Serve JS files with build hash replacement."""
    return _serve_processed_asset(os.path.join(FRONTEND_DIR, "js", path), "application/javascript")


@app.get("/css/{path:path}")
def serve_css(path: str):
    """Serve CSS files with build hash replacement."""
    return _serve_processed_asset(os.path.join(FRONTEND_DIR, "css", path), "text/css")


# ─── Frontend ────────────────────────────────────────────────
@app.get("/")
def serve_frontend():
    return _serve_processed_asset(os.path.join(PROJECT_DIR, "index.html"), "text/html")


@app.get("/onboarding")
def serve_frontend_onboarding():
    return _serve_processed_asset(os.path.join(PROJECT_DIR, "index.html"), "text/html")


@app.get("/dashboard")
def serve_frontend_dashboard():
    return _serve_processed_asset(os.path.join(PROJECT_DIR, "index.html"), "text/html")


@app.get("/health")
def health_check():
    return {"status": "ok", "version": "1.0.0"}
