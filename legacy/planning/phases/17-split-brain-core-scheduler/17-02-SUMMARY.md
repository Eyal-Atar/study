---
phase: 17-split-brain-core-scheduler
plan: 02
subsystem: api
tags: [anthropic, claude-haiku, exam-brain, auditor, split-brain, fastapi, sqlite, json-parsing]

# Dependency graph
requires:
  - phase: 17-01
    provides: "focus_score and dependency_id columns on tasks, extracted_text on exam_files, auditor_draft on exams"
provides:
  - "_build_all_exam_context(): full-context string from exam_files.extracted_text with headers and 700K char truncation"
  - "_build_auditor_prompt(): zero-loss audit prompt producing tasks with focus_score, reasoning, dependency_id, plus gaps and topic_map"
  - "_calculate_total_hours(): global study budget helper"
  - "call_split_brain(): single Claude Haiku call for ALL exams at once — returns validated tasks, gaps, topic_map"
  - "POST /brain/generate-roadmap updated to Auditor-only (no scheduler, no task deletion, no schedule clearing)"
  - "Auditor JSON persisted to exams.auditor_draft for all user exams"
  - "GET /brain/auditor-draft: retrieves persisted Auditor draft for review page refresh safety"
affects:
  - "17-03 (Strategist + Enforcer) - reads Auditor tasks as input, runs scheduler after user approval"
  - "Frontend Intermediate Review Page - consumes /brain/auditor-draft and POST response"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single Anthropic API call for ALL exams combined (replaces per-exam loop)"
    - "Robust JSON parsing: markdown fence strip + first-brace/last-brace extraction for preamble safety"
    - "focus_score clamped to [1, 10], reasoning required, dependency_id bounds-checked against task array length"
    - "Auditor draft persisted to DB (exams.auditor_draft) immediately after API call for page-refresh safety"

key-files:
  created: []
  modified:
    - "backend/brain/exam_brain.py"
    - "backend/brain/routes.py"

key-decisions:
  - "call_split_brain() returns raw_response in result dict for debug visibility without exposing to client"
  - "generate-roadmap does NOT clear tasks/schedule — this is intentional for the intermediate state (Strategist runs in Plan 03)"
  - "auditor_draft written to ALL upcoming exams for the user (not just first) — ensures consistent retrieval regardless of which exam is queried first"
  - "get_auditor_draft returns first non-null draft across exams — sufficient because all exams receive the same JSON blob"
  - "RuntimeError from missing API key returns 400 (client error), all other exceptions return 500"

patterns-established:
  - "Pattern: Single AI call with all exam context concatenated — eliminates N-call loop anti-pattern"
  - "Pattern: Persist intermediate AI state to DB immediately after call — prevents data loss on page refresh"
  - "Pattern: Robust JSON extraction using first-{ / last-} bounds in addition to fence stripping"

requirements-completed: [SB-03, SB-04]

# Metrics
duration: 10min
completed: 2026-02-28
---

# Phase 17 Plan 02: Knowledge Auditor (Split-Brain Call 1) Summary

**Single Claude Haiku call across ALL exams simultaneously, returning tasks with focus_score/reasoning/dependency_id, gap detection, and topic_map — persisted to DB for review page refresh safety**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-02-28T15:05:21Z
- **Completed:** 2026-02-28T15:15:00Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments
- `call_split_brain()` replaces the per-exam `analyze_all_exams()` loop with a single Haiku call for all exams
- `_build_all_exam_context()` assembles full exam context from `exam_files.extracted_text` with file-type headers, legacy fallback, and hard 700K char truncation
- `_build_auditor_prompt()` produces a structured zero-loss audit prompt requesting tasks with `focus_score` (1-10), `reasoning`, `dependency_id`, and `gaps`/`topic_map` JSON
- All task fields are validated post-parse: `focus_score` clamped [1,10], `reasoning` defaulted, `dependency_id` bounds-checked, `exam_id` fallback to first exam
- `POST /brain/generate-roadmap` updated to Auditor-only flow — does not run scheduler, does not delete tasks or schedule blocks
- Auditor output persisted to `exams.auditor_draft` for all upcoming exams immediately after the API call
- `GET /brain/auditor-draft` added: retrieves and parses stored draft with 404/500 error handling

## Task Commits

Each task was committed atomically:

1. **Tasks 1+2: Auditor context assembly, prompt building, and call_split_brain** - `8fd99be` (feat)
2. **Task 3: Brain routes integration and persistence** - `071ee3e` (feat)

## Files Created/Modified
- `backend/brain/exam_brain.py` - Added `_build_all_exam_context()`, `_calculate_total_hours()`, `_build_auditor_prompt()`, and `call_split_brain()` methods to `ExamBrain`
- `backend/brain/routes.py` - Replaced `generate_roadmap` body with Auditor-only flow; added `GET /brain/auditor-draft` endpoint

## Decisions Made
- Tasks 1 and 2 were both in `exam_brain.py` with no logical commit boundary between them, so they were committed together in a single atomic commit — no correctness impact
- `call_split_brain()` does not call the Strategist — that is Plan 03. This route is intentionally a half-step
- The `generate-roadmap` route intentionally does NOT clear tasks or schedule blocks — the existing schedule remains intact until the user approves the Auditor draft and triggers the Strategist (Plan 03)
- `auditor_draft` is written to all upcoming exams with the same JSON blob — this is redundant but ensures `GET /brain/auditor-draft` works regardless of which exam row is returned first
- `_calculate_total_hours()` uses `max(1, days_until)` floor — prevents zero-hour budget for same-day exams

## Deviations from Plan

None - plan executed exactly as written. The decision to commit Tasks 1 and 2 together was a natural grouping since both are ExamBrain methods with no independent verify step between them.

## Issues Encountered
None — all methods implemented correctly on first attempt, syntax checks passed, verification script all green.

## User Setup Required
None - no external service configuration required. Existing `ANTHROPIC_API_KEY` env var is used.

## Next Phase Readiness
- `call_split_brain()` is fully implemented and produces validated Auditor output
- `POST /brain/generate-roadmap` is ready for frontend integration (Intermediate Review Page)
- `GET /brain/auditor-draft` is ready for review page refresh flow
- Plan 03 (Strategist + Enforcer) can build `POST /brain/approve-and-schedule` on top of the persisted `auditor_draft`
- Frontend needs to wire `generateRoadmap()` to call the new route and render `screen-auditor-review`

---
*Phase: 17-split-brain-core-scheduler*
*Completed: 2026-02-28*
