# Research: Phase 7 - User Profiles & Hobbies

## Existing User Schema
The current `users` table in `backend/server/database.py` contains:
- `id` (INTEGER PRIMARY KEY)
- `name` (TEXT NOT NULL)
- `email` (TEXT UNIQUE)
- `wake_up_time` (TEXT DEFAULT '08:00')
- `sleep_time` (TEXT DEFAULT '23:00')
- `study_method` (TEXT DEFAULT 'pomodoro')
- `session_minutes` (INTEGER DEFAULT 50)
- `break_minutes` (INTEGER DEFAULT 10)
- `created_at` (TEXT)
- `password_hash` (TEXT)
- `auth_token` (TEXT)
- `google_id` (TEXT)
- `google_linked` (INTEGER DEFAULT 0)

## New Required Data Points
Based on `07-CONTEXT.md`, the following fields need to be added to the `users` table:
- `hobby_name` (TEXT): The user's main hobby (e.g., Gym, Gaming).
- `neto_study_hours` (REAL): Net learning hours per day.
- `peak_productivity` (TEXT): 'Morning', 'Afternoon', 'Evening', or 'Night'.
- `onboarding_completed` (INTEGER DEFAULT 0): To track mandatory onboarding completion.

## Backend Implementation
1.  **Database Migration:** Update `init_db` in `backend/server/database.py` to add new columns if they don't exist.
2.  **Schemas:** Update `UserResponse` and `UserUpdate` in `backend/users/schemas.py` to include new fields.
3.  **Auth Routes:**
    - Update `register` in `backend/auth/routes.py` to initialize `onboarding_completed = 0`.
    - Update `google_callback` to set `onboarding_completed = 0` for new users.
    - Check if the redirect to `/onboarding` for new users is already handled (it is, in `google_callback`).
4.  **User Routes:**
    - Update `get_profile` and `update_profile` in `backend/users/routes.py` to handle the new fields.

## Frontend Implementation
1.  **Onboarding Screen:**
    - The current `screen-onboarding` in `index.html` is a simple welcome screen.
    - It needs to be converted into a multi-step wizard as per the "Profiler" requirements.
    - Step 1: Hobby Name (Icons/Tags + Other).
    - Step 2: Sleep/Wake (Existing fields, but need to be captured here) + Study Load (Neto hours).
    - Step 3: Peak Productivity (Selection).
2.  **Routing/Navigation:**
    - After login/register, check `user.onboarding_completed`. If `0`, redirect/show `screen-onboarding`.
    - If Google Sign-In redirects to `/onboarding`, the current `app.js` already shows `screen-onboarding`.
3.  **Persistence:**
    - Submitting the wizard should PATCH `/users/me` with all the data and set `onboarding_completed = 1`.
    - Redirect to `screen-dashboard` on success.

## Technical Considerations
- **Icons for Hobbies:** Can use emojis or simple SVG icons for the tags (Gym, Gaming, Reading, etc.).
- **Time Pickers:** HTML5 `<input type="time">` is sufficient and mobile-friendly.
- **Sliders:** HTML5 `<input type="range">` for Study Load (Neto hours).
- **Peak Productivity:** Radio buttons or cards for selection.
