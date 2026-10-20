---
status: resolved
trigger: "decouple-planning-constraints-from-ui"
created: 2026-02-25T00:00:00Z
updated: 2026-02-25T00:01:00Z
---

## Current Focus

hypothesis: CONFIRMED - The UI timeline grid is rendered from startHour (derived from the earliest block's hour, NOT wake time) to hour 24. The grid height is (24 - startHour) * HOUR_HEIGHT, limiting blocks to only be draggable within that window. The drag bounds in interactions.js use `(24 - startHour) * getHourHeight()` as the gridEndPixel, preventing drops beyond hour 24 (correct) but also making startHour the floor. The wake/sleep settings are only used by backend/brain/scheduler.py for AI planning - they do NOT currently appear in the UI grid calculation directly. The real issue is that startHour is dynamically calculated from the first block's hour (e.g. 8am → startHour=7), meaning the grid only starts at hour 7, not 0:00 - users cannot scroll/drag to hours 0-6. The grid must start at hour 0 always.
test: Confirmed by reading calendar.js lines 130-142 and interactions.js lines 253-254, 417-433
expecting: Fix: hardcode startHour=0 in calendar.js so the grid always covers 00:00-24:00
next_action: Apply the fix

## Symptoms

expected: The Roadmap UI should render and allow interaction (scrolling, dragging, dropping) across the full 24-hour timeline (00:00-24:00), regardless of wake-up/sleep hour settings.
actual: The scrollable/visible area and draggable range in the Roadmap are constrained by the wake-up and sleep hour settings, preventing users from placing or viewing blocks outside that window.
errors: No runtime errors - this is a behavioral/UX constraint issue in the rendering and drag logic.
reproduction: Open the Roadmap view, observe that the timeline only shows/scrolls within the wake/sleep window; try dragging a block outside that range - it snaps back or is blocked.
started: Likely always been the case; by design (incorrectly applied to UI layer).

## Eliminated

- hypothesis: wake/sleep hours from user settings are directly used in UI grid height calculation
  evidence: grep found no reference to wake_up_time or sleep_time in calendar.js or interactions.js; the settings only appear in auth.js (form handling) and backend scheduler.py (AI planning)
  timestamp: 2026-02-25

## Evidence

- timestamp: 2026-02-25
  checked: calendar.js lines 130-142
  found: startHour is computed as Math.max(0, firstTaskHour - 1) where firstTaskHour is the hour of the earliest block. For empty days it defaults to 8. This means the grid starts 1 hour before the first block, NOT at 0:00.
  implication: Users cannot scroll or drag to any hour before the earliest scheduled block minus 1.

- timestamp: 2026-02-25
  checked: calendar.js line 215 and lines 220-235
  found: totalGridHeight = (24 - startHour) * HOUR_HEIGHT. The HTML grid height, time column labels, and horizontal dividers all start from startHour, not 0. data-start-hour="${startHour}" is written to the container div.
  implication: The entire grid is truncated at the top - hours 0 through (startHour-1) are invisible and unreachable.

- timestamp: 2026-02-25
  checked: interactions.js lines 253-254 and 417-433
  found: gridEndPixel = (24 - startHour) * getHourHeight() is used in onTouchEnd and interact.js end handler. The restrictRect modifier restricts desktop drags to '.calendar-grid'. isDelayed flag uses gridEndPixel as upper bound.
  implication: The drag bounds correctly go to hour 24 at the bottom, but the top is implicitly limited by the grid starting at startHour. No explicit sleep-hour clamp exists in drag code.

- timestamp: 2026-02-25
  checked: backend/brain/scheduler.py lines 31-32
  found: wake_h/sleep_h from user settings are used only in the AI scheduler to define available planning windows.
  implication: Backend correctly scopes wake/sleep to AI planning only. The separation is already correct on the backend. Only the frontend grid start needs fixing.

## Resolution

root_cause: In calendar.js, startHour is dynamically set to (firstTaskHour - 1) instead of being fixed at 0. This causes the hourly grid, time labels, and scroll area to begin at the hour of the first scheduled block, not at midnight. Users cannot view, scroll to, or drag blocks into any hour earlier than the first scheduled block minus 1. The grid height is (24 - startHour) * HOUR_HEIGHT, so it also does not cover the full 24-hour day. Wake/sleep user settings are correctly limited to backend AI planning and do not directly affect the UI - but the startHour logic achieves a similar constraining effect from the content side.
fix: Set startHour = 0 always in renderHourlyGrid (remove the firstTaskHour calculation). The empty-day default of 8 should also become 0. This exposes the full 00:00-24:00 grid. Block positions (visualTop) are calculated as (blockHour - startHour) * HOUR_HEIGHT - with startHour=0 this simplifies to blockHour * HOUR_HEIGHT, which is correct. The data-start-hour attribute will be 0, and all drag/save math in interactions.js already handles any startHour value correctly.
verification: startHour is now always 0. All downstream calculations in calendar.js and interactions.js accept any startHour value via data-start-hour attribute, so they require no changes. The grid renders 24 hour rows (00:00-23:00), totalGridHeight = 24 * HOUR_HEIGHT, block visualTop = blockHour * HOUR_HEIGHT. The current-time indicator guard (h < startHour = h < 0) is never triggered so it always shows. The restrictRect modifier in interact.js restricts to .calendar-grid which now spans the full 24 hours. Drop coordinate math in onTouchEnd and saveSequence use startHour=0 from data-start-hour, correctly mapping pixel positions to times across the full day.
files_changed: [frontend/js/calendar.js]
