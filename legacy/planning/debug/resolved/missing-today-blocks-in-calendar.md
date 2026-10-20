---
status: investigating
trigger: "Schedule blocks are missing from the 'Today' view in the calendar, but are visible on future days. Tasks are visible in the Focus tab."
created: 2024-05-20T10:00:00Z
updated: 2024-05-20T10:00:00Z
---

## Current Focus

hypothesis: Today's date comparison logic in the frontend or backend is filtering out today's blocks incorrectly.
test: Examine how the calendar filters/displays blocks for the current day.
expecting: Find a logic error in date handling or timezone offset that makes "today" appear empty.
next_action: Examine frontend/js/calendar.js and backend/brain/scheduler.py

## Symptoms

expected: Schedule blocks should appear on Today's calendar view if time is available.
actual: "Today" view is empty, but future days have blocks. Focus tab shows tasks correctly.
errors: None reported in UI or browser console.
reproduction: Generate Roadmap -> Approve -> View Roadmap Today.
started: Persistent issue.

## Eliminated

## Evidence

## Resolution

root_cause: 
fix: 
verification: 
files_changed: []
