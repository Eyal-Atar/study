# Phase 17: Split-Brain Core Scheduler - Research

**Researched:** 2026-02-28
**Domain:** AI Prompt Engineering, Python Scheduling Logic, SQLite Migrations, FastAPI, Vanilla JS Modals
**Confidence:** HIGH (codebase verified directly; no third-party library unknowns)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Model:** `claude-3-haiku-20240307` — same key already in use, split one call into two sequential calls
- **No new API keys** — Anthropic key is already in environment
- **Syllabus parser upgrade:** Full PyMuPDF extraction (all pages), not just first 5 pages / 10K chars
- **Multi-File Upload:** New `exam_files` rows for syllabus / summary / sample_exam file types. Add `extracted_text` TEXT column to `exam_files`. Extract full text at upload time (no re-processing).
- **Auditor scope:** ONE call with ALL exams + ALL their files concatenated. Claude Haiku supports 200K context — sufficient.
- **API Call 1 (Auditor):** Zero-Loss Audit → Task Decomposition → Gap Detection. Returns task list + detected gaps. Each task has a `focus_score` (1-10) and optionally a `dependency_id`.
- **Intermediate Review Page:** Full-page UI between Auditor and Strategist. Shows topic map, gaps, material coverage. User approves before Call 2 runs.
- **API Call 2 (Strategist):** Receives approved task list from ALL exams. Distributes across the week. Places high `focus_score` tasks in user's `peak_productivity` window. Fills exactly `neto_study_hours * 60` minutes per day including padding tasks.
- **Python Enforcer:** Pure Python validation of Strategist output. Hard-locked hobby and break blocks. Pomodoro breaks injected by Python, not AI.
- **DB additions:** `focus_score` INTEGER and `dependency_id` INTEGER on `tasks` table.
- **Dashboard Sync:** XP Progress Bar shows completion percentage against daily hour quota.
- **Two-way Google Calendar sync:** Deferred.
- **Stress Detection:** Deferred.

### Claude's Discretion

- Prompt engineering for the two separate calls
- Database schema design for `focus_score` and `dependency_id` fields
- Error handling for API failures
- Intermediate page component layout and UX details

### Deferred Ideas (OUT OF SCOPE)

- Two-way Google Calendar sync
- Stress Detection (emotional analysis based on deferral rate)
</user_constraints>

---

## Summary

Phase 17 upgrades the existing single-call AI scheduling engine into a two-call "Split-Brain" architecture: an **Auditor** (content analysis) and a **Strategist** (time distribution). All changes are evolutionary — no rewrites. The existing `ExamBrain`, `syllabus_parser`, `scheduler`, and `generate-roadmap` route are the direct targets.

The most structurally significant change is the **Intermediate Review Page**: a full-page frontend UI that surfaces Auditor output (topic map, gaps, material coverage) for user approval before the Strategist runs. This is a new frontend screen that must be wired into the existing screen-switching pattern (`showScreen` in `ui.js`).

Database work is surgical: two new columns on `tasks` (`focus_score`, `dependency_id`) and one new column on `exam_files` (`extracted_text`). Both can be added as migration-style `ALTER TABLE` statements in `database.py`, consistent with the existing migration pattern.

**Primary recommendation:** Implement in the order specified by CONTEXT.md's roadmap (Parts 1-5), treating the Intermediate Review Page as the integration seam — the backend produces Auditor output, stores it temporarily, and the frontend retrieves it to render the review page before triggering the Strategist.

---

## Standard Stack

### Core (already in use — no new packages)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `anthropic` | existing | Claude API calls | Already installed, same key |
| `fitz` (PyMuPDF) | existing | PDF text extraction | Already in `syllabus_parser.py` and `exam_brain.py` |
| `fastapi` | existing | Backend API routing | Existing server |
| `sqlite3` | stdlib | Database | Existing DB engine |
| Vanilla JS ES6 | N/A | Frontend modules | Existing pattern (`store.js`, `ui.js`, etc.) |
| Tailwind CSS (CDN) | existing | Styling | Loaded via CDN in `index.html` |

### No new packages required

All libraries needed for Phase 17 are already installed in the backend `venv`. The `anthropic` SDK, `fitz`, and `fastapi` cover every new backend capability needed.

**Installation:** None required.

---

## Architecture Patterns

### Recommended Project Structure (changes only)

```
backend/
├── brain/
│   ├── exam_brain.py          # Modified: replace analyze_all_exams with call_split_brain (Auditor + Strategist)
│   ├── syllabus_parser.py     # Modified: remove 5-page / 10K char cap; extract full text
│   ├── scheduler.py           # Modified: enforce hard daily quota, read focus_score for peak-window placement
│   └── schemas.py             # Modified: add focus_score, dependency_id to any task schema if needed
├── exams/
│   └── routes.py              # Modified: upload handler → save extracted_text at upload time
└── server/
    └── database.py            # Modified: migration for tasks.focus_score, tasks.dependency_id, exam_files.extracted_text

frontend/js/
├── tasks.js                   # Modified: generateRoadmap → Phase 1 only (Auditor); add auditor review UI flow
├── brain.js (or new file)     # New: renderAuditorReview(), approveAndRunStrategist()
└── ui.js                      # Possibly: add screen-auditor-review to showScreen

index.html                     # New: screen-auditor-review full-page section
```

### Pattern 1: Sequential Two-Call Pattern in ExamBrain

**What:** Replace `analyze_all_exams()` (which loops per exam calling AI) with `call_split_brain()` that makes exactly two AI calls total.

**When to use:** Always during roadmap generation.

**Current code to replace** (`exam_brain.py`, lines 34–87):
```python
async def analyze_all_exams(self) -> dict:
    # loops per exam → one AI call per exam
    for exam in self.exams:
        res = self._analyze_single_exam_with_ai(ec, target_hours)
```

**Target pattern:**
```python
async def call_split_brain(self) -> dict:
    # Call 1: Auditor — all exams + all files, single call
    auditor_result = self._call_auditor(all_exam_context)
    # Returns: tasks with focus_score + dependency_id + gaps list

    # Do NOT call Strategist here — return auditor result for user review
    return {
        "tasks": auditor_result["tasks"],
        "gaps": auditor_result["gaps"],
        "topic_map": auditor_result["topic_map"],
    }

async def call_strategist(self, approved_tasks: list) -> dict:
    # Call 2: Strategist — runs only after user approval
    strategist_result = self._call_strategist(approved_tasks)
    return strategist_result
```

**Key insight:** The Auditor and Strategist must be callable independently. The `generate-roadmap` route will stop at Auditor output and return it to the frontend. A new route (e.g., `POST /brain/approve-and-schedule`) runs the Strategist and Python Enforcer after user approval.

### Pattern 2: Intermediate Review Page (New Frontend Screen)

**What:** A full-page screen inserted between "Generate Roadmap" click and the final schedule. Uses the existing `showScreen()` pattern.

**Existing screen pattern** (`ui.js`):
```javascript
export function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId)?.classList.add('active');
}
```

**New screen in `index.html`:**
```html
<div id="screen-auditor-review" class="screen">
    <!-- Topic map, gaps list, file coverage, Approve button -->
</div>
```

**Flow:**
1. User clicks "Generate Roadmap" → `generateRoadmap()` in `tasks.js`
2. Backend returns Auditor output (tasks + gaps + topic_map)
3. Frontend calls `showScreen('screen-auditor-review')` and renders gap list
4. User edits (dismiss gaps, add search tasks) → clicks "Approve & Generate Schedule"
5. Frontend POSTs approved task list to `/brain/approve-and-schedule`
6. Backend runs Strategist + Python Enforcer → returns schedule
7. Frontend renders calendar, calls `showScreen('screen-dashboard')`

### Pattern 3: Full PDF Text Extraction

**What:** Remove the `max_pages=5` cap in `syllabus_parser.py` and `exam_brain.py`. Extract ALL pages.

**Current code** (`syllabus_parser.py`, line 10):
```python
def extract_text_from_pdf(pdf_bytes: bytes, max_pages: int = 5) -> str:
```

**Target code:**
```python
def extract_text_from_pdf(pdf_bytes: bytes, max_pages: int = None) -> str:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    text = ""
    for i, page in enumerate(doc):
        if max_pages is not None and i >= max_pages:
            break
        text += page.get_text() + "\n"
    doc.close()
    return text
```

**For `exam_brain.py`:** Same change — remove `max_pages=10` cap.

### Pattern 4: Save `extracted_text` at Upload Time

**What:** When a file is uploaded, immediately extract full text via PyMuPDF and store in `exam_files.extracted_text`. This avoids re-processing during Auditor call.

**Current upload handler** (`exams/routes.py`, line 144):
- Saves file to disk
- Only runs `process_syllabus_background` for `file_type == 'syllabus'`
- Does NOT store extracted text in DB

**Target behavior:**
- For ALL PDF uploads (any `file_type`): extract full text via `fitz` and save to `exam_files.extracted_text`
- The Auditor then reads `extracted_text` from DB — no disk re-reads needed

**DB migration needed** (add to `database.py`):
```python
exam_file_columns = {row[1] for row in conn.execute("PRAGMA table_info(exam_files)").fetchall()}
if "extracted_text" not in exam_file_columns:
    conn.execute("ALTER TABLE exam_files ADD COLUMN extracted_text TEXT")
```

### Pattern 5: focus_score Placement in Scheduler

**What:** High `focus_score` tasks (8-10) should be placed in the user's `peak_productivity` window. `peak_productivity` already exists in `users` table (default: 'Morning').

**Existing scheduler logic** (`scheduler.py`): Simple linear scan — picks the first task with `remaining_task_hours[t["id"]] > 0.01`. No awareness of focus score or peak windows.

**Target logic:**
- Parse `peak_productivity` to a time range: `'Morning'` = 07:00-12:00, `'Afternoon'` = 12:00-17:00, `'Evening'` = 17:00-22:00
- When filling a window that overlaps the peak window: prefer tasks with `focus_score >= 8`
- When filling off-peak windows: prefer tasks with `focus_score < 8`
- Fallback: if no matching focus-score task, revert to standard linear scan

### Pattern 6: Hard Daily Quota Enforcement (Python Enforcer)

**What:** Validate that the Strategist-output task list actually fills `neto_study_hours * 60` minutes. If short, generate padding tasks.

**Current scheduler behavior** (`scheduler.py`, line 81–101): `day_limit_min = neto_study_hours * 60` is already enforced as a ceiling. However, there is no floor enforcement — if tasks run out, the day ends early.

**Target behavior:**
- After filling a day with real tasks, if `used_on_day_min < day_limit_min - 45`:
  - Insert a padding task block (e.g., "Solve random practice exam") to close the gap
  - Padding task is not stored in `tasks` table; it's a synthetic `ScheduleBlock` with `block_type='study'` and `task_id=None`
- Hobby block is always at fixed end-of-day slot regardless of fill level

### Anti-Patterns to Avoid

- **Anti-pattern: Calling AI per exam in a loop.** Current `analyze_all_exams()` calls Claude once per exam. With multi-exam concatenation, this would send N calls instead of 1. The Auditor must process all exams in one call.
- **Anti-pattern: Re-reading PDFs from disk during scheduling.** Disk reads are slow. `extracted_text` in DB is the cache.
- **Anti-pattern: Storing Auditor state in memory only.** The intermediate review page requires a page reload to be safe on mobile. Store Auditor output in DB (a `auditor_draft` column on `exams` or a new `audit_sessions` table) so the review page can fetch it.
- **Anti-pattern: Blocking the event loop on PDF extraction.** Current pattern uses `run_in_executor` correctly. Keep this for any new synchronous PDF work.
- **Anti-pattern: Letting the Strategist decide break timing.** Breaks (Pomodoro, long breaks) must be injected by Python Enforcer, not by the AI prompt. The Strategist only outputs tasks.

---

## Critical Implementation Detail: Auditor State Persistence

The Intermediate Review Page introduces a stateful flow that must survive navigation. The Auditor runs, returns output, the user reviews it (potentially for several minutes), then approves.

**Problem:** If Auditor output is stored only in JS memory, a page refresh loses it. If user closes modal, state is gone.

**Recommended approach:** Store Auditor draft output in a lightweight DB column.

Option A (recommended): Add `auditor_draft TEXT` to the `exams` table. After the Auditor call, serialize the output (tasks + gaps + topic_map) as JSON and save it. The review page fetches `/brain/auditor-draft` which reads this column. After approval, the column is cleared.

Option B: Store in `localStorage` in the frontend. Simpler but fragile on mobile (storage cleared by OS). Not recommended for this flow.

**Claude's discretion:** Either approach is valid. Option A is more robust.

---

## Database Schema Changes

### `tasks` table additions

```sql
-- Add focus_score: 1-10, concentration level required (1=low, 10=extreme focus)
ALTER TABLE tasks ADD COLUMN focus_score INTEGER DEFAULT 5;

-- Add dependency_id: optional link to a prerequisite task
ALTER TABLE tasks ADD COLUMN dependency_id INTEGER REFERENCES tasks(id);
```

Migration location: `backend/server/database.py`, inside the `init_db()` function, following the existing migration pattern (check column existence before adding).

### `exam_files` table addition

```sql
-- Stores full extracted text from PDF; populated at upload time
ALTER TABLE exam_files ADD COLUMN extracted_text TEXT;
```

### No schema change needed for `exam_files.file_type`

The existing CHECK constraint is: `CHECK(file_type IN ('syllabus', 'past_exam', 'notes', 'other'))`. The CONTEXT.md uses `'summary'` and `'sample_exam'` as file types. **This is a conflict.** The existing constraint must be updated. Since SQLite does not support ALTER TABLE for CHECK constraints, a table rebuild (like the existing `tasks_new` migration pattern in `database.py`) is required, OR simply drop the CHECK constraint by rebuilding the table.

**Recommended:** Update the CHECK to `CHECK(file_type IN ('syllabus', 'summary', 'sample_exam', 'past_exam', 'notes', 'other'))` via table rebuild. This follows the exact same pattern already in `database.py` lines 169-214.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDF text extraction | Custom parser | `fitz` (PyMuPDF) — already installed | Handles multi-column layouts, encoding edge cases |
| AI response JSON parsing | Custom regex | Existing `json.loads()` + markdown fence stripping pattern | Already working in `exam_brain.py` lines 98-105 |
| Focus score → window mapping | Novel algorithm | Simple time-range lookup dict | 3 productivity windows is trivially enumerable |
| Token counting for 200K context | Token counter lib | Rough character estimate (1 token ≈ 4 chars): 200K tokens ≈ 800K chars | Haiku's limit is generous; log total chars and warn, don't over-engineer |

**Key insight:** All complex problems in this phase (PDF extraction, AI calls, time scheduling) are already solved by the existing codebase. This phase is configuration and orchestration, not new library introduction.

---

## Common Pitfalls

### Pitfall 1: Auditor JSON Parsing Failure on Long Outputs

**What goes wrong:** The Auditor prompt sends potentially 800K+ characters of exam material. Claude's response could be a large JSON array. If the response includes partial markdown or commentary, `json.loads()` fails silently (currently falls back to `[]`).

**Why it happens:** Long prompts sometimes cause Claude to add preamble text ("Here are the tasks:") before the JSON, especially when the context is rich.

**How to avoid:** Use a strict system prompt with `RETURN ONLY VALID JSON. NO TEXT BEFORE OR AFTER.` at the top of the system message (not just user message). Use the existing fence-stripping logic in `exam_brain.py` lines 98-105 and add a fallback that searches for `[` as JSON start position.

**Warning signs:** Empty task list returned from generate-roadmap when files are present.

### Pitfall 2: SQLite CHECK Constraint Violation on New File Types

**What goes wrong:** Uploading a `summary` or `sample_exam` file type fails silently because the existing `exam_files.file_type` CHECK constraint only allows `('syllabus', 'past_exam', 'notes', 'other')`.

**Why it happens:** CONTEXT.md defines new file types that weren't in the original schema.

**How to avoid:** Update the `exam_files` table CHECK constraint as part of the DB migration before implementing the file upload changes.

**Warning signs:** 500 error on file upload with `file_type='summary'`.

### Pitfall 3: Scheduler Infinite Loop When No Tasks Remain (Exclusive Zone)

**What goes wrong:** The current scheduler (`scheduler.py` line 121-124) sets `window_remaining_min = 0` and `continue`s when no tasks are available for the exclusive zone. This skips the window but doesn't advance the outer `windows` loop, causing a potential infinite sub-loop.

**Why it happens:** The `while window_remaining_min >= 45` loop relies on `window_remaining_min` being decremented. If it's forced to 0 and the outer for-loop re-evaluates the same day, it could revisit windows.

**How to avoid:** When adding padding logic to the Enforcer, ensure the padding task creation also exits the window loop cleanly. Verify that `window_remaining_min = 0` + `continue` is actually breaking the inner while loop (it should, since `0 >= 45` is False).

**Warning signs:** Schedule generation hangs or returns thousands of duplicate blocks.

### Pitfall 4: Peak Productivity Window Edge Cases

**What goes wrong:** If `peak_productivity` is 'Evening' and the user's `wake_up_time` is 06:00 with `sleep_time` 23:00, the scheduler correctly identifies evening windows. But if `peak_productivity` is unset or a custom string, the mapping breaks.

**Why it happens:** `peak_productivity` is a free-form TEXT field in the DB with default 'Morning'. No validation exists.

**How to avoid:** Implement the focus-score placement with a safe default: if `peak_productivity` is not one of ['Morning', 'Afternoon', 'Evening'], treat all windows as non-peak and skip focus-score placement (fall back to standard scan).

### Pitfall 5: Auditor Token Overflow

**What goes wrong:** Concatenating ALL exams + ALL files could exceed Claude Haiku's 200K token context window (≈800K characters). This causes an API error.

**Why it happens:** Users with many exams and large PDFs (e.g., 200-page textbooks).

**How to avoid:** Before the Auditor call, compute total character count of the concatenated context. If it exceeds 700K characters (safety margin), truncate per-file texts proportionally. Log a warning. The CONTEXT.md says Haiku supports 200K tokens — verify this is the input context limit, not output. (As of the `claude-3-haiku-20240307` release, input context is 200K tokens.)

**Warning signs:** `anthropic.BadRequestError` with "prompt too long" message.

### Pitfall 6: Intermediate Review Page Mobile Navigation

**What goes wrong:** On mobile, the Intermediate Review page is a new full screen. If the user taps the browser back button, they may navigate away from the app or to the splash screen rather than back to dashboard.

**Why it happens:** The existing `showScreen()` pattern manages visibility via CSS classes, not the browser history API. Browser back button isn't intercepted.

**How to avoid:** Add a "Cancel" button in the review page that explicitly calls `showScreen('screen-dashboard')`. Do not rely on browser back navigation for this flow. Optionally, push a history state entry when showing the review screen.

---

## Code Examples

### Auditor Prompt Pattern

```python
# Source: adapted from existing _build_strategy_prompt in exam_brain.py

def _build_auditor_prompt(self, all_exam_context: str, total_hours: float) -> str:
    return f"""You are a Zero-Loss Knowledge Auditor for a university student.

STUDENT PROFILE:
- Total available study hours across all exams: {total_hours}
- Peak productivity window: {self.user.get('peak_productivity', 'Morning')}

ALL EXAM MATERIALS:
{all_exam_context}

TASK:
1. For each exam, map the syllabus topics.
2. Identify which topics have matching summary/notes content and which are GAPS (in syllabus but no study material found).
3. Decompose ALL topics into pedagogical tasks with:
   - focus_score (1-10): concentration level required
   - dependency_id: null or the index of a prerequisite task in this list
4. Assign estimated_hours per task (0.5 to 3.0 hours each).

RETURN ONLY VALID JSON — NO TEXT BEFORE OR AFTER:
{{
  "tasks": [
    {{
      "exam_id": <int>,
      "title": "<string>",
      "topic": "<string>",
      "estimated_hours": <float>,
      "focus_score": <int 1-10>,
      "dependency_id": <null or index int>,
      "sort_order": <int>
    }}
  ],
  "gaps": [
    {{
      "exam_id": <int>,
      "topic": "<string>",
      "description": "Topic in syllabus but no study material found"
    }}
  ],
  "topic_map": {{
    "<exam_id>": ["topic1", "topic2", ...]
  }}
}}"""
```

### Strategist Prompt Pattern

```python
def _build_strategist_prompt(self, approved_tasks: list, days_available: int) -> str:
    task_list = json.dumps(approved_tasks, indent=2)
    return f"""You are a Strategic Schedule Architect.

STUDENT PROFILE:
- Daily net study quota: {self.user.get('neto_study_hours', 4.0)} hours ({int(self.user.get('neto_study_hours', 4.0) * 60)} minutes)
- Peak productivity window: {self.user.get('peak_productivity', 'Morning')}
- Days available: {days_available}

APPROVED TASK LIST:
{task_list}

RULES:
1. Distribute tasks across {days_available} days.
2. Place tasks with focus_score >= 8 in the peak productivity window when possible.
3. Respect dependency_id: a task cannot appear before its dependency.
4. Interleave exam subjects to prevent burnout (do not assign one exam for too many consecutive days).
5. If total task hours < {days_available} days * {self.user.get('neto_study_hours', 4.0)} hours, generate padding tasks:
   - Type: "Practice" or "Review" — never "Simulation" (those are already in the task list)
   - Label: "General Review: [subject]" or "Solve Practice Problems: [subject]"
   - Assign to the exam with the earliest upcoming date
6. IMPORTANT: do NOT assign tasks to specific times — only assign them to days (day_index: 0 = today, 1 = tomorrow, etc.)

RETURN ONLY VALID JSON:
[
  {{
    "task_index": <int, index into input task list, or -1 for padding tasks>,
    "day_index": <int, 0 = today>,
    "title": "<string — only set for padding tasks>",
    "exam_id": <int — only set for padding tasks>,
    "estimated_hours": <float — only set for padding tasks>
  }}
]"""
```

### DB Migration Pattern (consistent with existing code)

```python
# In database.py, init_db() — add after existing task_columns check

task_columns = {row[1] for row in conn.execute("PRAGMA table_info(tasks)").fetchall()}
if "focus_score" not in task_columns:
    conn.execute("ALTER TABLE tasks ADD COLUMN focus_score INTEGER DEFAULT 5")
if "dependency_id" not in task_columns:
    conn.execute("ALTER TABLE tasks ADD COLUMN dependency_id INTEGER")

exam_file_columns = {row[1] for row in conn.execute("PRAGMA table_info(exam_files)").fetchall()}
if "extracted_text" not in exam_file_columns:
    conn.execute("ALTER TABLE exam_files ADD COLUMN extracted_text TEXT")
```

### Full Text Extraction at Upload Time

```python
# In exams/routes.py, upload_exam_file handler
# After writing file to disk and before INSERT into exam_files:

extracted_text = None
if safe_name.lower().endswith(".pdf"):
    try:
        doc = fitz.open(stream=content, filetype="pdf")
        texts = [page.get_text() for page in doc]
        doc.close()
        extracted_text = "\n".join(texts)
    except Exception as e:
        print(f"Text extraction failed for {safe_name}: {e}")

cursor = db.execute(
    """INSERT INTO exam_files (exam_id, filename, file_path, file_type, file_size, extracted_text)
       VALUES (?, ?, ?, ?, ?, ?)""",
    (exam_id, safe_name, file_path, file_type, file_size, extracted_text)
)
```

### Auditor Context Assembly

```python
def _build_all_exam_context(self) -> str:
    """Concatenate all exams + all their extracted texts into one string."""
    db = get_db()
    parts = []
    total_chars = 0
    CHAR_LIMIT = 700_000  # ~175K tokens, safe margin under Haiku's 200K

    for exam in self.exams:
        exam_header = f"\n### EXAM: {exam['name']} ({exam['subject']}) — Date: {exam['exam_date']}\n"
        files = db.execute(
            "SELECT file_type, filename, extracted_text FROM exam_files WHERE exam_id = ?",
            (exam["id"],)
        ).fetchall()

        file_texts = []
        for f in files:
            if f["extracted_text"]:
                file_texts.append(f"[{f['file_type'].upper()}: {f['filename']}]\n{f['extracted_text']}")

        if not file_texts and exam.get("parsed_context"):
            # Fallback: use old parsed_context (topics/intensity/objectives)
            file_texts.append(f"[LEGACY CONTEXT]\n{exam['parsed_context']}")

        exam_block = exam_header + "\n\n".join(file_texts)

        if total_chars + len(exam_block) > CHAR_LIMIT:
            # Truncate this exam's content proportionally
            remaining = CHAR_LIMIT - total_chars
            exam_block = exam_block[:remaining] + "\n[TRUNCATED — file too large]"

        parts.append(exam_block)
        total_chars += len(exam_block)
        if total_chars >= CHAR_LIMIT:
            break

    db.close()
    return "\n\n".join(parts)
```

---

## New API Routes Required

| Route | Method | Purpose |
|-------|--------|---------|
| `POST /brain/generate-roadmap` | POST | Step 1: Run Auditor, save draft, return gaps + topic_map |
| `POST /brain/approve-and-schedule` | POST | Step 2: Accept approved tasks, run Strategist + Enforcer, save schedule |
| `GET /brain/auditor-draft` | GET | Fetch stored Auditor output for review page |

The existing `POST /brain/generate-roadmap` route in `brain/routes.py` becomes Step 1 only. The existing `POST /brain/regenerate-schedule` route remains unchanged (it reads from DB, not AI).

---

## Frontend Flow for Intermediate Review Page

### State transitions

```
Dashboard → [Click "Generate Roadmap"] → loading-overlay shown
    → POST /brain/generate-roadmap → Auditor runs
    → Response: { tasks, gaps, topic_map }
    → Store in window._auditorDraft (or localStorage as backup)
    → showScreen('screen-auditor-review')
    → User reviews gaps, optionally adds "Search" tasks to gaps
    → [Click "Approve & Generate Schedule"]
    → POST /brain/approve-and-schedule { approved_tasks }
    → Strategist + Enforcer run
    → Response: { tasks, schedule }
    → Render calendar
    → showScreen('screen-dashboard')
```

### Auditor Review Page minimal HTML structure

```html
<div id="screen-auditor-review" class="screen">
    <div class="relative z-10 min-h-screen flex flex-col p-4 max-w-2xl mx-auto">
        <h2 class="text-xl font-bold mb-4">Review Your Study Plan</h2>

        <!-- Topic map per exam -->
        <div id="auditor-topic-map" class="mb-6"></div>

        <!-- Detected gaps -->
        <div id="auditor-gaps" class="mb-6">
            <h3 class="text-lg font-semibold mb-2">Detected Gaps</h3>
            <div id="gaps-list"></div>
        </div>

        <!-- Action buttons -->
        <div class="flex gap-3 mt-auto">
            <button id="btn-cancel-review" class="...">Cancel</button>
            <button id="btn-approve-schedule" class="...">Approve & Generate Schedule</button>
        </div>
    </div>
</div>
```

### XP Progress Bar Update (Part 5)

The existing progress bar (`stat-done`, `stat-hours` elements in `tasks.js:updateStats()`) tracks `done/total` tasks. To show daily quota completion:

```javascript
// In updateStats():
const today = new Date().toISOString().split('T')[0];
const todaySchedule = (getCurrentSchedule() || []).filter(b => b.day_date === today && b.block_type === 'study');
const todayDoneMin = todaySchedule.filter(b => b.completed === 1).reduce((s, b) => {
    const start = new Date(b.start_time);
    const end = new Date(b.end_time);
    return s + (end - start) / 60000;
}, 0);
const quotaMin = (getCurrentUser()?.neto_study_hours || 4.0) * 60;
const dailyPct = Math.min(100, Math.round((todayDoneMin / quotaMin) * 100));
// Update progress bar element
```

---

## State of the Art

| Old Approach | Current Approach | Impact on Phase 17 |
|--------------|-----------------|---------------------|
| Per-exam AI call loop | One Auditor call for all exams | Eliminates N API calls; replaces `analyze_all_exams()` entirely |
| First-5-pages PDF scan | Full-doc PyMuPDF extraction | Richer context for gap detection; stored in DB |
| No gap detection | Auditor compares syllabus vs. summaries | New `gaps` array in response |
| Simple linear task queue | focus_score-aware window placement | Scheduler reads `tasks.focus_score` |
| No daily floor | Hard bucket fill + padding tasks | Python Enforcer closes gaps |
| Immediate schedule after generate | User review page between AI calls | New screen + approve-and-schedule route |

---

## Open Questions

1. **Auditor Draft Storage Location**
   - What we know: Auditor output must persist between the generate step and the approve step
   - What's unclear: Should it go in a new DB table, a column on `exams`, or `localStorage`?
   - Recommendation: Add `auditor_draft TEXT` column to `exams` table (simplest, consistent with existing pattern). One row per exam, overwritten on each generate.

2. **Padding Task Representation**
   - What we know: Padding tasks fill gaps to meet daily quota. They must appear in the schedule.
   - What's unclear: Should padding tasks be inserted into the `tasks` table (with a flag like `is_padding=1`) or be purely synthetic blocks?
   - Recommendation: Insert into `tasks` table with `is_padding=1` flag (requires new column) OR use `block_type='padding'` on `schedule_blocks`. If they don't need to be checked off individually, synthetic blocks are simpler.

3. **Legacy Users with old `parsed_context`**
   - What we know: Existing users have `parsed_context` (JSON: topics/intensity/objectives) but no `extracted_text` in `exam_files`. CONTEXT.md says the review page should let them decide whether to re-upload.
   - What's unclear: Should the Auditor fall back to `parsed_context` automatically, or always prompt re-upload?
   - Recommendation: Automatic fallback to `parsed_context` with a banner on the review page: "We used your previously uploaded context. For better gap detection, upload your full study materials."

4. **`push_notified` column on `schedule_blocks`**
   - What we know: `schedule_blocks` has a `push_notified` column (not in the CREATE TABLE but added as migration). The notifications system uses it.
   - What's unclear: After Strategist runs and creates new schedule blocks, do they need `push_notified = 0` by default? Yes — the existing INSERT in `routes.py` already sets it conditionally (`is_notified = 1 if block.start_time < now_iso else 0`). This pattern must be preserved in the new `approve-and-schedule` route.

---

## Sources

### Primary (HIGH confidence)

- Direct codebase read: `backend/brain/exam_brain.py` — existing AI call structure, prompt format
- Direct codebase read: `backend/brain/scheduler.py` — window logic, daily quota, exclusive zone
- Direct codebase read: `backend/brain/syllabus_parser.py` — PDF extraction limits
- Direct codebase read: `backend/server/database.py` — full schema + migration pattern
- Direct codebase read: `backend/exams/routes.py` — file upload handler, background task pattern
- Direct codebase read: `frontend/js/tasks.js` — exam modal flow, generateRoadmap(), screen patterns
- Direct codebase read: `frontend/js/ui.js` (imports) — showScreen pattern

### Secondary (MEDIUM confidence)

- CONTEXT.md (17-CONTEXT.md) — user decisions, implementation roadmap
- Claude Haiku 200K context window: Stated in CONTEXT.md; consistent with known Anthropic model specs as of training cutoff

### Tertiary (LOW confidence)

- None — all claims are verifiable from the codebase directly

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; all verified in `requirements.txt` and existing imports
- Architecture: HIGH — all patterns derived from existing working code
- DB migrations: HIGH — pattern copied from existing `database.py` migrations
- Pitfalls: HIGH — derived from reading actual code behavior, not assumptions
- Prompt engineering: MEDIUM — guidance based on existing prompts; actual effective prompts require iteration

**Research date:** 2026-02-28
**Valid until:** 2026-03-30 (30 days; only external dependency is Claude API — stable)
