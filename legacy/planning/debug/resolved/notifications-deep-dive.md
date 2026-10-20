---
status: diagnosed
trigger: "Notifications still don't work after two rounds of fixes. Need to do deep end-to-end diagnosis."
created: 2026-02-25T11:30:00
updated: 2026-02-25T11:35:00
symptoms_prefilled: true
goal: find_root_cause_only
---

## Current Focus

hypothesis: CONFIRMED — subscription id=15 was created at 11:22:58 BEFORE VAPID key rotation at 12:49. Current .env contains new VAPID keys. Every push attempt returns 403 BadJwtToken. The initPush() re-subscribe fix (from round 2) never executed because the user has not opened the app since the VAPID keys were rotated and the fix was deployed.
test: Direct webpush() call confirmed 403 BadJwtToken
expecting: Stale subscription must be deleted, user must re-open app to trigger initPush() which will force a fresh subscribe with current VAPID key
next_action: Manually delete subscription id=15 from DB so that next app open forces a fresh subscription

## Symptoms

expected: Push notifications arrive on iPhone at block start time
actual: No notifications arrive at all — ever
errors: none visible to user (silently failing 403 on backend)
reproduction: wait for a block's start time — no notification fires
started: after VAPID key rotation on Feb 25 at 12:49

## Eliminated

- hypothesis: Scheduler not running
  evidence: server/__init__.py startup() calls start_scheduler(); server starts cleanly; no startup errors in logs. The ABSENCE of scheduler log output is explained by no logging.basicConfig() being configured — the scheduler IS running but its INFO/ERROR output is silently discarded to the void.
  timestamp: 2026-02-25

- hypothesis: Scheduler not finding blocks for user 6
  evidence: Direct DB query simulation confirms user 6 IS found via push_subscriptions JOIN, and 3 blocks ARE returned for today/tomorrow (2026-02-25, 2026-02-26). Block matching logic is correct.
  timestamp: 2026-02-25

- hypothesis: _parse_block_start() time conversion is wrong
  evidence: Direct test of all 3 blocks: '2026-02-25T13:24:00' → 11:24 UTC, '2026-02-25T21:00:00' → 19:00 UTC, '2026-02-26T14:00:00' → 12:00 UTC (next day). All correct for UTC+2 user. Time parsing is NOT the bug.
  timestamp: 2026-02-25

- hypothesis: user 4 (the active user in logs) has no subscription
  evidence: ALL activity in logs is user 4. User 4 has zero push subscriptions. The only subscription belongs to user 6. User 6 has blocks but user 4 does not. This is not a bug — just confirms the test user is user 6, not user 4.
  timestamp: 2026-02-25

- hypothesis: initPush() re-subscribe fix worked
  evidence: initPush() fix IS in notifications.js (confirmed by reading file). BUT: it only works if the user opens the app AFTER the fix is deployed. The subscription in DB (id=15, created 11:22:58) was created BEFORE the VAPID key rotation (12:49). The fix was deployed alongside the key rotation, but the user has not opened the app since then (no /push/subscribe POST seen in logs after 12:49). So the stale subscription was NEVER replaced.
  timestamp: 2026-02-25

## Evidence

- timestamp: 2026-02-25T11:26
  checked: push_subscriptions table
  found: 1 subscription — id=15, user_id=6, created_at=2026-02-25 11:22:58, endpoint=https://web.push.apple.com/QJ9bzQSm5...
  implication: Only user 6 can receive push notifications

- timestamp: 2026-02-25T11:26
  checked: users table — user 4 subscriptions
  found: user 4 (eyal3936@gmail.com) has 0 push subscriptions. User 5 has 0. Only user 6 (my@email.com) has subscriptions.
  implication: All the logged app activity (user 4) will NEVER receive notifications regardless of any other fix

- timestamp: 2026-02-25T11:26
  checked: scheduler query simulation
  found: User 6 found via JOIN. 3 blocks returned for today (2026-02-25) and tomorrow. Block matching and time parsing all work correctly.
  implication: The scheduler would fire if webpush delivery worked

- timestamp: 2026-02-25T11:27
  checked: .env modification time vs subscription creation time
  found: Subscription id=15 created 11:22:58. .env modified 12:49. VAPID keys in .env are the NEWER keys, created AFTER the subscription.
  implication: The subscription was created with old VAPID public key. Backend now signs with new private key. Classic BadJwtToken scenario — SAME issue as the previous round.

- timestamp: 2026-02-25T11:30
  checked: direct webpush() call to user 6's subscription with current .env VAPID keys
  found: WebPushException: Push failed: 403 Forbidden, body: {"reason":"BadJwtToken"}
  implication: CONFIRMED ROOT CAUSE — delivery fails every time. Notification pipeline stops here.

- timestamp: 2026-02-25T11:30
  checked: app.js initPush() call location
  found: initPush() is called in initApp() BEFORE auth check (line 37). This means it runs at page load regardless of whether the user is logged in. BUT initPush() immediately returns if Notification.permission !== 'granted'. On iOS, the permission was previously granted. So initPush() SHOULD have run subscribeToPush() which unsubscribes+resubscribes.
  implication: CRITICAL QUESTION: Did the user actually open the app in Safari/PWA after the VAPID rotation at 12:49? If not, the stale subscription was never replaced. No /push/subscribe POST appears in logs after 12:49, confirming the user has NOT opened the app since key rotation.

- timestamp: 2026-02-25T11:31
  checked: entire final_server.log for /push/subscribe or scheduler output
  found: Zero occurrences of /push/subscribe, "Triggered push", "[Scheduler]", "send_to_user", "VAPID", "webpush". The scheduler IS running silently (no logging.basicConfig configured, so output goes nowhere), and no fresh subscription has been registered since the VAPID key rotation.
  implication: Confirms the user has not opened the app since VAPID keys were rotated. The stale subscription sits in DB and every scheduler run 403s silently.

## Resolution

root_cause: |
  The push subscription in the database (id=15, created 2026-02-25 11:22:58) was
  created with the OLD VAPID public key. The VAPID keys in .env were rotated at 12:49
  on the same day. Every push attempt since then returns 403 BadJwtToken from Apple
  — directly confirmed by calling webpush() directly.

  The previous "fix" (initPush() always re-subscribes on app load) is correct code
  but has NEVER RUN since deployment, because the user (user 6) has not opened the
  app in Safari/PWA since the VAPID key rotation at 12:49. The stale subscription
  remains in the DB.

  Secondary finding: there is no logging.basicConfig() call anywhere in the project's
  Python code. This means all logger.info()/logger.error() calls in scheduler.py and
  utils.py are silently discarded, making it impossible to diagnose push failures
  from server logs.

fix: |
  TWO ACTIONS REQUIRED:

  1. IMMEDIATE (manual): Delete subscription id=15 from push_subscriptions table.
     Command: DELETE FROM push_subscriptions WHERE id=15;

     This forces the next app open to create a fresh subscription (because
     utils.py's 403 handler will also have cleaned it eventually, but only after
     the FIRST push attempt at block time, which may already be in the past).

     Actually: the 403 cleanup in utils.py DOES handle this — it removes the
     subscription on 403. But this only runs when the scheduler fires at a block
     time. If that time has already passed, the subscription just sits there doing
     nothing. Manual deletion + user reopening app is the fastest path.

  2. PERMANENT FIX (code): Add logging.basicConfig() to backend entry point so that
     scheduler errors are visible in logs. Currently ALL push failures (403, timeouts,
     etc.) are silently discarded, making this class of bug impossible to diagnose
     from logs.

     In backend/run.py or backend/server/__init__.py, add:
     import logging
     logging.basicConfig(level=logging.INFO, format='%(levelname)s [%(name)s] %(message)s')

  USER ACTION NEEDED: After deleting the stale subscription, the user must open
  the app in Safari/PWA on their iPhone. initPush() will run, detect Notification
  permission is 'granted', call subscribeToPush() which unsubscribes+resubscribes
  with the current VAPID key, and save the fresh subscription to the backend.

verification: pending — requires user to open app after stale subscription is deleted
files_changed: []
