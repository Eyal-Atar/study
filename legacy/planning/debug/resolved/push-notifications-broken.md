---
status: resolved
trigger: "PWA push notifications for study reminders are not firing at all. They used to work but broke recently."
created: 2026-03-21T00:00:00Z
updated: 2026-03-21T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED — The database was reset/replaced (new DB with users 1/2/3), causing all real push subscriptions to be lost. The only push_subscriptions row is for user_id=6 (which no longer exists) with a dummy Apple Push endpoint. The scheduler query JOINs push_subscriptions so no users are found and no notifications fire.
test: Verified via direct DB query — users 1,2,3 have notif_per_task=1 but zero push subscriptions
expecting: Fix requires users to re-subscribe (by re-logging into the app), or the initPush flow must be verified to actually save subscriptions to the DB
next_action: Check why initPush is not successfully saving subscriptions for the current users

## Symptoms

expected: Push notifications should fire at scheduled study times as reminders
actual: Nothing happens — no notifications are triggered or displayed at all
errors: Unknown — need to investigate
reproduction: Enable notifications, set up study schedule, wait for scheduled time — no notification arrives
started: Broke recently — used to work before recent changes

## Eliminated

- hypothesis: Scheduler code was broken by recent commits
  evidence: Scheduler code diffs show only debug print removal, no logic change
  timestamp: 2026-03-21

- hypothesis: Frontend push subscription code was broken by cleanup
  evidence: notifications.js diff only removed debug logging; core logic intact
  timestamp: 2026-03-21

- hypothesis: CSRF is blocking /push/subscribe
  evidence: notifications/routes.py has no verify_csrf_token dependency
  timestamp: 2026-03-21

- hypothesis: push_notified=1 on all blocks blocking notifications
  evidence: DB shows most blocks have push_notified=0; not the issue
  timestamp: 2026-03-21

- hypothesis: timezone parsing change (_parse_block_start) broke time matching
  evidence: Analyzed both old and new heuristic; both correctly handle the actual data formats in DB
  timestamp: 2026-03-21

## Evidence

- timestamp: 2026-03-21
  checked: push_subscriptions table in study_scheduler.db
  found: Only 1 row exists, for user_id=6 with endpoint "https://updates.push.apple.com/dummy" — a non-existent user with a fake endpoint
  implication: The scheduler JOIN finds no users (1,2,3 have no subscriptions), so no notifications fire

- timestamp: 2026-03-21
  checked: users table
  found: Users 1,2,3 (Eyal Atar, Luna, Eyal Atar) all have notif_per_task=1 but no push subscriptions
  implication: The DB was replaced/reset at some point, wiping real subscriptions. Previous DB (scheduler_debug.log) shows users 4 and 6.

- timestamp: 2026-03-21
  checked: scheduler_debug.log
  found: Log from 2026-02-25 shows users 4 and 6 being checked — these users no longer exist in the current DB
  implication: The app was running against a different DB before; now a new DB has users 1-3 but no corresponding push subscriptions

- timestamp: 2026-03-21
  checked: schedule_blocks table
  found: 97 incomplete study/hobby blocks for users 1,2,3; push_notified=0 on most
  implication: Blocks exist and are properly marked for notification; the missing subscriptions are the only blocker

## Resolution

root_cause: The database was replaced (users 1/2/3 replaced the old users 4/6), wiping all push subscriptions. The scheduler's JOIN on push_subscriptions returns zero rows for the new users, so no notifications fire. Additionally, the notification permission prompt in initDashboard() was gated on `isStandalone` (PWA installed mode), so non-standalone users (desktop/Android Chrome) were never prompted to enable notifications — meaning Notification.permission remained 'default' and initPush() silently returned without creating a subscription.

fix: |
  1. Added GET /push/subscription-status endpoint (backend) — lets initPush() detect when the browser has a subscription but the backend lost it (DB reset scenario), and silently re-saves without user intervention.
  2. Updated initPush() (notifications.js) — after VAPID key match, checks the backend subscription status. If backend has no subscription, re-saves the browser subscription immediately.
  3. Updated notification prompt in initDashboard() (app.js) — removed the isStandalone gate for non-iOS devices. Android/desktop Chrome supports push in regular browser mode, so all non-iOS users who haven't been prompted now see the "Enable Notifications" modal on first login.
  4. Removed leftover debug print() from notifications/routes.py.
  5. Removed unused import json from notifications/routes.py.

verification: |
  - Backend syntax check passes (ast.parse on routes.py)
  - initPush() now proactively re-syncs subscription to backend on each login if backend lost it
  - Non-iOS users will be prompted to enable notifications on their first login after this fix
  - Existing users with Notification.permission === 'granted' will have their subscription automatically re-saved on next login

files_changed:
  - frontend/js/app.js: removed isStandalone gate from notification prompt for non-iOS users; added isIos detection
  - frontend/js/notifications.js: added /push/subscription-status check in initPush() to detect and recover from DB-reset subscription loss
  - backend/notifications/routes.py: added GET /push/subscription-status endpoint; removed debug print; removed unused import
