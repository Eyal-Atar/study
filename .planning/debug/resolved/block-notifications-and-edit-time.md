---
status: resolved
trigger: "Three bugs: drag notification not firing, PWA no notification prompt, edit modal shows wrong time"
created: 2026-02-25T00:00:00
updated: 2026-02-25T00:30:00
---

## Current Focus

hypothesis: All three root causes confirmed and fixed
test: Code review + logic trace + Python unit tests
expecting: All three issues resolved
next_action: Archive

## Symptoms

expected_1: Push notification fires when dragged block's new start time arrives
actual_1: No notification fires after drag
expected_2: PWA first-time login shows notification permission prompt
actual_2: No prompt appears
expected_3: Edit modal shows current start time after drag
actual_3: Edit modal shows original (pre-drag) start time

## Eliminated

- hypothesis: Backend scheduler not running
  evidence: scheduler.py is wired via start_scheduler(), runs every minute
  timestamp: 2026-02-25

- hypothesis: Push subscription missing for user
  evidence: saveSubscription() is called on subscribeToPush(); the issue is the notification not finding the block at right time
  timestamp: 2026-02-25

- hypothesis: Edit modal reads from DOM text instead of data object
  evidence: showTaskEditModal reads block object passed in; root issue is WHICH block object
  timestamp: 2026-02-25

## Evidence

- timestamp: 2026-02-25
  checked: brain/scheduler.py time storage convention
  found: Stores start_time as local + tz_offset (UTC) with +00:00 suffix: "2026-02-25T12:30:00+00:00"
  implication: Brain-generated blocks have tz-aware UTC ISO strings

- timestamp: 2026-02-25
  checked: interactions.js saveSequence() + calendar.js handleSaveBlock() toLocalISO()
  found: Drag PATCH stores local time without suffix: "2026-02-25T14:30:00"
  implication: Dragged blocks store LOCAL time not UTC

- timestamp: 2026-02-25
  checked: notifications/scheduler.py _parse_block_start() original code
  found: "T"-format strings assumed UTC (tzinfo=UTC applied directly). "2026-02-25T14:30:00" treated as 14:30 UTC. For UTC+2 user with block at 14:30 local (=12:30 UTC), the window comparison is off by 4h (2 × tz_offset since it's added twice effectively)
  implication: CONFIRMED ROOT CAUSE 1 — notifications never fire for dragged blocks

- timestamp: 2026-02-25
  checked: tasks.js toggleDone() notification prompt trigger
  found: Prompt fires ONLY after first task completion AND Notification.permission==='default'. On fresh PWA install with zero tasks done, no trigger ever runs.
  implication: CONFIRMED ROOT CAUSE 2 — no login-time prompt for PWA

- timestamp: 2026-02-25
  checked: calendar.js double-tap handler + sf:blocks-saved event + _blocksByDay
  found: Double-tap opens edit modal using block from _blocksByDay (live) or dayBlocks (render-time fallback). _blocksByDay is updated ONLY when sf:blocks-saved fires (after PATCH returns). If user double-taps immediately after drag, PATCH hasn't returned yet, so _blocksByDay still has pre-drag time.
  implication: CONFIRMED ROOT CAUSE 3 — race condition: stale time shown when tapping too soon after drag

## Resolution

root_cause_1: notifications/scheduler.py _parse_block_start() incorrectly treated local-format ISO strings (no timezone suffix) as UTC, ignoring the user's timezone_offset. For a UTC+2 user with a block dragged to 14:30 local, the function returned 14:30 UTC instead of 12:30 UTC, causing the notification window check to fail.

root_cause_2: The notification permission modal (modal-notif-permission) had only ONE trigger: the first task completion in tasks.js toggleDone(). For a brand new PWA user who just installed the app and logged in without completing any tasks, no prompt appeared.

root_cause_3: The edit modal's block lookup used _blocksByDay first, then fell back to the render-time dayBlocks snapshot. _blocksByDay is updated asynchronously after the drag PATCH completes. A double-tap immediately after drop uses stale data. The DOM element's style.top is always correct immediately.

fix:
  - backend/notifications/scheduler.py: Rewrote _parse_block_start() to detect timezone-unaware "T" format strings and apply the correct UTC conversion using the user's stored tz_offset_min (UTC = local + tz_offset_min, consistent with brain/scheduler.py convention).
  - frontend/js/app.js: Added PWA-aware notification prompt in initDashboard() that shows modal-notif-permission on first login when running in standalone mode (PWA installed) and permission is 'default'.
  - frontend/js/calendar.js: Double-tap handler now derives start_time/end_time from the block element's current DOM style.top/style.height, which is always updated synchronously after a drag snap, instead of relying on _blocksByDay which may be stale.

verification:
  - Python unit tests confirm all 4 time format variants parse correctly
  - Logic trace confirms drag → DOM update is synchronous; PATCH + sf:blocks-saved is async
  - Logic trace confirms standalone check is correct for iOS PWA and Android TWA

files_changed:
  - backend/notifications/scheduler.py
  - frontend/js/app.js
  - frontend/js/calendar.js
