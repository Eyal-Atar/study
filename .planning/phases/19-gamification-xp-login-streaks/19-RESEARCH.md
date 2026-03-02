# Phase 19: Gamification (XP, Login Streaks, Morning Prompt) - Research

**Researched:** 2026-03-03
**Domain:** Gamification mechanics, SQLite migrations, FastAPI routing, vanilla JS frontend
**Confidence:** HIGH (all findings derived from direct codebase inspection)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Achievements Tab located within Profile tab (modal-settings) as a scrollable panel — NOT a new navigation tab
- Login streak splash only when streak >= 3 days; milestone splashes at 7, 14, 30 days; auto-dismiss 3-5s
- Broken streak: counter reset to 0, gentle disappointment icon in Achievements Tab
- Morning Prompt: modal on first login of day; shows unfinished tasks from yesterday; "Reschedule today" action only
- Rescheduling uses automatic placement respecting sleep hours, study quota, break/hobby time; priority by focus_score; if no fit, ask user to choose: reschedule / delete / skip
- After rescheduling: modal closes, return to daily view — no intermediate success message
- Two separate (non-nested) progress circles: Daily XP (resets midnight, user timezone) and Overall XP across exam period
- Circles ~80-100px diameter, placed below achievement badges; minimal labels only ("Daily", "Overall"), no numbers
- Badges shown newest-first; locked badges are hidden (no locked state displayed)
- XP formula: based on task focus_score (harder = more XP); level system 1-50

### Claude's Discretion
- Color gradients and exact shade choices for progress circles
- Exact splash screen animation/transition timings
- Whether to show level-up notifications (keep minimal)
- How to visually distinguish milestone splashes (7, 14, 30-day streaks)
- Specific badge icon designs and visual styles
- Badge organization strategy (content grows over time)
- Streak break detection strategy (background check vs login-based)

### Deferred Ideas (OUT OF SCOPE)
- Leaderboards or social sharing
- Custom badges or achievement creation
- Streaks for study hours (not just login)
- Notification fanfare on big milestones
- Achievement categories with filtering
</user_constraints>

---

## Summary

Phase 19 adds a quiet gamification layer to StudyFlow. All data lives in new SQLite tables added via the existing migration pattern in `database.py`. The backend exposes a new `gamification` router mounted in `server/__init__.py`. The frontend adds an Achievements tab into the existing Profile Settings modal and a Morning Prompt modal that fires once per day.

The core implementation challenge is the login-first-of-day detection. The existing codebase has no `last_login` tracking. Every other gamification mechanic (XP, badges, streak display, morning prompt) depends on knowing "is this the user's first login today?" This must be solved first as the foundation.

The second key insight is that XP calculation ties directly to the existing `focus_score` column (INTEGER 1-10) on the `tasks` table. This column is already populated by the Auditor AI for every task. No changes to the task schema are needed for XP input data.

**Primary recommendation:** New `gamification` module (backend router + DB tables) with login-gate middleware pattern; all frontend wired through a new `gamification.js` module imported in `app.js`.

---

## Database Schema Changes

### Existing Schema Relevant to This Phase

From `backend/server/database.py`, the current tasks table (after Phase 17 migrations) has:

```sql
tasks (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    focus_score INTEGER DEFAULT 5,   -- range 1-10, populated by Auditor AI
    status TEXT CHECK(status IN ('pending', 'in_progress', 'done', 'deferred')),
    estimated_hours REAL,
    ...
)

schedule_blocks (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    task_id INTEGER,
    completed INTEGER DEFAULT 0,    -- 1 when user checks off a block
    ...
)

users (
    id INTEGER PRIMARY KEY,
    timezone_offset INTEGER DEFAULT 0,   -- minutes offset from UTC
    ...
)
```

The `completed` event on `schedule_blocks` is the correct XP award trigger — this is when the user checks the checkbox. Task status becomes `done` when all its blocks are completed.

### New Tables Required

```sql
-- Tracks per-user XP and level state
CREATE TABLE IF NOT EXISTS user_xp (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    total_xp INTEGER DEFAULT 0,
    current_level INTEGER DEFAULT 1,
    daily_xp INTEGER DEFAULT 0,
    daily_xp_date TEXT,               -- YYYY-MM-DD in user's local timezone; resets when date changes
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Tracks login streak state
CREATE TABLE IF NOT EXISTS user_streaks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_login_date TEXT,             -- YYYY-MM-DD in user's local timezone
    streak_broken INTEGER DEFAULT 0,  -- flag: 1 if streak broke since last splash shown
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Stores earned badges (one row per earned badge)
CREATE TABLE IF NOT EXISTS user_badges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    badge_key TEXT NOT NULL,          -- e.g. "iron_will_7", "knowledge_seeker_50"
    earned_at TEXT DEFAULT (datetime('now')),
    UNIQUE (user_id, badge_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

**Migration pattern:** Follow the established `database.py` pattern — check existing columns with `PRAGMA table_info`, then `ALTER TABLE` or full table rebuild as needed. New tables use `CREATE TABLE IF NOT EXISTS`.

**No changes to existing tables are needed.** The `focus_score` column already exists on `tasks`. The `completed` column already exists on `schedule_blocks`. The `timezone_offset` column already exists on `users`.

---

## XP Calculation Logic

### focus_score Range

From `exam_brain.py` line 356: `fs = max(1, min(10, int(fs)))` — confirmed range is 1-10. Auditor assigns this; AI prompt says "focus_score (1-10): concentration level required". Tasks with score >= 8 are placed in peak windows.

### XP Award Formula

Award XP when a `schedule_block` is toggled to `completed = 1` (the `task-toggle` event in `tasks.js`). The backend PATCH endpoint for block completion is the right place to compute and record XP.

Recommended formula:
```
xp_earned = round(focus_score * estimated_hours * 10)
```

Examples:
- focus_score=3, estimated_hours=1.0 → 30 XP
- focus_score=8, estimated_hours=2.5 → 200 XP
- focus_score=10, estimated_hours=3.0 → 300 XP

This keeps XP meaningful and proportional to actual study effort. Range per task: ~15 XP (score=3, 0.5h) to ~350 XP (score=10, 3.5h).

### Level System

50 levels with fixed XP per level. Recommended: linear, 1000 XP per level.

```
level = min(50, floor(total_xp / 1000) + 1)
xp_in_current_level = total_xp % 1000
xp_to_next_level = 1000 - xp_in_current_level
```

Level 1: 0-999 XP, Level 2: 1000-1999 XP, ..., Level 50: 49000+ XP.

Daily XP resets at midnight in the user's local timezone. `daily_xp_date` stores the YYYY-MM-DD string; on each XP award, if the stored date != today, reset `daily_xp` to 0 before adding.

### Daily XP Circle Progress

The "daily" circle represents progress toward a daily XP goal. A sensible daily goal:
```
daily_goal = user.neto_study_hours * 4 * 100  # ~4 tasks/hour avg at focus_score ~4
```
Or simpler: fixed 400 XP/day as a reasonable target for a 4-hour study day.

Progress = `min(1.0, daily_xp / daily_goal)`

### Overall XP Circle Progress

Progress = `(total_xp % 1000) / 1000` — progress within current level.

### When XP Is Awarded

XP is awarded when `schedule_block.completed` changes from 0 to 1. The current backend PATCH route for blocks is in `tasks/routes.py`. The gamification router will expose a POST endpoint to record XP; the block PATCH handler calls it internally (or the block PATCH route handles both atomically).

**Important:** Toggling a completed block BACK to 0 does NOT subtract XP. XP is one-directional (only gained, never lost). This matches the "positive reinforcement only" philosophy.

---

## Login Streak Detection

### The Login-Gate Pattern

The existing `initDashboard()` in `app.js` runs on every successful auth check. It calls `loadExams()` and other init functions. The login streak and morning prompt checks must happen here, once per session, gated by "first login of the day."

**Implementation: backend login-gate endpoint.**

Create `POST /gamification/login-check` which the frontend calls once at the start of every session (from `initDashboard()`). The backend:
1. Calculates today's date in user's local timezone using `timezone_offset`
2. Reads `user_streaks.last_login_date`
3. If `last_login_date` == today → already logged in today, return `{first_login_today: false}`
4. If `last_login_date` == yesterday → streak continues, increment; return `{first_login_today: true, streak: N, morning_prompt_needed: ...}`
5. If `last_login_date` < yesterday or NULL → streak broken, reset to 1; return `{first_login_today: true, streak: 1, streak_broken: true, ...}`
6. Update `last_login_date = today`

**What counts as a login:** Any successful `GET /auth/me` response followed by `POST /gamification/login-check`. This happens naturally in `initDashboard()`.

### Streak Break Detection

Login-based detection (not a background job). When the user opens the app, the backend computes the gap between `last_login_date` and today. If gap > 1 day, streak is broken. This is simple, reliable, and requires no scheduler.

**Edge case: timezone crossing.** Use `user.timezone_offset` (stored in minutes) to compute the user's local date. Existing pattern from `brain/routes.py`:
```python
now_utc = datetime.now(timezone.utc)
local_now = now_utc - timedelta(minutes=tz_offset or 0)
today_str = local_now.strftime("%Y-%m-%d")
```

### "Splash Shown Today" Flag

Store in `localStorage` as `sf_streak_splash_date = YYYY-MM-DD` (in the user's local date). At startup, if `sf_streak_splash_date != today`, the splash is eligible to show. After showing, set `sf_streak_splash_date = today`. This prevents re-showing the splash if the user refreshes the PWA.

The "gentle disappointment on broken streak" in the Achievements Tab is a UI-only state derived from the `streak` value being 1 after a break — no separate flag needed. The backend returns `streak_broken: true` in the login-check response so the frontend can show it once.

---

## Morning Prompt Integration

### Trigger Condition

Morning prompt fires if `first_login_today: true` AND there are unfinished tasks from yesterday.

"Yesterday's unfinished tasks" = tasks where:
- `day_date = yesterday_str` (user's local timezone)
- `status IN ('pending', 'in_progress')`

The login-check endpoint returns `morning_prompt_needed: true` and the list of yesterday's pending tasks.

### Rescheduling Algorithm

The existing `rollover_tasks()` function in `brain/routes.py` already moves past-date tasks to today by setting `day_date = today`. The morning prompt is a UX layer on top of this existing mechanism.

```python
def rollover_tasks(db, user_id, tz_offset):
    """Move incomplete tasks from the past to today."""
    # Already exists — sets day_date = today, is_delayed = 1
```

The morning prompt workflow:
1. User sees modal listing yesterday's unfinished tasks
2. User taps "Reschedule today" per task — this calls the existing rollover logic for that task
3. If there is no room (time quota exceeded), the backend responds with a conflict status, and the frontend prompts: "No room today — reschedule, delete, or skip?"
4. After all tasks are handled, the frontend fires `calendar-needs-refresh` (existing event)

**Capacity check:** After marking a task for rescheduling today, verify the daily quota is not exceeded:
```python
today_blocks = db.execute(
    "SELECT SUM(estimated_hours) FROM tasks WHERE user_id=? AND day_date=? AND status != 'done'",
    (user_id, today_str)
).fetchone()[0] or 0
capacity_exceeded = today_blocks + task.estimated_hours > user.neto_study_hours
```

### New Endpoints Needed

```
POST /gamification/login-check
  → returns: { first_login_today, streak, streak_broken, morning_tasks: [...], badges_newly_earned: [...] }

POST /gamification/reschedule-task/{task_id}
  → action: "reschedule" | "delete" | "skip"
  → reschedule: sets day_date = today, is_delayed = 1, calls regenerate_schedule
  → delete: sets status = 'deferred' or deletes task
  → skip: no change (task remains at yesterday's date, will stop showing in prompt)

GET /gamification/summary
  → returns: { xp: {total, level, daily, daily_goal}, streak: {current, longest}, badges: [...] }

POST /gamification/award-xp  (internal — called when block is completed)
  → body: { task_id, block_id }
  → computes focus_score * estimated_hours * 10
  → updates user_xp table
  → checks badge unlock conditions
  → returns: { xp_earned, new_total, new_level, level_up, badges_earned: [...] }
```

### Integration Point in Existing Block Completion

The task-toggle flow in `tasks.js` → `PATCH /tasks/blocks/{block_id}` → marks `completed = 1`. After the PATCH succeeds, the frontend fires a `POST /gamification/award-xp` call. This keeps XP decoupled from block completion and allows the gamification module to evolve independently.

---

## Frontend Architecture

### Profile.js (New File)

There is no `frontend/js/profile.js` currently. Create it as a new module. It handles:
- Achievements Tab rendering (badges, circles, streak)
- Gamification data fetching (`GET /gamification/summary`)
- XP update on task completion (listen for `task-toggle` events)

Import in `app.js`:
```javascript
import { initGamification } from './profile.js?v=AUTO';
// call from initDashboard():
try { initGamification(); } catch (e) { console.error('initGamification failed:', e); }
```

### Achievements Tab in Profile Settings Modal

The Profile Settings modal (`modal-settings`) has three tabs: Routine, Alerts, Account. Add a fourth tab button and pane:

```html
<button class="profile-tab-btn ..." data-target="tab-achievements">Achievements</button>
<div id="tab-achievements" class="profile-tab-pane hidden space-y-5">
    <!-- Streak display -->
    <!-- Badge grid -->
    <!-- XP circles (2 SVG circles side by side) -->
</div>
```

The existing `initProfileTabs()` in `ui.js` uses `querySelectorAll('.profile-tab-btn')` and `querySelectorAll('.profile-tab-pane')` — it will automatically pick up the new tab/pane without any code changes.

### SVG Progress Circles

Use pure SVG — no library needed. The pattern:
```html
<svg width="90" height="90" viewBox="0 0 90 90">
  <circle cx="45" cy="45" r="38" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="8"/>
  <circle cx="45" cy="45" r="38" fill="none" stroke="#6B47F5" stroke-width="8"
          stroke-dasharray="238.76"
          stroke-dashoffset="COMPUTED"
          stroke-linecap="round"
          transform="rotate(-90 45 45)"/>
</svg>
```

`stroke-dasharray` = circumference = 2 * PI * 38 = 238.76
`stroke-dashoffset` = circumference * (1 - progress_fraction)

Two circles side by side using flexbox. Labels "Daily" and "Overall" below each circle in small muted text (`text-xs text-white/40`). No numbers displayed (per constraint).

Color palette matching zen aesthetic:
- Daily circle: `#6B47F5` (accent-500) — matches existing primary color
- Overall/Level circle: `#10B981` (mint-500) — existing success color

CSS transition: `transition: stroke-dashoffset 0.6s ease-in-out` for smooth animation when XP updates.

### Streak Splash Screen

Implement as a new modal separate from `modal-settings`. Shown before the dashboard loads, auto-dismissed after 4 seconds.

```html
<div id="modal-streak-splash" class="modal-bg">
    <div class="...">
        <div id="streak-splash-icon">🔥</div>
        <div id="streak-splash-number">7</div>
        <div id="streak-splash-label">Day Streak!</div>
        <div id="streak-splash-message">You're building something great.</div>
    </div>
</div>
```

Milestone distinctions (Claude's discretion):
- 3-6 days: standard flame icon, subtle fade-in
- 7 days: larger icon, gold border on modal
- 14 days: dual flame icon, gold gradient text
- 30+ days: triple flame, full glow effect

Auto-dismiss with `setTimeout(() => showModal('modal-streak-splash', false), 4000)`.

### Morning Prompt Modal

```html
<div id="modal-morning-prompt" class="modal-bg modal-sheet">
    <div class="...">
        <h2>Yesterday's unfinished tasks</h2>
        <div id="morning-tasks-list"><!-- task rows injected by JS --></div>
        <button id="btn-morning-done">All done</button>
    </div>
</div>
```

Task rows render with a "Reschedule today" button per task. After all tasks are handled, close the modal and trigger `calendar-needs-refresh`.

### Startup Sequence (First Login of Day)

```javascript
// In initDashboard(), AFTER loadExams() completes:
const gamResult = await authFetch(`${API}/gamification/login-check`, { method: 'POST' });
const gam = await gamResult.json();

if (gam.first_login_today) {
    // 1. Show streak splash if eligible
    if (gam.streak >= 3 && !splashShownToday()) {
        showStreakSplash(gam.streak, gam.streak_broken);
        markSplashShownToday();
        // Auto-dismiss after 4s, then show morning prompt
        setTimeout(() => {
            showModal('modal-streak-splash', false);
            if (gam.morning_tasks?.length > 0) showMorningPrompt(gam.morning_tasks);
        }, 4000);
    } else if (gam.morning_tasks?.length > 0) {
        showMorningPrompt(gam.morning_tasks);
    }
}
```

### XP Update After Task Completion

In `tasks.js` `_handleTaskToggle`, after the PATCH succeeds and `isDone` transitions to true (block is now completed):

```javascript
// Award XP for completed block
authFetch(`${API}/gamification/award-xp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: taskId, block_id: blockId })
}).then(r => r.json()).then(xpResult => {
    if (xpResult.xp_earned > 0) updateXPDisplay(xpResult);
    if (xpResult.level_up) showLevelUpNotification(xpResult.new_level);
    if (xpResult.badges_earned?.length > 0) showBadgeNotification(xpResult.badges_earned);
}).catch(() => {}); // XP failure is non-blocking
```

---

## Badge Definitions

Recommended initial badge set (mix of streak, task volume, and special milestones):

| badge_key | Name | Criterion | Check Timing |
|-----------|------|-----------|--------------|
| `first_step` | First Step | First task completed | award-xp |
| `iron_will_3` | Iron Start | 3-day streak | login-check |
| `iron_will_7` | Iron Will | 7-day streak | login-check |
| `iron_will_14` | Fortnight | 14-day streak | login-check |
| `iron_will_30` | Unstoppable | 30-day streak | login-check |
| `knowledge_seeker_10` | Quick Start | 10 tasks completed | award-xp |
| `knowledge_seeker_50` | Knowledge Seeker | 50 tasks completed | award-xp |
| `knowledge_seeker_100` | Century | 100 tasks completed | award-xp |
| `deep_focus` | Deep Focus | Complete a focus_score=10 task | award-xp |
| `level_10` | Rising Scholar | Reach Level 10 | award-xp |
| `level_25` | Dedicated | Reach Level 25 | award-xp |
| `level_50` | Master | Reach Level 50 | award-xp |

Badge unlock check in `award-xp` and `login-check`:
```python
def check_and_award_badges(db, user_id, user_xp_row, streak_row) -> list[str]:
    existing = {r['badge_key'] for r in db.execute(
        "SELECT badge_key FROM user_badges WHERE user_id = ?", (user_id,)
    ).fetchall()}
    newly_earned = []

    tasks_done = db.execute(
        "SELECT COUNT(*) FROM schedule_blocks WHERE user_id = ? AND completed = 1",
        (user_id,)
    ).fetchone()[0]

    # ... check each badge criterion, INSERT if not in existing
    return newly_earned
```

---

## Common Pitfalls

### Pitfall 1: Timezone Date Calculation for Streak
**What goes wrong:** Using UTC date for streak comparison causes streaks to break for users in positive UTC offsets (midnight UTC is still "yesterday" local time for most users).
**How to avoid:** Always compute local date as `local_now = datetime.now(timezone.utc) - timedelta(minutes=tz_offset)` then `local_now.strftime("%Y-%m-%d")`. This pattern is already used throughout `brain/routes.py`.

### Pitfall 2: Double XP on Task Toggle Undo
**What goes wrong:** User marks block done, gets XP. User untogles it (sets back to pending). User retogles done — gets XP again.
**How to avoid:** Check `user_badges` or a separate `xp_events` table for whether XP was already awarded for this block_id. Simple approach: add a `xp_awarded INTEGER DEFAULT 0` column to `schedule_blocks` — set to 1 when XP is awarded, never award XP again if this flag is set.

### Pitfall 3: award-xp Failure Blocking Task Toggle UX
**What goes wrong:** The XP API call fails (network, DB error), and the error bubbles up to break the task-toggle UI.
**How to avoid:** The XP call must be fire-and-forget with `.catch(() => {})`. Task completion UX is already complete before XP is processed. Never await XP in the critical path of task-toggle.

### Pitfall 4: Morning Prompt Showing After Rollover Already Ran
**What goes wrong:** `rollover_tasks()` already moves past-date tasks to today when `regenerate-schedule` runs. By the time morning prompt fires, the tasks are already on today — but the prompt says "yesterday's tasks."
**How to avoid:** The login-check endpoint runs BEFORE `loadExams()` triggers regenerate-schedule. OR: query for `is_delayed = 1` tasks (already rolled over) rather than `day_date = yesterday`. The `is_delayed` flag is set by `rollover_tasks()` and clearly marks "these were moved from a previous day."

Query for morning prompt tasks:
```sql
SELECT * FROM tasks
WHERE user_id = ?
  AND status != 'done'
  AND is_delayed = 1
  AND day_date = ?  -- today_str (already rolled over)
ORDER BY focus_score DESC
```

### Pitfall 5: initProfileTabs() Runs Before Achievements Tab HTML Exists
**What goes wrong:** `initProfileTabs()` in `ui.js` is called from `initApp()` before `modal-settings` is fully initialized. If the Achievements tab button is added dynamically, it won't be picked up.
**How to avoid:** Add the Achievements tab button and pane directly in `index.html` (static HTML), not via JavaScript injection. `initProfileTabs()` uses `querySelectorAll` at call time — it will find all `.profile-tab-btn` elements including the new one.

### Pitfall 6: Daily XP Reset Race Condition
**What goes wrong:** `daily_xp_date` is today, but the user crosses midnight and completes another task — `daily_xp` should reset but doesn't because the check only happens in `award-xp`.
**How to avoid:** `GET /gamification/summary` also checks `daily_xp_date` vs today and returns `daily_xp = 0` (and resets DB) if the date has changed. The summary endpoint is fetched fresh every time the Achievements tab opens.

---

## Architecture Patterns

### New Backend Module

Create `backend/gamification/` alongside the existing `brain/`, `users/`, `tasks/` modules:

```
backend/gamification/
├── __init__.py
├── routes.py      # FastAPI router with /gamification/* endpoints
└── utils.py       # XP calc, badge check, streak update functions
```

Register in `server/__init__.py`:
```python
from gamification.routes import router as gamification_router
app.include_router(gamification_router, prefix="/gamification", tags=["gamification"])
```

Also add `gamification` module to `init_db()` in `database.py` (or have `gamification/utils.py` handle its own migrations via the existing pattern).

### New Frontend Module

Create `frontend/js/profile.js` (the previously referenced but non-existent file):
- Exports `initGamification()` — called from `app.js:initDashboard()`
- Exports `updateXPDisplay(xpResult)` — called from `tasks.js` after block completion
- Handles Achievements Tab rendering, splash screen, morning prompt modal

---

## Implementation Approach Summary

**Order of implementation (dependency-safe):**

1. **DB migrations** — add `user_xp`, `user_streaks`, `user_badges` tables. Add `xp_awarded` column to `schedule_blocks`.

2. **Backend gamification module** — `GET /gamification/summary`, `POST /gamification/login-check`, `POST /gamification/award-xp`, `POST /gamification/reschedule-task/{task_id}`.

3. **HTML changes** — add Achievements tab button + pane to `modal-settings` in `index.html`; add streak splash modal; add morning prompt modal.

4. **Frontend profile.js** — implement `initGamification()`, Achievements Tab rendering, SVG circles, badge grid.

5. **Startup sequence** — wire `login-check` call into `initDashboard()` in `app.js`; trigger splash + morning prompt.

6. **XP wiring** — add `award-xp` fire-and-forget call in `tasks.js` after successful block toggle to done.

7. **Morning prompt** — implement reschedule/delete/skip per-task logic; wire to `calendar-needs-refresh`.

---

## Known Constraints

- **SQLite is locked during concurrent writes** — WAL mode is already enabled (`PRAGMA journal_mode=WAL`). The `gamification` module must use the same `get_db()` pattern. Avoid long-held transactions.
- **No separate cron/scheduler for streak detection** — login-based detection only. Users who never log in will have their streak break naturally on next login.
- **No external libraries** — SVG circles are pure SVG (no Chart.js, no canvas). Splash animations are CSS transitions only.
- **Module system** — all new JS must use ES6 module syntax (`export`/`import`) matching existing files; imported with `?v=AUTO` cache-busting pattern.
- **focus_score range** — 1-10 (verified from `exam_brain.py` validation code). Default is 5 when not set.
- **No separate profile.js exists** — must create from scratch; this is a net-new file.

---

## Sources

### Primary (HIGH confidence — direct codebase inspection)
- `backend/server/database.py` — full schema, migration patterns, all existing columns
- `backend/brain/exam_brain.py` — focus_score range (1-10), AI prompt structure
- `backend/brain/routes.py` — existing login/rollover patterns, rollover_tasks(), tz_offset handling
- `backend/brain/scheduler.py` — how neto_study_hours quota works, task placement
- `backend/server/__init__.py` — router registration pattern, how to add new modules
- `frontend/js/app.js` — initDashboard() hook point, existing startup sequence
- `frontend/js/tasks.js` — task-toggle flow, PATCH endpoint, XP integration point
- `frontend/js/calendar.js` — task-checkbox DOM event dispatch
- `frontend/js/ui.js` — initProfileTabs(), showModal(), existing tab system
- `frontend/js/store.js` — store pattern for caching gamification state
- `index.html` — Profile Settings modal structure, tab buttons, pane layout

### Architecture Decisions (HIGH confidence — derived from code patterns)
- Login-gate via `POST /gamification/login-check` matches existing auth pattern
- `is_delayed = 1` flag is the correct way to identify morning prompt tasks (already set by `rollover_tasks()`)
- Pure SVG circles (no library) aligns with zero-dependency frontend approach
- Fire-and-forget XP call matches existing notification pattern in tasks.js

---

## RESEARCH COMPLETE
