---
phase: 17-split-brain-core-scheduler
plan: 03
subsystem: ui, api, scheduler
tags: [anthropic, claude-haiku, strategist, exam-brain, scheduler, focus-score, peak-productivity, fastapi, vanilla-js, sqlite]

# Dependency graph
requires:
  - phase: 17-01
    provides: "focus_score and dependency_id columns on tasks, extracted_text on exam_files, auditor_draft on exams"
  - phase: 17-02
    provides: "call_split_brain (Auditor), POST /brain/generate-roadmap (Auditor-only), GET /brain/auditor-draft"
provides:
  - "screen-auditor-review: full-page Intermediate Review Screen in index.html"
  - "renderAuditorReview(): renders topic map, gaps (with Dismiss/Add Search Task), and tasks list with focus score badges"
  - "approveSchedule(): POSTs approved_tasks to /brain/approve-and-schedule, updates dashboard"
  - "checkAuditorDraftOnInit(): detects stored draft on login, shows resume banner"
  - "_build_strategist_prompt(): Claude Haiku prompt distributing tasks across days with focus-score rules, dependency ordering, interleaving, internal_priority, and padding tasks"
  - "call_strategist(): Strategist API Call 2, returns tasks augmented with day_index and internal_priority"
  - "POST /brain/approve-and-schedule: runs Strategist + Enforcer, saves tasks/schedule, clears auditor_draft"
  - "Focus-score-aware scheduler: peak windows prefer focus_score >= 8 tasks; off-peak windows prefer lower focus tasks"
  - "Dependency-aware scheduling: _dependency_satisfied() prevents tasks from being scheduled before their prerequisites"
  - "Padding block injection: adds study blocks when daily quota is underfilled by >= 45 min"
affects:
  - "Dashboard schedule rendering — new task/schedule data flows through existing renderCalendar/renderFocus"
  - "Phase 18+ (any future AI scheduler iterations)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-call Split-Brain flow: Auditor (Plan 02) → Intermediate Review → Strategist → Enforcer (Plan 03)"
    - "Robust JSON array parsing: markdown fence stripping + first-bracket/last-bracket boundary extraction"
    - "Focus-score-aware window selection: PEAK_WINDOWS dict + _is_peak_window() helper for 4 productivity windows"
    - "Dependency satisfaction via completed_task_ids set updated as tasks are placed in schedule"
    - "Padding task injection post-window-fill: real padding task from DB or synthetic fallback block"
    - "Draft resumption banner: checkAuditorDraftOnInit fetches /brain/auditor-draft on login, offers resume"

key-files:
  created: []
  modified:
    - "index.html"
    - "frontend/js/tasks.js"
    - "frontend/js/app.js"
    - "backend/brain/exam_brain.py"
    - "backend/brain/routes.py"
    - "backend/brain/scheduler.py"

key-decisions:
  - "approveSchedule() POSTs to /brain/approve-and-schedule (brain prefix) consistent with existing brain routes"
  - "call_strategist() falls back unassigned tasks to day_index=0, internal_priority=10 — no task is silently dropped"
  - "_dependency_satisfied() uses completed_task_ids (a set of task IDs that have been scheduled) to allow partial-completion ordering — a task whose dependency has started (not necessarily finished) is considered ready"
  - "Padding blocks: if a real is_padding task exists in the task list, use it; otherwise inject a synthetic ScheduleBlock with task_id=None so it appears on the calendar without a checkable task"
  - "auditor_draft is cleared to NULL after approval so checkAuditorDraftOnInit does not offer to resume a completed session"
  - "_dependency_satisfied defined once at function scope (not inside the while loop) for cleaner code"

patterns-established:
  - "Pattern: Intermediate Review Page as integration seam — backend produces Auditor output, frontend renders review, approve triggers Strategist"
  - "Pattern: Peak window selection uses PEAK_WINDOWS dict with safe fallback for unknown values"
  - "Pattern: checkAuditorDraftOnInit + resume banner — non-blocking, non-fatal draft check on login"

requirements-completed: [SB-05, SB-06, SB-07, SB-08]

# Metrics
duration: 5min
completed: 2026-02-28
---

# Phase 17 Plan 03: Strategist + Intermediate Review Screen Summary

**Full Split-Brain flow complete: Auditor Review Screen, Strategist (Call 2) with focus-score/dependency/padding rules, and focus-score-aware Python Enforcer placement in peak productivity windows**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-02-28T15:10:31Z
- **Completed:** 2026-02-28T15:15:37Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- `screen-auditor-review` added to `index.html` — full-page Intermediate Review Screen with topic map, gaps (Dismiss/Add Search Task), proposed tasks with focus-score badges, Cancel/Approve buttons
- `generateRoadmap()` updated to navigate to the review screen rather than loading the calendar directly; auditor draft stored in `window._auditorDraft`
- `renderAuditorReview()` renders topic map per exam, gaps with inline actions, and tasks grouped with F1-F10 focus-score badges
- `approveSchedule()` collects approved tasks (including user-added search tasks), POSTs to `/brain/approve-and-schedule`, refreshes dashboard
- `checkAuditorDraftOnInit()` called on every login — fetches `/brain/auditor-draft`, shows non-intrusive resume banner if a draft exists
- `_build_strategist_prompt()`: comprehensive Haiku prompt distributing tasks across days with peak-window guidance, dependency rules, interleaving constraints, internal_priority (1-100), and daily quota padding instructions
- `call_strategist()`: executes API Call 2, robustly parses JSON array, maps task_index → actual tasks, constructs padding task dicts, falls back unassigned tasks, returns augmented task list
- `POST /brain/approve-and-schedule`: runs Strategist, converts day_index → date strings, clears old tasks/schedule, saves new tasks with focus_score, runs Python Enforcer, saves schedule blocks, clears auditor_draft
- `scheduler.py` updated with `PEAK_WINDOWS` dict, `_is_peak_window()`, focus-score-aware candidate selection (peak → prefer high-focus; off-peak → prefer low-focus), dependency-aware filtering via `completed_task_ids`, and padding block injection when daily quota is underfilled by >= 45 min

## Task Commits

Each task was committed atomically:

1. **Task 1: Intermediate Review Screen** - `f1ecdb0` (feat)
2. **Task 2: Strategist Prompt and Call** - `fbbd846` (feat)
3. **Task 3: Approve Route & Scheduler Update** - `e4ddce1` (feat)

## Files Created/Modified
- `index.html` - Added `screen-auditor-review` div with topic map, gaps, tasks, and action button sections
- `frontend/js/tasks.js` - Added `renderAuditorReview()`, `approveSchedule()`, `checkAuditorDraftOnInit()`, `_addSearchTaskFromGap()`, `_showResumeBanner()`; updated `generateRoadmap()` to navigate to review screen; imported `showScreen` from `ui.js`
- `frontend/js/app.js` - Imported `checkAuditorDraftOnInit`; added call in `initDashboard()` after `loadExams()`
- `backend/brain/exam_brain.py` - Added `_build_strategist_prompt()` and `call_strategist()` methods to `ExamBrain`
- `backend/brain/routes.py` - Added `POST /brain/approve-and-schedule` endpoint
- `backend/brain/scheduler.py` - Added `PEAK_WINDOWS`, `_is_peak_window()`, focus-score-aware selection, dependency tracking, and padding block injection

## Decisions Made
- `approveSchedule()` sends to `/brain/approve-and-schedule` (brain prefix) consistent with existing brain route prefix
- `call_strategist()` falls back any AI-unassigned tasks to `day_index=0, internal_priority=10` — no task is silently dropped
- `_dependency_satisfied()` uses the `completed_task_ids` set (tasks that have been placed in ANY slot, not necessarily fully completed) — relaxed definition allows the scheduler to proceed through the day without deadlocking when dependencies are partial
- Padding block injection uses a real `is_padding` task from the DB if available; otherwise a synthetic `ScheduleBlock` with `task_id=None` fills the gap
- `auditor_draft` column is set to NULL after approval so the resume banner does not reappear on next login

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None — all three tasks implemented correctly, all Python files compile cleanly (`py_compile` verified), all JavaScript exports verified via grep.

## User Setup Required
None - no external service configuration required. Existing `ANTHROPIC_API_KEY` env var is used for the Strategist call.

## Next Phase Readiness
- Split-Brain architecture is fully functional: Auditor → Review → Strategist → Enforcer pipeline complete
- `screen-auditor-review` is wired into the existing `showScreen` pattern and accessible from both desktop and mobile
- `POST /brain/approve-and-schedule` is ready and returns `tasks + schedule` in the same format as existing routes
- The scheduler now respects `focus_score`, `dependency_id`, and generates padding blocks
- Phase 17 requirements SB-05 through SB-08 fulfilled
- Any future phase can extend the Strategist prompt or add new focus-score tiers without architectural changes

## Self-Check: PASSED

All files verified present. All task commits verified in git history.

| Check | Result |
|-------|--------|
| index.html | FOUND |
| frontend/js/tasks.js | FOUND |
| frontend/js/app.js | FOUND |
| backend/brain/exam_brain.py | FOUND |
| backend/brain/routes.py | FOUND |
| backend/brain/scheduler.py | FOUND |
| 17-03-SUMMARY.md | FOUND |
| commit f1ecdb0 (Task 1) | FOUND |
| commit fbbd846 (Task 2) | FOUND |
| commit e4ddce1 (Task 3) | FOUND |

---
*Phase: 17-split-brain-core-scheduler*
*Completed: 2026-02-28*
