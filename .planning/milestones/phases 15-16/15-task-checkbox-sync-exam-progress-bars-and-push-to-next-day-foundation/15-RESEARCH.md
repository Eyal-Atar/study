# Phase 15: Task Checkbox Sync, Exam Progress Bars, and Push-to-Next-Day Foundation - Research

**Researched:** 2026-02-24
**Domain:** Frontend state management, CSS animations, SQLite schema migration, optimistic UI patterns
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Checkbox interaction:**
- Optimistic UI: checkmark appears instantly on tap in Today's Focus
- Background sync to server (no loading spinner blocking the user)
- State syncs between Today's Focus tab and Calendar/Roadmap via central store

**XP Progress Bars:**
- Daily Bar: shows progress for current day's tasks only
- Exam Master Bar: shows overall progress across all tasks in that exam's roadmap
- Color transitions: starts orange/yellow, shifts to green as progress increases, bright green at 100%
- On completing the final task: glow animation (short burst) on the bar
- Both bars use CSS transitions for smooth visual updates

**Push-to-Next-Day (Defer) logic:**
- When user defers a task:
  1. Original task gets status `deferred`, visually grayed out on its original day
  2. A new copy is created on the next calendar day automatically
  3. Linked via `linkedTaskId` for history tracking
- Deferred tasks are **excluded** from the original day's percentage denominator (no "punishment" for deferring)
- Deferred tasks are **added** to the next day's denominator
- Deferral allowed up to and including exam day itself
- Delete removes task entirely from all calculations (daily and exam-wide)

**Data schema changes:**
- `status` field: enum of `pending`, `completed`, `deferred`
- `originalDate`: preserves the task's original scheduled date for tracking
- `linkedTaskId`: links deferred copy back to the original task

**Progress formulas:**
- Daily % = completed / (total - deferred) * 100
- Overall Exam % = total completed / total tasks in roadmap * 100

### Claude's Discretion
- Exact CSS transition/glow animation implementation
- Where to place the daily bar vs exam bar in the UI layout
- How to handle the defer button/gesture (swipe, button, or long-press)
- Error handling for failed background syncs

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

## Summary

Phase 15 builds three tightly coupled features on top of the existing optimistic-UI checkbox system. The codebase already has a working optimistic toggle pattern (`toggleDone` in `tasks.js`) and a `completed` field on `schedule_blocks`. The core challenge for checkbox sync is extending this pattern to the Today's Focus panel (which currently only shows tasks as read-only list items) and ensuring the central store reflects state consistently across both tabs without full re-renders.

The XP progress bars are a pure frontend concern — no new backend endpoints are needed. Progress percentages can be computed client-side from the data already in `store.currentTasks` and `store.currentExams`, and the existing `done_count`/`task_count` fields on exam responses already power partial progress display on exam cards. The daily bar requires one additional computation (filtered by today's date and excluding deferred tasks). The color gradient and glow animation are straightforward CSS transitions with no third-party dependencies.

Push-to-Next-Day is the heaviest change. It requires a database schema migration (three new columns on `tasks`), a new PATCH endpoint (`/tasks/{task_id}/defer`), frontend UI for triggering the defer action, and updates to the progress-calculation queries. The status enum constraint in SQLite must be updated from `('pending', 'in_progress', 'done')` to include `'deferred'`. A new copy-task operation must run atomically (copy row + link IDs) in the backend.

**Primary recommendation:** Sequence the work as (1) schema migration, (2) defer endpoint, (3) Today's Focus checkbox wiring, (4) XP bars with CSS animations. This ensures each step is independently verifiable.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| SQLite3 (Python stdlib) | built-in | Schema migration, new columns, status enum update | Already the project database |
| FastAPI | already installed | New `/tasks/{id}/defer` endpoint | Already the backend framework |
| Pydantic | already installed | Request schema for defer body | Already used for all request models |
| Vanilla JS ES6 modules | n/a | Frontend state and UI updates | Project-mandated (no framework) |
| Tailwind CSS (CDN) | already loaded | Progress bar sizing and color classes | Already the styling system |
| CSS transitions | n/a | Smooth bar width changes, glow animation | Built into every modern browser |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| CSS `@keyframes` | n/a | Glow burst animation on 100% completion | Only for the completion animation |
| CSS `background` linear-gradient or direct color | n/a | Orange-to-green color transition on bar fill | Transition via JS class swap or inline style |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline style width update | CSS custom property + transition | Both work; inline is simpler given the codebase uses inline styles throughout calendar blocks |
| CSS color interpolation via hue-rotate | Class-based color swaps at thresholds | Class swaps at thresholds (0-33%, 34-66%, 67-99%, 100%) are easier to implement with Tailwind utility classes; true hue-rotate would require a custom CSS variable approach |
| Server-sent events for live sync | Polling | Optimistic UI already handles the sync; SSE would be over-engineering for this use case |

**Installation:** No new packages required.

---

## Architecture Patterns

### Recommended Project Structure

No new files need to be created. Changes are confined to:

```
backend/
├── server/database.py        # Migration: add 3 columns to tasks, update status CHECK
├── tasks/routes.py           # New: POST /tasks/{task_id}/defer endpoint
├── tasks/schemas.py          # New: DeferResponse schema (optional)
frontend/
├── js/tasks.js               # Update: toggleDone in Today's Focus, add deferTask()
├── js/calendar.js            # Update: renderTodayFocus() to include checkboxes + defer button, renderXPBars()
├── js/store.js               # No structural change needed
├── css/styles.css            # New: .xp-bar, @keyframes glow-burst, .task-deferred CSS
└── index.html                # New: HTML slots for daily XP bar + exam XP bars
```

### Pattern 1: Optimistic UI for Checkbox Toggle (Existing — Already Works)

**What:** State mutated in memory first, server called async in background. Rollback on failure.

**Current implementation** (in `tasks.js` `toggleDone`):
```javascript
// 1. Mutate store immediately
task.status = isDone ? 'pending' : 'done';
// 2. Update DOM immediately
blockEl.classList.add('is-completed');
// 3. Spawn confetti
spawnConfetti(btn);
// 4. Call API async (background)
const patchRes = await authFetch(endpoint, { method: 'PATCH' });
if (!patchRes.ok) {
    // 5. Rollback on failure
    task.status = isDone ? 'done' : 'pending';
    updateStats();
}
```

**Extension needed for Today's Focus:** The `renderTodayFocus()` function currently renders tasks as read-only `<div>` items with no checkboxes. It needs to add `<button class="task-checkbox">` elements that dispatch `task-toggle` events — the same event already handled by `initTasks()`. This reuses the existing event system without adding new event types.

### Pattern 2: Progress Bar Computed from Store (New)

**What:** Client-side computation from in-memory store data; no new API calls.

**Daily XP bar computation:**
```javascript
function computeDailyProgress() {
    const today = new Date().toISOString().split('T')[0];
    const todayTasks = getCurrentTasks().filter(t => t.day_date === today);
    const active = todayTasks.filter(t => t.status !== 'deferred');
    const completed = active.filter(t => t.status === 'done');
    return active.length > 0 ? Math.round((completed.length / active.length) * 100) : 0;
}
```

**Exam master bar computation:**
```javascript
function computeExamProgress(examId) {
    // Uses exam.done_count and exam.task_count already returned by GET /exams
    // These are computed by the backend query in exams/routes.py
    // Note: done_count counts tasks WHERE status='done'; must be updated to exclude deferred from denominator
    const exam = getCurrentExams().find(e => e.id === examId);
    if (!exam || exam.task_count === 0) return 0;
    return Math.round((exam.done_count / exam.task_count) * 100);
}
```

**Important note:** The existing `GET /exams` endpoint computes `done_count` and `task_count` via SQL. After adding `deferred` status, the `task_count` query must remain `COUNT(*) FROM tasks WHERE exam_id = ?` (all tasks including deferred), while `done_count` stays `COUNT(*) WHERE status = 'done'`. The overall exam % per the locked decision is `total completed / total tasks * 100` — this is what the current backend already computes.

### Pattern 3: CSS Color Transition on Progress Bar (New)

**What:** Bar color changes at thresholds as width increases.

**Approach (class-swap at thresholds) — recommended for Tailwind:**
```javascript
function getXPBarColorClass(pct) {
    if (pct >= 100) return 'bg-mint-500';       // bright green
    if (pct >= 67)  return 'bg-mint-400';        // green
    if (pct >= 34)  return 'bg-gold-400';        // yellow
    return 'bg-gold-500';                        // orange/gold
}
```

The bar `div` gets both `transition-all duration-500` (Tailwind) and its color class updated on every re-render. CSS transitions handle smooth color changes between classes when the class is swapped.

**Glow burst on 100%:**
```css
@keyframes glow-burst {
    0%   { box-shadow: 0 0 0px rgba(16, 185, 129, 0); }
    40%  { box-shadow: 0 0 16px rgba(16, 185, 129, 0.9), 0 0 32px rgba(16, 185, 129, 0.4); }
    100% { box-shadow: 0 0 0px rgba(16, 185, 129, 0); }
}
.xp-bar-glow {
    animation: glow-burst 1.2s ease-out forwards;
}
```

Applied via JS: when pct transitions to 100, add `.xp-bar-glow` class; remove after animation completes.

### Pattern 4: Defer Task — Backend Atomic Operation (New)

**What:** PATCH endpoint that atomically marks the original task `deferred` and inserts a copy on the next calendar day.

```python
@router.patch("/tasks/{task_id}/defer")
def defer_task(task_id: int, current_user: dict = Depends(get_current_user)):
    db = get_db()
    try:
        task = db.execute(
            "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
            (task_id, current_user["id"])
        ).fetchone()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        task = dict(task)

        # Compute next day from current day_date
        from datetime import date, timedelta
        original_date = task["day_date"] or date.today().isoformat()
        next_date = (date.fromisoformat(original_date) + timedelta(days=1)).isoformat()

        # 1. Mark original task as deferred, set original_date
        db.execute(
            """UPDATE tasks SET status = 'deferred', original_date = ?
               WHERE id = ? AND user_id = ?""",
            (original_date, task_id, current_user["id"])
        )

        # 2. Insert copy for next day, linked back
        cursor = db.execute(
            """INSERT INTO tasks
               (user_id, exam_id, title, topic, subject, deadline,
                estimated_hours, difficulty, status, day_date, sort_order,
                original_date, linked_task_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)""",
            (
                current_user["id"], task["exam_id"], task["title"],
                task["topic"], task["subject"], task["deadline"],
                task["estimated_hours"], task["difficulty"],
                next_date,
                task.get("sort_order", 0),
                original_date,
                task_id
            )
        )
        new_task_id = cursor.lastrowid

        # 3. Update original task's linked_task_id to point forward
        db.execute(
            "UPDATE tasks SET linked_task_id = ? WHERE id = ?",
            (new_task_id, task_id)
        )

        db.commit()
        return {"message": "Task deferred", "new_task_id": new_task_id, "next_date": next_date}
    finally:
        db.close()
```

### Pattern 5: Database Migration (Additive — Existing Pattern)

**What:** Add columns with ALTER TABLE in `init_db()`, guarded by column existence check.

The project already does this for every new column (see `database.py` migrations section). Follow the exact same pattern:

```python
task_columns = {row[1] for row in conn.execute("PRAGMA table_info(tasks)").fetchall()}
if "original_date" not in task_columns:
    conn.execute("ALTER TABLE tasks ADD COLUMN original_date TEXT")
if "linked_task_id" not in task_columns:
    conn.execute("ALTER TABLE tasks ADD COLUMN linked_task_id INTEGER")
```

**Status enum constraint:** SQLite `CHECK` constraints on existing rows are NOT enforced retroactively on `ALTER TABLE`. To add `'deferred'` to the CHECK, the cleanest option is to drop and recreate the constraint via a table rebuild — but this is risky with live data. The safer approach: **remove the CHECK constraint** from the initial CREATE TABLE statement and enforce status values at the application layer (the Python route handlers) instead. Since this is SQLite and the constraint was in `CREATE TABLE IF NOT EXISTS` (only applied on first run), existing databases already have the constraint baked in and new values will fail.

**CRITICAL FINDING:** The existing `tasks` table has:
```sql
status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'done'))
```
Inserting `status='deferred'` will raise a `CHECK constraint failed` SQLite error on any database where the table already exists. The constraint cannot be modified with `ALTER TABLE` in SQLite.

**Solution:** Recreate the table via the SQLite "rename-recreate-copy-drop" pattern inside a migration guard, or simply set `status = 'deferred'` via a raw workaround: since SQLite only validates CHECK on new rows/updates (not on existing data), and we cannot easily modify the CHECK, the correct approach is to:
1. Create a NEW tasks table schema (in the migration) without the CHECK constraint
2. Copy all data over
3. Drop old table, rename new table

Or alternatively, use `UPDATE tasks SET status = 'deferred'` after dropping the constraint — but SQLite does not support `DROP CONSTRAINT`. The table-rebuild is the correct path.

**Simplest viable approach:** Since the app is pre-production (single developer, single SQLite file), run a one-time migration script that rebuilds the tasks table. Wrap it in a version guard in `init_db()`:

```python
# Check if 'deferred' status is already supported
try:
    conn.execute("INSERT OR IGNORE INTO tasks (id, user_id, title, estimated_hours, difficulty, status) VALUES (-1, -1, '_test_', 0, 0, 'deferred')")
    conn.execute("DELETE FROM tasks WHERE id = -1")
    # deferred status works — no migration needed
except Exception:
    # Need to rebuild tasks table to remove CHECK constraint
    conn.executescript("""
        CREATE TABLE tasks_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            exam_id INTEGER,
            title TEXT NOT NULL,
            topic TEXT,
            subject TEXT,
            deadline TEXT,
            estimated_hours REAL DEFAULT 1.0,
            difficulty INTEGER DEFAULT 3 CHECK(difficulty BETWEEN 0 AND 5),
            status TEXT DEFAULT 'pending',
            is_delayed INTEGER DEFAULT 0,
            day_date TEXT,
            sort_order INTEGER DEFAULT 0,
            original_date TEXT,
            linked_task_id INTEGER,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
        );
        INSERT INTO tasks_new SELECT *, NULL, NULL FROM tasks;
        DROP TABLE tasks;
        ALTER TABLE tasks_new RENAME TO tasks;
    """)
```

**Confidence: MEDIUM** — The test-insert approach works for SQLite but is fragile. Recommend testing locally before implementing. A simpler alternative: update the `INSERT INTO tasks_new SELECT *` to explicitly list columns to avoid schema mismatch.

### Anti-Patterns to Avoid

- **Full re-render on checkbox toggle:** The existing code already avoids this (does targeted DOM updates). Do not call `renderCalendar()` or `loadExams()` in the checkbox handler — it causes a visible flash. Keep the existing pattern: targeted DOM mutations + background API call + exam card refresh only.
- **Blocking spinner on defer:** No loading spinners on defer. Optimistic UI: mark deferred in store immediately, show the UI change, sync in background.
- **Separate Today's Focus event system:** Do not create new event types. Reuse the existing `window.dispatchEvent(new CustomEvent('task-toggle', ...))` pattern that `initTasks()` already listens to.
- **Computing progress from DOM:** Always compute progress from `store.currentTasks` and `store.currentExams`, never from the DOM. The DOM is a rendering artifact.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSS color interpolation | Custom JS lerp between hex colors | CSS `transition` + class swap at thresholds | CSS handles smooth transitions natively; class-swap is simpler and works with Tailwind |
| SQLite constraint modification | `ALTER TABLE ... MODIFY CONSTRAINT` | Table-rebuild migration (copy-rename pattern) | SQLite does not support `ALTER CONSTRAINT` |
| Real-time sync between tabs | WebSockets or polling | Shared in-memory store (already exists) | Single-tab app; store.js already handles state sharing between calendar.js and tasks.js |
| Animation library | GreenSock/Anime.js | CSS `@keyframes` + `animation` | Overkill for a single glow burst effect; no extra dependency needed |

**Key insight:** The codebase's ES6 module + central store pattern already solves the "sync between views" problem. Both the Today's Focus panel and the Calendar panel read from `store.currentTasks` — keeping that store updated is all that's needed for consistency.

---

## Common Pitfalls

### Pitfall 1: SQLite CHECK Constraint Blocks 'deferred' Status
**What goes wrong:** `db.execute("UPDATE tasks SET status = 'deferred' WHERE id = ?", ...)` raises `sqlite3.IntegrityError: CHECK constraint failed: tasks` because the existing schema has `CHECK(status IN ('pending', 'in_progress', 'done'))`.
**Why it happens:** The constraint was set at table creation time and cannot be removed with `ALTER TABLE`.
**How to avoid:** Run the table-rebuild migration in `init_db()` before any route that uses `deferred` status. Test with the dev database before shipping.
**Warning signs:** Any `UPDATE ... SET status = 'deferred'` crashes the server on first use.

### Pitfall 2: Today's Focus Checkbox Fires Double Toggle
**What goes wrong:** Tapping the checkbox in Today's Focus also triggers the calendar view checkbox (same task ID), resulting in two API calls.
**Why it happens:** The `task-toggle` event is global (`window.dispatchEvent`). If both panels render checkboxes with the same `data-task-id`, both will catch the event through the `_handleTaskToggle` listener added in `initTasks()`.
**How to avoid:** The calendar (hourly grid) dispatches `task-toggle` with both `taskId` AND `blockId`. Today's Focus tasks should dispatch with only `taskId` and no `blockId`. The `toggleDone` function already handles both cases — the lock key is `block-{blockId}` vs `task-{taskId}`. These are different keys, so concurrent toggle will not block, but the store update will run twice.
**Real fix:** The deduplication lock in `toggleDone` uses `task-{taskId}` when no blockId is given and `block-{blockId}` when a blockId is given. As long as the Today's Focus only dispatches `taskId` (no `blockId`), and the calendar dispatches both, there will be two API calls for the same underlying task. This is the existing behavior and is acceptable. The visual state is idempotent (marking done twice is a no-op).
**Warning signs:** Two PATCH requests appear in network tab when checking a task that appears in both panels simultaneously.

### Pitfall 3: Version Cache Mismatch on JS Modules
**What goes wrong:** Browser caches old `calendar.js?v=25` after new progress bar code is added, resulting in the new XP bar HTML being rendered but the old JS driving it.
**Why it happens:** The project uses query-string versioning (`?v=N`) on all module imports and stylesheet links. Each file has a hardcoded version.
**How to avoid:** Bump the version number on every modified JS file in its import references. Check `tasks.js` line 1 (`import ... from './calendar.js?v=25'`) and `index.html` (`/css/styles.css?v=26`) — both need bumping when those files change.
**Warning signs:** New HTML elements appear in DOM but JS event handlers don't attach, or old progress calculation runs.

### Pitfall 4: Defer Creates Orphaned Schedule Block
**What goes wrong:** The deferred task copy is created in `tasks` table, but no corresponding `schedule_blocks` row is created for the next day. The new task exists in the task list but never appears in the calendar.
**Why it happens:** The calendar renders from `schedule_blocks`, not directly from `tasks`. New tasks only appear in the calendar after `regenerate-schedule` runs.
**How to avoid:** Two options: (A) after deferring, trigger a lightweight schedule refresh that calls `POST /regenerate-schedule` silently, or (B) also create a `schedule_blocks` copy for the next day in the defer endpoint. Option B is simpler and more predictable.
**Warning signs:** Deferred task appears in task list count but never shows on the calendar for the next day.

### Pitfall 5: Progress Formula Divides by Zero
**What goes wrong:** `completed / (total - deferred) * 100` throws when all tasks for the day are deferred (denominator = 0).
**Why it happens:** Edge case: user defers every task for today.
**How to avoid:** Guard: `if (active.length === 0) return 0;` before the division. Show the bar at 0% (not broken) when no active tasks remain.

### Pitfall 6: Glow Animation Fires on Every Re-render at 100%
**What goes wrong:** Every time `renderXPBars()` is called while the bar is at 100%, the glow animation restarts.
**Why it happens:** Re-adding the CSS class (even if it's already there) restarts CSS animations.
**How to avoid:** Track whether the bar has already reached 100% and the glow has fired. Use a module-level flag: `let _barGlowFired = { daily: false, exam: {} }`. Only add the glow class and set the flag once; clear the flag when progress drops below 100%.

---

## Code Examples

### XP Bar HTML Structure (to add to index.html)
```html
<!-- Daily XP Bar — placed in Today's Focus panel -->
<div id="daily-xp-bar-container" class="mb-4">
    <div class="flex items-center justify-between mb-1">
        <span class="text-xs font-semibold text-white/50">TODAY'S XP</span>
        <span id="daily-xp-label" class="text-xs font-bold text-gold-400">0%</span>
    </div>
    <div class="h-2 bg-dark-900/60 rounded-full overflow-hidden">
        <div id="daily-xp-fill"
             class="h-full rounded-full transition-all duration-500 ease-out bg-gold-500"
             style="width: 0%"></div>
    </div>
</div>
```

### renderXPBars() Function (new, to add to calendar.js or tasks.js)
```javascript
const _barGlowFired = { daily: false };

export function renderXPBars() {
    // ── Daily Bar ──
    const today = new Date().toISOString().split('T')[0];
    const todayTasks = getCurrentTasks().filter(t => t.day_date === today);
    const activeTasks = todayTasks.filter(t => t.status !== 'deferred');
    const doneTasks = activeTasks.filter(t => t.status === 'done');
    const dailyPct = activeTasks.length > 0
        ? Math.round((doneTasks.length / activeTasks.length) * 100)
        : 0;

    const fill = document.getElementById('daily-xp-fill');
    const label = document.getElementById('daily-xp-label');
    if (fill) {
        fill.style.width = `${dailyPct}%`;
        // Color transition via class swap
        fill.className = fill.className
            .replace(/bg-(gold|mint)-(400|500)/g, '')
            .trim();
        if (dailyPct >= 100) {
            fill.classList.add('bg-mint-500');
            if (!_barGlowFired.daily) {
                fill.classList.add('xp-bar-glow');
                _barGlowFired.daily = true;
                setTimeout(() => fill.classList.remove('xp-bar-glow'), 1300);
            }
        } else if (dailyPct >= 67) {
            fill.classList.add('bg-mint-400');
            _barGlowFired.daily = false;
        } else if (dailyPct >= 34) {
            fill.classList.add('bg-gold-400');
            _barGlowFired.daily = false;
        } else {
            fill.classList.add('bg-gold-500');
            _barGlowFired.daily = false;
        }
    }
    if (label) label.textContent = `${dailyPct}%`;
}
```

### Defer API Call (frontend, in tasks.js)
```javascript
export async function deferTask(taskId) {
    const API = getAPI();
    const currentTasks = getCurrentTasks();
    const task = currentTasks.find(t => t.id === taskId);
    if (!task) return;

    // Optimistic: mark deferred in store
    task.status = 'deferred';
    renderTodayFocus(getCurrentTasks());
    renderXPBars();

    try {
        const res = await authFetch(`${API}/tasks/${taskId}/defer`, { method: 'PATCH' });
        if (!res.ok) throw new Error('Defer failed');
        const data = await res.json();
        // Silently refresh schedule to include the new task copy on next day
        // (triggers lightweight schedule refresh, not full loadExams)
        window.dispatchEvent(new CustomEvent('sf:defer-completed', { detail: { newTaskId: data.new_task_id } }));
    } catch (e) {
        // Rollback
        task.status = 'pending';
        renderTodayFocus(getCurrentTasks());
        renderXPBars();
        console.error('Defer failed:', e);
    }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tasks status: `pending`, `in_progress`, `done` | Add `deferred` to enum | Phase 15 | Requires SQLite table rebuild migration |
| Today's Focus: read-only list | Today's Focus: interactive checkboxes | Phase 15 | Reuses existing `task-toggle` event system |
| Progress shown only on exam cards (text %) | XP bars in Today's Focus + exam master bar | Phase 15 | CSS transitions, no new backend endpoints |
| No defer mechanism | Push-to-next-day with linked task history | Phase 15 | New PATCH endpoint + schedule copy logic |

---

## Open Questions

1. **Where exactly does the defer button appear?**
   - What we know: User decision says placement is Claude's discretion
   - What's unclear: Whether defer is a button in Today's Focus, a swipe gesture on calendar blocks, or a long-press context menu
   - Recommendation: Use a small "Defer" button next to each task in Today's Focus panel (simplest, most accessible). On the calendar hourly grid, the existing double-tap edit modal could gain a "Defer" option. Avoid adding a third gesture — the codebase already has long-press (drag), double-tap (edit), and swipe (delete).

2. **Does deferring create a schedule_blocks row immediately or wait for next regeneration?**
   - What we know: The calendar renders from `schedule_blocks`, not `tasks`. The defer endpoint creates a new task row but says nothing about blocks.
   - What's unclear: Whether the deferred copy should appear immediately in the calendar or only after regeneration.
   - Recommendation: Create a `schedule_blocks` row in the defer endpoint (copy the original block's time slot to the next day). This gives immediate visual feedback in the calendar without requiring a full regeneration.

3. **What does "today's denominator" mean for `schedule_blocks` vs `tasks`?**
   - What we know: Progress formula uses `tasks` table status. But the hourly grid renders from `schedule_blocks`. A block can be completed (`completed=1`) independently of `tasks.status`.
   - What's unclear: Should the daily XP bar be based on `tasks.status` (the existing store field) or `schedule_blocks.completed` (the per-block checkbox state)?
   - Recommendation: Use `tasks.status` for progress calculation, consistent with the locked decision formulas. The `schedule_blocks.completed` field is for the per-block visual state; a task can have multiple blocks in a day. For simplicity, treat one task = one unit of daily progress.

4. **Exam Master Bar: does task_count in GET /exams include deferred tasks?**
   - What we know: Current query is `SELECT COUNT(*) FROM tasks WHERE exam_id = ?` — includes all statuses.
   - What's unclear: After adding `deferred`, should exam master bar use `total tasks (including deferred)` or `total non-deferred tasks`?
   - Recommendation: Per locked decision: "Overall Exam % = total completed / total tasks in roadmap * 100". This means deferred tasks stay in the denominator for exam progress (they are still tasks to complete, just moved). The existing `task_count` query is already correct. Only the daily bar excludes deferred from denominator.

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection of `/Users/eyalatar/Desktop/try /studyflow/backend/server/database.py` — schema, migrations pattern
- Direct code inspection of `/Users/eyalatar/Desktop/try /studyflow/backend/tasks/routes.py` — existing route patterns, optimistic toggle endpoints
- Direct code inspection of `/Users/eyalatar/Desktop/try /studyflow/frontend/js/tasks.js` — existing `toggleDone` optimistic UI implementation
- Direct code inspection of `/Users/eyalatar/Desktop/try /studyflow/frontend/js/calendar.js` — `renderTodayFocus`, `renderHourlyGrid`, `renderExamLegend` patterns
- Direct code inspection of `/Users/eyalatar/Desktop/try /studyflow/frontend/js/store.js` — central store structure
- Direct code inspection of `/Users/eyalatar/Desktop/try /studyflow/frontend/css/styles.css` — existing animation patterns (`@keyframes`, `.just-completed`, `.is-completed`)
- Direct code inspection of `/Users/eyalatar/Desktop/try /studyflow/frontend/js/ui.js` — `examColorClass`, `spawnConfetti` patterns
- SQLite official documentation on CHECK constraints and ALTER TABLE limitations (training knowledge, confirmed by code inspection that the constraint exists)

### Secondary (MEDIUM confidence)
- Project conventions in `.planning/codebase/CONVENTIONS.md` — naming patterns, error handling patterns
- Project architecture in `.planning/codebase/ARCHITECTURE.md` — layer responsibilities
- Phase 15 CONTEXT.md — locked user decisions

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — No new dependencies; all patterns confirmed by reading existing code
- Architecture: HIGH — Follows exact same patterns as Phases 8–14 (migrations, optimistic UI, module events)
- SQLite CHECK constraint pitfall: MEDIUM-HIGH — Confirmed by reading schema in database.py; SQLite behavior is well-known
- Defer + schedule_blocks interaction: MEDIUM — Open question #2 not fully resolved; requires planner decision
- Pitfalls: HIGH — Identified from direct code reading (version cache pattern, double-toggle pattern, zero-division edge case)

**Research date:** 2026-02-24
**Valid until:** 2026-03-24 (stable stack — 30 day window is safe)
