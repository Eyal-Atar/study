---
status: investigating
trigger: "roadmap-regeneration-breaks-interactions"
created: 2025-02-17T00:00:00Z
updated: 2025-02-17T00:00:00Z
---

## Current Focus
hypothesis: Re-rendering or regenerating the roadmap DOM elements does not re-attach event listeners for interactions (double-tap, drag) or fails to sync new data with the notification scheduler.
test: Check the roadmap generation/render function to see if event listeners are re-attached or if the interaction setup is only called on initial page load.
expecting: Interaction setup functions (e.g., `setupInteractions`, `attachTaskListeners`) are not called after roadmap generation.
next_action: gathering initial evidence

## Symptoms
expected: Double tap to edit task works, notifications work after generating a new schedule. Dragging task to 1 minute from now triggers a push notification.
actual: Double tap and notifications stop working after a new schedule is generated. Dragging to 1 min from now doesn't trigger notification.
errors: Silent failure (assumed).
reproduction: 1. Generate a new roadmap. 2. Double tap a task block (fails). 3. Drag a task to 1 minute from now (no notification).
started: Happens specifically after generating a new roadmap/schedule.

## Eliminated

## Evidence

## Resolution
root_cause: 
fix: 
verification: 
files_changed: []
