# Project State: StudyFlow

**Last Updated:** 2026-02-22
**Status:** Phase 10 complete - all plans done

---

## Project Reference

**Core Value:**
Students open the app every day and know exactly what to study, when, and for how long — with zero manual planning.

---

## Current Position

**Phase:** 10 - Regenerate Roadmap
**Plan:** 2 of 2 complete
**Status:** Phase 10 complete - ready for next phase
**Progress:** `[#######---] 70%` (7/10 phases complete)

---

## Session Continuity

- Phase 9 is complete (Manual task management, Push Physics, Edits).
- Phase 10 Plan 01 complete: is_manually_edited DB flag + POST /regenerate-delta endpoint.
- Phase 10 Plan 02 complete: brain chat replaced with constraint-triggered regen bar; study-hours change triggers bar.
- Blocks with is_manually_edited=1 are preserved during AI delta regeneration.
- Ready for next phase.

---

## Decisions Made

- is_manually_edited flag is permanent — once set, backend cannot unset it via time/title updates
- Delta regeneration uses pipe-delimited snapshot for token efficiency (not full JSON)
- SQL WHERE clause includes AND is_manually_edited = 0 as safety double-check alongside Python filtering
- Break blocks excluded from AI snapshot — only study and hobby blocks sent to Claude
- Regen trigger placed in auth.js handleSaveSettings (not app.js) — that is where the save handler lives
- getRegenTriggerLabel exported from store.js for future consumers but not imported into brain.js (not needed internally)
- tasks.js left unchanged — no exam-date edit flow exists yet; future feature should call setRegenTriggered(true)

---

## Performance Metrics

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 10 | 01 | 3 min | 2 | 5 |
| 10 | 02 | 2 min | 2 | 5 |

---

## Last Session

**Stopped At:** Completed 10-02-PLAN.md
**Timestamp:** 2026-02-22
