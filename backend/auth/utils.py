"""Authentication utilities: password hashing + token management."""

import hashlib
import secrets
import hmac
from fastapi import HTTPException, Request, Response
from server.database import get_db
from server.config import SESSION_SECRET_KEY

def get_csrf_token(request: Request) -> str:
    """Return the CSRF token from cookies, or generate a new one if missing."""
    token = request.cookies.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
    return token

def verify_csrf_token(request: Request):
    """Dependency: Verify X-CSRF-Token header against csrf_token cookie."""
    # Skip for safe methods
    if request.method in ("GET", "HEAD", "OPTIONS", "TRACE"):
        return
        
    cookie_token = request.cookies.get("csrf_token")
    header_token = request.headers.get("X-CSRF-Token")
    
    if not cookie_token or not header_token or not hmac.compare_digest(cookie_token, header_token):
        raise HTTPException(status_code=403, detail="CSRF token validation failed")


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000)
    return f"{salt}${h.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    if "$" not in stored_hash:
        return False
    salt, h = stored_hash.split("$", 1)
    new_h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000)
    return secrets.compare_digest(new_h.hex(), h)


def generate_token() -> str:
    return secrets.token_urlsafe(48)


def get_current_user(request: Request):
    """FastAPI dependency: extract and validate auth token from cookie."""
    session_token = request.cookies.get("session_token")
    if not session_token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    db = get_db()
    try:
        user = db.execute(
            "SELECT * FROM users WHERE auth_token = ?", (session_token,)
        ).fetchone()
    finally:
        db.close()

    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return dict(user)
