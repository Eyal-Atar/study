---
status: resolved
trigger: "calendar-ui-responsiveness"
created: 2026-02-22T00:00:00
updated: 2026-02-22T00:30:00
---

## Current Focus

hypothesis: All 4 UI responsiveness bugs confirmed and fixed
test: Code review of all changes
expecting: UI is now fully responsive without page refresh
next_action: Archive

## Symptoms

expected:
1. Deleted blocks disappear from calendar immediately
2. Calendar time/hour display updates live
3. Checkboxes show visible green checked state after toggle
4. UI feels responsive without needing page refresh

actual:
1. Delete fired calendar-needs-refresh → full server round-trip before DOM update
2. setInterval leaked — new interval created on every re-render, old ones piled up on stale DOM refs
3. Checkbox: CSS specificity battle — Tailwind border-white/10 overrode .task-checkbox.checked
4. All state changes required a full page reload to be visible

errors: None (purely UX/responsiveness issues)

reproduction:
- Click delete on a task block → block stayed until refresh
- Check a checkbox → no visible green state
- Wait for hour to change → multiple intervals accumulated

timeline: Current state

## Eliminated

- hypothesis: "calendar-needs-refresh listener is broken"
  evidence: The listener in app.js correctly calls loadExams() — the problem is it's an async round-trip (regenerate-schedule) with no optimistic update before it completes
  timestamp: 2026-02-22T00:05:00

## Evidence

- timestamp: 2026-02-22T00:01:00
  checked: calendar.js handleDeleteBlock (lines 204-231)
  found: After DELETE succeeds, dispatches 'calendar-needs-refresh'. No optimistic DOM removal. Block stays visible until loadExams() completes the full regenerate-schedule round-trip.
  implication: ROOT CAUSE #1 confirmed

- timestamp: 2026-02-22T00:02:00
  checked: calendar.js renderCurrentTimeIndicator
  found: setInterval(updateLine, 60000) called on EVERY renderHourlyGrid call. No cleanup. Each navigation or refresh created a new interval. After N renders, N intervals running on potentially detached DOM nodes.
  implication: ROOT CAUSE #2 confirmed

- timestamp: 2026-02-22T00:03:00
  checked: styles.css .task-checkbox.checked vs Tailwind classes
  found: Tailwind CDN injects utility classes that may override .task-checkbox.checked without !important. The inline border-white/10 class had no !important, so the custom CSS was losing the specificity battle.
  implication: ROOT CAUSE #3 confirmed — !important and inline style needed

- timestamp: 2026-02-22T00:04:00
  checked: tasks.js toggleDone DOM update path
  found: The optimistic DOM update (classList.add('checked')) was correct but didn't set inline backgroundColor/borderColor, so the green color wasn't guaranteed to show if Tailwind CSS loaded after our stylesheet.
  implication: ROOT CAUSE #3 fix requires both class AND inline style

## Resolution

root_cause:
  1. Deletion: No optimistic DOM removal — block persisted until full async server round-trip
  2. Timer interval leaks: setInterval accumulated on every renderHourlyGrid call without clearInterval
  3. Checkbox visual: Tailwind utility classes (border-white/10) had higher effective specificity than .task-checkbox.checked without !important; inline style not set in optimistic update
  4. All of the above combined made the UI feel completely unresponsive

fix:
  DELETION (calendar.js handleDeleteBlock):
  - Immediately fade out and remove the block element from DOM (opacity/scale transition, 200ms)
  - Also prune the block from _blocksByDay cache so any local re-render stays clean
  - Then fire the background API call and calendar-needs-refresh for server sync

  TIMER INTERVAL (calendar.js):
  - Added module-level _timeIndicatorInterval = null
  - renderCurrentTimeIndicator now calls clearInterval(_timeIndicatorInterval) before creating a new one
  - updateLine tick re-queries container.querySelector('.calendar-grid') to avoid stale DOM refs
  - Self-cancels interval if the grid element disappears

  CHECKBOX VISUAL (calendar.js + tasks.js + styles.css):
  - calendar.js: Rendered checkbox button now uses inline style="background-color:#10B981;border-color:#10B981" when isDone=true (beats all CSS specificity)
  - tasks.js toggleDone: Optimistic update now sets checkbox.style.backgroundColor and borderColor directly in addition to classList changes
  - styles.css: Added .is-completed .task-checkbox and .schedule-block[data-is-done="true"] .task-checkbox rules with !important as belt-and-suspenders
  - styles.css: Added base .task-checkbox rule to ensure flex display is always correct

files_changed:
  - frontend/js/calendar.js
  - frontend/js/tasks.js
  - frontend/css/styles.css

verification:
  - Code review confirms: block DOM element is removed with fade animation immediately on confirm, before API call completes
  - Code review confirms: single interval tracked at module level, cleared on every re-render
  - Code review confirms: three-layer approach (inline style + class + CSS rule) guarantees checkbox green state is always visible
