---
status: investigating
trigger: "Investigate why double-tap edit doesn't work, why hours are not visible in the calendar grid, and how to remove the 15-minute snapping 'magnet' behavior for precise 1-minute positioning."
created: 2025-05-15T09:00:00Z
updated: 2025-05-15T09:00:00Z
---

## Current Focus

hypothesis: The calendar grid rendering logic is missing the hour labels, the double-tap event is either not registered or not handled correctly, and the snapping logic is hardcoded to 15 minutes.
test: Examine calendar.js and interactions.js for grid rendering, event handling, and snapping logic.
expecting: Identify hardcoded values for snapping, missing CSS or JS for hour labels, and event listener issues for double-tap.
next_action: Examine calendar.js and interactions.js.

## Symptoms

expected: Double-tap on a task should open edit mode. Hours should be visible on the left side of the calendar grid. Task dragging/resizing should be precise to 1 minute.
actual: Double-tap does nothing. No hour labels are visible. Tasks snap to 15-minute intervals.
errors: None reported.
reproduction: 
1. Try double-tapping a task in the calendar.
2. Observe the left side of the calendar grid for hour labels.
3. Drag or resize a task and check the time increments.
started: Always broken/not implemented.

## Eliminated

## Evidence

- timestamp: 2025-05-15T09:10:00Z
  checked: frontend/js/calendar.js and frontend/css/styles.css
  found: .hour-label has position: absolute in CSS but no top value set in JS, causing them to stack. JS also uses redundant inline styles.
  implication: Hours are not visible because they are improperly positioned (all at top: 0).
- timestamp: 2025-05-15T09:12:00Z
  checked: frontend/js/calendar.js
  found: Double-tap logic is only implemented for touchend event, which won't work for mouse users.
  implication: Double-tap edit fails for desktop users.
- timestamp: 2025-05-15T09:14:00Z
  checked: frontend/js/interactions.js
  found: SNAP_MINUTES is hardcoded to 15.
  implication: This is the 'magnet' behavior the user wants to remove for 1-minute precision.

## Resolution

root_cause: Hours are not visible due to missing 'top' positioning for absolutely positioned labels. Double-tap is only implemented for touch events. Snapping is hardcoded to 15 minutes.
fix: 
- In calendar.js: Set top: i * hHeight for .hour-label and add dblclick event listener for double-tap edit.
- In interactions.js: Change SNAP_MINUTES to 1.
- In styles.css: Ensure .hour-label styles are clean and don't conflict.
