---
status: investigating
trigger: "Investigate and calibrate the 'Yesterday's unfinished tasks' (morning review) routine."
created: 2024-05-23T12:00:00Z
updated: 2024-05-23T12:00:00Z
---

## Current Focus

hypothesis: The '_get_morning_tasks' helper is filtering out real pending tasks incorrectly or the database query is not catching them.
test: Examine '_get_morning_tasks' implementation and database state for User 9.
expecting: Identify the logic error in task selection for morning review.
next_action: "gather initial evidence by reading relevant files"

## Symptoms

expected: The modal should display real 'pending' tasks from previous days (day_date < today) that belong to User 9.
actual: Only the synthetic test task is visible in the modal.
errors: Logic mis-calibration between database state and the '_get_morning_tasks' helper.
reproduction: 1. Ensure User 9 has pending tasks from a past date. 2. Click 'Trigger Morning Review' in the Mac debug panel. 3. Check the iPhone modal content.
started: Issue persisted after improving task detection logic.

## Eliminated

## Evidence

## Resolution

root_cause: 
fix: 
verification: 
files_changed: []
