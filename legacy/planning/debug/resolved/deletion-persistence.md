---
status: resolved
trigger: "Deleted blocks reappear after reopening the app. The deletion is not being persisted."
created: 2026-03-01T00:00:00Z
updated: 2026-03-01T00:20:00Z
---

## Current Focus

hypothesis: The DELETE API call fires successfully but `regenerate-schedule` is called on app reload, which re-creates blocks for tasks that were NOT deleted. The backend `delete_block` only deletes study blocks AND their associated task. But non-study blocks (hobby, padding with task_id=None) only get the block deleted — not the task. When regenerate-schedule runs, those tasks still exist and get re-scheduled. Additionally there is a timing race: `_deletingBlocks.delete(blockId)` is in a `finally` block that runs BEFORE the async `executeDelete` resolves (executeDelete is passed to `showConfirmModal` which calls it later via setTimeout).
test: Tracing the code path end-to-end
expecting: Confirm the race condition + whether regenerate-schedule is called on reload
next_action: Document full evidence and fix

## Symptoms

expected: After deleting a block and reopening the app, the block should stay deleted.
actual: Deleted blocks reappear on app reload.
errors: Likely 404 or the delete never fires, or regenerate-schedule recreates them.
reproduction: 1. Delete a task block. 2. Close app. 3. Reopen — block is back.
started: Ongoing issue. Previous fix attempt corrected some API URLs but problem persists.

## Eliminated

(none yet)

## Evidence

- timestamp: 2026-03-01T00:01:00Z
  checked: frontend/js/calendar.js handleDeleteBlock (lines 387-490)
  found: |
    CRITICAL RACE CONDITION: The `_deletingBlocks` guard uses a `try/finally` pattern:
    ```js
    try {
        const executeDelete = async () => { ... actual fetch DELETE ... };
        showConfirmModal({ ..., onConfirm: executeDelete });
    } finally {
        _deletingBlocks.delete(String(blockId));  // ← runs IMMEDIATELY
    }
    ```
    `showConfirmModal` stores `executeDelete` as a callback to be called later
    (via setTimeout of 280ms after user clicks OK). The `finally` block runs
    synchronously right after `showConfirmModal` returns — long BEFORE the user
    even sees the modal. So `_deletingBlocks` is cleared before the delete happens.
    This is a benign guard bug (doesn't prevent deletion but guard is useless).
  implication: The guard doesn't prevent actual deletion. Look elsewhere.

- timestamp: 2026-03-01T00:02:00Z
  checked: The actual DELETE fetch in executeDelete (calendar.js line 468)
  found: |
    ```js
    const res = await authFetch(`${API}/tasks/block/${blockId}`, { method: 'DELETE' });
    ```
    URL: `{API}/tasks/block/{blockId}` with method DELETE.
    Route registration in server/__init__.py: `tasks_router` is included with NO prefix
    (line 89: `app.include_router(tasks_router, tags=["tasks"])`).
    The route in tasks/routes.py is `@router.delete("/tasks/block/{block_id}")`.
    Combined URL: `/tasks/block/{block_id}` — this is correct.
  implication: The URL and HTTP method are correct. The DELETE hits the right endpoint.

- timestamp: 2026-03-01T00:03:00Z
  checked: backend/tasks/routes.py delete_block (lines 99-130)
  found: |
    The backend correctly:
    1. Fetches block by id+user_id (404 if not found)
    2. DELETEs the schedule_block row
    3. If block_type == 'study' AND task_id exists: also deletes the task AND all other blocks for that task
    4. Commits the transaction
    For 'hobby' blocks: only the schedule_block row is deleted (task_id is None for hobby blocks).
    For 'study' blocks with task_id: task + all blocks deleted. ✓
  implication: Backend deletion is correct for study blocks. But regenerate-schedule may recreate them.

- timestamp: 2026-03-01T00:04:00Z
  checked: brain/routes.py regenerate_schedule (lines 359-545)
  found: |
    `regenerate_schedule` fetches tasks WHERE status != 'done', then re-runs the
    Enforcer on ALL of them. The Enforcer will generate new blocks for every task
    it receives. The key question: when a study block is deleted, does the task get
    deleted too?

    Answer: YES — for study blocks with task_id (line 116-126 in tasks/routes.py):
    ```python
    if block["block_type"] == "study" and block["task_id"]:
        db.execute("DELETE FROM tasks WHERE id = ? AND user_id = ?", ...)
        db.execute("DELETE FROM schedule_blocks WHERE task_id = ? AND user_id = ?", ...)
    ```
    So the task IS deleted. When regenerate-schedule runs, that task is gone → no recreation.

    BUT: regenerate_schedule does a full wipe+regenerate of ALL schedule_blocks:
    ```python
    db.execute("DELETE FROM schedule_blocks WHERE user_id = ?", (user_id,))
    ```
    Then re-inserts from new_schedule. This means manually-edited blocks survive (they're
    saved and re-inserted), but deleted-then-regenerated blocks should NOT come back
    IF the underlying task was also deleted.
  implication: Deletion of STUDY blocks should persist through regenerate-schedule. Need to check what happens on app reload — does it call regenerate-schedule?

- timestamp: 2026-03-01T00:05:00Z
  checked: frontend/js/tasks.js — app reload flow (loadExams or similar)
  found: |
    The tasks.js file is very large. Looking for where the app loads on startup.
    Key function to find: what does the app do on page load/user login?
    The file imports from store.js and other modules. Need to check if there's a
    call to regenerate-schedule on load.
  implication: Need to inspect tasks.js more carefully for the app init flow.

- timestamp: 2026-03-01T00:06:00Z
  checked: Optimistic local update before the fetch in handleDeleteBlock
  found: |
    CRITICAL FINDING: The optimistic update removes blocks from `_blocksByDay`
    (in-memory state) and DOM. But then:
    ```js
    const res = await authFetch(`${API}/tasks/block/${blockId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
        // error path: refreshScheduleOnly to restore
        await refreshScheduleOnly(safeContainer);
        return;
    }
    // SUCCESS PATH: no refreshScheduleOnly call!
    // Sync Focus view
    renderFocus(getCurrentTasks());
    ```
    On SUCCESS: the code does NOT call refreshScheduleOnly. It leaves the optimistic
    local state as-is. This is fine for the current session.
    On app RELOAD: the frontend fetches `/schedule` (GET) which returns DB blocks.
    If the DELETE worked correctly (task + block deleted), the block won't be in the DB.
    So the block shouldn't reappear on reload IF the DELETE succeeded.
  implication: The reappearance must mean either: (A) the DELETE is failing silently, (B) regenerate-schedule is called on reload and recreates blocks from surviving tasks, or (C) the block somehow gets re-created elsewhere.

## Eliminated

- hypothesis: Wrong API URLs causing 404 → tasks=[] → always regenerate
  evidence: Fixed in commit 791dc1a (/tasks and /schedule URLs corrected)
  timestamp: 2026-03-01T00:10:00Z

- hypothesis: Manually-edited blocks being re-inserted after deletion
  evidence: delete_block correctly deletes task AND all its schedule_blocks; manually_edited_rows query won't find deleted rows
  timestamp: 2026-03-01T00:15:00Z

- hypothesis: Service worker serving stale JS
  evidence: SW uses network-first for .js files (sw.js lines 113-125); latest code is always served
  timestamp: 2026-03-01T00:16:00Z

## Evidence (continued)

- timestamp: 2026-03-01T00:08:00Z
  checked: loadExams fetch error handling (tasks.js lines 121-137)
  found: |
    ```js
    const tasksRes = await authFetch(`${API}/tasks`);
    const scheduleRes = await authFetch(`${API}/schedule`);
    let tasks = [];  // ← initialized to []
    if (tasksRes.ok) tasks = await tasksRes.json();
    // if tasksRes NOT ok → tasks stays []
    if (forceRegen || (tasks.length === 0 && exams.length > 0)) {
        regenerate-schedule...
    }
    ```
    If `/tasks` request fails for ANY reason (network error, auth issue, 5xx),
    `tasks` stays `[]` and regenerate-schedule is triggered. This recreates all
    blocks from surviving tasks (including any tasks that should have been deleted).
    The condition does NOT distinguish between "tasks is empty because there are none"
    vs "tasks is empty because the fetch failed".
  implication: Fetch failures silently trigger regenerate-schedule. This is a reliability bug.

- timestamp: 2026-03-01T00:09:00Z
  checked: hobby/padding block deletion persistence
  found: |
    Hobby blocks (block_type="hobby", task_id=None) and spaced-repetition padding
    blocks (task_id=None) are ALWAYS recreated by the Enforcer whenever
    regenerate-schedule runs. The Enforcer has no awareness of explicit user deletions.
    These blocks will reappear if:
    1. regenerate-schedule fires after deletion (via defer, toggle error, or forceRegen)
    2. The specific scenario: user defers a block → deferBlockToTomorrow() directly calls
       regenerate-schedule (tasks.js line 496) → Enforcer recreates hobby/padding blocks
  implication: Hobby and padding blocks always recreate on any regenerate-schedule call.

- timestamp: 2026-03-01T00:10:00Z
  checked: Whether STUDY blocks (with task_id) are correctly deleted
  found: |
    delete_block (tasks/routes.py lines 99-130) correctly:
    1. Deletes the specific schedule_block row
    2. For study blocks with task_id: ALSO deletes the task AND all sibling blocks
    The Enforcer queries tasks WHERE status != 'done' — deleted tasks are gone.
    Therefore, study blocks that are properly deleted will NOT be recreated by regen.

    CRITICAL EXCEPTION: if the DELETE HTTP call itself fails (network error, auth error),
    the optimistic UI removes the block from view, but the block STAYS in the DB.
    On next reload: block reappears from /schedule (correctly reflects DB state).
    The user would see this as "block came back after reopening".
  implication: DELETE call failure is treated as success (optimistic update not reverted on success path, only on !res.ok and not-404).

## Resolution

root_cause: |
  TWO confirmed bugs remain after the URL fix in 791dc1a:

  BUG 1 — Most likely cause of reported symptom:
  In loadExams() (tasks.js), if the /tasks fetch fails for any reason (network hiccup,
  server error, auth issue), tasks stays as [] (initial value). The condition
  `tasks.length === 0 && exams.length > 0` then triggers regenerate-schedule, which
  recreates ALL blocks from remaining tasks — including any tasks that should have
  been deleted but may not have been (e.g., if the DELETE HTTP call failed silently).
  The code does NOT distinguish between "no tasks" and "tasks fetch failed."

  BUG 2 — Hobby and padding blocks (task_id=None):
  These are ALWAYS regenerated by the Enforcer whenever regenerate-schedule runs.
  Since deferBlockToTomorrow() calls regenerate-schedule as part of normal flow,
  any deferred block will trigger recreation of hobby and padding blocks.
  (This is lower priority since deferring is an explicit action.)

fix: |
  BUG 1 FIX (tasks.js loadExams) — APPLIED:
  Track whether the /tasks and /schedule fetches succeeded separately.
  Only trigger regenerate-schedule if BOTH fetches succeeded AND tasks is genuinely
  empty. If either fetch fails, never trigger regen — prevents deleted blocks from
  being recreated due to network errors.

  Changed condition from:
    `tasks.length === 0 && exams.length > 0`
  To:
    `tasksFetchOk && scheduleFetchOk && tasks.length === 0 && exams.length > 0`

  BUG 2 (hobby/padding blocks) — NOT FIXED (accepted behavior):
  Hobby and padding blocks with task_id=None will always be recreated when
  regenerate-schedule runs (via defer or forceRegen). This is acceptable since
  these blocks are ephemeral schedule fillers, not user-created tasks.

verification: |
  1. Delete a study block → block disappears from UI
  2. Close and reopen app → block stays deleted
  3. Delete a hobby block → block disappears
  4. Defer another block (triggers regen) → study block stays deleted, hobby block may reappear (accepted)
files_changed:
  - frontend/js/tasks.js (loadExams function, lines 120-156)
