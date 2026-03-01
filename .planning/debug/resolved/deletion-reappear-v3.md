---
status: resolved
trigger: "Deleted task blocks STILL reappear after closing and reopening the app"
created: 2026-03-01T00:00:00Z
updated: 2026-03-01T00:05:00Z
---

## Current Focus

hypothesis: CONFIRMED — GET /schedule is served from service worker cache (cache-first), not network
test: Read sw.js fetch handler — /schedule not in API list, falls to static asset cache-first handler
expecting: Fix: add /schedule to SW API list so it always uses network-first
next_action: Apply fix to frontend/sw.js

## Symptoms

expected: After deleting a block and reopening the app, the block should stay deleted.
actual: Deleted blocks reappear on app reload.
errors: Unknown
reproduction: 1. Delete a task block (confirm deletion). 2. Close and reopen app. 3. Block is back.
started: Ongoing. Two previous fix attempts did not resolve it.

## Eliminated

- hypothesis: Wrong API URLs (/tasks/tasks, /brain/schedule)
  evidence: Fixed in commit 791dc1a — correct URLs now /tasks and /schedule
  timestamp: 2026-03-01T00:01:00Z

- hypothesis: Fetch failure triggers regen (tasks=[] when fetch fails)
  evidence: Fixed in commit 43a58a3 — tasksFetchOk/scheduleFetchOk guards added
  timestamp: 2026-03-01T00:01:00Z

- hypothesis: regenerate-schedule fires on every reload recreating blocks
  evidence: tasksGenuinelyEmpty guard prevents regen unless BOTH fetches OK AND tasks truly empty
  timestamp: 2026-03-01T00:02:00Z

- hypothesis: DELETE endpoint fails silently (wrong URL, wrong method)
  evidence: URL /tasks/block/{id} is correct, DELETE method correct, backend deletes task + all blocks
  timestamp: 2026-03-01T00:02:00Z

- hypothesis: executeDelete returns early (blockData not found in _blocksByDay)
  evidence: _blocksByDay is populated from schedule on render. 560ms window before executeDelete runs is too short for any re-render to clear it
  timestamp: 2026-03-01T00:03:00Z

## Evidence

- timestamp: 2026-03-01T00:04:00Z
  checked: frontend/sw.js — service worker fetch handler (lines 57-153)
  found: |
    The SW fetch handler categorizes requests:
    1. method !== GET → pass through (DELETE/POST/PATCH unaffected)
    2. navigation → network-first
    3. API calls (hardcoded list) → NETWORK-FIRST, cache fallback
       List includes: /auth, /tasks, /exams, /users, /brain, /regenerate, /generate-roadmap
    4. .js/.css assets → network-first
    5. Other static assets → CACHE-FIRST (puts in cache, serves from cache next time)

    CRITICAL: GET /schedule is NOT in the API list (item 3).
    The brain_router has NO prefix — routes are /schedule, /auditor-draft, etc.
    The /brain prefix in the SW list matches NOTHING since the router has no prefix.
    GET /schedule falls to item 5: CACHE-FIRST.

    On first load after login: GET /schedule → network → response cached in SW.
    After delete + close + reopen: GET /schedule → SW returns CACHED response (stale, has deleted block).
    Even though DELETE succeeded and DB is correct, the SW serves the old schedule.

    This is why blocks reappear: /tasks (in list, network-first) returns correct data (task deleted),
    but /schedule (not in list, cache-first) returns stale data (block still there).
    The calendar renders the stale schedule blocks, making the deleted block reappear.
  implication: Fix = add /schedule (and /auditor-draft, /approve-and-schedule) to SW API list

## Resolution

root_cause: |
  GET /schedule is not in the service worker's network-first API list.
  The brain_router routes have no /brain prefix, but the SW still has /brain in its API list
  (which now matches nothing). GET /schedule falls to the "other static assets" cache-first
  handler, which caches the schedule response and serves it stale on subsequent loads.

  After a user deletes a block:
  1. DELETE /tasks/block/{id} succeeds — task + block removed from DB
  2. User closes app
  3. User reopens app: GET /tasks returns [] for deleted task (network-first, correct)
  4. GET /schedule returns STALE CACHED response with deleted block still in it
  5. renderCalendar(tasks, schedule) renders the stale schedule block → block reappears

fix: |
  Add /schedule (and other brain routes) to the SW network-first API list.
  Replace the broken /brain prefix pattern with the actual route prefixes:
  /schedule, /auditor-draft, /approve-and-schedule, /regenerate-schedule (already covered by /regenerate), /brain-chat

verification: |
  1. Deploy fix (new SW with updated URL patterns installs via skipWaiting)
  2. Browser's controllerchange event triggers window.location.reload()
  3. New SW now handles GET /schedule as network-first
  4. Delete a block → DELETE /tasks/block/{id} succeeds (task + block removed from DB)
  5. Close and reopen app → GET /schedule hits network → returns fresh schedule (deleted block absent)
  6. Block does not reappear ✓
  7. For offline scenarios: if network fails, cached /schedule is served (acceptable — same as before)

files_changed:
  - frontend/sw.js
