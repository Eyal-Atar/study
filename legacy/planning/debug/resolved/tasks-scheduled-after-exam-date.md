---
status: verified
trigger: "tasks-scheduled-after-exam-date"
created: 2025-05-15T10:00:00Z
updated: 2025-05-15T11:00:00Z
---

## Current Focus

hypothesis: The scheduling logic or the AI prompt allows tasks to be assigned to day_indices that exceed the actual study window (today until day before exam).
test: Analyze exam_brain.py and scheduler.py for day range calculations.
expecting: To find a discrepancy between the calculated study window and the allowed day_index in the prompt or scheduler.
next_action: Fix applied and verified by code analysis.

## Symptoms

expected: All study tasks must be completed by the day before the exam. No study tasks on or after the exam date.
actual: Tasks are appearing on dates after the exam.
errors: Logic error in scheduling constraints.
reproduction: Generate Roadmap for an exam a few days away. Observe tasks on days following the exam.
started: Reported after recent scheduler logic updates.

## Eliminated

## Evidence

- timestamp: 2025-05-15T10:30:00Z
  checked: backend/brain/scheduler.py
  found: The scheduler loop was preparing time windows for up to 14 days AFTER the last exam. It also lacked a check to ensure a task's exam_id was not already in the past or on the same day.
  implication: Tasks could "overflow" into days after the exam if they didn't fit or if the AI assigned them there.

- timestamp: 2025-05-15T10:45:00Z
  checked: backend/brain/exam_brain.py
  found: The Strategist AI prompt did not provide individual exam deadlines to the AI, and there was no clamping of the day_index returned by the AI.
  implication: The AI was "flying blind" and could easily hallucinate day_indices beyond individual exam dates.

## Resolution

root_cause: Discrepancy between the global study window and individual exam dates in both the AI prompt and the deterministic scheduler. The scheduler allowed overflow into days after exams, and the AI wasn't strictly informed of individual deadlines.
fix: 
1. Updated `ExamBrain._build_strategist_prompt` to include explicit exam deadlines and rules.
2. Added defensive clamping in `ExamBrain.call_strategist` to ensure `day_index` is strictly before the exam date.
3. Modified `scheduler.py` to limit the scheduling window to the last exam date and added candidate filtering to enforce task-specific deadlines.
verification: Code analysis confirms that no study tasks can be scheduled on or after their respective exam dates because of the strict `current_day_date < exam_date_lookup[eid]` check in the Enforcer (scheduler.py).
files_changed: ["backend/brain/scheduler.py", "backend/brain/exam_brain.py"]
