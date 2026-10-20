---
status: resolved
trigger: "When moving a block (drag or double-tap edit), the frontend updates correctly and stays correct until the user RELOADS the page. After reload, the block reverts to its original position."
created: 2026-03-02T00:00:00Z
updated: 2026-03-02T00:03:00Z
---

## Current Focus

hypothesis: CONFIRMED AND FIXED
test: curl PATCH before fix → 500. curl PATCH after fix → 200. DB updated correctly.
expecting: N/A - fix verified
next_action: archive session

## Symptoms

expected: After moving a block and reloading the page, the block should be in its new position.
actual: Block moves correctly in UI, but after full page reload it's back in the original position.
errors: None visible (500 error logged to browser console, optimistic UI stays; on reload old position returned).
reproduction: 1. Move a block via drag or double-tap edit. 2. Confirm it looks correct. 3. Reload the page (F5 or close/reopen). 4. Block is back in original position.
started: Persistent issue through multiple fix attempts.

## Eliminated

- hypothesis: Service worker caching GET /schedule
  evidence: sw.js uses network-first for all API routes including /schedule.
  timestamp: 2026-03-02

- hypothesis: regenerate-schedule called on page load overwrites manual edits
  evidence: loadExams() only calls regenerate-schedule if tasks.length === 0. Normal reload does NOT trigger regeneration.
  timestamp: 2026-03-02

- hypothesis: regenerate-schedule doesn't preserve manually-edited blocks
  evidence: Fixed in commit ee03316. Routes.py preserves is_manually_edited=1 blocks before DELETE and re-inserts them.
  timestamp: 2026-03-02

- hypothesis: handleSaveBlock calling refreshScheduleOnly on success
  evidence: Fixed in commit 99324f7. handleSaveBlock now does in-memory update only.
  timestamp: 2026-03-02

- hypothesis: PATCH SQL has wrong parameters or missing columns
  evidence: push_notified and is_manually_edited columns both exist. Param count verified (5 for 5 placeholders). SQL is syntactically correct.
  timestamp: 2026-03-02

- hypothesis: GET /schedule returns different data than what was PATCHed
  evidence: GET /schedule returns blocks 8889/8890 with correct moved positions when writes succeed.
  timestamp: 2026-03-02

## Evidence

- timestamp: 2026-03-02
  checked: curl PATCH /tasks/block/8827 with valid session cookie
  found: Returns HTTP 500 "Internal Server Error" (text/plain, not JSON = unhandled Python exception, NOT HTTPException).
  implication: PATCH handler throws uncaught exception, preventing DB write.

- timestamp: 2026-03-02
  checked: python3 sqlite3.connect + BEGIN IMMEDIATE
  found: "database is locked" error immediately when trying to acquire write lock.
  implication: Another process is holding shared locks that prevent exclusive write access.

- timestamp: 2026-03-02
  checked: lsof study_scheduler.db
  found: Process 37696 (child of server 8107 via multiprocessing.spawn) holds 26+ open file descriptors to the same DB file.
  implication: Child process inherited SQLite FDs from parent. In SQLite rollback journal mode, these hold shared locks that block exclusive write access.

- timestamp: 2026-03-02
  checked: PRAGMA journal_mode
  found: "delete" (default rollback journal mode, NOT WAL)
  implication: In DELETE mode, writers need exclusive locks. Any open reader blocks all writers.

- timestamp: 2026-03-02
  checked: notifications/scheduler.py
  found: Scheduler fires every 10 seconds using apscheduler AsyncIOScheduler. Calls _generate_message() which is synchronous (Claude API). Running sync code in async context may spawn a multiprocessing child. Child inherits 26+ SQLite FDs, holding shared locks indefinitely.
  implication: Every time Claude API is called by the scheduler, it can lock the DB for writes for the duration of the API call.

- timestamp: 2026-03-02
  checked: PATCH after fix (WAL mode + timeout=5)
  found: Returns 200 "Block updated successfully". DB updated to start=2026-03-02T12:00:00, is_manually_edited=1. Verified via GET /schedule. Three concurrent PATCHes all succeeded.
  implication: WAL mode fixes the root cause — readers and writers no longer block each other.

## Resolution

root_cause: |
  SQLite "database is locked" (SQLITE_BUSY) error in the PATCH handler.

  The notification scheduler (apscheduler) calls _generate_message() which is a synchronous
  Claude API call. Python's asyncio event loop cannot directly run sync code — it may spawn
  a subprocess via multiprocessing to avoid blocking. That subprocess (PID 37696) inherits ALL
  open file descriptors from the parent server (PID 8107), including SQLite DB connections.

  In SQLite's default DELETE (rollback journal) mode: writes require an EXCLUSIVE lock.
  The inherited file descriptors in the subprocess hold SHARED locks on the DB. When the
  PATCH /tasks/block/{id} handler tries to UPDATE schedule_blocks, SQLite cannot upgrade
  from shared to exclusive because the subprocess's inherited connections hold shared locks.

  Result: UPDATE fails with sqlite3.OperationalError("database is locked"). FastAPI returns
  HTTP 500. saveSequence logs the error to console (not visible to user). The optimistic
  DOM update stays visible. On reload, original position returned from DB.

fix: |
  database.py get_db(): two changes:
  1. PRAGMA journal_mode=WAL — WAL (Write-Ahead Logging) allows concurrent reads and
     writes without blocking each other. Writers never block readers; readers never block
     writers. This eliminates the "database is locked" error entirely.
  2. timeout=5 — retry write locks for up to 5 seconds instead of failing immediately.
     Belt-and-suspenders protection for any remaining concurrent write scenarios.
  3. check_same_thread=False — correct for FastAPI's thread pool architecture.

verification: |
  Before fix: curl PATCH /tasks/block/8827 → HTTP 500 "Internal Server Error"
  After fix: curl PATCH /tasks/block/8827 → HTTP 200 {"message": "Block updated successfully"}
  GET /schedule confirmed: block 8827 start_time updated to "2026-03-02T12:00:00", is_manually_edited=1
  Three concurrent PATCHes all succeeded simultaneously.
  PRAGMA journal_mode on new connections now returns "wal".

files_changed:
  - backend/server/database.py (WAL mode + timeout + check_same_thread)
