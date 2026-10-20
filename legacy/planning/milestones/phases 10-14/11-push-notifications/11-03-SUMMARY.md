---
phase: 11-push-notifications
plan: 03
subsystem: ui
tags: [push-notifications, pwa, service-worker, notification-settings, permission-modal, vanilla-js]

# Dependency graph
requires:
  - phase: 11-push-notifications plan 01
    provides: service worker push event handler and PWA infrastructure
  - phase: 11-push-notifications plan 02
    provides: VAPID backend, /push/subscribe endpoint, /push/vapid-public-key endpoint
provides:
  - Permission onboarding modal (#modal-notif-permission) shown after first task marked Done
  - First-task-done detection logic with localStorage persistence flag
  - Browser push subscription registration via subscribeToPush() in auth.js
  - Notification settings section in Settings modal (timing dropdown, per-task toggle, daily-summary toggle)
  - Settings persistence: notif_timing, notif_per_task, notif_daily_summary saved to PATCH /users/me and reloaded on open
affects: [future notification preferences UX, APScheduler cron in plan 02 reads per-user preferences]

# Tech tracking
tech-stack:
  added: [Web Push API (pushManager.subscribe), Notification API (requestPermission), CustomEvent (request-push-permission)]
  patterns: [CustomEvent bus for cross-module communication (tasks.js -> auth.js), localStorage flag for one-shot UX prompts]

key-files:
  created: []
  modified:
    - frontend/index.html
    - frontend/js/tasks.js
    - frontend/js/auth.js

key-decisions:
  - "Permission modal shown with 1.5s delay after first task Done so confetti animation completes before modal appears"
  - "localStorage key 'sf_notif_prompt_shown' persists across sessions — modal shown once ever, not once per session"
  - "tasks.js dispatches CustomEvent 'request-push-permission' to window; auth.js listens — decoupled modules, no direct import"
  - "subscribeToPush() fetches VAPID key first, then calls requestPermission() — avoids requesting browser permission if backend is unavailable"
  - "Notification settings fields use optional chaining (?.) in handleSaveSettings so they silently no-op if DOM elements absent (graceful degradation)"

patterns-established:
  - "Pattern 1: One-shot UX prompts use localStorage flags + Notification.permission guard — never re-prompt once dismissed"
  - "Pattern 2: Cross-module events via window.dispatchEvent(CustomEvent) + window.addEventListener — no shared imports needed"

requirements-completed: [NOTIF-01, NOTIF-02]

# Metrics
duration: 10min
completed: 2026-02-23
---

# Phase 11 Plan 03: Push Notifications Frontend Summary

**Permission onboarding modal triggered on first task Done, push subscription via subscribeToPush(), and notification settings (timing + toggles) persisted to backend through PATCH /users/me**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-02-23T00:00:00Z
- **Completed:** 2026-02-23T00:10:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added permission modal (#modal-notif-permission) to index.html: shown after the first task is marked Done, with a 1.5s delay so confetti finishes first
- Added NOTIF_PROMPT_KEY localStorage flag in tasks.js so the modal is shown exactly once per user (persists across refreshes)
- Added subscribeToPush() in auth.js: fetches VAPID public key from /push/vapid-public-key, calls Notification.requestPermission(), subscribes via pushManager, POSTs to /push/subscribe
- Added _urlBase64ToUint8Array() helper for VAPID key decoding
- Wired window 'request-push-permission' CustomEvent from tasks.js (Yes button) to subscribeToPush() in auth.js
- Added notification settings section to Settings modal: timing dropdown (at_start, 15_before, 30_before), per-task checkbox (default checked), daily-summary checkbox (default unchecked)
- Settings populated from user profile on modal open; saved via PATCH /users/me notif_timing/notif_per_task/notif_daily_summary fields

## Task Commits

Each task was committed atomically:

1. **Task 1: Permission onboarding modal (HTML) + first-task-done trigger (tasks.js)** - `7d2e866` (feat)
2. **Task 2: Push subscription flow (auth.js) + Notification settings UI** - `3f74dae` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `frontend/index.html` - Added #modal-notif-permission modal HTML; added notification settings section in #modal-settings
- `frontend/js/tasks.js` - Added NOTIF_PROMPT_KEY helpers, first-task-done detection in toggleDone, modal button event bindings in initTasks
- `frontend/js/auth.js` - Added subscribeToPush(), _urlBase64ToUint8Array(), 'request-push-permission' event listener, notif fields in settings load and save

## Decisions Made
- Modal delay of 1.5s chosen to let confetti animation complete before the modal overlay appears — better UX pacing
- tasks.js dispatches a CustomEvent on window to trigger subscribeToPush() in auth.js — avoids a circular import between the two modules
- subscribeToPush() requests VAPID key before calling requestPermission() — if the backend push endpoint is unavailable (e.g., dev without VAPID keys), we skip the browser prompt entirely
- localStorage flag checked alongside Notification.permission === 'default' guard — both conditions must pass for modal to appear

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added notification settings load/save fields that were absent from auth.js**
- **Found during:** Task 2 (pre-commit verification)
- **Issue:** The plan specified populating notif_timing/notif_per_task/notif_daily_summary in both btnShowSettings.onclick and handleSaveSettings, but the initial implementation of auth.js only had the subscribeToPush and event listener — the settings persistence code was missing
- **Fix:** Added 3 notif field population lines in btnShowSettings.onclick; added 3 notif fields to PATCH payload in handleSaveSettings
- **Files modified:** frontend/js/auth.js
- **Verification:** Fields read from getCurrentUser() on modal open; included in payload JSON on save
- **Committed in:** `3f74dae` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (missing critical settings persistence)
**Impact on plan:** Fix was necessary for NOTIF-02 compliance. No scope creep.

## Issues Encountered
None beyond the auto-fixed settings persistence gap.

## User Setup Required
None - notification settings persist automatically once VAPID_PRIVATE_KEY is set (configured in Plan 02).

## Next Phase Readiness
- Phase 11 is complete: PWA manifest + SW (Plan 01), VAPID backend + scheduler (Plan 02), permission modal + settings UI (Plan 03)
- All three NOTIF and INFRA requirements marked complete
- App is ready for end-to-end push notification testing: mark task done → grant permission → receive scheduled Claude WhatsApp-friend message

---
*Phase: 11-push-notifications*
*Completed: 2026-02-23*
