---
phase: 11-push-notifications
plan: "02"
subsystem: backend-notifications
tags: [push-notifications, vapid, apscheduler, pywebpush, claude-ai, web-push]
dependency_graph:
  requires:
    - "11-01 (PWA foundation / service worker)"
  provides:
    - "POST /push/subscribe — stores PushSubscription JSON per user"
    - "GET /push/vapid-public-key — serves VAPID public key to browser"
    - "DELETE /push/subscribe — opt-out endpoint"
    - "APScheduler cron (every 1 min) — sends push via pywebpush with Claude-generated message"
  affects:
    - "backend/users table (push_subscription, notif_timing, notif_per_task, notif_daily_summary)"
    - "FastAPI startup lifecycle (scheduler start/stop)"
tech_stack:
  added:
    - "pywebpush>=2.0.0 — Web Push Protocol implementation"
    - "apscheduler>=3.10.0 — BackgroundScheduler for cron jobs"
  patterns:
    - "Domain-driven module: backend/notifications/ with __init__.py, routes.py, scheduler.py"
    - "FastAPI @app.on_event startup/shutdown for scheduler lifecycle"
    - "SQLite migration via PRAGMA table_info + conditional ALTER TABLE"
    - "Claude claude-3-haiku-20240307 for WhatsApp-style notification message generation"
    - "Graceful fallback: if Claude fails, default message used; if VAPID not set, push silently skipped"
key_files:
  created:
    - backend/notifications/__init__.py
    - backend/notifications/routes.py
    - backend/notifications/scheduler.py
    - scripts/generate_vapid.py
  modified:
    - backend/requirements.txt
    - backend/server/database.py
    - backend/users/schemas.py
    - backend/server/__init__.py
decisions:
  - "VAPID keys generated via py_vapid (Vapid01) rather than pywebpush.Vapid — matches installed library API"
  - "Claude model selected: claude-3-haiku-20240307 (fast/cheap for frequent notification messages)"
  - "Scheduler timing: interval(minutes=1) — matches 1-minute window logic for notif_timing offsets"
  - "Startup/shutdown via @app.on_event (not lifespan context manager) — matches existing codebase pattern"
  - "No notification sent unless VAPID_PRIVATE_KEY is set — safe default for development"
metrics:
  duration: "3 min"
  completed: "2026-02-23"
  tasks_completed: 2
  files_changed: 8
---

# Phase 11 Plan 02: Push Notification Backend Engine Summary

**One-liner:** VAPID Web Push backend with pywebpush, subscribe/unsubscribe endpoints, and a 1-minute APScheduler cron that calls Claude (WhatsApp-friend persona) and fires push notifications for upcoming study blocks.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | DB migration, VAPID setup, POST /push/subscribe endpoint | ab49b99 | backend/notifications/routes.py, backend/server/database.py, backend/users/schemas.py, backend/requirements.txt, scripts/generate_vapid.py |
| 2 | APScheduler cron job with Claude WhatsApp-friend message generation | dcb4f87 | backend/notifications/scheduler.py, backend/server/__init__.py |

## What Was Built

### Task 1: Infrastructure and Subscribe Endpoint
- Added `pywebpush>=2.0.0` and `apscheduler>=3.10.0` to requirements.txt (already installed in .venv)
- Added DB migration in `database.py` for 4 new columns on `users` table: `push_subscription TEXT`, `notif_timing TEXT DEFAULT 'at_start'`, `notif_per_task INTEGER DEFAULT 1`, `notif_daily_summary INTEGER DEFAULT 0`
- Updated `UserResponse` and `UserUpdate` schemas in `users/schemas.py` with the new fields
- Created `backend/notifications/__init__.py` (empty module marker)
- Created `backend/notifications/routes.py` with:
  - `GET /push/vapid-public-key` — returns VAPID public key for browser subscription
  - `POST /push/subscribe` — stores PushSubscription JSON blob in users table
  - `DELETE /push/subscribe` — clears the subscription (opt-out)
- Registered `notifications_router` in `server/__init__.py`
- Created `scripts/generate_vapid.py` for one-time VAPID key generation (keys already in `backend/.env`)

### Task 2: APScheduler Cron with Claude Message Generation
- Created `backend/notifications/scheduler.py` (136 lines):
  - `_generate_message()` — calls Claude `claude-3-haiku-20240307` with a WhatsApp-friend sarcastic prompt, falls back to default message on error
  - `_send_push()` — calls `pywebpush.webpush()` with VAPID credentials, handles `WebPushException` gracefully
  - `_check_and_send_notifications()` — runs every minute: queries users with push subscriptions, finds study blocks in the timing window (at_start / 15_before / 30_before), calls Claude, sends push
  - `start_scheduler()` — creates and starts `BackgroundScheduler` with a 1-minute interval job
- Wired into `server/__init__.py`:
  - `from notifications.scheduler import start_scheduler`
  - `_scheduler = None` module-level state
  - `@app.on_event("startup")` → `init_db()` + `start_scheduler()`
  - `@app.on_event("shutdown")` → `_scheduler.shutdown()` if running

## Verification Results

1. `python -c "import pywebpush; import apscheduler; print('deps OK')"` → "deps OK"
2. `GET /push/vapid-public-key` → `{"key": "BFv1rzkUXAh4k7v6Y7fOl526spzSU9JFcfYHSAhNFU_D-WRJdquLkXvili0q3n6nbvctpRVP-lTy6zU3BC3iBOU"}` (non-empty key)
3. Server started with "Application startup complete" — no crash, scheduler wired in
4. Push routes registered: `/push/vapid-public-key`, `/push/subscribe` in OpenAPI spec
5. DB migration verified: `push_subscription`, `notif_timing`, `notif_per_task`, `notif_daily_summary` columns present in `users` table
6. `scheduler.py` syntax check passed, 136 lines (min required: 60), all required patterns present (anthropic, messages.create, webpush())

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] VAPID key generation used py_vapid instead of pywebpush.Vapid**
- **Found during:** Task 1 (pre-existing in generate_vapid.py)
- **Issue:** Plan proposed `from pywebpush import Vapid` but installed library uses `from py_vapid import Vapid01` API
- **Fix:** `generate_vapid.py` already uses `from py_vapid import Vapid01` which is the correct API for the installed version
- **Files modified:** scripts/generate_vapid.py (pre-existing correct implementation)
- **Commit:** ab49b99

**2. [Observation] Task 1 was largely pre-existing**
- Task 1 files (routes.py, __init__.py, DB migration, schemas, requirements.txt, generate_vapid.py, VAPID keys in .env) were already implemented in a prior session before this plan execution. Committed as part of this plan for proper tracking.

## Auth Gates

None encountered. VAPID keys were pre-generated and present in `backend/.env`.

## Self-Check: PASSED

Files created:
- backend/notifications/__init__.py: FOUND
- backend/notifications/routes.py: FOUND
- backend/notifications/scheduler.py: FOUND
- scripts/generate_vapid.py: FOUND

Commits:
- ab49b99: FOUND (feat(11-02): DB migration, VAPID setup, and POST /push/subscribe endpoint)
- dcb4f87: FOUND (feat(11-02): APScheduler cron job with Claude WhatsApp-friend message generation)
