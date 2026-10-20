---
phase: 10-regenerate-roadmap
plan: "01"
subsystem: backend
tags: [ai, schedule, regeneration, database, migration]
dependency_graph:
  requires: []
  provides: [is_manually_edited_column, regenerate_delta_endpoint]
  affects: [backend/brain/routes.py, backend/tasks/routes.py, backend/server/database.py]
tech_stack:
  added: []
  patterns: [pipe-delimited-snapshot, delta-update, surgical-sql-update]
key_files:
  created: []
  modified:
    - backend/server/database.py
    - backend/tasks/routes.py
    - backend/tasks/schemas.py
    - backend/brain/routes.py
    - backend/brain/schemas.py
decisions:
  - "is_manually_edited flag is permanent — once set it cannot be unset by time/title updates"
  - "Delta endpoint uses pipe-delimited snapshot for token efficiency rather than full JSON schedule"
  - "Safety double-check: SQL WHERE clause includes AND is_manually_edited = 0 in addition to Python-level filtering"
  - "Break blocks are excluded from snapshot — only study and hobby blocks are sent to AI"
metrics:
  duration: "3 minutes"
  completed_date: "2026-02-22"
  tasks_completed: 2
  files_modified: 5
---

# Phase 10 Plan 01: Regenerate Roadmap Backend Summary

**One-liner:** DB migration for is_manually_edited flag plus token-efficient delta regeneration endpoint that surgically updates only auto-generated FLX blocks via pipe-delimited Claude prompt.

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | DB migration + mark manual edits in PATCH endpoint | c7d738f | database.py, tasks/routes.py, tasks/schemas.py |
| 2 | POST /regenerate-delta endpoint with compressed AI delta logic | ae55d2e | brain/routes.py, brain/schemas.py |

---

## What Was Built

### Task 1: DB Migration + Manual Edit Tracking

**backend/server/database.py:**
- Added migration for `is_manually_edited` column to `schedule_blocks` table (`INTEGER DEFAULT 0`)
- Migration placed after existing `task_title` and `exam_name` migrations in the `block_columns` section
- Column confirmed present in `study_scheduler.db` (column index 12)

**backend/tasks/routes.py:**
- In `update_block()` (PATCH /tasks/block/{id}), added auto-setting of `is_manually_edited = 1` when `start_time`, `end_time`, or `task_title` is provided in the request body
- Logic added BEFORE the `if not updates: return` early exit

**backend/tasks/schemas.py:**
- Added `is_manually_edited: Optional[bool] = None` field to `BlockUpdate` class
- Field is for schema completeness only — backend auto-sets the value, frontend cannot override

### Task 2: POST /regenerate-delta Endpoint

**backend/brain/schemas.py:**
- Added `RegenerateDeltaRequest` schema with a single `reason: str` field

**backend/brain/routes.py:**
- Updated import to include `RegenerateDeltaRequest`
- Added `POST /regenerate-delta` endpoint with full delta regeneration logic:
  - Fetches next 14 days of non-completed schedule blocks
  - Builds pipe-delimited snapshot: `{id}|{FIX/FLX}|{M/A}|{DayHH:MM}-{HH:MM}`
  - Break blocks excluded from snapshot
  - Sends delta-only prompt to `claude-sonnet-4-5-20250929`
  - Parses response format: `Reasoning: ...` + `{BlockID}:{Day}{HH:MM}-{HH:MM}` lines
  - Builds day-abbreviation to date mapping for the 14-day window
  - Filters valid update targets (`valid_update_ids` — blocks with `is_manually_edited = 0`)
  - SQL UPDATE includes `AND is_manually_edited = 0` as safety double-check
  - Syncs `tasks.day_date` when a block's date changes
  - Returns `{reasoning, blocks_updated, tasks, schedule}`

---

## Verification Results

- All 5 modified files compile without errors (`python -m py_compile`)
- `schedule_blocks.is_manually_edited` column confirmed in DB: `12|is_manually_edited|INTEGER|0|0|0`
- `GET /regenerate-delta` returns HTTP 405 (Method Not Allowed), confirming POST endpoint is registered
- `RegenerateDeltaRequest` and `BrainMessage` both import successfully from `brain.schemas`
- All key route elements verified: import, route decorator, SQL guard, valid_update_ids filter, snapshot builder

---

## Deviations from Plan

None - plan executed exactly as written.

---

## Self-Check

- [x] `backend/server/database.py` - modified (is_manually_edited migration added)
- [x] `backend/tasks/routes.py` - modified (is_manually_edited = 1 auto-set)
- [x] `backend/tasks/schemas.py` - modified (is_manually_edited field added to BlockUpdate)
- [x] `backend/brain/routes.py` - modified (/regenerate-delta endpoint added)
- [x] `backend/brain/schemas.py` - modified (RegenerateDeltaRequest schema added)
- [x] Commit c7d738f exists (Task 1)
- [x] Commit ae55d2e exists (Task 2)
- [x] DB column verified: `is_manually_edited INTEGER DEFAULT 0` at index 12
- [x] Endpoint verified: GET /regenerate-delta returns 405

## Self-Check: PASSED
