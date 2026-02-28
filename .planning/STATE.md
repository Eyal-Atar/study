# Session State

## Project Reference

See: .planning/PROJECT.md

## Position

**Milestone:** v1.0 milestone
**Current phase:** Phase 17 — Split-Brain Core Scheduler
**Current plan:** 17-02 (Plan 01 complete)
**Status:** In progress
**Last session:** 2026-02-28 — Completed 17-01-PLAN.md (DB migrations + PDF extraction uncap)

## Session Log

- 2026-02-23: Phase 14 complete — mobile UX and tab navigation.
- 2026-02-25: Phase 15 complete — progress bars and task deferral.
- 2026-02-25: Phase 16 complete — PWA push and smart triggers.
- 2026-02-27: Finalized scheduling logic — implemented Exclusive Focus Zone, Long Breaks, and 1-hour morning buffer. Fixed notification storms and splash screen.
- 2026-02-28: Phase 17 Plan 01 complete — Split-Brain DB migrations and PDF extraction uncap.

## Decisions

- Rebuilt exam_files table (exam_files_new pattern) to update CHECK constraint — SQLite cannot ALTER CHECK constraints. (17-01)
- auditor_draft stored on exams table directly for simplicity — overwritten on each generate cycle. (17-01)
- max_pages defaulted to None in both syllabus_parser.py and exam_brain.py — backward-compatible, all pages extracted. (17-01)

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
