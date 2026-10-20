---
status: resolved
trigger: "multi-task-toggle-persistent — clicking ONE checkbox causes TWO tasks to visually toggle"
created: 2026-02-22T00:00:00Z
updated: 2026-02-22T01:30:00Z
---

## Current Focus

hypothesis: RESOLVED
test: Scheduler fix verified — max 1 block per task per contiguous study segment per day
expecting: No more double-toggle on checkbox click
next_action: Done — archived

## Symptoms

expected: Clicking one checkbox toggles exactly one task
actual: Two tasks' checkboxes change state from a single click — intermittently
errors: No console errors reported
reproduction: Click any task checkbox in the hourly grid view. Sometimes two blocks toggle instead of one.
started: Persists through multiple rounds of fixes

## Eliminated

- hypothesis: interact.js drag handler firing click events on checkbox
  evidence: ignoreFrom, data-did-move guard, and completely emptying the start handler did not fix it
  timestamp: 2026-02-22

- hypothesis: Duplicate window-level task-toggle listeners
  evidence: Module-level _handleTaskToggle constant used to prevent duplicate listeners
  timestamp: 2026-02-22

- hypothesis: Click event bubbling through to outer containers
  evidence: stopPropagation + stopImmediatePropagation + direct addEventListener applied, did not fix
  timestamp: 2026-02-22

- hypothesis: Same task toggling concurrently via race condition
  evidence: _togglingTasks Set guard added, did not fix
  timestamp: 2026-02-22

- hypothesis: A different task_id was being toggled (truly two different tasks)
  evidence: Database confirmed it IS the same task_id across multiple blocks. The two visually-toggling blocks are the SAME task, split into multiple Pomodoro-size sessions by the scheduler. All previous fixes targeted the wrong layer (event handling).
  timestamp: 2026-02-22

## Evidence

- timestamp: 2026-02-22T01:00:00Z
  checked: backend/study_scheduler.db — schedule_blocks table
  found: 41 tasks have multiple schedule_blocks on the same day. Task 318 has 2 blocks on 2026-02-22 (12:24-13:14 and 14:09-14:49). Up to 3 blocks per task per day exist. Query: SELECT task_id, day_date, COUNT(*) FROM schedule_blocks WHERE task_id IS NOT NULL GROUP BY task_id, day_date HAVING COUNT(*) > 1
  implication: Root cause confirmed. The scheduler creates N Pomodoro-sessions per task per day based on estimated_hours / session_min. Each session = one DOM element with the same data-task-id. Clicking one triggers toggleDone which marks ALL of them via querySelectorAll, causing all same-task blocks to visually toggle simultaneously.

- timestamp: 2026-02-22T01:00:00Z
  checked: scheduler.py lines 109-160 — while loop inside for task in day_tasks
  found: The while loop appends a new ScheduleBlock per session_min chunk until remaining[task_id] <= 0. A 1.5h task with 50min sessions creates 2 blocks. A 2.5h task creates 3 blocks. All share the same task_id.
  implication: This is the source of duplicate blocks. The fix is to accumulate sessions into a single block per task per contiguous segment.

- timestamp: 2026-02-22T01:00:00Z
  checked: tasks.js line 160 — querySelectorAll('.schedule-block[data-task-id="${taskId}"]')
  found: This correctly selects all DOM elements for a task (done=task-level status). The frontend behavior is correct; the bug was entirely in the data the backend produced.
  implication: Frontend required no changes. The fix is purely in the scheduler.

- timestamp: 2026-02-22T01:30:00Z
  checked: Scheduler test — generate_multi_exam_schedule with 2.5h task (session_min=50)
  found: Before fix: 3 blocks for task 101. After fix: 1 block (06:30->09:00). Max blocks per task per day = 1 for contiguous sessions, 2 max when hobby block splits the task's window.
  implication: Fix verified correct.

## Resolution

root_cause: The scheduler's inner while loop created one ScheduleBlock per Pomodoro session (50min). A task with 2.5h estimated time created 3 separate blocks all sharing the same task_id. When the user clicked any block's checkbox, tasks.js toggleDone used querySelectorAll('.schedule-block[data-task-id="X"]') to update all matching DOM elements — correctly for task-level status, but visually toggling 2-3 calendar blocks simultaneously. The user observed this as "two different tasks toggling from one click." All previous fix attempts targeted the event handler layer, which was not the problem.

fix: Modified backend/brain/scheduler.py to accumulate contiguous Pomodoro sessions for the same task into a single ScheduleBlock. The _emit_task_block() helper tracks task_block_start_local / task_block_end_local and only emits once per contiguous session group. If the hobby block interrupts a task's sessions, two blocks are emitted (one before, one after the hobby) — which is visually clear because the hobby block sits between them.

verification: Test confirmed — task 101 (2.5h, 50min sessions) now generates 1 block spanning the full 2.5h instead of 3 separate 50min blocks. Hobby-interruption edge case generates at most 2 blocks. Syntax verified. All 3 test tasks produce exactly 1 block each on their assigned day.

files_changed:
  - backend/brain/scheduler.py: merged while-loop ScheduleBlock emissions into single per-task-per-segment block using _emit_task_block() accumulator
