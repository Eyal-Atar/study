---
status: investigating
trigger: "The user reports that the schedule's first task is being pushed forward based on the current time (the 'now' line). Specifically, logging in 10 minutes later pushes the task 10 minutes further."
created: 2024-03-24T14:30:00Z
updated: 2024-03-24T14:30:00Z
---

## Current Focus

hypothesis: The scheduler uses `local_now` as the direct start time for today's first task without a stable baseline.
test: Examine `backend/brain/scheduler.py`'s `generate_multi_exam_schedule` and its use of `local_now`.
expecting: `current_time` in the scheduler starts from `local_now + today_start_buffer` for today's tasks.
next_action: Read `backend/brain/scheduler.py` to understand the logic.

## Symptoms

expected: The schedule's first task should start at a fixed preferred time (e.g., 9:00 AM) or remain stable if it's already in the past.
actual: The first task is pushed forward as the current time moves.
errors: N/A
reproduction: Regenerate the schedule at different times of the day; the first task will shift.
started: Recently reported.

## Eliminated

## Evidence

## Resolution

root_cause:
fix:
verification:
files_changed: []
