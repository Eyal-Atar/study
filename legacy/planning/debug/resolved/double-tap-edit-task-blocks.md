---
status: resolved
trigger: "Double-tap to edit task blocks is reportedly not working. Investigate event listener conflicts in calendar.js."
created: 2024-05-18T10:00:00Z
updated: 2026-03-01T00:00:00Z
---

## Current Focus

hypothesis: RESOLVED
test: N/A
expecting: N/A
next_action: Done

## Symptoms

expected: Double-tapping a task block should open an edit modal or trigger edit mode.
actual: Double-tapping doesn't trigger the expected action — nothing happens.
errors: None reported.
reproduction: Double-tap any task block in the calendar.
started: After phase-17 refactor of calendar.js (setupGridListeners moved to module level).

## Eliminated

- hypothesis: Event listeners not attached (container._listenersAttached guard firing too early)
  evidence: setupGridListeners IS called on first renderHourlyGrid; listeners ARE attached to the persistent container element and survive re-renders. The guard works correctly.
  timestamp: 2026-03-01T00:00:00Z

- hypothesis: touchend passive flag preventing preventDefault on double-tap
  evidence: The listener is registered with { passive: false }, so preventDefault() is callable.
  timestamp: 2026-03-01T00:00:00Z

- hypothesis: interactions.js touchend consuming events before calendar.js sees them
  evidence: interactions.js adds its touchend listener to document (not container), and only acts when touchDragState exists. calendar.js listens on container. No conflict.
  timestamp: 2026-03-01T00:00:00Z

## Evidence

- timestamp: 2026-03-01T00:00:00Z
  checked: calendar.js setupGridListeners() double-tap logic
  found: _lastTapBlock is declared as a module-level variable (line 30). On first tap, it is assigned the DOM element reference (blockEl). On any subsequent re-render (day swap, refresh), container.innerHTML = html replaces all block DOM nodes with fresh ones. On the second tap, e.target.closest('.schedule-block') returns the NEW node. The check `_lastTapBlock === blockEl` compares the new node to the OLD detached node — always false.
  implication: Double-tap can ONLY succeed if the two taps happen without ANY re-render in between. The module-level variable approach is correct in principle but must compare by block ID, not object identity.

- timestamp: 2026-03-01T00:00:00Z
  checked: HEAD (committed) version of setupGridListeners vs working tree version
  found: Committed version declared _lastTapTime and _lastTapBlock as LOCAL variables inside the function, which was called from inside renderHourlyGrid. Working tree refactored them to MODULE-LEVEL to survive the _listenersAttached guard. But the comparison still uses object identity (===), which breaks after any innerHTML replacement.
  implication: The refactoring introduced the regression. The fix is minimal: store block ID string instead of DOM node reference.

- timestamp: 2026-03-01T00:00:00Z
  checked: interactions.js activateTouchDrag()
  found: Long-press dispatches sf:edit-block event, opening the modal. This is a separate path and works correctly. The double-tap is the broken path.
  implication: Long-press editing still works; only double-tap is broken.

## Resolution

root_cause: _lastTapBlock stored a DOM element reference. After any re-render (renderHourlyGrid replaces container.innerHTML), the stored reference pointed to a detached node that is !== the newly created equivalent block element. The double-tap check `_lastTapBlock === blockEl` was therefore always false after re-renders.
fix: Two-line change in the touchend handler inside setupGridListeners — store blockEl.dataset.blockId (a stable string) instead of blockEl (DOM node). Compare with _lastTapBlock === blockEl.dataset.blockId. On the first tap (else branch), store `blockEl ? blockEl.dataset.blockId : null`.
verification: Double-tap on a task block opens the edit modal consistently, including after day swipes and schedule refreshes.
files_changed:
  - frontend/js/calendar.js (lines 502 and 531)
