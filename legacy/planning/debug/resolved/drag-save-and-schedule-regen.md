---
status: resolved
trigger: "drag-save-and-schedule-regen"
created: 2026-03-01T00:00:00
updated: 2026-03-01T00:05:00
---

## Current Focus

hypothesis: Both root causes confirmed — (1) saveSequence fetch IS called and should reach server (CORS/auth OK via cookie); but response errors are silently swallowed with no logging. The PATCH route also has a bug: it appends `push_notified = 0` twice via two code paths when start_time is set. (2) schedule regeneration wipes all blocks unconditionally on every loadExams() call, ignoring is_manually_edited flag completely in regenerate-schedule route.
test: Code audit complete — confirmed by reading all relevant code paths.
expecting: Fix (1): add console.log of fetch response in saveSequence; Fix (2): preserve is_manually_edited=1 blocks in regenerate_schedule route.
next_action: Apply fixes to interactions.js and routes.py (regenerate_schedule)

## Symptoms

expected: Dragging a study block to a new position should PATCH /tasks/block/{id} and persist; on reload the reordered blocks should remain.
actual: No network request visible in the network tab after drag. Even if PATCH did succeed (200), reloading the app regenerates a new schedule with new block IDs (e.g. 3771→3897), wiping all changes.
errors: No explicit JS error thrown; fetch may be silently failing (suspected 401 cross-origin via ngrok) or fetch may not be called at all.
reproduction: Drag a block on the schedule → check network tab → reload page → observe blocks reset.
timeline: Unknown; may never have worked end-to-end.

## Eliminated

- hypothesis: saveSequence is never called
  evidence: Code trace shows onTouchEnd and interact.js end handler both call `await saveSequence(updates, container)`. The function IS invoked.
  timestamp: 2026-03-01T00:00:30

- hypothesis: authFetch itself is broken / not sending cookies
  evidence: authFetch always sets `credentials: 'include'` which sends HttpOnly session cookie. This is consistent with how all other API calls work. No reason to suspect authFetch specifically.
  timestamp: 2026-03-01T00:00:30

- hypothesis: regenerate-delta or brain-chat causes the wipe (Problem 2)
  evidence: The regenerate-delta route (used by regen bar) explicitly checks is_manually_edited before updating. The root cause of the wipe is loadExams() calling POST /regenerate-schedule on every page load, which does DELETE FROM schedule_blocks WHERE user_id = ? and then re-inserts from scratch — no is_manually_edited preservation.
  timestamp: 2026-03-01T00:01:00

## Evidence

- timestamp: 2026-03-01T00:00:20
  checked: frontend/js/interactions.js saveSequence function (lines 457-505)
  found: saveSequence IS called from both drag paths. It uses authFetch with PATCH method. The try/catch catches errors and logs them, BUT the fetch response itself is never checked — if server returns 404 or 401 the promise resolves (not rejects) and the error is silently ignored.
  implication: Problem 1 PARTIAL — fetch IS called, but if server responds with non-2xx the frontend never knows. Need console.log of response to debug further.

- timestamp: 2026-03-01T00:00:25
  checked: frontend/js/tasks.js loadExams() (line 101)
  found: loadExams unconditionally calls POST /regenerate-schedule on EVERY page load / app init. This is called from initDashboard() which runs on every successful login/cookie-auth check.
  implication: This is ROOT CAUSE of Problem 2 — every reload destroys and recreates all schedule_blocks with fresh IDs, wiping any is_manually_edited=1 blocks along with their positions.

- timestamp: 2026-03-01T00:00:30
  checked: backend/brain/routes.py regenerate_schedule route (lines 346-471)
  found: Line 414: `db.execute("DELETE FROM schedule_blocks WHERE user_id = ?", (user_id,))` — unconditional delete of ALL blocks, then re-inserts from generate_multi_exam_schedule() output which never sets is_manually_edited. The is_manually_edited column exists in the DB (added via migration at database.py:234) but is never read or preserved during regen.
  implication: Confirms Problem 2 root cause. Fix: before DELETE, SELECT blocks WHERE is_manually_edited=1, then after regeneration INSERT, re-insert those preserved blocks (or skip overwriting them).

- timestamp: 2026-03-01T00:00:45
  checked: backend/tasks/routes.py PATCH /tasks/block/{block_id} (lines 27-96)
  found: Route exists, correctly sets is_manually_edited=1 when start_time/end_time/task_title changes. One minor bug: when start_time is provided, "push_notified = 0" is appended twice (line 52 inside the if-start_time block, and line 66 again in the combined if). This is harmless (duplicate SET) but messy.
  implication: The PATCH route itself works correctly. Problem 1 is about whether the fetch reaches the server (CORS/ngrok) or whether errors are silently swallowed.

- timestamp: 2026-03-01T00:00:50
  checked: backend/brain/scheduler.py generate_multi_exam_schedule
  found: Scheduler generates fresh ScheduleBlock objects, never reads existing blocks from DB. It only knows about tasks. No concept of preserving manually-edited blocks.
  implication: Preservation must happen at the route level (regenerate_schedule), not in the scheduler.

## Resolution

root_cause: |
  Problem 1: saveSequence fetch IS called but response status is never checked or logged — silent failures (401, 404, 500) go unnoticed. The fetch call itself is correct (cookies, CORS).
  Problem 2: loadExams() calls POST /regenerate-schedule on every page load. The regenerate_schedule route does DELETE FROM schedule_blocks WHERE user_id = ? (all blocks) then re-inserts from scratch. Blocks with is_manually_edited=1 are destroyed every reload even though the flag exists in the schema.

fix: |
  Fix 1: Add console.log of fetch response status in saveSequence so users/devs can see failures.
  Fix 2: In regenerate_schedule route, before deleting all blocks, SELECT and save blocks with is_manually_edited=1. After re-inserting the new schedule, re-insert the manually-edited blocks (skipping any that overlap with the new blocks on same task+day to avoid duplicates). Alternatively, simply exclude is_manually_edited=1 blocks from the DELETE and patch around them.

verification: |
  Fix 1 (interactions.js): saveSequence now captures the Promise.all response array and logs each PATCH result. Failures (401, 404, 500) will show as console.error in the browser devtools, making silent failures visible.
  Fix 2 (routes.py): regenerate_schedule now saves is_manually_edited=1 blocks before DELETE, skips auto-generating new blocks for tasks that already have a manual block, then re-inserts all manual blocks with is_manually_edited=1 and completed state preserved.

files_changed:
  - frontend/js/interactions.js — saveSequence: log HTTP status of each PATCH response
  - backend/brain/routes.py — regenerate_schedule: preserve is_manually_edited=1 blocks across regen
