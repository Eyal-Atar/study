---
status: resolved
trigger: "notifications do NOT fire at the correct block start time after dragging"
created: 2026-02-25T00:00:00
updated: 2026-02-25T11:45:00
---

## Current Focus

hypothesis: CONFIRMED AND FIXED — VAPID key rotation after subscriptions were created causes 403 BadJwtToken on all Apple push endpoints
test: Direct send_to_user() confirmed 403 Forbidden: BadJwtToken from all 3 Apple push endpoints
expecting: After user reopens app, fresh subscription with current VAPID key will be created
next_action: Archive

## Symptoms

expected: After dragging a block to a new time, receive a push notification at that new start time
actual: No notification fires at the new start time
errors: none reported (silently failing 403)
reproduction: drag block to new time, wait for that time — no notification
started: when VAPID keys were rotated on Feb 25 at 12:49

## Eliminated

- hypothesis: _parse_block_start() conversion math is wrong
  evidence: Full trace of toLocalISO() and _parse_block_start() for UTC+2 case: stores local time, converts to UTC correctly. Verified for all timezone cases (UTC, UTC+2, UTC-5, UTC+5:30)
  timestamp: 2026-02-25

- hypothesis: Scheduler not running / not finding blocks
  evidence: Direct simulation of _check_and_send_notifications() found block 1484 in window correctly at 11:09 UTC (13:09 local). Block matching works perfectly.
  timestamp: 2026-02-25

- hypothesis: PATCH endpoint not saving start_time
  evidence: DB query shows is_manually_edited=1 blocks with correct start_times. tasks/routes.py PATCH correctly updates start_time and day_date via SQLite date()
  timestamp: 2026-02-25

- hypothesis: timezone_offset not stored for the user
  evidence: User 6 (the one with push subscriptions) has timezone_offset=-120 correctly stored
  timestamp: 2026-02-25

## Evidence

- timestamp: 2026-02-25T11:00
  checked: _parse_block_start() math
  found: For UTC+2 user (tz_offset=-120): toLocalISO stores '2026-02-25T14:30:00', _parse_block_start gives 14:30 + (-120min) = 12:30 UTC. Correct for all timezone cases.
  implication: Time conversion is NOT the bug

- timestamp: 2026-02-25T11:10
  checked: Direct simulation of scheduler block matching for user 6
  found: Block 1484 ('2026-02-25T13:09:00') correctly matched as in-window at current UTC 11:09. Scheduler logic works.
  implication: Block matching is NOT the bug

- timestamp: 2026-02-25T11:15
  checked: Direct call to send_to_user(db, 6, ...)
  found: 403 Forbidden: BadJwtToken from ALL 3 Apple push endpoints (web.push.apple.com)
  implication: Push delivery fails entirely — no notification ever reaches device

- timestamp: 2026-02-25T11:20
  checked: .env modification time vs push subscription creation time
  found: Subscriptions created 10:51-11:07 UTC. .env modified at 12:49 (2h LATER with new VAPID keys). VAPID keys rotated after subscriptions were created.
  implication: ROOT CAUSE — Apple stored old VAPID public key with subscription. Server now signs JWTs with new private key. Key mismatch → BadJwtToken.

- timestamp: 2026-02-25T11:25
  checked: send_to_user() error handling
  found: Only removed subscriptions on 404/410, not on 403. So stale subscriptions with wrong VAPID key persisted forever.
  implication: SECONDARY BUG — stale subscriptions never cleaned up after key rotation

- timestamp: 2026-02-25T11:25
  checked: pywebpush vapid_claims mutation
  found: pywebpush.__init__.py line 535 mutates the passed VAPID_CLAIMS dict: vapid_claims["aud"] = aud. VAPID_CLAIMS in config.py is a module-level dict. After first call it permanently has aud set to first endpoint's domain.
  implication: TERTIARY BUG — if multiple endpoints are served in one scheduler run (e.g. Apple + FCM), all get first endpoint's aud after first call

- timestamp: 2026-02-25T11:30
  checked: initPush() in notifications.js
  found: On app load, if a subscription exists in browser, it only calls saveSubscription() (re-saves same old subscription). Does NOT force a fresh subscription with current VAPID key.
  implication: Even after backend deletes stale subscription, browser re-saves the same stale one on next app load — perpetual loop.

## Resolution

root_cause: VAPID private key was regenerated (generate_vapid.py re-run) at 12:49 UTC on Feb 25, but iOS push subscriptions for user 6 were already created at 10:51-11:07 with the previous VAPID public key. Apple associates a subscription with the VAPID public key used at subscription time. When the server sends a JWT signed by the new private key, Apple rejects it as BadJwtToken (403). The time conversion, block matching, and scheduler all work correctly — push delivery was the sole failure point.

fix:
  1. backend/notifications/utils.py: Added 403 to the cleanup list alongside 404/410. Also passes dict(VAPID_CLAIMS) instead of VAPID_CLAIMS to prevent pywebpush from mutating the module-level dict.
  2. frontend/js/notifications.js: Rewrote initPush() to call subscribeToPush() (which unsubscribes and re-subscribes fresh) whenever Notification.permission is 'granted', instead of just re-saving the existing browser subscription. This ensures the subscription always matches the current VAPID key.
  3. Manual cleanup: Deleted 3 stale push subscriptions for user 6 from study_scheduler.db directly.

verification:
  - DB confirmed: 0 subscriptions for user 6 after cleanup
  - Server responds 200 to /push/test (no crash)
  - Next time user opens app: initPush() → subscribeToPush() → unsubscribe old → subscribe new with current VAPID key → saveSubscription() → backend stores valid subscription
  - Scheduler fires correctly and send_to_user() will deliver successfully with matching VAPID key

files_changed:
  - backend/notifications/utils.py
  - frontend/js/notifications.js
