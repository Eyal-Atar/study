"""Authentication routes: register, login, logout, me."""

import os
from fastapi import APIRouter, HTTPException, Depends, Response, Request
from fastapi.responses import RedirectResponse, HTMLResponse
from server.database import get_db
from auth.utils import hash_password, verify_password, generate_token, get_current_user
from auth.schemas import RegisterRequest, LoginRequest, AuthResponse
from users.schemas import UserResponse
from auth.oauth_config import oauth

router = APIRouter()


@router.post("/register", response_model=AuthResponse)
def register(body: RegisterRequest, response: Response):
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
                    wake_up_time, sleep_time, study_method, session_minutes, break_minutes, onboarding_completed, timezone_offset)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (body.name.strip(), body.email.lower().strip(), hash_password(body.password),
                 token, body.wake_up_time, body.sleep_time, body.study_method,
                 body.session_minutes, body.break_minutes, 0, body.timezone_offset)
          )
          db.commit()
          user_id = cursor.lastrowid
    finally:
        db.close()

    # Set HttpOnly cookie
    is_production = os.environ.get("ENVIRONMENT") == "production"
    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        secure=is_production,
        samesite="lax",  # Allows cookies on redirects while maintaining CSRF protection
        path="/",
        max_age=2592000,  # 30 days
    )

    user = UserResponse(
        id=user_id, name=body.name.strip(), email=body.email.lower().strip(),
        wake_up_time=body.wake_up_time, sleep_time=body.sleep_time,
        study_method=body.study_method, session_minutes=body.session_minutes,
        break_minutes=body.break_minutes,
        hobby_name=None, neto_study_hours=4.0, peak_productivity='Morning', onboarding_completed=0,
        timezone_offset=body.timezone_offset
    )
    return AuthResponse(token="", user=user)  # Token not returned in JSON, only in cookie


@router.post("/login", response_model=AuthResponse)
def login(body: LoginRequest, response: Response):
    db = get_db()
    row = db.execute(
        "SELECT * FROM users WHERE email = ?", (body.email.lower().strip(),)
    ).fetchone()

    if not row or not verify_password(body.password, row["password_hash"]):
        db.close()
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Check if account is Google-linked
    if row["google_linked"]:
        db.close()
        raise HTTPException(status_code=403, detail="This account uses Google Sign-In. Please use the 'Sign in with Google' button.")

    token = generate_token()
    db.execute("UPDATE users SET auth_token = ? WHERE id = ?", (token, row["id"]))
    db.commit()
    db.close()

    # Set HttpOnly cookie
    is_production = os.environ.get("ENVIRONMENT") == "production"
    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        secure=is_production,
        samesite="lax",  # Allows cookies on redirects while maintaining CSRF protection
        path="/",
        max_age=2592000,  # 30 days
    )

    user = UserResponse(**{k: row[k] for k in UserResponse.model_fields})
    return AuthResponse(token="", user=user)  # Token not returned in JSON, only in cookie


@router.post("/logout")
def logout(response: Response, current_user: dict = Depends(get_current_user)):
    db = get_db()
    db.execute("UPDATE users SET auth_token = NULL WHERE id = ?", (current_user["id"],))
    db.commit()
    db.close()
    
    # Clear the session cookie
    response.delete_cookie(key="session_token", httponly=True, samesite="lax", path="/")
    return {"message": "Logged out"}


@router.get("/me", response_model=UserResponse)
def get_me(current_user: dict = Depends(get_current_user)):
    return UserResponse(**{k: current_user[k] for k in UserResponse.model_fields})


@router.get("/google/login")
async def google_login(request: Request):
    """Initiate Google OAuth flow."""
    redirect_uri = request.url_for('google_callback')
    return await oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/google/callback", name="google_callback")
async def google_callback(request: Request, response: Response):
    """Handle Google OAuth callback and create/link user account."""
    try:
        token = await oauth.google.authorize_access_token(request)
    except Exception as e:
        # User cancelled or error occurred
        return RedirectResponse(url="/", status_code=302)
    
    # Get user info from Google
    userinfo = token.get('userinfo')
    if not userinfo:
        return RedirectResponse(url="/", status_code=302)
    
    google_id = userinfo.get('sub')
    email = userinfo.get('email', '').lower().strip()
    name = userinfo.get('name', '').strip()
    
    if not google_id or not email:
        return RedirectResponse(url="/", status_code=302)
    
    db = get_db()
    try:
        # Try to find user by google_id first
        user = db.execute(
            "SELECT * FROM users WHERE google_id = ?", (google_id,)
        ).fetchone()
        
        is_new_user = False
        
        if not user:
            # Try to find user by email (for account linking)
            user = db.execute(
                "SELECT * FROM users WHERE email = ?", (email,)
            ).fetchone()
            
            if user:
                # Link existing account
                token_value = user['auth_token'] if user['auth_token'] else generate_token()
                db.execute(
                    "UPDATE users SET google_id = ?, google_linked = 1, auth_token = ? WHERE id = ?",
                    (google_id, token_value, user['id'])
                )
                db.commit()
                user_id = user['id']
            else:
                # Create new user from Google profile
                token_value = generate_token()
                cursor = db.execute(
                    """INSERT INTO users (name, email, google_id, google_linked, auth_token,
                       wake_up_time, sleep_time, study_method, session_minutes, break_minutes, onboarding_completed)
                       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)""",
                    (name, email, google_id, token_value, "08:00", "23:00", "pomodoro", 50, 10, 0)
                )
                db.commit()
                user_id = cursor.lastrowid
                is_new_user = True
        else:
            # Existing Google user
            user_id = user['id']
            token_value = user['auth_token'] if user['auth_token'] else generate_token()
            if not user['auth_token']:
                db.execute("UPDATE users SET auth_token = ? WHERE id = ?", (token_value, user_id))
                db.commit()
        
        # Fetch the complete user record
        user_row = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        
    finally:
        db.close()
    
    # Set HttpOnly cookie
    is_production = os.environ.get("ENVIRONMENT") == "production"
    
    # Redirect based on whether user is new
    redirect_url = "/onboarding" if is_new_user else "/dashboard"
    
    # Create redirect response and set cookie on it
    redirect_response = RedirectResponse(url=redirect_url, status_code=302)
    redirect_response.set_cookie(
        key="session_token",
        value=token_value,
        httponly=True,
        secure=is_production,
        samesite="lax",  # Changed from "strict" to allow OAuth redirects
        path="/",
        max_age=2592000,  # 30 days
    )
    
    return redirect_response
