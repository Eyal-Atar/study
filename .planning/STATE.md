# Project State: StudyFlow

**Last Updated:** 2026-02-23
**Status:** Phase 11 in progress - Plan 02 complete

---

## Project Reference

**Core Value:**
Students open the app every day and know exactly what to study, when, and for how long — with zero manual planning.

---

## Current Position

**Phase:** 11 - Push Notifications
**Plan:** 2 of 3 complete
**Status:** Phase 11 in progress - Plan 02 complete (push notification backend engine)
**Progress:** [███████░░░] 67%

---

## Session Continuity

- Phase 9 is complete (Manual task management, Push Physics, Edits).
- Phase 10 Plan 01 complete: is_manually_edited DB flag + POST /regenerate-delta endpoint.
- Phase 10 Plan 02 complete: brain chat replaced with constraint-triggered regen bar; study-hours change triggers bar.
- Blocks with is_manually_edited=1 are preserved during AI delta regeneration.
- Phase 11 Plan 01 complete: PWA manifest.json, service worker sw.js, offline banner, FastAPI /manifest.json + /sw.js + /static routes.
- Phase 11 Plan 02 complete: VAPID Web Push backend (pywebpush), POST /push/subscribe, DB migration for push columns, APScheduler cron with Claude WhatsApp-friend message generation.

---

## Decisions Made

- is_manually_edited flag is permanent — once set, backend cannot unset it via time/title updates
- Delta regeneration uses pipe-delimited snapshot for token efficiency (not full JSON)
- SQL WHERE clause includes AND is_manually_edited = 0 as safety double-check alongside Python filtering
- Break blocks excluded from AI snapshot — only study and hobby blocks sent to Claude
- Regen trigger placed in auth.js handleSaveSettings (not app.js) — that is where the save handler lives
- getRegenTriggerLabel exported from store.js for future consumers but not imported into brain.js (not needed internally)
- Edit Exam feature added (outside GSD phases): PATCH /exams/{id} endpoint, edit button on exam cards, pre-populated modal, existing file management in step 2, regen bar triggered on date change

---
- [Phase 11]: FastAPI serves /sw.js via explicit route with Service-Worker-Allowed header, not StaticFiles mount — required for full app scope
- [Phase 11]: SW install error is caught but does not fail install — partial cache is better than no SW at all
- [Phase 11]: Offline banner uses bg-red-500 (safe Tailwind default) instead of bg-coral-500 per plan fallback guidance
- [Phase 11]: Startup/shutdown scheduler via @app.on_event (not lifespan context manager) — matches existing codebase pattern
- [Phase 11]: No push notification fires unless VAPID_PRIVATE_KEY is set in .env — safe default for development
- [Phase 11]: Claude claude-3-haiku-20240307 selected for WhatsApp-friend message generation (fast/cheap for per-minute scheduling)

## Performance Metrics

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 10 | 01 | 3 min | 2 | 5 |
| 10 | 02 | 2 min | 2 | 5 |
| 11 | 01 | 3min | 2 | 7 |
| 11 | 02 | 3 min | 2 | 8 |

## Last Session

**Stopped At:** Completed 11-02-PLAN.md
**Timestamp:** 2026-02-22
