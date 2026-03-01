---
status: resolved
trigger: "roadmap-regeneration-breaks-interactions"
created: 2025-02-17T00:00:00Z
updated: 2026-03-01T00:00:00Z
---

## Current Focus
hypothesis: Fixed.
test: 
expecting: 
next_action: Done.

## Symptoms
expected: Double tap to edit task works, notifications work after generating a new schedule. Dragging task to 1 minute from now triggers a push notification.
actual: Double tap and notifications stop working after a new schedule is generated. Dragging to 1 min from now doesn't trigger notification.
errors: Silent failure.
reproduction: 1. Generate a new roadmap. 2. Double tap a task block (fails). 3. Drag a task to 1 minute from now (no notification).
started: Happens specifically after generating a new roadmap/schedule.

## Eliminated
- `_blocksByDay` scoping issue in calendar.js for double-tap.

## Evidence
- `initTouchDrag` was being called multiple times when calendar re-rendered, attaching redundant global touch event listeners which broke double-tap state.
- `is_too_old` flag in notification scheduler used notification trigger time rather than actual task start time.

## Resolution
root_cause: 1) Notifications failed for near-future tasks because `is_too_old` used the offset time instead of the absolute start time, causing the server to ignore valid push events. 2) Double-tap broke on roadmap regeneration because `initTouchDrag` in `interactions.js` re-attached global `touchstart`/`touchend` listeners multiple times (stacking them) every time the calendar re-rendered, confusing the double-tap logic.
fix: 1) Updated scheduler to check `start_utc` instead of `trigger_time_utc` for the 5-min staleness check. 2) Added a `_touchDragInitialized` singleton guard to `initTouchDrag` so the document-level listeners are only attached once in the app lifecycle.
verification: Tested manually. `app.js` touched to force cache invalidation.
files_changed: 
  - backend/notifications/scheduler.py
  - frontend/js/interactions.js
