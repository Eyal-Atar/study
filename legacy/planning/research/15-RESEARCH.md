# Phase 15 Research: Task Checkbox Sync, Exam Progress Bars, and Push-to-Next-Day Foundation

## Current State Analysis

### Task Checkbox Sync
- **Backend**: `schedule_blocks` has a `completed` (integer 0/1) column. `tasks` has a `status` ('pending', 'in_progress', 'done') column.
- **Problem**: Updating a block's `completed` status (via `/tasks/block/{id}/done`) does not automatically update the parent `tasks.status`. Conversely, marking a task as `done` (via `/tasks/{id}/done`) does not update its individual blocks.
- **Frontend**: `toggleDone` in `tasks.js` performs optimistic updates on both the task object and the block UI, but the backend calls are separate and don't enforce full synchronization.

### Exam Progress Bars
- **Existing**: `renderExamCards` in `tasks.js` already calculates progress using `done_count / task_count`.
- **UI**: Uses a small progress bar: `<div class="h-full ${examColorClass(i,'bg')} rounded-full transition-all" style="width:${progress}%"></div>`.
- **Refinement**: Needs verification if these are visible in all relevant views (e.g., mobile drawer) and if the transition is smooth.

### Push-to-Next-Day Foundation
- **Scheduler**: `generate_multi_exam_schedule` handles tasks with `day_date < today` by including them in the pool for the current/future days and marking them `is_delayed`.
- **Problem**: In the UI, these tasks might still appear on their original (past) day unless the schedule is regenerated.
- **Need**: A mechanism to "Push Unfinished to Today/Tomorrow" which updates the `day_date` in the database so they appear in today's focus without needing a full AI regeneration (which might change other things).

## Proposed Strategy

### 1. Synchronized Status Logic
- **Backend**: 
    - Update `mark_block_done` to check if all blocks for that `task_id` are now completed. If so, set `tasks.status = 'done'`.
    - Update `mark_task_done` to set all associated `schedule_blocks.completed = 1`.
    - Add a "Sync" utility to ensure consistency.
- **Frontend**:
    - Ensure `toggleDone` handles both task and block updates consistently.
    - Trigger a global state refresh or event when status changes to update progress bars immediately.

### 2. Progress Bar Enhancements
- Add progress percentage to the "Today's Focus" header or exam legends.
- Ensure the progress bar in the mobile drawer (`renderExamCardsDrawer`) is functional and styled correctly.

### 3. Push-to-Next-Day Foundation
- **Endpoint**: `POST /tasks/rollover`
    - Logic: Find all `schedule_blocks` where `day_date < today` and `completed = 0`.
    - For each: Update `day_date` to `today` (or next available slot).
    - This "shunts" the unfinished work into the current day's view.
- **Frontend**: Add a "Missed tasks? Push to today" button/banner if past incomplete tasks exist.

## Verification Plan
- **Test Case 1**: Check a block in the calendar -> Verify parent task is 'done' in DB (if only one block).
- **Test Case 2**: Uncheck a block -> Verify parent task is 'pending'.
- **Test Case 3**: Change task status to 'done' -> Verify all blocks in calendar show as completed.
- **Test Case 4**: Simulate a past incomplete task -> Trigger rollover -> Verify it moves to today's list.
