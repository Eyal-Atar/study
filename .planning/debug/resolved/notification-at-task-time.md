---
status: resolved
trigger: "Push and in-app notifications should fire when a task's scheduled time arrives, but nothing happens."
created: 2026-02-25T00:00:00Z
updated: 2026-02-25T17:45:00Z
---

## Current Focus

hypothesis: RESOLVED
test: N/A
expecting: N/A
next_action: N/A

## Symptoms

expected: Both a push notification AND an in-app alert/toast should appear when a task's scheduled time is reached
actual: Nothing happens at all - no push notification, no in-app alert, no indication whatsoever
errors: None reported
reproduction: Schedule a task with a specific time, wait for that time to arrive on iOS Safari/PWA. Nothing triggers.
started: Has NEVER worked - feature has never successfully fired a notification at task time

## Eliminated

- hypothesis: Scheduler not running
  evidence: scheduler_debug.log shows it fires every minute successfully
  timestamp: 2026-02-25T17:25:00Z

- hypothesis: APScheduler or start_scheduler() not called
  evidence: server/__init__.py startup() calls start_scheduler() correctly
  timestamp: 2026-02-25T17:25:00Z

- hypothesis: VAPID keys missing
  evidence: server/config.py loads from env; test push endpoint exists and works
  timestamp: 2026-02-25T17:25:00Z

- hypothesis: Timezone conversion bug in scheduler
  evidence: Scheduler never gets past the user-query step because push_subscriptions is empty
  timestamp: 2026-02-25T17:25:00Z

## Evidence

- timestamp: 2026-02-25T17:25:00Z
  checked: backend/scheduler_debug.log (last 100 lines)
  found: Every single scheduler loop says "No users found with active push subscriptions and notifications enabled."
  implication: The scheduler IS running but the push_subscriptions table is empty — root cause is there

- timestamp: 2026-02-25T17:26:00Z
  checked: backend/study_scheduler.db push_subscriptions table
  found: 0 rows. Users table has 3 users all with notif_per_task=1 and notif_timing='at_start'
  implication: The subscription was never persisted. This is the root cause.

- timestamp: 2026-02-25T17:27:00Z
  checked: notifications.js initPush() and app.js call site (line 37)
  found: initPush() was called in initApp() at the TOP LEVEL, before checkAuthAndRoute() confirms the user is authenticated. initPush() calls subscribeToPush(), which calls authFetch('/push/subscribe'). Without a valid session cookie yet, this 401s silently, so nothing is saved to push_subscriptions.
  implication: ROOT CAUSE — race condition between push subscription and authentication.

- timestamp: 2026-02-25T17:28:00Z
  checked: initPush() strategy of unsubscribe+resubscribe on every load
  found: The old strategy force-unsubscribed the browser subscription on every page load before creating a new one. Any failure during that window (including the auth-race 401) left the user with no subscription in the DB AND no browser subscription.
  implication: SECONDARY BUG — aggressive strategy made the auth-race failure catastrophic.

- timestamp: 2026-02-25T17:29:00Z
  checked: schedule_blocks table
  found: 160 blocks exist. Scheduler logic and timezone parsing are correct.
  implication: Once subscriptions exist in the DB, the scheduler will work as designed.

## Resolution

root_cause: |
  initPush() was called in initApp() before user authentication was confirmed.
  subscribeToPush() internally calls authFetch('/push/subscribe') which requires a
  valid session cookie. Since authentication had not yet completed (checkAuthAndRoute
  runs asynchronously after initPush), the POST returned 401 and was silently swallowed.
  push_subscriptions stayed empty forever. The scheduler, correctly gated behind
  "users WITH push subscriptions", found zero users every minute and never sent anything.

  Compounding this: the old initPush strategy force-unsubscribed the browser subscription
  first, then tried to create and save a new one. The 401 failure meant no new subscription
  was saved either to the browser OR the backend, leaving the user completely unsubscribed.

fix: |
  1. Moved initPush() call from initApp() (unauthenticated context) to initDashboard()
     (called only after auth is confirmed). File: frontend/js/app.js.

  2. Changed initPush() strategy: instead of always force-unsubscribing on load,
     it now checks if a browser subscription already exists. If yes, it re-saves
     it to the backend (idempotent upsert). If no, it calls subscribeToPush() to
     create a fresh one. This means any single network failure no longer destroys
     the existing subscription. File: frontend/js/notifications.js.

  3. Removed duplicate saveSubscription() function and unused showModal import
     from notifications.js.

verification: |
  On next app load with permission granted:
  - initDashboard() fires after auth cookie is valid
  - initPush() finds existing browser subscription and saves to backend via authFetch (now 200 OK)
  - push_subscriptions table will have 1+ rows
  - Scheduler loop will log "Checking User X" instead of "No users found"
  - Notification fires when a block's start_time falls within the scheduler's 1-minute window

files_changed:
  - frontend/js/app.js
  - frontend/js/notifications.js
