---
phase: 19-gamification-xp-login-streaks
plan: 02
subsystem: api
tags: [fastapi, gamification, xp, streaks, badges, morning-prompt]

# Dependency graph
requires:
  - phase: 19-01
    provides: gamification utility functions (calculate_xp, update_user_xp, update_streak, check_and_award_badges, _today_in_tz) and DB tables (user_xp, user_streaks, user_badges)
provides:
  - POST /gamification/login-check — first-of-day gate with streak update and morning prompt
  - POST /gamification/award-xp — idempotent XP grant with badge checking
  - POST /gamification/reschedule-task/{task_id} — morning prompt task actions (reschedule/delete/skip)
  - GET /gamification/summary — full XP, streak, badges state for dashboard
  - Gamification router registered in FastAPI app at /gamification prefix
affects: [frontend-gamification, achievements-tab, morning-prompt-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Idempotency via xp_awarded flag on schedule_blocks prevents double XP grants"
    - "Early return pattern on login-check: return {first_login_today: False} before expensive queries"
    - "finally: db.close() pattern for consistent DB connection teardown in all endpoints"

key-files:
  created:
    - backend/gamification/routes.py
  modified:
    - backend/server/__init__.py

key-decisions:
  - "Routes commit all four endpoints in a single file — cohesive module, no partial state between route additions"
  - "reschedule action updates both tasks.day_date and schedule_blocks dates to keep them in sync"
  - "summary endpoint auto-resets daily_xp when date has rolled over — prevents stale daily stats"
  - "login-check returns minimal {first_login_today: False} early to avoid redundant DB queries on repeated calls"

patterns-established:
  - "Gamification endpoints: always get tz_offset from current_user, default to 0"
  - "XP idempotency: check xp_awarded on block before any calculation"

requirements-completed: [GAM-04, GAM-05, GAM-06]

# Metrics
duration: 10min
completed: 2026-03-03
---

# Phase 19 Plan 02: Gamification Backend Routes & API Summary

**Four FastAPI gamification endpoints (login-check, award-xp, reschedule-task, summary) registered at /gamification prefix with idempotent XP granting and first-of-day streak gating**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-03T09:47:00Z
- **Completed:** 2026-03-03T09:57:10Z
- **Tasks:** 4
- **Files modified:** 2

## Accomplishments
- All four gamification endpoints implemented in backend/gamification/routes.py (313 lines)
- login-check endpoint gates on first-of-day, updates streak, returns morning tasks and newly earned badges
- award-xp endpoint is fully idempotent via xp_awarded flag, calculates XP as focus_score * estimated_hours * 10
- reschedule-task handles morning prompt actions: reschedule (move to today), delete (defer), skip (no-op)
- summary endpoint returns full XP/streak/badges state and auto-resets daily_xp on date rollover
- Gamification router registered in FastAPI app with prefix=/gamification

## Task Commits

Each task was committed atomically:

1. **Tasks 1-3: Gamification routes (login-check, award-xp, reschedule-task, summary)** - `1d62aa0` (feat)
2. **Task 4: Register gamification router in FastAPI app** - `4fde84a` (feat)

## Files Created/Modified
- `backend/gamification/routes.py` - Four gamification API endpoints with Pydantic request schemas and helper functions
- `backend/server/__init__.py` - Added gamification router import and include_router registration

## Decisions Made
- Routes commit all four endpoints together — routes.py was already fully written, committing as a unit maintains coherent module state
- reschedule action updates both tasks table and schedule_blocks (including start_time/end_time date prefix replacement) to keep task and block dates in sync
- summary auto-resets daily_xp on date rollover to prevent stale daily stats persisting across days
- login-check uses early return for non-first-logins to avoid running morning task queries unnecessarily

## Deviations from Plan

None - plan executed exactly as written. routes.py was pre-created with all four endpoints; Tasks 1-3 committed the file, Task 4 registered the router.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All four gamification backend endpoints are live and callable via HTTP
- Frontend can now call POST /gamification/login-check on app load to trigger morning prompt
- Frontend can call POST /gamification/award-xp when marking schedule blocks as complete
- GET /gamification/summary provides all data needed for Achievements tab
- Ready for Phase 19 Plan 03 (frontend gamification UI integration)

---
*Phase: 19-gamification-xp-login-streaks*
*Completed: 2026-03-03*
