---
status: resolved
trigger: "dual-task-toggle: Clicking one task checkbox sometimes causes two different tasks to toggle simultaneously"
created: 2026-02-22T00:00:00Z
updated: 2026-02-22T00:20:00Z
---

## Current Focus

hypothesis: CONFIRMED — interact.js intercepts pointerdown on .schedule-block, fires end handler even on zero-movement clicks. end handler calls resolveCollisions which synchronously shifts adjacent blocks' style.top. After this shift, a second pointer/click event (from interact.js's pointer capture release) lands on a now-shifted adjacent block. The combination of the originally captured pointer firing to block A AND the released pointer (at new coordinates after block shift) landing on block B causes two different task-toggle events.

Additionally: interact.js end handler → saveSequence → calendar-needs-refresh (100ms delay) → loadExams → renderHourlyGrid re-render on EVERY click, which is wasteful and creates race conditions.

The fix: use interact.js's ignoreFrom option to prevent drag tracking from starting when the pointer goes down on .task-checkbox elements. This stops interact.js from intercepting clicks on checkboxes entirely.

test: verified by code reading — resolveCollisions runs on ALL blocks during end handler, modifies positions; no drag threshold configured; inertia:true adds further pointer event complexity
next_action: implement ignoreFrom: '.task-checkbox' in interactions.js draggable config

## Symptoms

expected: Clicking a task's checkbox toggles only THAT task's done/pending state.
actual: Sometimes clicking one checkbox causes two tasks to visually toggle — one checks, another unchecks (or both change state).
errors: No console errors reported.
reproduction: Click a task checkbox in the calendar hourly grid view. Intermittently, two tasks toggle instead of one.
timeline: Intermittent — not every click, sometimes happens.

## Eliminated

- hypothesis: "listener accumulation on re-render — same element getting multiple addEventListener calls"
  evidence: container.innerHTML = html destroys and recreates all DOM nodes on each renderHourlyGrid call. Each new node gets exactly one fresh addEventListener. Cannot accumulate.
  timestamp: 2026-02-22T00:10:00Z

- hypothesis: "data-task-id corruption — different tasks sharing the same task ID"
  evidence: data-task-id comes from block.task_id which is server data. The guard parseInt+isNaN prevents empty/null from firing. Not the issue.
  timestamp: 2026-02-22T00:10:00Z

- hypothesis: "_togglingTasks Set insufficient — same task fires twice"
  evidence: The prior fix already handles same-task double-toggle. The bug is explicitly about TWO DIFFERENT tasks toggling. _togglingTasks would block same ID but not different IDs.
  timestamp: 2026-02-22T00:10:00Z

- hypothesis: "window task-toggle listener accumulated (multiple initTasks() calls)"
  evidence: initTasks() does window.removeEventListener before window.addEventListener. Even if called multiple times, only one handler exists. initTasks() is only called once anyway.
  timestamp: 2026-02-22T00:10:00Z

- hypothesis: "initInteractions() called multiple times, stacking interact.js selector registrations"
  evidence: initInteractions() is called exactly once in app.js line 34. Grep confirms no other callers.
  timestamp: 2026-02-22T00:10:00Z

## Evidence

- timestamp: 2026-02-22T00:05:00Z
  checked: interactions.js initInteractions()
  found: interact('.schedule-block:not(.block-break):not(.is-completed)') with inertia:true. No ignoreFrom or allowFrom config. No minimum drag distance configured.
  implication: interact.js intercepts ALL pointerdown events on ANY .schedule-block child element including .task-checkbox buttons.

- timestamp: 2026-02-22T00:06:00Z
  checked: interactions.js drag end handler lines 69-111
  found: end handler runs resolveCollisions on ALL blocks in container (not just the dragged one), modifies style.top for all, calls saveSequence which PATCHes all blocks and dispatches calendar-needs-refresh after 100ms delay
  implication: Every click (even zero-movement) on any .schedule-block triggers a full re-render 100ms later via calendar-needs-refresh.

- timestamp: 2026-02-22T00:07:00Z
  checked: calendar.js renderHourlyGrid lines 293-302
  found: Each call to renderHourlyGrid destroys old DOM via container.innerHTML and creates fresh nodes. Each checkbox gets exactly ONE fresh addEventListener. container.onclick is set as property (replaced, not accumulated).
  implication: No listener accumulation within a single render cycle. The issue must be cross-render or cross-element.

- timestamp: 2026-02-22T00:08:00Z
  checked: tasks.js toggleDone lines 133-210
  found: toggleDone does optimistic update + PATCH. calendar-needs-refresh is only dispatched on ERROR (line 207). Normal success path does NOT re-render calendar. So calendar re-render during a successful toggle is only triggered by interact.js's saveSequence.
  implication: The 100ms-delayed calendar-needs-refresh from interact.js's end handler is the mechanism that triggers re-renders even on simple clicks.

- timestamp: 2026-02-22T00:09:00Z
  checked: app.js lines 82-84
  found: calendar-needs-refresh listener calls loadExams() which calls renderCalendar() → renderHourlyGrid() — a full network request + full DOM re-render
  implication: Every checkbox click causes a full API round-trip and DOM re-render 100ms later due to interact.js's end handler firing.

- timestamp: 2026-02-22T00:12:00Z
  checked: interact.js version and known behavior
  found: interact.js v1.10.27. Selector-based delegation operates at document level. With inertia:true, pointer capture is held beyond the initial pointerup. The end event may fire after pointer has moved. resolveCollisions synchronously shifts adjacent blocks' style.top BEFORE the native click event fires. The browser then determines click target based on updated coordinates.
  implication: When resolveCollisions shifts an adjacent block INTO the click coordinates, the native click can fire on THAT block's checkbox. Simultaneously, interact.js's own pointer tracking fires the captured event to the original block's checkbox. Result: two different .task-checkbox elements receive click events → two different task-toggle events → two different toggleDone calls with different taskIds.

## Resolution

root_cause: interact.js intercepts ALL pointerdown events on .schedule-block elements (via selector-based document-level delegation) because no ignoreFrom was configured. When a user clicks a .task-checkbox button inside a .schedule-block, interact.js starts a drag session on the parent block. On pointerup (even with zero movement), interact.js fires its drag end handler. The end handler calls resolveCollisions() which synchronously modifies style.top for ALL blocks in the container — including adjacent blocks that were not dragged. This position change happens BEFORE the native click event fires. The browser then determines click target based on the updated DOM coordinates. If resolveCollisions shifted an adjacent block into the original click coordinates, that block's checkbox also receives a click event. Simultaneously, interact.js delivers the original captured pointer event to the original block's checkbox. Result: two different .task-checkbox elements receive click events from one physical tap, dispatching two task-toggle events with two different taskIds.

Secondary issue: even without the coordinate-shift problem, interact.js end firing on every click causes saveSequence() to PATCH all blocks and dispatch calendar-needs-refresh, triggering a full loadExams() + renderCalendar() + renderHourlyGrid() re-render 100ms after every checkbox click. This is wasteful and creates race conditions with in-flight toggleDone() operations.

fix: Two changes to frontend/js/interactions.js:
1. Added ignoreFrom: '.task-checkbox, .delete-reveal-btn' to both .draggable() and .resizable() configs. This tells interact.js to not start a drag/resize session when the pointer goes down on those child elements. Checkboxes and delete buttons now receive native click events without interact.js interference.
2. Added data-drag-started attribute tracking in the drag start handler. The drag end handler now checks this flag before calling saveSequence. If start never fired (zero-movement tap on block body), end returns early without running resolveCollisions or saveSequence. This eliminates spurious full re-renders on taps.

verification: Server returns 200. JavaScript syntax check passes. Logic verified by code reading: with ignoreFrom applied, clicking a .task-checkbox bypasses interact.js entirely — no drag session starts, no end handler fires, no resolveCollisions runs, no block position shifts happen before the native click. The native click fires normally on exactly the clicked checkbox, dispatching exactly one task-toggle event.

files_changed:
  - frontend/js/interactions.js
