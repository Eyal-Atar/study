# Plan 06-02: Google OAuth Routes with Authlib - Summary

**Status:** ✅ Complete  
**Date:** 2026-02-20

## Tasks Completed

### Task 1: Authlib Configuration ✅
- Created `backend/auth/oauth_config.py` with Google OAuth provider configuration
- Configured OAuth with `server_metadata_url` for OpenID Connect discovery
- Set scopes to `openid email profile`
- Uses environment variables `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`

### Task 2: Implement OAuth Routes ✅
- **GET /auth/google/login:**
  - Initiates OAuth flow by redirecting to Google
  - Uses `oauth.google.authorize_redirect()` with callback URL
  
- **GET /auth/google/callback:**
  - Handles token exchange and validates OAuth response
  - Extracts user info (`sub`, `email`, `name`) from `userinfo` claim
  - Implements account linking/creation logic:
    1. First tries to find user by `google_id`
    2. If not found, tries to find user by `email`:
       - If found: links account (sets `google_id`, `google_linked=1`), generates/updates auth token
       - If not found: creates new user from Google profile with default settings
    3. Sets `session_token` cookie with HttpOnly, Secure (prod), SameSite=Strict, 30-day expiry
    4. Redirects to:
       - `/onboarding` for first-time Google users (newly created accounts)
       - `/dashboard` for returning users (existing Google accounts or linked accounts)

### Task 3: Refine Existing Login for Linked Accounts ✅
- Updated `login()` route to check `google_linked` flag
- Returns 403 error with message: "This account uses Google Sign-In. Please use the 'Sign in with Google' button."
- Prevents password login for accounts that have been linked to Google

## Files Modified
- `backend/auth/oauth_config.py` - Created OAuth configuration
- `backend/auth/routes.py` - Added Google OAuth routes and linked account protection

## Environment Variables Required
Users need to add these to their `.env` file:
```
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
```

## Verification Notes
- ✅ Code compiles without syntax errors
- ⚠️ OAuth routes require Google OAuth credentials to be configured
- ⚠️ Frontend routes `/onboarding` and `/dashboard` need to be implemented in Plan 06-03

## Next Steps
- Configure Google OAuth credentials in Google Cloud Console
- Add redirect URI: `http://localhost:8000/auth/google/callback` (for development)
- Proceed to Plan 06-03: Frontend cookie migration + Google Sign-In button
