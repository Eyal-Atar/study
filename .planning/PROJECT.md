# StudyFlow

## What This Is

An AI-powered study planner that helps students manage multiple exams by generating personalized, day-by-day study schedules with hourly time slots. Students upload exam materials (syllabi, past exams), and the AI "Brain" (Claude) analyzes them to create an optimized roadmap that adapts to schedule changes. Built as a web app targeting public launch.

## Core Value

Students open the app every day and know exactly what to study, when, and for how long — with zero manual planning.

## Requirements

### Validated

- ✓ User registration and login with email/password — Phase 3
- ✓ Exam CRUD with multi-file upload (PDF syllabi, past exams, notes) — Phase 2
- ✓ AI-powered roadmap generation via Claude (analyze exams → create tasks) — Phase 2
- ✓ Brain chat for natural language schedule adjustments — Phase 2
- ✓ Task completion tracking with calendar view — Phase 3
- ✓ Exclusive zones (4 days before exam = focused study) — Phase 2
- ✓ Today's Focus sidebar — Phase 3
- ✓ Multi-exam scheduler with daily study cap — Phase 2
- ✓ Color-coded roadmap timeline with exam milestones — Phase 3
- ✓ Domain-driven backend folder structure — Phase 4
- ✓ Frontend Modularization (ES6 Modules) — Phase 5
- ✓ Google OAuth login (Sign in with Google) — Phase 6
- ✓ User Profiles & Onboarding Wizard — Phase 7
- ✓ Hourly time slot scheduling with timezone support — Phase 8

### Active

### Out of Scope

- Google Calendar sync — defer to v2, complex OAuth scope management
- Admin panel / user management — not needed for v1 launch
- Real-time chat between users — not a social app
- Video/audio content support — PDF and text only for v1
- Hobby feature (full implementation) — placeholder only in exclusive zone for now
- Mobile native app — PWA covers mobile use case

## Context

- Brownfield project with 4 completed phases (backend, brain, auth+frontend, restructure)
- FastAPI + SQLite + vanilla JS stack, Claude API for AI features
- No tests exist — manual testing only
- No deployment infrastructure yet
- Single monolithic frontend file (index.html + app.js) that will need careful updates
- Scheduler algorithm in `backend/brain/scheduler.py` needs significant rework for hourly slots
- ExamBrain in `backend/brain/exam_brain.py` needs prompt updates for new exclusive zone strategy
- Existing `roadmap.md` documents completed phases and planned features

## Constraints

- **Tech stack**: Continue with FastAPI + SQLite + vanilla JS — no framework migration
- **AI provider**: Anthropic Claude API (already integrated)
- **Frontend**: No build step — keep CDN-based Tailwind + vanilla JS approach
- **Auth**: Must support both existing email/password AND new Google OAuth
- **Database**: SQLite for v1 (PostgreSQL migration is a v2 concern)
- **Budget**: Minimize Claude API token usage where possible (cache, summarize)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Replace brain chat with regenerate input | Chat was underused; global regeneration is more intuitive for schedule changes | — Pending |
| Google OAuth over other providers | Most students have Google accounts; single provider keeps scope manageable | — Pending |
| Keep vanilla JS frontend | Avoids migration cost; app complexity doesn't yet warrant a framework | — Pending |
| PWA instead of native app | Lower cost, single codebase, students can install from browser | — Pending |
| Hourly scheduling over vague tasks | Core usability improvement — students need to know exactly when to study | — Pending |

---
*Last updated: 2026-02-17 after initialization*
