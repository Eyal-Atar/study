---
phase: 17-split-brain-core-scheduler
verified: 2026-02-28T18:00:00Z
status: gaps_found
score: 7/8 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 7/8
  gaps_closed: []
  gaps_remaining:
    - "Padding task is_padding flag not persisted to DB — scheduler real-padding branch is dead code"
  regressions: []
gaps:
  - truth: "Strategist generates padding tasks to hit the 360-minute daily quota"
    status: partial
    reason: "Padding tasks carry is_padding=True in memory (call_strategist) but approve-and-schedule saves them to the tasks table without an is_padding column. When the scheduler receives DB-read task rows, t.get('is_padding') is always None/falsy. The 'use real padding task from DB' branch (scheduler.py line 227) is dead code in practice. Padding blocks still appear on the calendar via the synthetic fallback (task_id=None), but they are never DB-backed tasks. Visual distinction still works because calendar.js uses title-prefix matching, not the is_padding flag."
    artifacts:
      - path: "backend/brain/routes.py"
        issue: "approve-and-schedule saves tasks to DB (lines 216-238) without is_padding column; DB-read rows passed to scheduler never carry is_padding=True"
      - path: "backend/brain/scheduler.py"
        issue: "Line 227 checks t.get('is_padding') on DB-read task rows — always None; real padding task branch unreachable in practice"
    missing:
      - "Option A: Add is_padding INTEGER DEFAULT 0 column to tasks table in database.py and persist task.get('is_padding', 0) in the INSERT inside approve-and-schedule"
      - "Option B: Change scheduler.py line 227 to detect padding tasks by title prefix — t.get('title', '').startswith(('General Review:', 'Solve Practice Problems:')) — consistent with calendar.js logic"
human_verification:
  - test: "Full end-to-end Split-Brain flow"
    expected: "Click Generate Roadmap -> Review screen appears with topics/gaps/tasks -> Approve -> Dashboard shows calendar"
    why_human: "Cannot verify AI API call returns valid JSON, review screen renders correctly in browser, or final calendar populates without running the live application"
  - test: "Draft resumption banner"
    expected: "Refresh page after generating roadmap but before approving — a non-intrusive banner appears at the top/bottom offering to Resume Review"
    why_human: "Requires live browser + server interaction to test page-refresh state persistence"
  - test: "Padding task visual distinction"
    expected: "Tasks titled 'General Review: ...' or 'Solve Practice Problems: ...' appear with double left border and amber Review badge in the calendar"
    why_human: "Visual rendering cannot be verified programmatically"
---

# Phase 17: Split-Brain Core Scheduler Verification Report

**Phase Goal:** Upgrade the single-call AI scheduling engine into a two-call Split-Brain architecture (Auditor + Strategist) with full PDF extraction, gap detection, user review page, hard daily quota enforcement, and focus-score-aware scheduling.
**Verified:** 2026-02-28
**Status:** gaps_found (one gap remaining from previous verification — not closed by Plans 17-04)
**Re-verification:** Yes — all 4 plans now complete; previous verification was after Plan 03

---

## Re-Verification Summary

The previous verification (also `gaps_found`, score 7/8) identified one gap: the `is_padding` flag is not persisted to the tasks table, making the scheduler's "use real DB padding task" branch unreachable. Plans 17-04 commits (`ef17616`, `eb97136`, `a5cd01e`) addressed Dashboard Sync, visual padding distinction, and legacy method removal — but did not fix the `is_padding` persistence gap.

All previously-passing items remain verified. No regressions detected.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | DB has focus_score and dependency_id on tasks, extracted_text on exam_files, auditor_draft on exams | VERIFIED | `database.py` lines 247-256, 258-296; confirmed in `study_scheduler.db` via PRAGMA |
| 2 | PDF extraction reads ALL pages (no cap) at upload time | VERIFIED | `exams/routes.py` lines 178-187: inline fitz extraction, all pages; `syllabus_parser.py` line 10: `max_pages=None` |
| 3 | Auditor context assembly concatenates all exam files with 700K char truncation | VERIFIED | `exam_brain.py` lines 39-96: `_build_all_exam_context` with `CHAR_LIMIT = 700_000` |
| 4 | Auditor call returns tasks/gaps/topic_map and is persisted to auditor_draft | VERIFIED | `exam_brain.py` lines 177-284: `call_split_brain`; `brain/routes.py` lines 75-86: draft persistence |
| 5 | screen-auditor-review exists and is wired to generateRoadmap, renderAuditorReview, approveSchedule | VERIFIED | `index.html` line 539; `tasks.js` lines 457-488, 491-665; `app.js` lines 14, 169 |
| 6 | Strategist distributes tasks across days with focus-score rules | VERIFIED | `exam_brain.py` lines 290-474: `_build_strategist_prompt` + `call_strategist` with padding logic |
| 7 | Scheduler places focus_score>=8 tasks in peak windows and handles dependencies | VERIFIED | `scheduler.py` lines 11-30 (PEAK_WINDOWS + `_is_peak_window`); lines 153-161 (peak/off-peak selection) |
| 8 | Strategist generates padding tasks to hit daily quota | PARTIAL | `call_strategist` sets `is_padding=True` in memory; `approve-and-schedule` saves all tasks to DB without `is_padding` column; scheduler receives DB rows where `t.get("is_padding")` is always None; real padding branch (scheduler.py line 227) is dead code; synthetic fallback used instead |

**Additionally verified (Plan 04 items):**

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 9 | Dashboard shows Daily Progress against neto_study_hours quota | VERIFIED | `index.html` lines 396-399, 434-437: "Daily Progress" label, `stat-done`, `daily-quota-progress` progress bar |
| 10 | Completing a task updates Daily Progress calculation | VERIFIED | `tasks.js` `updateStats()` lines 222-250: filters schedule blocks by today+study+completed=1, sums duration, calculates `dailyPct` |
| 11 | Obsolete single-call AI methods removed from ExamBrain | VERIFIED | grep for `analyze_all_exams`, `_analyze_single_exam_with_ai`, `_build_strategy_prompt` in `exam_brain.py` returns no matches; commit `a5cd01e` removed 134 lines |
| 12 | Auditor draft is cleared after schedule approval | VERIFIED | `brain/routes.py` lines 276-283: `UPDATE exams SET auditor_draft = NULL` after saving schedule |
| 13 | Padding tasks are visually distinct in calendar | VERIFIED | `calendar.js` lines 219-221: title prefix match + `block-padding` class + `padding-badge` span; `styles.css` lines 752-779: double border, saturate filter, amber badge |

**Score:** 7/8 must-have truths verified (the same gap as before)

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `backend/server/database.py` | Schema migrations for tasks, exam_files, exams | VERIFIED | focus_score + dependency_id on tasks (lines 247-251); auditor_draft on exams (lines 253-256); exam_files_new rebuild with extracted_text + updated CHECK (lines 258-296); confirmed in actual DB |
| `backend/brain/syllabus_parser.py` | Uncapped PDF text extraction | VERIFIED | Line 10: `max_pages: int = None`; loop iterates all pages |
| `backend/exams/routes.py` | Upload handler saves extracted_text | VERIFIED | Lines 176-196: async fitz extraction via run_in_executor; INSERT includes extracted_text |
| `backend/brain/exam_brain.py` | _build_all_exam_context, _build_auditor_prompt, call_split_brain, _build_strategist_prompt, call_strategist | VERIFIED | All 5 methods present and substantive (556 lines); legacy methods confirmed absent |
| `backend/brain/routes.py` | generate-roadmap (Auditor-only), auditor-draft GET, approve-and-schedule POST | VERIFIED | Lines 30-93, 96-125, 128-292 |
| `backend/brain/scheduler.py` | PEAK_WINDOWS, _is_peak_window, focus-score-aware selection, dependency tracking, padding injection | VERIFIED | Lines 11-30, 73-83, 153-161, 223-269; real padding branch has dead-code issue but synthetic fallback works |
| `index.html` | screen-auditor-review markup | VERIFIED | Lines 538-590: full review screen with topic map, gaps, tasks, Cancel/Approve buttons |
| `frontend/js/tasks.js` | renderAuditorReview, approveSchedule, checkAuditorDraftOnInit, updateStats with quota | VERIFIED | Lines 491-711 (review/approve/init); lines 222-251 (updateStats with neto_study_hours) |
| `frontend/js/calendar.js` | block-padding class and padding-badge on padding task titles | VERIFIED | Lines 219-221, 257: prefix match + class + badge injection |
| `frontend/css/styles.css` | .block-padding and .padding-badge styles | VERIFIED | Lines 752-779: double left border, saturate(0.7), amber badge |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `frontend/js/tasks.js` | `backend/brain/routes.py` | POST /approve-and-schedule | WIRED | `tasks.js` line 629: `authFetch(\`${API}/approve-and-schedule\`)` — brain router has no prefix in `__init__.py` |
| `backend/brain/routes.py` | `backend/brain/exam_brain.py` | call_split_brain invocation | WIRED | `routes.py` line 66: `await brain.call_split_brain()` |
| `backend/brain/routes.py` | `backend/brain/exam_brain.py` | call_strategist invocation | WIRED | `routes.py` line 168: `await brain.call_strategist(approved_tasks)` |
| `backend/brain/exam_brain.py` | `backend/brain/scheduler.py` | generate_multi_exam_schedule | WIRED | `routes.py` line 241: `generate_multi_exam_schedule(current_user, exam_list, saved_tasks)` |
| `backend/exams/routes.py` | `backend/server/database.py` | INSERT with extracted_text | WIRED | `exams/routes.py` lines 193-196: INSERT includes extracted_text |
| `frontend/js/app.js` | `frontend/js/tasks.js` | checkAuditorDraftOnInit on init | WIRED | `app.js` line 14 (import) + line 169 (call in initDashboard) |
| `backend/brain/exam_brain.py` (call_strategist) | `backend/brain/scheduler.py` | is_padding flag for real padding tasks | BROKEN | `call_strategist` sets `is_padding=True` in memory; `approve-and-schedule` saves all tasks to DB without `is_padding` column; `scheduler.py` line 227 checks `t.get("is_padding")` on DB rows — always None; real padding branch unreachable |

---

## Requirements Coverage

Note: SB-01 through SB-08 are phase-internal requirements defined only in ROADMAP.md and plan frontmatter. They do not appear in `.planning/REQUIREMENTS.md` (which tracks v1 user-facing requirements). No orphaned requirements found.

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SB-01 | 17-01 | DB schema: focus_score, dependency_id on tasks | SATISFIED | `database.py` lines 247-251; confirmed in actual DB |
| SB-02 | 17-01 | DB schema: extracted_text, auditor_draft; PDF extraction uncapped | SATISFIED | `database.py` lines 253-296; `syllabus_parser.py` line 10; `exams/routes.py` lines 176-196 |
| SB-03 | 17-02 | Auditor context assembly and prompt; call_split_brain | SATISFIED | `exam_brain.py` lines 39-284 |
| SB-04 | 17-02 | generate-roadmap Auditor-only; auditor_draft persistence; GET /auditor-draft | SATISFIED | `brain/routes.py` lines 30-125 |
| SB-05 | 17-03, 17-04 | Intermediate Review Screen; renderAuditorReview; approveSchedule; draft resumption | SATISFIED | `index.html`, `tasks.js`, `app.js` all wired |
| SB-06 | 17-03 | Strategist prompt + call; approve-and-schedule route | SATISFIED | `exam_brain.py` lines 290-474; `brain/routes.py` lines 128-292 |
| SB-07 | 17-03 | Focus-score-aware scheduler (PEAK_WINDOWS, dependency tracking, padding blocks) | SATISFIED | `scheduler.py` lines 11-30, 73-83, 153-161, 223-269 |
| SB-08 | 17-03, 17-04 | Daily quota progress bar; updateStats quota calculation | SATISFIED | `tasks.js` lines 222-251; `index.html` lines 396-437 |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `backend/brain/scheduler.py` | 227 | `t.get("is_padding")` on DB-read tasks — always None because no `is_padding` column in schema | Blocker (partial) | Real padding task branch is dead code; synthetic fallback is used instead. Padding blocks appear on calendar correctly (title prefix match in calendar.js still works). Functional impact is limited but the DB-backed padding task feature as designed is non-functional. |
| `backend/brain/syllabus_parser.py` | 22 | `extract_text_from_pdf(pdf_bytes, max_pages=5)` inside `extract_syllabus_context_with_ai()` still hardcodes max_pages=5 | Info | This function serves only the legacy `parsed_context` background job (not the Auditor path). No regression. |
| `.planning/ROADMAP.md` | 71-73 | Plans 17-01, 17-02, 17-03 listed as `[ ]` despite all having SUMMARY.md files | Info | Documentation tracking only; no code impact. |

---

## Human Verification Required

### 1. Full Split-Brain End-to-End Flow

**Test:** With ANTHROPIC_API_KEY set, add an exam with a PDF syllabus. Click "Generate Roadmap". Observe the Review Screen. Click "Approve & Generate Schedule".
**Expected:** Review Screen shows topic map per exam, gaps with Dismiss/Add Search Task buttons, proposed tasks with focus-score badges (F1-F10). After approval, dashboard shows a populated hourly calendar with high focus-score tasks in peak productivity windows.
**Why human:** Two live Claude Haiku API calls required; visual correctness of review screen layout and calendar placement cannot be asserted by static analysis.

### 2. Draft Resumption Banner

**Test:** Click "Generate Roadmap" (Auditor runs), then immediately refresh the page without approving.
**Expected:** After login/init, a non-intrusive banner appears offering to "Resume Review". Clicking it navigates to the review screen with the previously generated draft.
**Why human:** Requires real browser + server interaction to test page-refresh cycle and banner appearance.

### 3. Padding Task Visual Distinction

**Test:** Generate a schedule where total syllabus content is sparse so the Strategist generates padding tasks. Open the roadmap calendar.
**Expected:** Tasks titled "General Review: [Subject]" or "Solve Practice Problems: [Subject]" appear with a double left border, desaturated background, and amber "Review" badge.
**Why human:** Visual rendering cannot be verified programmatically.

---

## Gaps Summary

One gap carries over from the previous verification and was not addressed by Plans 17-04.

**Gap: is_padding data flow is broken between call_strategist and scheduler**

`call_strategist` correctly generates padding task dicts with `is_padding=True`. However, `approve-and-schedule` saves all tasks (including padding tasks) to the `tasks` table via a standard INSERT that does not include an `is_padding` column (no such column exists in the schema). The route then re-reads the saved tasks from the DB as dict rows (`saved_tasks`, lines 236-238), which of course have no `is_padding` attribute. These DB-read rows are passed to `generate_multi_exam_schedule`.

Inside the scheduler, line 227 looks for `t.get("is_padding")` to find a real padding task — always evaluates to None. The scheduler falls through to the synthetic block fallback, which creates a `ScheduleBlock` with `task_id=None`. This means padding tasks appear on the calendar but:

1. Are not connected to a real DB task (no task_id)
2. Cannot be toggled as complete by the user
3. Do not count toward daily progress in `updateStats()` (which requires `task_id`)

The visual distinction still works correctly because `calendar.js` detects padding by title prefix — a design that is independent of the `is_padding` flag.

**Fix required (either option):**

Option A — Persist `is_padding` to DB:
- Add `is_padding INTEGER DEFAULT 0` to tasks table in `database.py`
- In `approve-and-schedule`, add `is_padding` to the INSERT statement

Option B — Use title prefix in scheduler (simpler, no schema change):
- Change `scheduler.py` line 227 from `t.get("is_padding")` to `t.get("title", "").startswith(("General Review:", "Solve Practice Problems:"))`

---

_Verified: 2026-02-28_
_Verifier: Claude (gsd-verifier)_
