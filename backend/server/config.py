"""Global configuration — paths, env vars."""

import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "study_scheduler.db")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
