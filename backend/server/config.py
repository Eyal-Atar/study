"""Global configuration — paths, env vars.

DEPLOYMENT:
  Copy .env.example → .env and fill in the values.
  To switch servers, only the .env file needs to change — no code edits required.
"""

import os
import secrets
import base64
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # backend/
PROJECT_DIR = os.path.dirname(BASE_DIR)  # project root

# Load .env from project root (overrides any system env vars with same name)
load_dotenv(os.path.join(PROJECT_DIR, ".env"), override=True)

# ─── Paths ───────────────────────────────────────────────────
DB_PATH = os.path.join(BASE_DIR, "study_scheduler.db")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
FRONTEND_DIR = os.path.join(PROJECT_DIR, "frontend")

# ─── Environment ─────────────────────────────────────────────
# Set ENVIRONMENT=production in .env to enable HTTPS-only cookies,
# strict CORS, and other production hardening.
ENVIRONMENT = os.environ.get("ENVIRONMENT", "development")
IS_PRODUCTION = ENVIRONMENT == "production"

# ─── Server ──────────────────────────────────────────────────
# Change PORT in .env to run on a different port.
PORT = int(os.environ.get("PORT", 8000))

# ─── CORS ────────────────────────────────────────────────────
# Dev:  ALLOWED_ORIGINS=*   (allows any origin, including ngrok URLs)
# Prod: ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "*")
ALLOWED_ORIGINS = ["*"] if _raw_origins.strip() == "*" else [
    o.strip() for o in _raw_origins.split(",") if o.strip()
]

# ─── Keys & Secrets ──────────────────────────────────────────
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
SESSION_SECRET_KEY = os.environ.get("SESSION_SECRET_KEY", secrets.token_urlsafe(32))

VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")

VAPID_CLAIMS = {
    "sub": os.environ.get("VAPID_SUB_EMAIL", "mailto:admin@studyflow.local")
}
