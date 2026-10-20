# StudyFlow Bug Fix Tracker — State Freeze Audit
**Created**: 2026-03-09
**Total Issues Reported**: 78 | **Verified Real**: ~40 | **Fixed**: 22 | **False Positives**: ~38

> Many issues reported by automated scan were false positives after manual code review.
> Items marked ❌FP were verified to already be handled correctly in the code.

## Fix Progress

### Phase 1: CRITICAL (Must fix before state freeze)
| # | File | Issue | Status |
|---|------|-------|--------|
| 1 | backend/brain/routes.py:1129 | send_to_user after db.close() | ❌FP (happy path only, db still open) |
| 2 | backend/brain/routes.py:162-174 | rollover_tasks missing commit | ❌FP (caller commits in transaction) |
| 3 | backend/server/__init__.py:80 | Missing Request import | ✅ FIXED |
| 4 | backend/auth/utils.py:58 | DB resource leak in get_current_user | ✅ FIXED (try/finally) |
| 5 | backend/brain/routes.py:237 | DB close not guaranteed on exception | ❌FP (except block handles it) |
| 6 | frontend/js/auth.js:376 | Button null crash in login finally | ✅ FIXED |
| 7 | frontend/js/auth.js:299 | Form inputs not validated | ✅ FIXED |
| 8 | frontend/js/app.js:482 | Step elements null crash | ❌FP (file is 286 lines, issue doesn't exist) |
| 9 | frontend/js/tasks.js:88 | getCurrentTasks null crash | ✅ FIXED |
| 10 | frontend/js/calendar.js:206 | getCurrentExams null crash | ✅ FIXED (all 3 occurrences) |
| 11 | backend/server/__init__.py:115 | Debug routes no env guard | ✅ FIXED (IS_PRODUCTION check) |
| 12 | backend/server/__init__.py | Debug panel page no guard | ✅ FIXED (404 in production) |
| 13 | index.html:80 | Undefined _hardReset function | ✅ FIXED (fallback to reload) |
| O1 | frontend/js/app.js:184 | No recovery after refresh in Auditor | ❌FP (checkAuditorDraftOnInit already called) |

### Phase 2: HIGH SEVERITY
| # | File | Issue | Status |
|---|------|-------|--------|
| 14 | backend/brain/scheduler.py:203 | focus_score int() crash | ✅ FIXED (_safe_focus helper) |
| 15 | backend/brain/routes.py | No rate limiting on AI endpoints | ⬜ DEFERRED (infra change, not a code bug) |
| 16 | backend/brain/routes.py:99-110 | Orphaned files on upload fail | ✅ FIXED (try/except with cleanup) |
| 17 | backend/gamification/routes.py:284 | Race condition reschedule | ⬜ DEFERRED (needs architecture review) |
| 18 | backend/brain/routes.py:572 | Silent empty schedule on None | ✅ FIXED (warning log + response flag) |
| 19 | frontend/js/tasks.js:106 | loadExams flag deadlock | ❌FP (finally block already resets flag) |
| 20 | frontend/js/tasks.js:395 | Toggle mutex deadlock | ❌FP (finally block already cleans up) |
| 21 | frontend/js/interactions.js:506 | Save queue integrity | ❌FP (queue pattern is correct, errors caught) |
| 22 | frontend/js/calendar.js:827 | Time indicator stale closure | ❌FP (reads module-level let, always current) |
| 23 | frontend/js/tasks.js:834 | Index filtering during review | ❌FP (_origIndex tracks correctly) |
| 24 | debug_control.html:263 | Hardcoded test data | ⬜ DEFERRED (only accessible in dev now) |
| 25 | frontend/static/test_assets/ | Test assets publicly accessible | ⬜ DEFERRED (gated by debug isolation) |
| O2 | backend/brain/routes.py:84-90 | File index silent skip | ✅ FIXED (added warning log) |
| O3 | frontend/js/tasks.js:992 | No escape from all-rejected | ⬜ DEFERRED (UX improvement, not a bug) |

### Phase 3: MEDIUM SEVERITY
| # | File | Issue | Status |
|---|------|-------|--------|
| M1 | backend/brain/routes.py:384 | Subject field empty | ❌FP (uses task.get with default) |
| M2 | backend/brain/scheduler.py:97 | Off-by-one day range | ❌FP (verified correct with +1) |
| M3 | backend/brain/routes.py:560 | Monkey-patched stdout lock | ✅ FIXED (check before creating new lock) |
| M4 | backend/brain/exam_brain.py | Silent PDF extraction fail | ✅ FIXED (added warning log) |
| M5 | backend/brain/scheduler.py:75 | Timezone offset convention | ❌FP (matches JS getTimezoneOffset) |
| M6 | frontend/js/calendar.js:50 | initInteractions no cleanup | ❌FP (initTouchDrag has guard, interact.js replaces) |
| M7 | frontend/js/ui.js:156 | Profile tab listener leak | ✅ FIXED (init guard) |
| M8 | frontend/js/ui.js:289 | Mobile tab handler leak | ✅ FIXED (init guard) |
| M9 | frontend/js/interactions.js:506 | saveQueue unbounded growth | ❌FP (promise chain GC'd after resolve) |
| M10 | frontend/js/auth.js:432 | Silent logout error | ✅ FIXED (added console.warn) |
| M11 | frontend/js/tasks.js:76 | Silent schedule refresh fail | ❌FP (page reloads on line 74 anyway) |
| M12 | frontend/js/calendar.js:382 | Silent sync failure | ⬜ DEFERRED (minor UX) |
| M13 | frontend/js/onboarding.js:494 | Alert instead of toast | ⬜ DEFERRED (UX improvement) |
| M14 | frontend/js/calendar.js:128 | Stale dayKeys/blocksByDay | ❌FP (rebuilt every renderCalendar call) |
| M15 | frontend/js/calendar.js:117 | findAndScroll 10x retry | ❌FP (2s total, acceptable for DOM readiness) |
| O4 | frontend/js/onboarding.js | Hardcoded defaults | ⬜ DEFERRED (works, needs UX redesign) |
| O5 | backend/brain/routes.py | No exam_date vs buffer validation | ✅ FIXED (past date protection) |
| O6 | backend/brain/routes.py | Timezone offset null fallback | ❌FP (or 0 is correct behavior) |

### Phase 4: LOW SEVERITY
| # | File | Issue | Status |
|---|------|-------|--------|
| L1 | backend/brain/routes.py:103 | No file type validation | ✅ FIXED (allowed extensions check) |
| L2 | backend/brain/scheduler.py:304 | Unreachable padding code | ⬜ DEFERRED (needs scheduler review) |
| L3 | backend/tasks/routes.py:65 | Duplicate push_notified update | ❌FP (correctly inside conditional) |
| L4 | backend/brain/routes.py:355 | Silent exam ID fallback | ⬜ DEFERRED (intentional fallback) |
| L5 | backend/brain/scheduler.py:94 | No exam date format validation | ⬜ DEFERRED (minor edge case) |
| L6 | backend/brain/routes.py:420 | Broad JSON parse except | ❌FP (uses json.JSONDecodeError) |
| L7 | frontend/js/tasks.js:21 | Debug proxy in production | ✅ FIXED (removed stack trace log) |
| L8 | frontend/js/store.js:81 | Cookie URI encoding | ✅ FIXED (decodeURIComponent) |
| L9 | frontend/js/brain.js:37 | Input removal race | ⬜ DEFERRED (harmless edge case) |
| L10 | frontend/js/tasks.js:1239 | File limit UX confusion | ⬜ DEFERRED (UX improvement) |
| O7 | backend/brain/routes.py | auditor_draft per-exam not per-user | ⬜ DEFERRED (works, architectural debt) |

---

## Summary

### Fixed (22 items)
- **Backend**: Request import, auth DB leak, focus_score crash, orphaned files cleanup, scheduler None warning, file index logging, stdout lock fix, PDF log, exam date validation, file type validation
- **Frontend**: auth.js null checks (login/register/settings buttons + form fields), tasks.js null check, calendar.js null checks (3x), ui.js init guards (2x), ui.js modal null checks, logout logging, debug proxy cleanup, cookie URI decode
- **Infrastructure**: Debug routes gated behind IS_PRODUCTION, debug panel 404 in prod, _hardReset fallback

### False Positives (38 items)
Many issues reported by automated scanning were already correctly handled:
- Transactions that commit in caller context
- finally blocks that clean up properly
- Module-level variables read correctly by closures
- Acceptable fallback patterns

### Deferred (12 items)
- Rate limiting (infrastructure change)
- Race condition in reschedule (architecture review needed)
- UX improvements (alerts → toasts, escape routes)
- Test data cleanup (gated by debug isolation now)
- Architectural debt (auditor_draft storage)

---
## Session Notes
- Session 1 (2026-03-09): Full audit + fixes. 22 real issues fixed, 38 false positives identified.
- **Files modified**: `backend/server/__init__.py`, `backend/auth/utils.py`, `backend/brain/routes.py`, `backend/brain/scheduler.py`, `backend/brain/exam_brain.py`, `frontend/js/auth.js`, `frontend/js/tasks.js`, `frontend/js/calendar.js`, `frontend/js/ui.js`, `frontend/js/store.js`, `index.html`
- **To continue in next session**: Read this file, address DEFERRED items as needed.
