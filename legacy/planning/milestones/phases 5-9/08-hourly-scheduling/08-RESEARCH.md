# Research: Phase 08 - Hourly Time Slot Scheduling

## 1. Scheduling Algorithm: Deadline-First & Rollover

### Overflow Strategy
Current `scheduler.py` uses a weighted distribution based on time remaining until the exam. For Phase 8, we must pivot to a strict **Deadline-First** approach when study load exceeds `neto_study_hours`.

**Proposed Logic:**
1.  **Input:** Daily tasks from AI (`tasks` table) and user preferences (`neto_study_hours`, wake/sleep times).
2.  **Filter:** Identify tasks for the current day.
3.  **Sort:** Sort exams by `exam_date` (ascending).
4.  **Allocate:**
    -   Fill the available `neto_study_hours` window starting from `wake_up_time + 1h`.
    -   If a task cannot fit in today's window, it is marked as `delayed` and pushed to the *next day's* pool.
5.  **Rollover:** Before scheduling today's AI tasks, the scheduler must fetch `status != 'done'` tasks from *previous* days and place them at the front of today's queue.

### Hobby/Break Slot
-   The "Hobby" slot should be treated as a high-priority block.
-   **Placement:** Schedule it during the user's *non-peak* productivity time to ensure peak time is used for study.
-   **Duration:** 2 hours (default).

## 2. Technical Timezone Conversions

### Storage Pattern
-   **Database:** Store `start_time` and `end_time` as UTC ISO 8601 strings (e.g., `2026-02-20T14:00:00Z`).
-   **Python:** Use `datetime.fromisoformat()` with `timezone.utc`.
-   **Frontend:** The browser automatically handles UTC to Local conversion when using `new Date("...Z")`.

### Machine Timezone Implementation
-   Frontend sends the local timezone offset or name during login/onboarding.
-   Alternatively, the backend generates UTC blocks, and the frontend JS uses `.toLocaleString()` or a library to render them in the user's current view.

## 3. UI Integration: Event Calendar (vkurko)

### Grid View
-   Switch from custom timeline to `Event Calendar`'s **Daily** or **Weekly** grid view.
-   **Visuals:**
    -   `study` blocks: use `exam_color`.
    -   `break` / `hobby` blocks: use a distinct neutral color (e.g., `dark-600` or `sky-500`).
    -   `delayed` tasks: Add a ⚠️ icon or a "Delayed" badge.

### Drag-and-Drop
-   `Event Calendar` supports an `onEventDrop` callback.
-   **Flow:**
    1.  User drags block.
    2.  Frontend captures new `start` and `end` times.
    3.  Call `PATCH /schedule/{id}` to update the backend.
    4.  If the task is moved to a new day, update its `day_date`.

## 4. Database Schema Updates

### Table: `schedule_blocks` (Existing but needs refinement)
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | INTEGER | PK |
| `user_id` | INTEGER | FK to users |
| `task_id` | INTEGER | FK to tasks |
| `start_time` | TEXT | UTC ISO 8601 |
| `end_time` | TEXT | UTC ISO 8601 |
| `block_type` | TEXT | 'study' or 'break' |
| `is_delayed` | INTEGER | 0 or 1 |

### Table: `tasks` (Update)
-   Add `is_delayed` column to track tasks that were pushed by the algorithm.
