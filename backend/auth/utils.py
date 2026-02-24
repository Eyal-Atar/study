"""Authentication utilities: password hashing + token management."""

import hashlib
import secrets
from fastapi import HTTPException, Request
from server.database import get_db


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
    user = db.execute(
        "SELECT * FROM users WHERE auth_token = ?", (session_token,)
    ).fetchone()
    db.close()

    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return dict(user)
