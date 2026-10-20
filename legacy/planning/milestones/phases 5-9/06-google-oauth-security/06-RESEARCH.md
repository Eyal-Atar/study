# Phase 6: Google OAuth & Security - Research

**Researched:** 2026-02-18
**Domain:** OAuth 2.0 / OpenID Connect authentication, secure cookie-based session management
**Confidence:** HIGH

## Summary

This phase implements Google OAuth 2.0 authentication using Authlib 1.6.8 for FastAPI and migrates token storage from localStorage to HttpOnly cookies for XSS protection. The implementation follows OpenID Connect protocol with automatic CSRF protection via state parameter validation.

**Key technical decisions:** Authlib provides automatic state parameter generation and validation, eliminating manual CSRF protection implementation. FastAPI's Starlette SessionMiddleware stores temporary OAuth flow data (code, state) server-side. HttpOnly cookies prevent JavaScript access to tokens, dramatically reducing XSS attack surface. Account linking is based on email matching using Google's `sub` claim as the unique identifier.

**Primary recommendation:** Use redirect-based OAuth flow (not popup) for better security and mobile compatibility. Implement email-based auto-linking with password deactivation post-link to prevent conflicting authentication methods. Set cookies with `httponly=True`, `secure=True`, `samesite='strict'`, and `max_age=2592000` (30 days).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
**Login screen experience:**
- Google Sign-In button appears BELOW the existing email/password form, as an alternative
- Google button only appears on the login screen, NOT on the registration screen
- First-time Google users see a welcome/onboarding screen before reaching the dashboard
- Returning Google users go straight to the dashboard

**Account linking:**
- If Google email matches an existing email/password account: auto-link (merge automatically)
- After auto-linking, Google replaces password login — only Google sign-in works for that account going forward
- If Google email does NOT match any existing account: auto-create a new StudyFlow account from Google profile data
- No separate registration step needed for Google users

**Session & token handling:**
- Sessions last 30 days before requiring re-authentication
- Migrate from localStorage tokens to HttpOnly cookies (required by roadmap success criteria)

**Error & edge cases:**
- If user cancels Google popup/flow: silent return to the regular registration screen, no error message
- Different Google email than registered email: handled by auto-link/auto-create logic above

### Claude's Discretion
- Google button styling (official branding vs app theme)
- "Remember me" checkbox (include or skip for simplicity)
- Token migration experience (silent logout or brief security notice)
- Multi-device session policy (unlimited or capped)
- Auth failure UX (toast vs error page)
- OAuth flow type (redirect vs popup)
- Email mismatch handling for non-matching Google accounts

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AUTH-01 | User can sign in with Google OAuth | Authlib OAuth2 integration patterns, OpenID Connect flow, Google userinfo extraction |
| AUTH-02 | Existing email/password login continues to work alongside Google OAuth | Cookie-based authentication dependency injection, multi-strategy authentication pattern |

</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Authlib | 1.6.8 | OAuth 2.0 / OpenID Connect client for FastAPI | Official OAuth library with automatic state validation, session-based flow management, supports Starlette/FastAPI integration |
| Starlette SessionMiddleware | Built-in | Server-side session storage for OAuth state/code | Required by Authlib for temporary OAuth flow data; built into FastAPI/Starlette |
| Google Identity (OpenID Connect) | OAuth 2.0 | Identity provider | Industry-standard authentication, automatic userinfo endpoint discovery via `.well-known/openid-configuration` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| PyJWT | Latest (2.x) | JWT token verification (optional) | If manually verifying Google ID tokens; Authlib handles automatically via `token['userinfo']` |
| python-dotenv | 1.0.1 | Environment variable management | Already in stack; store `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET_KEY` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Authlib | google-auth-oauthlib | Google-specific library; lacks generic OAuth support for future providers; Authlib more flexible |
| Redirect flow | Popup flow | Popup blocked by many browsers, poor mobile UX, incompatible with strict CSP; redirect flow universally supported |
| Manual state validation | Custom CSRF implementation | Authlib provides automatic state generation/validation; manual implementation error-prone |

**Installation:**
```bash
pip install authlib==1.6.8
# Starlette SessionMiddleware already available via FastAPI
```

---

## Architecture Patterns

### Recommended Project Structure
```
backend/
├── auth/
│   ├── routes.py           # Existing email/password + new OAuth routes
│   ├── utils.py            # Token generation, password hashing, + OAuth user creation
│   ├── schemas.py          # Pydantic models for OAuth responses
│   └── oauth_config.py     # NEW: Authlib OAuth registry
├── server/
│   └── __init__.py         # Add SessionMiddleware to FastAPI app
└── run.py
```

### Pattern 1: Authlib OAuth Registration
**What:** Register Google as an OAuth provider with automatic OpenID Connect discovery
**When to use:** During FastAPI application startup

**Example:**
```python
# backend/auth/oauth_config.py
# Source: https://docs.authlib.org/en/latest/client/fastapi.html
from authlib.integrations.starlette_client import OAuth
from starlette.config import Config

config = Config('.env')  # Load GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
oauth = OAuth(config)

# Google's OpenID Connect discovery endpoint
GOOGLE_DISCOVERY_URL = 'https://accounts.google.com/.well-known/openid-configuration'

oauth.register(
    name='google',
    server_metadata_url=GOOGLE_DISCOVERY_URL,  # Auto-fetches endpoints
    client_kwargs={
        'scope': 'openid email profile'  # Required scopes
    }
)
```

### Pattern 2: SessionMiddleware Setup
**What:** Add session middleware to store temporary OAuth state/code
**When to use:** During FastAPI app initialization

**Example:**
```python
# backend/server/__init__.py
from starlette.middleware.sessions import SessionMiddleware
import os

app = FastAPI()

# CRITICAL: Add before mounting OAuth routes
app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("SESSION_SECRET_KEY"),  # Strong random key (32+ chars)
    max_age=3600,  # Session expires after 1 hour (OAuth flow temporary)
    same_site="lax",  # CSRF protection for session cookies
    https_only=True  # Production only; False for localhost development
)
```

### Pattern 3: OAuth Login Redirect
**What:** Initiate OAuth flow by redirecting user to Google
**When to use:** When user clicks "Sign in with Google" button

**Example:**
```python
# backend/auth/routes.py
# Source: https://github.com/authlib/demo-oauth-client/blob/master/fastapi-google-login/app.py
from fastapi import APIRouter, Request
from .oauth_config import oauth

router = APIRouter()

@router.get("/auth/google/login")
async def google_login(request: Request):
    redirect_uri = request.url_for('google_callback')  # Must match Google Console config
    return await oauth.google.authorize_redirect(request, redirect_uri)
    # Authlib automatically:
    # 1. Generates state parameter (cryptographically secure random)
    # 2. Stores state in request.session
    # 3. Redirects to Google with state, client_id, scope, redirect_uri
```

### Pattern 4: OAuth Callback Handler
**What:** Exchange authorization code for tokens, extract user info, create/link account
**When to use:** Google redirects back to application after user consents

**Example:**
```python
# backend/auth/routes.py
from fastapi import HTTPException
from authlib.integrations.base_client.errors import OAuthError

@router.get("/auth/google/callback")
async def google_callback(request: Request, response: Response):
    try:
        # Authlib automatically:
        # 1. Retrieves state from session
        # 2. Validates state matches request parameter (CSRF protection)
        # 3. Exchanges authorization code for tokens
        token = await oauth.google.authorize_access_token(request)

        # Extract user info from ID token
        user_info = token.get('userinfo')
        google_id = user_info['sub']  # CRITICAL: Use 'sub' as unique ID, NOT email
        email = user_info.get('email')
        name = user_info.get('name')

        # Account linking logic
        existing_user = get_user_by_email(email)  # Query database

        if existing_user:
            # Auto-link: Mark account as Google-linked, disable password login
            link_google_account(existing_user['id'], google_id)
            user = existing_user
        else:
            # Auto-create new user from Google profile
            user = create_user_from_google(google_id, email, name)

        # Generate session token and store in HttpOnly cookie
        session_token = generate_token()
        save_user_session(user['id'], session_token)

        response.set_cookie(
            key="session_token",
            value=session_token,
            httponly=True,      # Prevents JavaScript access (XSS protection)
            secure=True,        # HTTPS only
            samesite="strict",  # CSRF protection
            max_age=2592000     # 30 days in seconds
        )

        # Redirect to onboarding or dashboard based on user status
        if user['is_new_google_user']:
            return RedirectResponse(url="/onboarding")
        else:
            return RedirectResponse(url="/dashboard")

    except OAuthError as e:
        # User canceled or error occurred
        # Per user constraint: silent redirect, no error message
        return RedirectResponse(url="/register")
```

### Pattern 5: Cookie-Based Authentication Dependency
**What:** Extract and validate session token from HttpOnly cookie instead of Authorization header
**When to use:** Protecting all API routes requiring authentication

**Example:**
```python
# backend/auth/utils.py
from fastapi import Cookie, HTTPException, Depends
from typing import Optional

async def get_current_user_from_cookie(
    session_token: Optional[str] = Cookie(None, alias="session_token")
) -> dict:
    """
    Dependency: Extract user from HttpOnly session cookie
    Replaces Authorization header Bearer token pattern
    """
    if not session_token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user = get_user_by_session_token(session_token)  # Query database
    if not user:
        raise HTTPException(status_code=401, detail="Invalid session")

    return user

# Usage in routes:
@router.get("/tasks")
async def get_tasks(current_user: dict = Depends(get_current_user_from_cookie)):
    # current_user available; works for both Google and email/password sessions
    return fetch_user_tasks(current_user['id'])
```

### Pattern 6: Multi-Strategy Authentication Support
**What:** Support both Google OAuth and email/password login with unified session management
**When to use:** Maintaining backward compatibility while adding OAuth

**Example:**
```python
# backend/auth/routes.py

@router.post("/auth/login")
async def email_password_login(credentials: LoginSchema, response: Response):
    """Traditional email/password login - still works unless account is Google-linked"""
    user = get_user_by_email(credentials.email)

    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Check if account is Google-linked (password disabled)
    if user.get('google_linked'):
        raise HTTPException(
            status_code=403,
            detail="This account uses Google Sign-In. Please use 'Sign in with Google' button."
        )

    # Verify password (existing PBKDF2 hashing)
    if not verify_password(credentials.password, user['password_hash']):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Generate session token (same cookie pattern as OAuth)
    session_token = generate_token()
    save_user_session(user['id'], session_token)

    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        secure=True,
        samesite="strict",
        max_age=2592000  # 30 days
    )

    return {"message": "Login successful"}
```

### Anti-Patterns to Avoid

- **DON'T use email as unique identifier:** Google's `sub` claim is immutable; email can change or be reassigned. Always use `sub` for Google account identity.
- **DON'T skip state validation:** Never disable Authlib's automatic state checking. CSRF attacks can link attacker's Google account to victim's session.
- **DON'T store tokens in localStorage after migration:** Once HttpOnly cookies are implemented, remove all localStorage token access. Mixing both creates security inconsistency.
- **DON'T allow both password and Google login post-link:** Per user constraint, Google should REPLACE password login after linking. Allowing both enables account takeover via weaker password.
- **DON'T use popup flow:** Browser popup blockers, mobile incompatibility, and CSP violations make redirect flow the only reliable choice.
- **DON'T manually implement session rotation:** Starlette SessionMiddleware auto-manages session IDs. Manual rotation doesn't change the actual cookie ID.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OAuth state generation/validation | Custom CSRF token system | Authlib's `authorize_redirect()` + `authorize_access_token()` | Authlib automatically generates cryptographically secure state, stores in session, validates on callback. Manual implementation risks weak randomness, storage bugs, timing attacks. |
| Google OpenID endpoint discovery | Hardcoded authorization/token URLs | `server_metadata_url` with `.well-known/openid-configuration` | Google's endpoints can change. Discovery document auto-updates jwks_uri, token_endpoint, userinfo_endpoint. Manual config breaks silently. |
| ID token verification | Manual JWT signature validation | Authlib's `token['userinfo']` or Google API client | Requires fetching Google's public keys from jwks_uri, verifying signature, checking iss/aud/exp claims. Authlib handles all validation automatically. |
| Session secret rotation | Manual key rotation logic | Environment variable + deployment process | Session secret rotation invalidates all active sessions. Coordinate rotation with deployment cycles, not runtime logic. |
| Cookie-based CSRF protection | Custom CSRF middleware | `samesite='strict'` cookie attribute | Modern browsers enforce SameSite; custom middleware adds complexity. Use `samesite='lax'` minimum, `'strict'` for highest security. |

**Key insight:** OAuth 2.0 is deceptively complex — redirect URI validation, state parameter binding, token exchange timing, and ID token verification all have subtle security implications. Authlib handles the entire OpenID Connect flow with automatic security validations. Custom implementations consistently miss edge cases like state parameter replay attacks, authorization code interception, and redirect URI manipulation.

---

## Common Pitfalls

### Pitfall 1: Redirect URI Mismatch
**What goes wrong:** Google returns `redirect_uri_mismatch` error; user stuck on Google consent screen
**Why it happens:** The `redirect_uri` in authorization request doesn't EXACTLY match Google Cloud Console configuration (trailing slash, http vs https, port number, query parameters)
**How to avoid:**
- Register ALL redirect URIs in Google Cloud Console: `http://localhost:8000/auth/google/callback` (dev), `https://yourdomain.com/auth/google/callback` (prod)
- Use `request.url_for('google_callback')` to generate redirect_uri dynamically (ensures exact match)
- NEVER hardcode redirect URIs; construct from request context
**Warning signs:** OAuth flow works locally but fails in production; redirect_uri_mismatch error in URL parameters

### Pitfall 2: Missing SessionMiddleware
**What goes wrong:** `RuntimeError: No session middleware installed` or state validation fails with "State not equal" error
**Why it happens:** Authlib stores OAuth state in `request.session`; without SessionMiddleware, session is unavailable
**How to avoid:**
- Add SessionMiddleware BEFORE registering OAuth routes in FastAPI app
- Set strong `secret_key` (32+ characters from `secrets.token_urlsafe(32)`)
- Use environment variable for secret, not hardcoded value
**Warning signs:** `authorize_access_token()` raises session-related exceptions; state parameter missing from session

### Pitfall 3: Email-Based Account Takeover via Pre-Registration
**What goes wrong:** Attacker pre-creates account with victim's email, victim uses Google OAuth, system auto-links to attacker's account
**Why it happens:** Email verification not enforced before linking accounts; attacker controls account created with victim's email
**How to avoid:**
- Verify email ownership during email/password registration (send confirmation email)
- Check `email_verified` claim in Google userinfo (Google verifies email ownership)
- If existing account has unverified email + Google account has verified email, prefer Google account (create new, mark old as duplicate)
**Warning signs:** Users report accessing someone else's data after Google login; accounts with same email but different owners

### Pitfall 4: Using `email` Instead of `sub` as User Identifier
**What goes wrong:** User changes Google email; system treats them as new user, loses existing data
**Why it happens:** Email addresses are mutable; user can change Google account email or domain ownership can transfer
**How to avoid:**
- Store Google's `sub` claim as unique identifier (`google_id` column)
- Use `sub` for account lookups and linking decisions
- Treat email as display-only field that can change
- If email match is used for initial linking, immediately store `sub` and use it for future authentications
**Warning signs:** Users report losing data after changing Google email; duplicate accounts for same person

### Pitfall 5: Token Storage Migration Without Logout
**What goes wrong:** After migrating to HttpOnly cookies, old localStorage tokens still present; app uses old tokens; security policy inconsistent
**Why it happens:** Frontend continues reading localStorage as fallback; backend accepts both cookie and Bearer token authentication
**How to avoid:**
- Implement token migration logic: read localStorage token, exchange for HttpOnly cookie session, delete localStorage token
- OR force logout on next visit: detect localStorage token presence, clear it, redirect to login with migration notice
- Update all fetch/axios calls to use `credentials: 'include'` instead of Authorization header
- Remove Authorization header authentication from backend (cookie-only)
**Warning signs:** Users see logout after deployment; some requests use cookies, others use headers; mixed authentication state

### Pitfall 6: Infinite Redirect Loop Between Login and Callback
**What goes wrong:** User clicks "Sign in with Google", redirects to Google, returns to callback, callback redirects to login, repeat
**Why it happens:** Callback route fails to set session cookie; authentication dependency redirects unauthenticated users to login; login initiates OAuth again
**How to avoid:**
- Ensure callback route sets HttpOnly cookie BEFORE redirecting to dashboard
- Test cookie setting: check `Set-Cookie` header in callback response
- Verify `secure=True` only in production (localhost requires `secure=False`)
- Check browser doesn't block third-party cookies (affects session cookies if misconfigured)
**Warning signs:** Network tab shows repeated requests to /auth/google/login and /auth/google/callback; user never reaches dashboard

### Pitfall 7: Hardcoded `secure=True` Breaking Localhost Development
**What goes wrong:** Cookies not set in development; authentication fails on localhost
**Why it happens:** `secure=True` flag requires HTTPS; localhost uses HTTP; browser silently ignores Set-Cookie with secure flag on HTTP
**How to avoid:**
- Use environment-based cookie security: `secure=os.getenv('ENVIRONMENT') == 'production'`
- OR use `secure=not request.url.hostname.startswith('localhost')`
- Document development environment setup: developers must know to disable secure flag locally
**Warning signs:** Authentication works in production, fails in local development; Set-Cookie header present but cookie not stored

---

## Code Examples

Verified patterns from official sources:

### Complete OAuth Setup (FastAPI Application Initialization)
```python
# backend/server/__init__.py
# Source: https://docs.authlib.org/en/latest/client/fastapi.html
from fastapi import FastAPI
from starlette.middleware.sessions import SessionMiddleware
import os

app = FastAPI()

# STEP 1: Add SessionMiddleware (required by Authlib)
app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("SESSION_SECRET_KEY"),  # Strong random value
    max_age=3600,  # OAuth session expires after 1 hour
    same_site="lax",
    https_only=os.getenv("ENVIRONMENT") == "production"
)

# STEP 2: Include OAuth routes
from backend.auth.routes import router as auth_router
app.include_router(auth_router, prefix="/auth", tags=["auth"])
```

### OAuth Configuration (Authlib Registration)
```python
# backend/auth/oauth_config.py
# Source: https://github.com/authlib/demo-oauth-client/blob/master/fastapi-google-login/app.py
from authlib.integrations.starlette_client import OAuth
from starlette.config import Config

# Load from .env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
config = Config('.env')
oauth = OAuth(config)

oauth.register(
    name='google',
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={
        'scope': 'openid email profile'
    }
)
```

### Setting HttpOnly Authentication Cookies
```python
# Source: https://www.starlette.io/responses/
# Starlette set_cookie documentation
response.set_cookie(
    key="session_token",
    value=token_value,
    max_age=2592000,      # 30 days in seconds
    httponly=True,        # Prevents JavaScript access (XSS protection)
    secure=True,          # HTTPS only (use False for localhost)
    samesite="strict",    # CSRF protection (strict = never sent cross-origin)
    path="/",             # Cookie valid for entire application
    domain=None           # Current domain only (don't set for localhost compatibility)
)
```

### Cookie Deletion (Logout)
```python
# Source: https://www.starlette.io/responses/
# To delete a cookie, set max_age=0
@router.post("/auth/logout")
async def logout(response: Response):
    response.set_cookie(
        key="session_token",
        value="",
        max_age=0,           # Expire immediately
        httponly=True,
        secure=True,
        samesite="strict"
    )
    return {"message": "Logged out successfully"}
```

### Environment Variables (.env)
```bash
# Google OAuth Configuration
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret

# Session Security
SESSION_SECRET_KEY=your-session-secret-32-plus-chars

# Application Environment
ENVIRONMENT=development  # or 'production'
```

### Frontend: Google Sign-In Button (HTML)
```html
<!-- frontend/index.html -->
<!-- Source: https://developers.google.com/identity/branding-guidelines -->
<!-- Login screen only (per user constraint) -->
<div id="login-form">
    <!-- Existing email/password form -->
    <form id="email-password-login">
        <input type="email" name="email" />
        <input type="password" name="password" />
        <button type="submit">Log In</button>
    </form>

    <!-- Google Sign-In appears BELOW (per user constraint) -->
    <div class="oauth-divider">or</div>
    <a href="/auth/google/login" class="google-signin-button">
        <img src="/assets/google-logo.svg" alt="Google" />
        Sign in with Google
    </a>
</div>
```

### Frontend: Fetch with Cookies
```javascript
// frontend/js/app.js
// After migration to HttpOnly cookies, ALWAYS include credentials
fetch('/api/tasks', {
    method: 'GET',
    credentials: 'include'  // Sends HttpOnly cookies with request
})
.then(response => response.json())
.then(tasks => displayTasks(tasks));

// REMOVE Authorization header pattern:
// ❌ headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
// ✅ credentials: 'include'
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| localStorage token storage | HttpOnly cookies | 2020-2021 (post-OWASP guidance) | Eliminates XSS token theft; requires backend cookie handling; improves security posture significantly |
| Manual OAuth state validation | Authlib automatic validation | Authlib 1.0+ (2021) | Developers no longer manually generate/check state; CSRF protection built-in |
| Popup OAuth flow | Redirect OAuth flow | 2018-2020 (browser popup blocking increased) | Better mobile support, no popup blocker issues, CSP compliant |
| Implicit flow (response_type=token) | Authorization code flow (response_type=code) | OAuth 2.0 Security BCP 2019 | Tokens never exposed in URL/browser history; server-side token exchange prevents interception |
| Hardcoded OAuth endpoints | OpenID Connect Discovery | OpenID Connect 1.0 (2014, widely adopted 2018+) | Automatic endpoint updates; no manual configuration for auth/token/jwks URLs |
| bcrypt password hashing | Argon2id password hashing | 2023-2024 (FastAPI community shift) | 300x better GPU resistance; memory-hard algorithm; current OWASP recommendation |

**Deprecated/outdated:**
- **OAuth 1.0:** Replaced by OAuth 2.0 (no signature generation, simpler flow)
- **Implicit flow (`response_type=token`):** Deprecated in OAuth 2.0 Security Best Current Practice (2019). Use authorization code flow instead.
- **Password grant type:** Removed from OAuth 2.1 draft. Use authorization code flow for all client types.
- **google-auth-oauthlib:** Google-specific library; Authlib preferred for multi-provider support and FastAPI integration

---

## Open Questions

### 1. Session Cookie Domain Configuration for Subdomains
- **What we know:** Setting `domain=".yourdomain.com"` makes cookies accessible to all subdomains
- **What's unclear:** Whether StudyFlow will use subdomains (api.studyflow.com, app.studyflow.com); current localhost testing doesn't reveal domain issues
- **Recommendation:** Omit `domain` parameter initially (defaults to current domain only). If multi-subdomain deployment occurs, set `domain` to root domain with leading dot.

### 2. Google OAuth Scopes Beyond Basic Profile
- **What we know:** `openid email profile` provides sub, email, name, picture
- **What's unclear:** Whether future features need additional Google API access (Calendar sync mentioned in v2 requirements but deferred)
- **Recommendation:** Start with minimal scopes. Google allows incremental authorization — request additional scopes only when needed for specific features.

### 3. Multi-Device Session Policy
- **What we know:** User constraint allows Claude's discretion on multi-device sessions
- **What's unclear:** Whether sessions should be unlimited per user or capped (e.g., max 5 devices)
- **Recommendation:** Start unlimited — simpler implementation, better UX. Add device limit only if abuse detected (requires sessions table with device fingerprinting).

### 4. Token Migration User Experience
- **What we know:** User constraint allows Claude's discretion on migration experience (silent logout vs notice)
- **What's unclear:** User expectation — is being logged out acceptable, or should migration be transparent?
- **Recommendation:** Silent migration if possible (exchange localStorage token for cookie on first request, delete localStorage). Fallback to logout with notice if token exchange fails (expired/invalid localStorage tokens).

---

## Sources

### Primary (HIGH confidence)
- [Authlib 1.6.6 FastAPI Client Documentation](https://docs.authlib.org/en/latest/client/fastapi.html) - OAuth setup, SessionMiddleware requirements
- [Authlib Demo: FastAPI Google Login](https://github.com/authlib/demo-oauth-client/blob/master/fastapi-google-login/app.py) - Complete working example
- [Authlib OAuth2 Session Documentation](https://docs.authlib.org/en/latest/client/oauth2.html) - State parameter automatic validation
- [Google OpenID Connect Documentation](https://developers.google.com/identity/openid-connect/openid-connect) - Full OAuth flow, ID token claims, verification requirements
- [Starlette Response.set_cookie Documentation](https://www.starlette.io/responses/) - httponly, secure, samesite parameters
- [FastAPI Response Cookies](https://fastapi.tiangolo.com/advanced/response-cookies/) - Cookie setting patterns in FastAPI
- [Google OAuth2 Scopes](https://developers.google.com/identity/protocols/oauth2/scopes) - Available scopes and claims
- [Google Sign-In Branding Guidelines](https://developers.google.com/identity/branding-guidelines) - Official button design requirements

### Secondary (MEDIUM confidence)
- [Google OAuth Redirect URI Configuration](https://developers.google.com/identity/protocols/oauth2/web-server) - localhost and production URI setup
- [OAuth 2.0 State Parameter Best Practices](https://auth0.com/docs/secure/attack-protection/state-parameters) - CSRF protection mechanisms
- [Google Account Linking Documentation](https://developers.google.com/identity/account-linking/oauth-linking) - Account merge patterns
- [FastAPI JWT HttpOnly Cookie Tutorial](https://fastapitutorial.medium.com/fastapi-securing-jwt-token-with-httponly-cookie-47e0139b8dde) - Cookie-based auth migration
- [localStorage vs HttpOnly Cookies Security Guide 2026](https://volcanicminds.com/en/insights/cookie-vs-localstorage-security-guide) - Migration rationale and security comparison

### Tertiary (LOW confidence - community sources)
- [FastAPI Session Management Best Practices](https://codesignal.com/learn/courses/secure-authentication-authorization-in-fastapi/lessons/session-management-best-practices) - Session rotation and secret management
- [OAuth Common Attacks and Prevention](https://workos.com/blog/oauth-common-attacks-and-how-to-prevent-them) - Pitfalls and anti-patterns
- [OAuth Account Takeover Risks](https://book.hacktricks.xyz/pentesting-web/oauth-to-account-takeover) - Email-based linking vulnerabilities

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** - Authlib officially documented for FastAPI, Google OpenID Connect is industry standard
- Architecture: **HIGH** - Patterns verified from Authlib official examples and Google developer docs
- Pitfalls: **MEDIUM-HIGH** - Common issues well-documented in OAuth security literature; some based on community experience vs official sources

**Research date:** 2026-02-18
**Valid until:** 2026-03-20 (30 days - stable OAuth 2.0 standards, but library versions may update)

**Notes:**
- OAuth 2.0 and OpenID Connect are mature standards (2012, 2014 respectively) with minimal breaking changes
- Authlib 1.6.x stable; minor version updates unlikely to affect implementation patterns
- Google's OpenID endpoints stable; Discovery document ensures automatic updates
- Cookie security attributes (httponly, secure, samesite) standardized across browsers as of 2020
