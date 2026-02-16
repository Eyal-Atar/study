"""Authentication routes: register, login, logout, me."""

from fastapi import APIRouter, HTTPException, Depends
from server.database import get_db
from auth.utils import hash_password, verify_password, generate_token, get_current_user
from auth.schemas import RegisterRequest, LoginRequest, AuthResponse
from users.schemas import UserResponse

router = APIRouter()


@router.post("/register", response_model=AuthResponse)
def register(body: RegisterRequest):
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if not body.email or "@" not in body.email:
        raise HTTPException(status_code=400, detail="Valid email required")
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Name is required")

    db = get_db()
    existing = db.execute("SELECT id FROM users WHERE email = ?", (body.email.lower().strip(),)).fetchone()
    if existing:
        db.close()
        raise HTTPException(status_code=409, detail="Email already registered")

    token = generate_token()
    try:
        cursor = db.execute(
            """INSERT INTO users (name, email, password_hash, auth_token,
               wake_up_time, sleep_time, study_method, session_minutes, break_minutes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (body.name.strip(), body.email.lower().strip(), hash_password(body.password),
             token, body.wake_up_time, body.sleep_time, body.study_method,
             body.session_minutes, body.break_minutes)
        )
        db.commit()
        user_id = cursor.lastrowid
    finally:
        db.close()

    user = UserResponse(
        id=user_id, name=body.name.strip(), email=body.email.lower().strip(),
        wake_up_time=body.wake_up_time, sleep_time=body.sleep_time,
        study_method=body.study_method, session_minutes=body.session_minutes,
        break_minutes=body.break_minutes
    )
    return AuthResponse(token=token, user=user)


@router.post("/login", response_model=AuthResponse)
def login(body: LoginRequest):
    db = get_db()
    row = db.execute(
        "SELECT * FROM users WHERE email = ?", (body.email.lower().strip(),)
    ).fetchone()

    if not row or not verify_password(body.password, row["password_hash"]):
        db.close()
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = generate_token()
    db.execute("UPDATE users SET auth_token = ? WHERE id = ?", (token, row["id"]))
    db.commit()
    db.close()

    user = UserResponse(**{k: row[k] for k in UserResponse.model_fields})
    return AuthResponse(token=token, user=user)


@router.post("/logout")
def logout(current_user: dict = Depends(get_current_user)):
    db = get_db()
    db.execute("UPDATE users SET auth_token = NULL WHERE id = ?", (current_user["id"],))
    db.commit()
    db.close()
    return {"message": "Logged out"}


@router.get("/me", response_model=UserResponse)
def get_me(current_user: dict = Depends(get_current_user)):
    return UserResponse(**{k: current_user[k] for k in UserResponse.model_fields})
