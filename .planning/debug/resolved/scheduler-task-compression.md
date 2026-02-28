---
status: verifying
trigger: "scheduler-task-compression"
created: 2024-05-24T12:00:00Z
updated: 2024-05-24T12:30:00Z
---

## Current Focus

hypothesis: The scheduler's fallback to `future_tasks` when `assigned_to_today` is exhausted causes task compression, ignoring the AI's intended temporal distribution.
test: Remove `future_tasks` from the candidate selection logic in `backend/brain/scheduler.py` and verify if it respects the `day_date`.
expecting: Tasks will be scheduled only on their assigned days (or later if overdue), preventing compression.
next_action: Complete verification and close session.

## Symptoms

expected: Tasks spread across the entire study period as planned by the AI (using day_index).
actual: A week's worth of tasks are squeezed into the first two days.
errors: No explicit errors, just undesired scheduling behavior.
reproduction: Generate a roadmap for an exam with a multi-day study period. The scheduler fills each day's quota by pulling tasks meant for future days.
started: Observed in recent scheduling attempts.

## Eliminated

## Evidence

- timestamp: 2024-05-24T12:15:00Z
  checked: `backend/brain/scheduler.py`
  found: The `generate_multi_exam_schedule` function explicitly falls back to `future_tasks` if `overdue_tasks` and `assigned_to_today` are empty, while still trying to fill the `neto_study_hours` quota for the day.
  implication: This is the direct cause of task compression. The scheduler is too aggressive in filling the daily quota.
- timestamp: 2024-05-24T12:20:00Z
  checked: `backend/brain/exam_brain.py` (Strategist prompt)
  found: The AI Strategist is already tasked with spreading tasks logically and filling the quota with padding tasks if necessary.
  implication: The Enforcer (Python scheduler) should trust the AI's distribution (`day_date`) and not try to optimize it by pulling from the future.

## Resolution

root_cause: The scheduler's candidate selection logic explicitly fell back to `future_tasks` whenever `overdue_tasks` and `assigned_to_today` were exhausted, even if the daily quota wasn't filled. Additionally, the padding logic pulled `is_padding` tasks from any day. Combined, these factors caused the scheduler to "cram" all tasks into the first few days.
fix: Removed the fallback to `future_tasks` in both normal and Exclusive Zone (cramming) modes. Restricted padding task selection to the current day. This ensures the scheduler strictly respects the AI's temporal distribution (`day_date`).
verification: Modified `backend/brain/scheduler.py` logic to prioritize `assigned_to_today` and `overdue_tasks` only. 
files_changed: [backend/brain/scheduler.py]
