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
- [ ] **Phase 10: Regenerate Roadmap** - Replace brain chat with global regeneration input for schedule changes
- [ ] **Phase 11: Push Notifications** - Add PWA installability and Claude-powered motivational notifications
- [ ] **Phase 12: Internationalization** - Support English, Hebrew, Spanish, Arabic with RTL layout
- [ ] **Phase 13: Production Deployment** - Deploy to Render with PostgreSQL and security hardening

---

## Phase Details

### Phase 5: Frontend Modularization
**Goal:** Modular frontend architecture that prevents function name collisions and scope leaks when adding new features
**Depends on:** Nothing (foundational refactor)
**Requirements:** (Technical debt - no direct requirement mapping)
**Success Criteria** (what must be TRUE):
  1. app.js is split into 5+ ES6 modules (auth.js, calendar.js, tasks.js, notifications.js, ui.js)
  2. Each module has clearly defined exports with no global variable pollution
  3. All existing features (login, exam management, task tracking) work identically after refactor
  4. New features can be added by creating isolated modules without touching existing code
**Plans:** 3/3 plans complete

---

### Phase 6: Google OAuth & Security
**Goal:** Users can sign in with Google using industry-standard OAuth with secure token storage
**Depends on:** Phase 5 (modular frontend needed for OAuth callback handling)
**Requirements:** AUTH-01, AUTH-02
**Success Criteria** (what must be TRUE):
  1. User sees "Sign in with Google" button on login screen
  2. User can authenticate with Google account and access their existing exams
  3. Existing email/password login continues to work for legacy users
  4. Auth tokens stored in HttpOnly cookies (not localStorage) to prevent XSS attacks
  5. OAuth state parameter validates correctly to prevent CSRF attacks
**Plans:** 4/4 plans complete

---

### Phase 7: User Profiles & Hobbies
**Goal:** Users can register and manage hobby preferences for personalized study schedules
**Depends on:** Phase 6 (auth must capture hobby during registration)
**Requirements:** PROF-01, PROF-02
**Success Criteria** (what must be TRUE):
  1. Registration form includes hobby input field with placeholder examples
  2. User profile displays current hobby in settings section
  3. User can update hobby from profile settings and see immediate confirmation
  4. Hobby data persists to database and loads correctly on app restart
**Plans:** 3/3 plans complete

---

### Phase 8: Hourly Time Slot Scheduling
**Goal:** Every study task has a specific hourly time slot with timezone-aware storage
**Depends on:** Phase 7 (hobby data needed for break time slot allocation)
**Requirements:** SCHED-01, SCHED-02
**Success Criteria** (what must be TRUE):
  1. Tasks display with exact hourly slots (e.g., "Linear Algebra: 08:00 - 11:00")
  2. Daily schedule includes dedicated hobby/break time slot based on user's registered hobby
  3. Schedule blocks stored in UTC ISO 8601 format, displayed in user's local timezone
  4. Calendar UI shows hourly grid view with tasks positioned at correct time slots
  5. AI scheduler allocates tasks to non-overlapping hourly blocks within daily study cap
**Plans:**
- [x] 08-01-PLAN.md — Database Migration & Task Rollover (completed 2026-02-21)
- [x] 08-02-PLAN.md — Deadline-First Scheduler Implementation (completed 2026-02-21)
- [x] 08-03-PLAN.md — Frontend Integration & Verification (completed 2026-02-21)

---

### Phase 9: Interactive Task Management
**Goal:** Users can manually adjust individual tasks without regenerating entire roadmap
**Depends on:** Phase 8 (hourly time slots must exist before manual editing)
**Requirements:** SCHED-03, TASK-01
**Success Criteria** (what must be TRUE):
  1. User can click a task to open edit modal showing title, duration, and time fields
  2. User can change task time slot and see visual update in calendar immediately
  3. User can modify task duration and surrounding tasks auto-adjust to prevent overlap
  4. Manual edits persist across browser sessions and survive roadmap regenerations
**Plans:** TBD

---

### Phase 10: Regenerate Roadmap
**Goal:** Replace brain chat with global regeneration input for schedule changes
**Depends on:** Phase 9 (manual edits must be trackable before delta regeneration)
**Requirements:** BRAIN-01, BRAIN-02, BRAIN-03
**Success Criteria** (what must be TRUE):
  1. Regeneration prompt only appears when a core constraint changes (exam moved or study hours increased)
  2. User can submit a natural-language reason for regeneration via a focused input (not brain chat)
  3. AI returns only the delta — tasks that need to move — not a full schedule rebuild
  4. Fixed events (exams/classes) and manually-edited tasks are never overwritten by regeneration
  5. Updated tasks appear in calendar immediately after regeneration completes
**Plans:** 2/3 plans executed
Plans:
- [x] 10-01-PLAN.md — DB migration (is_manually_edited) + POST /regenerate-delta backend endpoint (completed 2026-02-22)
- [ ] 10-02-PLAN.md — Remove brain chat UI, add conditional regeneration command bar
- [ ] 10-03-PLAN.md — Human verification checkpoint

---

### Phase 11: Push Notifications
**Goal:** App installable as PWA with motivational push notifications for study reminders
**Depends on:** Phase 10 (scheduler must be stable before adding notifications)
**Requirements:** NOTIF-01, NOTIF-02, INFRA-01, INFRA-03
**Success Criteria** (what must be TRUE):
  1. User can install app to home screen from browser with "Add to Home Screen" prompt
  2. App loads offline with cached UI and last-viewed schedule
  3. User receives push notifications with Claude-powered motivational messages before study sessions
  4. User can disable/customize notification frequency from settings without losing other preferences
  5. Notification permission request appears AFTER first study session completion (not on initial load)
**Plans:** TBD

---

### Phase 12: Internationalization
**Goal:** App supports 4 languages with proper RTL layout for Hebrew and Arabic
**Depends on:** Phase 11 (all UI features complete before translation)
**Requirements:** I18N-01, I18N-02, I18N-03
**Success Criteria** (what must be TRUE):
  1. User can select language from settings: English, Hebrew, Spanish, Arabic
  2. All UI text displays in selected language (buttons, labels, error messages, calendar)
  3. Hebrew and Arabic layouts mirror correctly with right-to-left text flow
  4. Language preference persists across sessions and PWA installs
  5. Claude-powered notifications and brain responses appear in user's selected language
**Plans:** TBD

---

### Phase 13: Production Deployment
**Goal:** App deployed to production with real domain, database, and security hardening
**Depends on:** Phase 12 (all features complete before production launch)
**Requirements:** INFRA-02
**Success Criteria** (what must be TRUE):
  1. App accessible at production domain with HTTPS certificate
  2. PostgreSQL database replaces SQLite with all user data migrated successfully
  3. Google OAuth redirect URIs configured for production domain
  4. CORS allows production frontend origin, blocks all others
  5. Rate limiting active on auth and AI endpoints to prevent abuse
  6. File upload validation blocks non-PDF files and enforces size limits
  7. Environment variables (API keys, secrets) loaded from secure config (not hardcoded)
**Plans:** TBD

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 5. Frontend Modularization | 3/3 | Complete    | 2026-02-18 |
| 6. Google OAuth & Security | 4/4 | Complete    | 2026-02-19 |
| 7. User Profiles & Hobbies | 3/3 | Complete    | 2026-02-20 |
| 8. Hourly Time Slot Scheduling | 3/3 | Complete    | 2026-02-21 |
| 9. Interactive Task Management | 3/3 | Complete    | 2026-02-22 |
| 10. Regenerate Roadmap | 2/3 | In Progress|  |
| 11. Push Notifications | 0/3 | Not started | - |
| 12. Internationalization | 0/3 | Not started | - |
| 13. Production Deployment | 0/3 | Not started | - |

**Overall:** 44% complete (4/9 phases)

---

## Notes

**Phase numbering starts at 5** because Phases 1-4 already completed (backend setup, brain integration, auth+frontend, restructure per PROJECT.md context).

**Research flags:**
- Phase 8 (Hourly Scheduling): Done (08-RESEARCH.md)
- Phase 10 (Regenerate Roadmap): Needs research for scheduler test cases, fallback strategies for impossible schedules
- Phase 13 (Deployment): Needs research for Render configuration, PostgreSQL migration strategy

**Coverage:**
- All 19 v1 requirements mapped to phases 5-13
- No orphaned requirements
- Technical debt (Phase 5) added based on research recommendations to prevent feature collision

---

*Roadmap updated: 2026-02-22*
*Current Focus: Phase 10*
