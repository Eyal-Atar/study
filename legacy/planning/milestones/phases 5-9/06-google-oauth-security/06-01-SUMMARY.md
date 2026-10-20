# Plan 06-01: Database Migration + Cookie Auth Foundation - Summary

**Status:** ✅ Complete  
**Date:** 2026-02-20

## Tasks Completed

### Task 1: Database Migration & Dependencies ✅
- Added `google_id` (TEXT, UNIQUE) column to `users` table
- Added `google_linked` (INTEGER, DEFAULT 0) column to `users` table  
- Added `authlib==1.6.8` and `itsdangerous==2.2.0` to `requirements.txt`
- Created index on `google_id` for efficient lookups
- Migration handles existing databases gracefully (checks before adding columns)

### Task 2: Add SessionMiddleware ✅
- Imported `SessionMiddleware` from `starlette.middleware.sessions`
- Registered middleware with FastAPI app
- Configured `SESSION_SECRET_KEY` from environment (with fallback to generated secret)
- Set `max_age=3600` (1 hour) for OAuth temporary sessions
- Set `https_only` based on `ENVIRONMENT` variable (False for development)
- Added `allow_credentials=True` to CORS middleware for cookie support

### Task 3: Implement Cookie-based Authentication ✅
- Updated `get_current_user()` in `auth/utils.py`:
  - Changed from reading `Authorization` header to reading `session_token` cookie
  - Updated function signature to accept `Request` instead of `Header`
- Updated `register()` route:
  - Sets `session_token` cookie with `httponly=True`, `secure` (prod only), `samesite="strict"`, `max_age=2592000` (30 days)
  - Returns empty string for token in JSON response (token only in cookie)
- Updated `login()` route:
  - Sets `session_token` cookie with same security settings
  - Added check to block password login for Google-linked accounts (returns 403)
  - Returns empty string for token in JSON response
- Updated `logout()` route:
  - Clears `session_token` cookie by calling `response.delete_cookie()`

## Files Modified
- `backend/server/database.py` - Added Google OAuth columns and migration logic
- `backend/server/__init__.py` - Added SessionMiddleware
- `backend/server/config.py` - Added SESSION_SECRET_KEY configuration
- `backend/auth/utils.py` - Migrated from header-based to cookie-based auth
- `backend/auth/routes.py` - Updated all auth routes to use cookies
- `backend/requirements.txt` - Added authlib and itsdangerous dependencies

## Verification Notes
- ✅ Code compiles without syntax errors
- ⚠️ Dependencies need to be installed: `pip install -r backend/requirements.txt`
- ⚠️ Server startup test pending (requires dependencies)

## Next Steps
- Install dependencies: `pip install -r backend/requirements.txt`
- Test cookie-based login/register flow
- Proceed to Plan 06-02: Google OAuth routes with Authlib
