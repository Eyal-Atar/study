---
status: resolved
trigger: "block deletion duplicates and crash"
created: 2026-03-01T00:00:00Z
updated: 2026-03-01T00:10:00Z
---

## Current Focus

hypothesis: RESOLVED - all three root causes fixed
test: code reviewed and fixes applied
expecting: clean deletion with no reappearance, no modal stuck
next_action: archive

## Symptoms

expected: When deleting a block, it should disappear cleanly and all UI components should update correctly
actual: Blocks sometimes reappear after deletion, duplicates appear, app can crash with blurry/stuck modal
errors: 404 errors when trying to delete already-deleted blocks, modal-confirm gets stuck
reproduction: Delete a block, it fades out then reappears broken. Clicking delete again crashes the app.
started: Ongoing, worsened by refreshScheduleOnly refactor

## Eliminated

- hypothesis: The DELETE backend endpoint is wrong
  evidence: DELETE /tasks/block/{id} is correct - it deletes the block and sets task day_date = NULL
  timestamp: 2026-03-01

- hypothesis: The store.setCurrentSchedule is the problem
  evidence: store is a simple in-memory object, no bugs there
  timestamp: 2026-03-01

- hypothesis: setupGridListeners duplicate listener bug causing crash
  evidence: container.onclick is direct assignment (safe). Touch events guarded by _listenersAttached flag. Not a crash cause.
  timestamp: 2026-03-01

## Evidence

- timestamp: 2026-03-01
  checked: handleDeleteBlock executeDelete in calendar.js (lines 347-375 before fix)
  found: |
    RACE CONDITION / ERROR SWALLOW (Root Cause 1):
    executeDelete did:
      1. Animate out (200ms)
      2. Remove from _blocksByDay local state
      3. await DELETE /tasks/block/{blockId}    [network]
      4. await refreshScheduleOnly()            [network: GET /schedule + full DOM rebuild]

    refreshScheduleOnly calls renderCalendar which completely replaces container.innerHTML.
    This destroys the fading block element and replaces the entire DOM.

    If DELETE failed (404 or network error), the catch block SWALLOWED THE ERROR
    and still called refreshScheduleOnly(). GET /schedule returned the block (still
    in DB), renderCalendar re-rendered it as a fresh visible block. User sees block
    come back. No error shown.

    Also: refreshScheduleOnly triggered a full re-render even on success, causing
    unnecessary DOM thrash and a ~200-400ms window where the block could reappear.

- timestamp: 2026-03-01
  checked: showConfirmModal in ui.js
  found: |
    MODAL STUCK BUG (Root Cause 2):
    showConfirmModal assigned new onclick handlers every call but called showModal(true)
    unconditionally. showModal(true) calls el.classList.remove('closing') and adds
    'active'. BUT if the modal was in the middle of its 260ms close animation
    (closing class set, _modalTimeout pending), calling showModal(true) removed
    'closing' and re-activated the modal. Then the original _modalTimeout fired 260ms
    later and removed 'active', instantly closing the freshly opened modal.

    This was the "blurry modal stuck" symptom: modal opens, appears blurry/frozen,
    then closes by itself. The user could not confirm the delete.

- timestamp: 2026-03-01
  checked: handleDeleteBlock - concurrent delete protection
  found: |
    NO IN-PROGRESS GUARD (Root Cause 3):
    No flag prevented the same block from being deleted twice concurrently.
    Since refreshScheduleOnly() rebuilds the entire DOM (including the block element
    as a fresh node), a user clicking delete on the re-rendered block would call
    executeDelete again with the same blockId. This triggered:
    - A second DELETE (404, since block already deleted)
    - A second refreshScheduleOnly (another full DOM rebuild)
    The two async flows interleaved unpredictably, causing visual duplicates and
    state corruption.

## Resolution

root_cause: |
  Three distinct bugs in the block deletion flow:

  BUG 1 (Block reappears): executeDelete always called refreshScheduleOnly()
  regardless of DELETE success/failure. On DELETE failure, the block was still
  in the DB, so GET /schedule returned it, and it reappeared silently with no
  error feedback.

  BUG 2 (Modal stuck/blurry): showConfirmModal called showModal(true) without
  cancelling the in-progress 260ms close animation timeout. The pending timeout
  then fired and removed 'active' from the freshly re-opened modal, making it
  appear to freeze then close.

  BUG 3 (Duplicate/concurrent delete): No in-progress guard on executeDelete.
  After the DOM was rebuilt by refreshScheduleOnly, the block appeared as a fresh
  element, allowing the user to click delete again while the first delete was
  still running, causing concurrent network calls and unpredictable re-renders.

fix: |
  FIX 1 (calendar.js handleDeleteBlock):
  - Added _deletingBlocks Set as module-level guard. executeDelete returns early
    if the blockId is already in the set.
  - Added block element capture BEFORE any async ops.
  - On DELETE success: skip refreshScheduleOnly entirely. Instead:
    * Immediately filter the block from _blocksByDay (local render state)
    * Immediately filter the block from getCurrentSchedule() store
    * Call renderFocus(getCurrentTasks()) to update the focus tab
    This avoids the race-condition re-render entirely.
  - On DELETE failure (non-ok response or network error): call refreshScheduleOnly()
    to restore correct server state, and properly log the error.

  FIX 2 (ui.js showConfirmModal):
  - Before calling showModal(true), check if the modal has the 'closing' class.
  - If yes: cancel the pending _modalTimeout and immediately remove 'active'
    and 'closing' classes, resetting the modal to a clean closed state before
    re-opening. This prevents the mid-animation timeout from firing after re-open.

verification: |
  Fixes verified by code trace:
  - On successful delete: block fades out (220ms), _deletingBlocks prevents
    re-entry, _blocksByDay + store updated, renderFocus called. No full re-render.
  - On failed delete: refreshScheduleOnly restores server state. Error logged.
  - Rapid double-click: second click hits _deletingBlocks guard, returns immediately.
  - Modal re-open during close animation: closing state cleared synchronously
    before showModal(true) runs, preventing the stale timeout from firing.

files_changed:
  - frontend/js/calendar.js (handleDeleteBlock, added _deletingBlocks guard)
  - frontend/js/ui.js (showConfirmModal, fix modal animation state)
