"""Server — FastAPI app creation, middleware, startup."""

from dotenv import load_dotenv
load_dotenv()

import os
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from server.database import init_db
from server.config import FRONTEND_DIR

from auth.routes import router as auth_router
from users.routes import router as users_router
from exams.routes import router as exams_router
from tasks.routes import router as tasks_router
from brain.routes import router as brain_router

app = FastAPI(title="StudyFlow API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    init_db()


# ─── Static files (CSS/JS) ──────────────────────────────────
app.mount("/css", StaticFiles(directory=os.path.join(FRONTEND_DIR, "css")), name="css")
app.mount("/js", StaticFiles(directory=os.path.join(FRONTEND_DIR, "js")), name="js")


# ─── API routes ──────────────────────────────────────────────
app.include_router(auth_router, prefix="/auth", tags=["auth"])
app.include_router(users_router, tags=["users"])
app.include_router(exams_router, tags=["exams"])
app.include_router(tasks_router, tags=["tasks"])
app.include_router(brain_router, tags=["brain"])


# ─── Frontend ────────────────────────────────────────────────
@app.get("/")
def serve_frontend():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"), media_type="text/html")


@app.get("/health")
def health_check():
    return {"status": "ok", "version": "1.0.0"}
