---
phase: 17-split-brain-core-scheduler
plan: 01
subsystem: database
tags: [sqlite, pymupdf, fitz, migrations, schema, pdf-extraction]

# Dependency graph
requires: []
provides:
  - "focus_score INTEGER DEFAULT 5 column on tasks table"
  - "dependency_id INTEGER column on tasks table"
  - "extracted_text TEXT column on exam_files table"
  - "auditor_draft TEXT column on exams table"
  - "exam_files CHECK constraint updated to include summary and sample_exam file types"
  - "Full PDF text extraction (all pages, no cap) in syllabus_parser.py and exam_brain.py"
  - "Upload handler stores full extracted_text in exam_files at upload time"
affects:
  - "17-02 (Split-Brain ExamBrain) - reads extracted_text from exam_files"
  - "17-03 (Strategist + Enforcer) - reads focus_score from tasks"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SQLite table rebuild pattern for CHECK constraint updates (exam_files_new)"
    - "run_in_executor for synchronous fitz PDF extraction in async FastAPI handlers"
    - "Migration guard pattern: check column existence before ALTER TABLE"

key-files:
  created: []
  modified:
    - "backend/server/database.py"
    - "backend/brain/syllabus_parser.py"
    - "backend/brain/exam_brain.py"
    - "backend/exams/routes.py"

key-decisions:
  - "Rebuilt exam_files table (exam_files_new pattern) to update CHECK constraint - SQLite cannot ALTER CHECK constraints"
  - "Extracted full PDF text in upload handler using run_in_executor to avoid blocking the async event loop"
  - "Uncapped max_pages in both syllabus_parser.py and exam_brain.py (None default, backward-compatible optional param)"
  - "auditor_draft stored on exams table (not a separate table) for simplicity - one draft per exam set, overwritten on each generate"

patterns-established:
  - "Pattern: PDF text extraction always uses run_in_executor in async route handlers"
  - "Pattern: SQLite migrations guard with PRAGMA table_info before ALTER TABLE"

requirements-completed: [SB-01, SB-02]

# Metrics
duration: 2min
completed: 2026-02-28
---

# Phase 17 Plan 01: Split-Brain DB Migrations and PDF Extraction Summary

**SQLite schema migrations adding focus_score/dependency_id on tasks, extracted_text on exam_files, auditor_draft on exams, plus uncapped full-document PDF text extraction stored at upload time**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-28T15:01:26Z
- **Completed:** 2026-02-28T15:03:10Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- All four new DB columns exist and verified: `tasks.focus_score`, `tasks.dependency_id`, `exam_files.extracted_text`, `exams.auditor_draft`
- `exam_files` table rebuilt with updated CHECK constraint accepting `summary` and `sample_exam` file types (in addition to existing types)
- `syllabus_parser.py` `extract_text_from_pdf()` default changed from `max_pages=5` to `max_pages=None` — all pages extracted
- `exam_brain.py` local `extract_text_from_pdf()` default changed from `max_pages=10` to `max_pages=None`
- `exams/routes.py` upload handler now imports `fitz` and extracts full PDF text at upload time via `run_in_executor`, stores in `exam_files.extracted_text`

## Task Commits

Each task was committed atomically:

1. **Task 1: Database schema migrations for Split-Brain columns** - `53f8547` (feat)
2. **Task 2: Uncap PDF extraction and save extracted_text at upload time** - `e2636f8` (feat)

## Files Created/Modified
- `backend/server/database.py` - Added migrations for focus_score, dependency_id, auditor_draft; rebuilt exam_files table with new CHECK + extracted_text column
- `backend/brain/syllabus_parser.py` - Uncapped max_pages (None default, reads all pages)
- `backend/brain/exam_brain.py` - Uncapped max_pages (None default, reads all pages)
- `backend/exams/routes.py` - Added fitz import; upload handler extracts and stores full PDF text

## Decisions Made
- Used table rebuild (exam_files_new) for the CHECK constraint update — SQLite cannot ALTER TABLE to modify CHECK, consistent with existing tasks_new migration pattern already in database.py
- Stored `auditor_draft` on exams table directly rather than a separate `audit_sessions` table — simpler, one draft per generation cycle, overwritten each time
- Wrapped fitz extraction in `run_in_executor` in the async upload handler — consistent with the existing `process_syllabus_background` pattern

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Also uncapped max_pages in exam_brain.py**
- **Found during:** Task 2 (Uncap PDF extraction)
- **Issue:** The RESEARCH.md explicitly called out `exam_brain.py` has `max_pages=10` cap that also needed removal, but the PLAN.md task action mentioned it only as "Also check" — treated as required
- **Fix:** Changed `max_pages=10` default to `max_pages=None` in `exam_brain.py`'s local `extract_text_from_pdf()` function
- **Files modified:** `backend/brain/exam_brain.py`
- **Verification:** Import checked, default confirmed as None
- **Committed in:** `e2636f8` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical per RESEARCH.md guidance)
**Impact on plan:** Necessary for correctness — both extraction functions must be uncapped for the Auditor to receive full document context. No scope creep.

## Issues Encountered
None — all migrations and code changes worked on first attempt.

## User Setup Required
None - no external service configuration required. Migrations run automatically on next server start.

## Next Phase Readiness
- Database schema is fully ready for Plan 02 (Split-Brain ExamBrain implementation)
- `exam_files.extracted_text` will be populated for new uploads; legacy rows will have NULL (fallback to `parsed_context` as designed)
- `tasks.focus_score` and `tasks.dependency_id` ready to be written by the Auditor
- `exams.auditor_draft` ready to persist Auditor JSON output between the two API calls

---
*Phase: 17-split-brain-core-scheduler*
*Completed: 2026-02-28*
