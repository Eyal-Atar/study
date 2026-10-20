---
status: investigating
trigger: "Investigate issue: morning-review-modal-not-shown"
created: 2024-05-24T12:00:00Z
updated: 2024-05-24T12:00:00Z
---

## Current Focus

hypothesis: The push notification handler in the service worker or the app is not correctly triggering the UI to show the morning review modal, or the modal trigger logic fails on iPhone.
test: Examine how push notifications are handled and how they interact with the UI to show 'modal-morning-prompt'.
expecting: Identify a disconnect between the notification click/reception and the UI state change.
next_action: Examine frontend/sw.js and frontend/js/notifications.js for morning review handling.

## Symptoms

expected: modal-morning-prompt should open on the iPhone, showing yesterday's undone tasks with 'Reschedule' options.
actual: The push notification is seen, but no UI modal appears in the app.
errors: User reports "iphone cant see the modal".
reproduction: 1. Open StudyFlow on iPhone. 2. On Mac, go to /debug-panel. 3. Click 'Backdate Today's Tasks' (to ensure there are "yesterday" tasks). 4. Click 'Trigger Morning Review'.
started: Never worked since the debug trigger was implemented today.

## Eliminated

## Evidence

## Resolution

root_cause:
fix:
verification:
files_changed: []
