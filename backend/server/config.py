"""Global configuration — paths, env vars."""

import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # backend/
PROJECT_DIR = os.path.dirname(BASE_DIR)  # study/
DB_PATH = os.path.join(BASE_DIR, "study_scheduler.db")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
FRONTEND_DIR = os.path.join(PROJECT_DIR, "frontend")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
