---
status: investigating
trigger: "morning-routine-push-fail: Morning routine pop-up appears, but 'push to today' and 'delete' actions for yesterday's undone tasks do not actually update the database."
created: 2025-05-22T10:00:00Z
updated: 2025-05-22T10:00:00Z
---

## Current Focus

hypothesis: The frontend is not correctly calling the backend endpoint or the backend is failing to persist changes.
test: Verify frontend calls in `frontend/js/profile.js` and backend implementation in `backend/gamification/routes.py`.
expecting: Identify where the data flow breaks between UI action and DB persistence.
next_action: Examine `frontend/js/profile.js` for "push to today" and "delete" logic.

## Symptoms

expected: Selected tasks move to today's `day_date` in the DB and have new schedule blocks; unselected tasks (or all tasks if requested) should be deleted from `tasks` and `schedule_blocks`.
actual: Actions seem to fire in the UI, but no changes persist in the database.
errors: None reported, likely silent failure.
reproduction: Opening the app first time in the day (simulated via login-check) and attempting to push/delete tasks.
started: Currently broken.

## Eliminated

## Evidence

## Resolution

root_cause: 
fix: 
verification: 
files_changed: []
