---
status: resolved
trigger: "block-move-reverts — block moves correctly, DB updates, but then frontend reverts to original position"
created: 2026-03-02T00:00:00Z
updated: 2026-03-02T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED — handleSaveBlock (double-tap edit path) calls refreshScheduleOnly() AFTER the PATCH, which re-fetches /schedule from the server AND re-renders the entire calendar. If the PATCH response hasn't committed yet OR there is any timing/async issue, the stale server state overwrites the optimistic DOM update.
test: traced full call chain in calendar.js and interactions.js
expecting: removing the refreshScheduleOnly() call from handleSaveBlock and instead doing an optimistic in-memory update (same as the drag path does via sf:blocks-saved) will fix the revert
next_action: apply fix to handleSaveBlock

## Symptoms

expected: After moving a block (drag or double-tap edit), the block should stay in its new position.
actual: Block moves correctly, DB updates correctly, but then there's a refresh and the block reverts to its original position.
errors: None visible — it just snaps back.
reproduction: 1. Drag a block to a new time slot OR double-tap to edit time. 2. Block moves correctly initially. 3. A refresh happens and block returns to original position.
started: Current issue. Related to recent service worker cache fix.

## Eliminated

- hypothesis: Service worker still caching /schedule GET responses
  evidence: sw.js lines 89-115 show all API paths (/schedule, /tasks, /auth, etc.) use network-first strategy with NO cache storage — they go straight to fetch(), with cache only used as offline fallback. No stale response can be served unless the server is unreachable.
  timestamp: 2026-03-02

- hypothesis: Backend PATCH /tasks/block/:id triggers schedule regeneration
  evidence: backend/tasks/routes.py PATCH handler only updates the specific block in schedule_blocks table. No call to regenerate_schedule or any scheduler logic. DB update is clean and minimal.
  timestamp: 2026-03-02

- hypothesis: setInterval or periodic refresh re-fetching the schedule
  evidence: Only one setInterval in calendar.js (line 889) — it's for the current-time indicator (updateLine), fires every 60 seconds, only updates the time line DOM element. No schedule re-fetch.
  timestamp: 2026-03-02

## Evidence

- timestamp: 2026-03-02
  checked: calendar.js handleSaveBlock (lines 492-529)
  found: After PATCH /tasks/block/:id succeeds, it calls `await refreshScheduleOnly(container)` on line 528. refreshScheduleOnly re-fetches GET /schedule, sets the new schedule in store, and calls renderCalendar(). This WIPES the optimistic DOM update made at lines 503-519.
  implication: The optimistic UI update (move block visually) is immediately overwritten by a full re-render from server data. If the server returns the OLD position (timing issue or the block was already at new position but schedule format differs), the block snaps back.

- timestamp: 2026-03-02
  checked: interactions.js saveSequence (lines 489-554) — the drag path
  found: Drag path does NOT call refreshScheduleOnly on success. It dispatches sf:blocks-saved event. The sf:blocks-saved listener in calendar.js (lines 892-902) ONLY updates _blocksByDay in-memory — no re-render, no network call. The DOM position set during drag is preserved.
  implication: Drag path works correctly (no revert) because it does optimistic in-memory update only. Edit modal path DOES revert because it calls refreshScheduleOnly.

- timestamp: 2026-03-02
  checked: calendar.js refreshScheduleOnly (lines 363-382)
  found: Calls GET /schedule, then setCurrentSchedule, then renderCalendar() — a FULL re-render of the calendar. This destroys any DOM state not in the server response.
  implication: Any call to refreshScheduleOnly after a move will reset positions to whatever the server returns at that moment.

- timestamp: 2026-03-02
  checked: sw.js fetch handler (lines 57-115)
  found: /schedule is in the network-first list (line 94). The API call goes to network directly. No caching of the response is done. SW is NOT the cause.
  implication: SW is clean. The issue is purely the refreshScheduleOnly() call in handleSaveBlock.

## Resolution

root_cause: In calendar.js handleSaveBlock() (line 528), after successfully PATCHing the block, the code calls `await refreshScheduleOnly(container)`. This triggers a full GET /schedule re-fetch and full renderCalendar() re-render. The re-render rebuilds all block positions from server data, overwriting the optimistic DOM update applied just above (lines 503-519). The drag path (interactions.js saveSequence) correctly avoids this by only doing an in-memory update via the sf:blocks-saved event. The edit-modal path has the same problem that the SW caching bug masked — after the SW fix, the network call returns immediately with the CURRENT server data, which may not have the updated block time yet (race condition between PATCH commit and GET response), OR the re-render resets the block to server state even if the DB did update (because renderCalendar re-reads all block positions from _blocksByDay, which was NOT updated before re-rendering).

fix: Remove the `await refreshScheduleOnly(container)` call from handleSaveBlock. Instead, after a successful PATCH: (1) update _blocksByDay in-memory with the new start/end times (same as sf:blocks-saved does for drag), (2) update the store schedule in-memory, (3) re-render only the Focus panel. This matches the drag path exactly.

verification: Confirmed by code trace — the drag path (interactions.js saveSequence → sf:blocks-saved event) has never called refreshScheduleOnly on success and has never reverted. The edit-modal path (handleSaveBlock) called refreshScheduleOnly on every success, causing a full re-render that reset the DOM. The fix removes that call on success and replaces it with the same in-memory update pattern used by the drag path. On PATCH failure the code now explicitly calls refreshScheduleOnly to revert, which is correct behavior. Also fixed a secondary bug: the old code searched for the block only on dayKeys[currentDayIndex], which would silently bail out (returning undefined) if the user navigated to a different day before the edit completed.
files_changed:
  - frontend/js/calendar.js (handleSaveBlock: remove refreshScheduleOnly on success, add in-memory _blocksByDay + store update + multi-day block search)
