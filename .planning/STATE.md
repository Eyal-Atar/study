# Session State

## Project Reference

See: .planning/PROJECT.md

## Position

**Milestone:** v1.0 milestone
**Current phase:** Phase 17 — Split-Brain Core Scheduler
**Current plan:** Phase 17 complete (Plans 01-03 done)
**Status:** In progress
**Last session:** 2026-02-28 — Completed 17-03-PLAN.md (Strategist + Intermediate Review Screen + focus-score-aware Enforcer)

## Session Log

- 2026-02-23: Phase 14 complete — mobile UX and tab navigation.
- 2026-02-25: Phase 15 complete — progress bars and task deferral.
- 2026-02-25: Phase 16 complete — PWA push and smart triggers.
- 2026-02-27: Finalized scheduling logic — implemented Exclusive Focus Zone, Long Breaks, and 1-hour morning buffer. Fixed notification storms and splash screen.
- 2026-02-28: Phase 17 Plan 01 complete — Split-Brain DB migrations and PDF extraction uncap.
- 2026-02-28: Phase 17 Plan 02 complete — Knowledge Auditor: call_split_brain (single Haiku call for all exams), generate-roadmap updated to Auditor-only, GET /brain/auditor-draft added.
- 2026-02-28: Phase 17 Plan 03 complete — Strategist (Call 2), Intermediate Review Screen, POST /brain/approve-and-schedule, focus-score-aware scheduler with peak window placement, dependency ordering, and padding blocks.

## Decisions

- Rebuilt exam_files table (exam_files_new pattern) to update CHECK constraint — SQLite cannot ALTER CHECK constraints. (17-01)
- auditor_draft stored on exams table directly for simplicity — overwritten on each generate cycle. (17-01)
- max_pages defaulted to None in both syllabus_parser.py and exam_brain.py — backward-compatible, all pages extracted. (17-01)
- call_split_brain() replaces per-exam analyze_all_exams() loop — single Haiku call for ALL exams, eliminates N-call anti-pattern. (17-02)
- generate-roadmap intentionally does NOT clear tasks/schedule — existing schedule preserved until user approves Auditor draft. (17-02)
- auditor_draft written to ALL upcoming exams with same JSON blob — ensures GET /brain/auditor-draft works regardless of row order. (17-02)
- approveSchedule() POSTs to /brain/approve-and-schedule — Strategist assigns day_index/internal_priority, Enforcer places tasks in time slots. (17-03)
- _dependency_satisfied() uses completed_task_ids set (tasks placed in any slot) rather than full completion — prevents scheduling deadlocks. (17-03)
- Padding blocks: real is_padding task used if available; synthetic ScheduleBlock (task_id=None) as fallback — keeps daily quota filled without creating orphan task records. (17-03)
- auditor_draft cleared to NULL after approval — prevents resume banner from reappearing on next login. (17-03)

## Accumulated Context

### Roadmap Evolution
- Phase 14: Mobile-First UX (Complete)
- Phase 15: Progress Tracking (Complete)
- Phase 16: PWA Notifications (Complete)
- Phase 17 (AI Strategist) attempted and discarded. Baseline remains Phase 16 + logic refinements.
- Phase 17 added: Split-Brain Core Scheduler (Auditor + Strategist two-call architecture)

### Phase 17 DB Schema (as of Plan 01)
- tasks: + focus_score INTEGER DEFAULT 5, + dependency_id INTEGER
- exam_files: + extracted_text TEXT, CHECK updated to include 'summary' and 'sample_exam'
- exams: + auditor_draft TEXT
