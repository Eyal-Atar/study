# Roadmap: StudyFlow

**Project:** StudyFlow - AI-Powered Study Planner
**Core Value:** Students open the app every day and know exactly what to study, when, and for how long
**Milestone:** v1 Public Launch
**Created:** 2026-02-18
**Depth:** Comprehensive

---

## Phases

- [x] **Phase 5: Frontend Modularization** - Refactor monolithic app.js into ES6 modules to prevent feature collision (completed 2026-02-18)
- [x] **Phase 6: Google OAuth & Security** - Add Google Sign-In with secure token storage and CSRF protection (completed 2026-02-19)
- [x] **Phase 7: User Profiles & Hobbies** - Capture and manage user hobby preferences for schedule personalization (completed 2026-02-20)
- [x] **Phase 8: Hourly Time Slot Scheduling** - Transform vague tasks into precise hourly schedules with timezone support (completed 2026-02-21)
- [x] **Phase 9: Interactive Task Management** - Enable manual task editing and time adjustments in calendar (completed 2026-02-22)
- [x] **Phase 10: Regenerate Roadmap** - Replace brain chat with global regeneration input for schedule changes (completed 2026-02-22)
- [x] **Phase 11: Push Notifications** - Add PWA installability and Claude-powered motivational notifications (completed 2026-02-22)
- [ ] **Phase 12: Internationalization** - Support English, Hebrew, Spanish, Arabic with RTL layout
- [ ] **Phase 13: Production Deployment** - Deploy to Render with PostgreSQL and security hardening
- [x] **Phase 14: Mobile-First UX** - Bottom tab navigation, touch drag with haptic feedback (completed 2026-02-23)
- [x] **Phase 15: Progress & Deferral** - Interactive progress tracking and task deferral (completed 2026-02-25)
- [x] **Phase 16: PWA Push Notifications, iOS Onboarding, and Smart Triggers** - VAPID push and 2-minute study reminders (completed 2026-02-25)

---

## Phase Details

### Phase 14: Mobile-First UX and Appification
**Goal:** Native-feeling mobile experience with bottom tab navigation, touch drag with haptic feedback, and bottom-sheet modals.
**Status:** Complete (2026-02-23)

### Phase 15: Task Checkbox Sync, Exam Progress Bars, and Push-to-Next-Day Foundation
**Goal:** Interactive progress tracking with real-time sync and task deferral support.
**Status:** Complete (2026-02-25)

### Phase 16: PWA Push Notifications, iOS Onboarding, and Smart Triggers
**Goal:** Establish a robust communication bridge between server and device with native-feeling push notifications and iOS onboarding.
**Status:** Complete (2026-02-25)

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 5. Frontend Modularization | 3/3 | Complete    | 2026-02-18 |
| 6. Google OAuth & Security | 4/4 | Complete    | 2026-02-19 |
| 7. User Profiles & Hobbies | 3/3 | Complete    | 2026-02-20 |
| 8. Hourly Time Slot Scheduling | 3/3 | Complete    | 2026-02-21 |
| 9. Interactive Task Management | 3/3 | Complete    | 2026-02-22 |
| 10. Regenerate Roadmap | 3/3 | Complete    | 2026-02-22 |
| 11. Push Notifications | 3/3 | Complete   | 2026-02-22 |
| 12. Internationalization | 0/3 | Not started | - |
| 13. Production Deployment | 0/3 | Not started | - |
| 14. Mobile-First UX | 1/1 | Complete | 2026-02-23 |
| 15. Progress & Deferral | 2/2 | Complete | 2026-02-25 |
| 16. PWA Push & Smart Triggers | 1/1 | Complete | 2026-02-25 |

**Overall:** 83% complete (10/12 phases)

### Phase 17: Split-Brain Core Scheduler

**Goal:** Upgrade the single-call AI scheduling engine into a two-call Split-Brain architecture (Auditor + Strategist) with full PDF extraction, gap detection, user review page, hard daily quota enforcement, and focus-score-aware scheduling.
**Depends on:** Phase 16
**Requirements:** [SB-01, SB-02, SB-03, SB-04, SB-05, SB-06, SB-07, SB-08]
**Plans:** 1/4 plans executed

Plans:
- [ ] 17-01-PLAN.md — DB migrations, full PDF extraction, upload handler update
- [ ] 17-02-PLAN.md — Auditor call (API Call 1) and brain routes
- [ ] 17-03-PLAN.md — Intermediate Review Page (frontend) + Strategist call (API Call 2)
- [ ] 17-04-PLAN.md — Dashboard Daily Progress (XP Bar) and final Phase 17 cleanup

---

*Roadmap updated: 2026-02-28*
