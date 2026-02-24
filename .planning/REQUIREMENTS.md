# Requirements: StudyFlow

**Defined:** 2026-02-18
**Core Value:** Students open the app every day and know exactly what to study, when, and for how long

## v1 Requirements

Requirements for feature-complete v1 public launch.

### Authentication

- [x] **AUTH-01**: User can sign in with Google OAuth
- [x] **AUTH-02**: Existing email/password login continues to work alongside Google OAuth

### Registration & Profile

- [x] **PROF-01**: Registration asks user for their hobby
- [x] **PROF-02**: User can update hobby in profile settings

### Scheduling

- [x] **SCHED-01**: Every task is assigned a specific hourly time slot (e.g., "08:00 - 11:00")
- [x] **SCHED-02**: Schedule includes daily hobby/break time slot based on user's registered hobby
- [ ] **SCHED-03**: User can manually adjust schedule (move tasks, change times)

### Brain & Roadmap

- [x] **BRAIN-01**: Replace "Talk to Brain" chat with global "Regenerate Roadmap" input
- [x] **BRAIN-02**: Regeneration respects user's manual schedule adjustments and preferences
- [x] **BRAIN-03**: User can type high-level changes (e.g., "I'm sick today, shift everything")

### Task Management

- [ ] **TASK-01**: User can click a task to edit its details (title, duration, time)

### Notifications

- [x] **NOTIF-01**: Push notifications for study reminders (Claude-powered motivational messages)
- [x] **NOTIF-02**: User can control notification frequency/preferences

### Localization

- [ ] **I18N-01**: App supports English, Hebrew, Spanish, and Arabic languages
- [ ] **I18N-02**: User can switch language from settings
- [ ] **I18N-03**: RTL layout support for Hebrew and Arabic

### Infrastructure

- [x] **INFRA-01**: App installable as PWA on mobile devices
- [ ] **INFRA-02**: App deployed to production (Render/Railway) with real domain
- [x] **INFRA-03**: Basic offline support via service worker caching

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Interaction

- **DND-01**: Drag & drop task reordering in daily view
- **DND-02**: Swap time slots between tasks via drag

### Security

- **SEC-01**: Token expiration with refresh token pattern
- **SEC-02**: HttpOnly cookie authentication (replace localStorage)
- **SEC-03**: Rate limiting on auth and AI endpoints

### Scheduling Enhancements

- **SCHED-04**: Customizable max daily study hours setting
- **SCHED-05**: New exclusive zone strategy (mock → hobby → review → practice)
- **SCHED-06**: Google Calendar sync (read-only import)

### Quality

- **QA-01**: Backend unit test suite (pytest)
- **QA-02**: Integration tests for full user flows
- **QA-03**: Frontend component tests

### Admin

- **ADMIN-01**: Admin panel for user management

## Out of Scope

| Feature | Reason |
|---------|--------|
| Real-time chat between users | Not a social app — focused on individual study planning |
| Video/audio content support | PDF and text only for v1, storage costs too high |
| Mobile native app | PWA covers mobile use case with lower cost |
| Google Calendar two-way sync | Complex OAuth scope management, defer to v2 |
| Spaced repetition algorithm | Requires data model refactor, not core to v1 |
| Full hobby feature beyond break slots | Placeholder time slots sufficient for v1 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | 06 | Complete |
| AUTH-02 | 06 | Complete |
| PROF-01 | 07 | Complete |
| PROF-02 | 07 | Complete |
| SCHED-01 | 08 | Complete |
| SCHED-02 | 08 | Complete |
| SCHED-03 | 09 | Not Started |
| BRAIN-01 | 10 | Not Started |
| BRAIN-02 | 10 | Not Started |
| BRAIN-03 | 10 | Not Started |
| TASK-01 | 09 | Not Started |
| NOTIF-01 | 11 | Not Started |
| NOTIF-02 | 11 | Not Started |
| I18N-01 | 12 | Not Started |
| I18N-02 | 12 | Not Started |
| I18N-03 | 12 | Not Started |
| INFRA-01 | 11 | Not Started |
| INFRA-02 | 13 | Not Started |
| INFRA-03 | 11 | Not Started |
