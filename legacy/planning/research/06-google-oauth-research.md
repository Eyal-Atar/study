# Research Phase 6: Google OAuth & Security

## Objectives
- Integrate Google Sign-In with industry-standard OAuth using Authlib.
- Secure token storage with HttpOnly cookies, replacing localStorage Bearer tokens.
- Add CSRF protection with the Double Submit Cookie pattern.
- Update the database schema to support Google accounts.
- Maintain compatibility with existing email/password login.

## Backend Research (FastAPI)

### 1. Google OAuth with Authlib
- **Library:** `authlib` and `httpx` (for async OAuth calls).
- **Implementation:**
  - Initialize `OAuth` from `authlib.integrations.starlette_client`.
  - Configure Google client with `client_id`, `client_secret`, and `server_metadata_url`.
  - Create `/auth/google/login` route to redirect to Google.
  - Create `/auth/google/callback` route to handle the redirection from Google, verify the token, and create/link the user.

### 2. Secure Token Storage (HttpOnly Cookies)
- **Current state:** Frontend stores `auth_token` in `localStorage` and sends it in the `Authorization: Bearer <token>` header.
- **New strategy:** Backend sets an `auth_token` cookie with `httponly=True`, `samesite='lax'`, and `secure=True` (in production).
- **Impact:** Prevents XSS-based token theft.

### 3. CSRF Protection
- **Pattern:** Double Submit Cookie.
- **Implementation:**
  - Backend sets a `csrf_token` cookie (non-HttpOnly).
  - Frontend reads the `csrf_token` from the cookie and sends it in a custom header (e.g., `X-CSRF-Token`) for all mutation requests (POST, PUT, DELETE).
  - Backend validates that the header value matches the cookie value.

### 4. Database Schema Updates
- **Table `users`:**
  - Add `google_id` (TEXT, UNIQUE) to link Google accounts.
  - Add `auth_token_expires` (TEXT) to handle token expiration (optional but recommended).

## Frontend Research (Modular JS)

### 1. Token Management
- **Update `store.js`:**
  - Remove `localStorage.getItem('studyflow_token')`.
  - Update `authFetch` to include `credentials: 'include'` by default.
  - No longer needs to manually send the `Authorization` header.

### 2. Login Flow
- **Update `auth.js`:**
  - Add `handleGoogleLogin` which redirects to `${API}/auth/google/login`.
  - Update `handleLogin` and `handleRegister` to rely on cookies set by the backend.

### 3. CSRF Implementation
- Add a utility to read a cookie value by name.
- Update `authFetch` to automatically include the `X-CSRF-Token` header.

## Migration Path
1. **Foundation:** Add `google_id` to `users` table and implement cookie-based session management in existing auth routes.
2. **Google OAuth:** Implement Authlib routes and frontend integration.
3. **Security:** Implement CSRF protection across all mutation endpoints.
4. **Verification:** End-to-end testing of both login methods.
