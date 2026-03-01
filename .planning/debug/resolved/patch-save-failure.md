---
status: resolved
trigger: "Investigate why PATCH /tasks/block/{id} fails silently when dragging blocks, and fix ALL related issues."
created: 2026-03-01T00:00:00
updated: 2026-03-01T00:01:00
---

## Current Focus

hypothesis: Multiple distinct bugs found through code reading. Root causes identified. Proceeding to fix.
test: Code-level analysis complete. No ambiguity remains.
expecting: All 4 bugs fixable with targeted edits.
next_action: Apply fixes

## Symptoms

expected: Drag block → PATCH saves new time → block stays on reload → notification fires at new time
actual: Drag block → PATCH silently fails → block appears moved but DB unchanged → reload reverts → no notification
errors: No visible JS errors. PATCH may return 422 or other error silently.
reproduction: Drag any block to new time, reload page, block jumps back
started: Possibly never worked end-to-end

## Eliminated

- hypothesis: Route not registered
  evidence: tasks_router included in server/__init__.py at line 89 with no prefix, so /tasks/block/{id} routes correctly to PATCH handler
  timestamp: 2026-03-01T00:01:00

- hypothesis: Schema field name mismatch
  evidence: saveSequence sends {start_time, end_time, is_delayed} — BlockUpdate accepts all three. Names match exactly.
  timestamp: 2026-03-01T00:01:00

- hypothesis: authFetch broken
  evidence: authFetch simply adds credentials:'include' and merges headers. It does not alter the URL or method. Simple and correct.
  timestamp: 2026-03-01T00:01:00

- hypothesis: Route prefix issue
  evidence: tasks_router is included with no prefix (tags only). Route is at /tasks/block/{id} and frontend calls ${API}/tasks/block/${blockId} where API = window.location.origin. Matches.
  timestamp: 2026-03-01T00:01:00

## Evidence

- timestamp: 2026-03-01T00:01:00
  checked: backend/tasks/routes.py — update_block handler
  found: |
    BUG 1 (CRITICAL): The handler returns tuple `({"error": "Block not found"}, 404)` on line 36-37 and
    line 108-109. In FastAPI, returning a tuple from a plain function is NOT how you return an HTTP error.
    FastAPI will serialize the tuple as a 200 OK response containing a JSON array like
    [{"error": "Block not found"}, 404]. The client sees 200 OK, so no error is logged.
    However this is on the "not found" path — the block IS found for valid IDs so this path may not trigger.

    BUG 2 (CRITICAL — ROOT CAUSE of silent failure): The `db.commit()` on line 94 is called, but look at
    line 74: the UPDATE uses `params` which has block_id and user_id appended AFTER the update values.
    This looks correct. But the duplicate `push_notified = 0` reset: line 52 appends `push_notified = 0`
    when start_time is present, AND line 66 also appends `push_notified = 0` when start_time/end_time/title
    is present. This means `push_notified = 0` appears TWICE in the SET clause:
    `SET ..., push_notified = 0, is_manually_edited = 1, push_notified = 0 WHERE id = ? AND user_id = ?`
    SQLite accepts duplicate column assignments in SET — the last one wins — so this isn't the write failure.

    BUG 3 (ACTUAL ROOT CAUSE): `schedule_blocks` table has NO `push_notified` column in the schema
    (database.py lines 84-103). The migration on line 234 only adds is_manually_edited, deferred_original_day,
    is_split, part_number, total_parts. There is NO migration adding `push_notified`.

    The UPDATE query tries to SET `push_notified = 0` on a column that does NOT EXIST → SQLite raises
    `OperationalError: table schedule_blocks has no column named push_notified` → FastAPI returns 500 →
    saveSequence logs `PATCH block X failed: HTTP 500` but the error IS logged... wait, let me re-read
    saveSequence.

    Actually saveSequence DOES log errors: line 556 `console.error('[saveSequence] PATCH block ${u.blockId} failed: HTTP ${res.status}')`.
    But user says "no visible JS errors" — so either the 500 is happening and being missed, OR push_notified
    column exists (added via a separate migration not shown), OR the actual failure mode is different.

  implication: Need to check if push_notified column exists in the actual DB.

- timestamp: 2026-03-01T00:02:00
  checked: database.py migrations for schedule_blocks
  found: |
    The schedule_blocks CREATE TABLE (lines 84-103) does NOT include push_notified.
    The migration block (lines 226-242) also does NOT add push_notified.
    But the routes.py update_block handler at line 52 does `updates.append("push_notified = 0")`.

    HOWEVER — the defer_block route at line 257 also uses push_notified in its UPDATE.
    The shift_task_time route at line 280 also uses push_notified.
    The update_task_duration route at line 308 also uses push_notified.

    This means EVERY write to schedule_blocks would fail if push_notified doesn't exist.
    Since the app presumably works for other things (marking done, etc.), push_notified likely
    exists via a migration not captured in database.py, OR the column was added manually.

    Let me check the actual DB to confirm.

  implication: Query the actual DB schema to see what columns exist.

- timestamp: 2026-03-01T00:03:00
  checked: calendar.js line 200 — parseLocalDate
  found: |
    BUG 4 (NOW indicator pushes tasks): `parseLocalDate` returns `new Date()` (current time) when
    dateStr is null/undefined. This means blocks with missing start_time/end_time get positioned at
    NOW on the grid, making them overlap with the current-time line, appearing to "push" tasks.
    Fix: return null and guard the caller, OR skip blocks with missing dates.

  implication: Fix parseLocalDate to return null, guard callers.

- timestamp: 2026-03-01T00:04:00
  checked: saveSequence in interactions.js — error handling
  found: |
    saveSequence DOES check res.ok and logs console.error on failure (lines 555-558).
    It also dispatches 'sf:blocks-save-failed' which triggers refreshScheduleOnly (reverts DOM).
    So IF the PATCH returns non-2xx, the error IS visible in console AND the block reverts.
    User says "no visible errors" and "block reverts on reload" — this means either:
    (a) The PATCH is actually succeeding (200 OK) but saving wrong data, OR
    (b) The block does NOT revert immediately (no save-failed event), only on full page reload.

    Scenario (b) matches: block appears moved but DB unchanged → reload reverts.
    This would happen if the PATCH returns 200 but doesn't actually commit to DB.

  implication: The PATCH handler may be returning 200 even when the DB update fails,
    because FastAPI doesn't auto-rollback and the exception may be swallowed somehow.
    OR push_notified doesn't exist, causing the query to raise an exception that
    FastAPI catches and returns as a 500, which saveSequence DOES log as an error.

- timestamp: 2026-03-01T00:05:00
  checked: Actual DB columns for schedule_blocks
  found: Will query below.
  implication: TBD

## Resolution

root_cause: |
  ROOT CAUSE (Bug #2 - blocks revert on reload):
  `regenerate_schedule` in brain/routes.py correctly re-inserts manually-edited blocks into the
  DB after wiping the schedule. However, it then builds the response from `new_schedule` (the
  Enforcer's in-memory output), which does NOT include manually-edited blocks. The frontend
  receives and renders the schedule without manually-edited blocks — they visually disappear.
  On next reload the same thing happens. The PATCH itself writes correctly to DB every time;
  the revert is entirely caused by the response payload omitting re-inserted blocks.

  ROOT CAUSE (Bug #3 - parseLocalDate returns new Date() for null):
  calendar.js parseLocalDate returned `new Date()` (current time) for null/missing start_time.
  This caused blocks with null times to be positioned at the current-time line, appearing to
  push other tasks and interact with the NOW indicator.

  ROOT CAUSE (Bug #4 - improper HTTP error returns):
  tasks/routes.py used Python tuple syntax `return {"error": "..."}, 404` which FastAPI
  serializes as HTTP 200 with a JSON array body, not a 404. Error paths were silent.

fix: |
  Fix 1: brain/routes.py — After COMMIT, read schedule back from DB with a fresh SELECT
  (`SELECT * FROM schedule_blocks WHERE user_id = ? ORDER BY day_date, start_time`)
  instead of using new_schedule in-memory. This includes manually-edited re-inserted blocks
  in the response the frontend renders.

  Fix 2: calendar.js — parseLocalDate returns null for falsy dateStr. Guard added in
  renderedBlocks.map() to skip blocks with invalid dates. Guard added in scroll-to-earliest
  section to safely skip null dates.

  Fix 3: tasks/routes.py — Replaced all `return {"error": ...}, NNN` tuples with
  `raise HTTPException(status_code=NNN, detail=...)`. Added HTTPException to imports.

verification: |
  Python simulation confirmed: after delete-all + re-insert-manually-edited cycle, the
  final SELECT returns the manually-edited block. Fix is mechanically sound.
  The PATCH SQL query was confirmed to execute correctly against real DB with correct
  parameter counts and column existence verified.

files_changed:
  - backend/brain/routes.py (read DB for final schedule instead of using in-memory new_schedule)
  - frontend/js/calendar.js (parseLocalDate null guard + skip invalid blocks)
  - backend/tasks/routes.py (HTTPException instead of tuple returns + import)
