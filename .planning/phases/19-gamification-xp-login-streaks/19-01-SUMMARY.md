---
phase: 19-gamification-xp-login-streaks
plan: 01
subsystem: database
tags: [sqlite, gamification, xp, streaks, badges, migrations]

# Dependency graph
requires:
  - phase: 17-split-brain-ai-scheduler
    provides: tasks.focus_score column used in XP calculation formula
provides:
  - user_xp table with total_xp, current_level, daily_xp tracking
  - user_streaks table with current/longest streak and streak_broken flag
  - user_badges table with UNIQUE (user_id, badge_key) constraint
  - schedule_blocks.xp_awarded column to prevent double-award
  - gamification/utils.py with calculate_xp, update_user_xp, update_streak, check_and_award_badges
affects:
  - 19-02 (splash screen reads streaks)
  - 19-03 (XP award on block completion)
  - 19-04 (achievements tab reads badges and XP)
  - 19-05 (morning prompt reads streak state)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - PRAGMA table_info migration pattern for ALTER TABLE IF NOT EXISTS
    - tz_offset integer for timezone-aware date calculations (no pytz dependency)
    - DB connection passed as parameter to utility functions (not global state)

key-files:
  created:
    - backend/gamification/__init__.py
    - backend/gamification/utils.py
  modified:
    - backend/server/database.py

key-decisions:
  - "Gamification tables added to existing SQLite DB via CREATE TABLE IF NOT EXISTS (not a separate DB)"
  - "xp_awarded added to schedule_blocks via ALTER TABLE migration to prevent double-award on completion"
  - "Level formula: min(50, floor(total_xp / 1000) + 1) — 1000 XP per level, cap at 50"
  - "streak_broken flag persists in DB until cleared by splash endpoint (not cleared on same login)"
  - "Badge criteria defined as lambda list in utils.py for easy extension"
  - "tz_offset as integer hours passed to functions — avoids pytz/zoneinfo dependency"

patterns-established:
  - "Gamification utils accept db connection as first arg — follows existing DB helper pattern"
  - "All date comparisons use YYYY-MM-DD strings in user's local TZ via _today_in_tz(tz_offset)"

requirements-completed: [GAM-01, GAM-02, GAM-03]

# Metrics
duration: 2min
completed: 2026-03-02
---

# Phase 19 Plan 01: Database Schema & Gamification Utilities Summary

**SQLite gamification schema (user_xp, user_streaks, user_badges) plus utility module with XP calculation, streak tracking, and badge-award logic wired to existing DB connection pattern**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-02T23:24:04Z
- **Completed:** 2026-03-02T23:25:44Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created three gamification tables (user_xp, user_streaks, user_badges) with correct constraints and foreign keys
- Added xp_awarded column to schedule_blocks to prevent double-awarding XP on block completion
- Implemented gamification/utils.py with calculate_xp, update_user_xp, update_streak, and check_and_award_badges functions, all verified with sample data

## Task Commits

Each task was committed atomically:

1. **Task 1: Create gamification database tables and add xp_awarded column** - `cf74a5e` (feat)
2. **Task 2: Create gamification utility module with XP, streak, and badge logic** - `6b6c5ef` (feat)

## Files Created/Modified

- `backend/server/database.py` - Added user_xp, user_streaks, user_badges CREATE TABLE IF NOT EXISTS blocks; added xp_awarded column migration for schedule_blocks; added indexes
- `backend/gamification/__init__.py` - Module entry point
- `backend/gamification/utils.py` - calculate_xp, update_user_xp, update_streak, check_and_award_badges with badge criteria for streak/level/XP milestones

## Decisions Made

- Gamification tables go into the existing SQLite DB (not a separate file) — consistent with all prior phases
- xp_awarded on schedule_blocks uses the existing ALTER TABLE migration pattern (PRAGMA table_info check)
- Level formula is min(50, floor(total_xp / 1000) + 1) — gives 1000 XP per level with a cap at level 50
- streak_broken flag in user_streaks is set to 1 on break, cleared by the splash screen endpoint (plan 19-02) — not cleared on next login
- Badge criteria defined as a list of (key, lambda) tuples to make future additions trivial

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All gamification foundation tables and utilities are ready
- Plan 19-02 (splash screen / morning prompt) can read user_streaks and call update_streak
- Plan 19-03 (XP award on block completion) can call calculate_xp and update_user_xp, then mark schedule_blocks.xp_awarded = 1
- Plan 19-04 (achievements tab) can query user_xp and user_badges

---
*Phase: 19-gamification-xp-login-streaks*
*Completed: 2026-03-02*
