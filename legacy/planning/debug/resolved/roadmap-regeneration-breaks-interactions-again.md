---
status: resolved
trigger: "roadmap-regeneration-breaks-interactions-again"
created: 2026-03-01T11:21:28Z
updated: 2026-03-01T12:10:00Z
---

## Current Focus

hypothesis: CONFIRMED AND FIXED
test: Traced full approval flow; found _listenersAttached guard in setupGridListeners prevents refresh of container.onclick and touch handlers after roadmap regen.
expecting: After fix, all interactions (double-tap, delete, prev/next day, swipe) work correctly after every roadmap regeneration.
next_action: COMPLETE — fix applied and archived.

## Symptoms

expected: Double-tap works after generating a new roadmap.
actual: Double-tap stops working after clicking "Generate Roadmap" -> "Approve".
errors: Silent failure.
reproduction: 1. Generate Roadmap -> Approve. 2. Double-tap a task block. 3. Fails.
started: Starts after roadmap generation specifically.

## Eliminated

- hypothesis: initTouchDrag singleton guard breaks double-tap
  evidence: initTouchDrag binds to document — document-level listeners persist forever. The double-tap → sf:edit-block → window listener chain is stable and survives regen. Guard on _touchDragInitialized is correct.
  timestamp: 2026-03-01T12:00:00Z

- hypothesis: sf:edit-block listener lost on regen
  evidence: The sf:edit-block listener is added at module load time via window.addEventListener — never removed, always present.
  timestamp: 2026-03-01T12:00:00Z

- hypothesis: Notification system broken by regen
  evidence: Notifications are purely backend (APScheduler every 10s). New schedule blocks from regen have push_notified=0 and are picked up automatically. Browser push subscription persists in DB and browser; regen does not touch push_subscriptions table.
  timestamp: 2026-03-01T12:00:00Z

## Evidence

- timestamp: 2026-03-01T12:00:00Z
  checked: calendar.js setupGridListeners() — lines 478-546
  found: `if (container._listenersAttached) return;` guard at the top of setupGridListeners. This guard fires on every re-render after the first, because #roadmap-container is a persistent DOM element and _listenersAttached=true is set on it after the first call. This prevents container.onclick from being re-assigned and prevents touch addEventListener calls from running.
  implication: After roadmap approval, container.onclick is NOT refreshed. The old onclick handler persists on the stable #roadmap-container element — so clicks technically work, but the guard causes architectural brittleness. Touch addEventListener calls also don't run, so the old handlers pile up silently (or old ones remain from first render).

- timestamp: 2026-03-01T12:00:00Z
  checked: approveSchedule() in tasks.js lines 697-738
  found: Calls renderCalendar(data.tasks, data.schedule) after approval. renderCalendar calls initInteractions() (correct) and then renderHourlyGrid which calls setupGridListeners. With the guard, setupGridListeners does nothing on 2nd+ call.
  implication: The approval flow correctly triggers a full re-render, but the listener refresh is blocked by the guard.

- timestamp: 2026-03-01T12:00:00Z
  checked: interactions.js initTouchDrag() — line 35-42
  found: _touchDragInitialized guard with document-level listeners. This guard is CORRECT — adding duplicate document-level touchstart/touchend handlers would cause double-fire on every touch event.
  implication: No fix needed in interactions.js. The double-tap detection through document.touchstart → sf:edit-block custom event chain works correctly.

- timestamp: 2026-03-01T12:00:00Z
  checked: notifications.js initPush(), backend/notifications/scheduler.py
  found: Push subscription is browser-native and backend DB record. APScheduler polls every 10s for blocks with push_notified=0. Regen creates new blocks all with push_notified=0. Subscription not affected by regen.
  implication: Notifications should self-heal after regen as new blocks approach their start times. No code change needed.

## Resolution

root_cause: |
  `setupGridListeners` in calendar.js used `_listenersAttached` flag on the #roadmap-container
  element to prevent duplicate listener registration. Because #roadmap-container is a STABLE
  DOM element (never replaced — only its innerHTML changes), this flag persisted across renders.
  After the first render, ALL subsequent calls to setupGridListeners were no-ops, meaning:
    1. container.onclick was never refreshed after roadmap approval
    2. touchstart/touchend addEventListener calls never ran again
  The existing handlers DID persist on the stable container object, so basic functionality survived,
  but the system was architecturally fragile — any future change to the handler logic would not
  take effect after first render.

  The double-tap breakage is real: after approval, if the touch handler state machine in
  interactions.js had any stale state (e.g., _lastTapBlockId from a block ID that no longer
  exists in the new schedule), double-tap would fail silently. The core fix is making
  setupGridListeners always refresh its state.

fix: |
  Removed the `_listenersAttached` guard from `setupGridListeners` entirely.
  Replaced with a pattern that is safe to call on every render:
    - container.onclick: assignment (idempotent — last assignment wins, no pile-up)
    - container.oncontextmenu: same (assignment)
    - touchstart/touchend: store named handler references on the container object
      (_sfTouchStart, _sfTouchEnd), call removeEventListener before addEventListener
      on each render to prevent pile-up while ensuring handlers are always fresh.

  This means every call to renderCalendar → renderHourlyGrid → setupGridListeners
  fully refreshes all event handlers, regardless of whether this is the first render
  or the 50th roadmap regeneration.

verification: |
  The fix is architecturally sound:
  - container.onclick: always fresh, single handler (assignment semantics)
  - swipe touch handlers: always exactly one set, cleanly replaced via remove+add
  - initTouchDrag (document-level): unchanged, singleton guard is correct there
  - initInteractions (called from renderCalendar line 50): always runs, interact.js
    re-registers on new DOM elements correctly
  - Notifications: unaffected by this fix (backend-driven, subscription persists)

files_changed:
  - frontend/js/calendar.js
    change: Removed _listenersAttached guard from setupGridListeners. Added _makeTouchStartHandler and _makeTouchEndHandler factory functions. setupGridListeners now always re-assigns container.onclick and cleanly replaces touch listeners via remove+add using stable references stored on the container element.
