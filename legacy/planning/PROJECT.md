# StudyFlow

## What This Is

An AI-powered study planner that helps students manage multiple exams by generating personalized, day-by-day study schedules with hourly time slots. Students upload exam materials (syllabi, past exams), and the AI "Brain" (Claude/GPT) analyzes them to create an optimized roadmap that adapts to schedule changes. Built as a web app targeting public launch.

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
- ✓ Mobile-First UX: Bottom tab navigation and touch interactions — Phase 14
- ✓ Progress & Deferral: Interactive progress bars and task skipping — Phase 15
- ✓ PWA & Push: VAPID notifications and smart study triggers — Phase 16
- ✓ Split-Brain Scheduler: Two-call AI architecture (Auditor + Strategist) — Phase 17
- ✓ Gamification: XP system, Login Streaks, and Morning Review — Phase 19
- ✓ Evaluation Dashboard: Isolated LLM arena for side-by-side optimization — Phase 20

### Active

- *v1.0 Release Stabilization*

### Out of Scope

- Google Calendar sync — defer to v2, complex OAuth scope management
- Admin panel / user management — not needed for v1 launch
- Real-time chat between users — not a social app
- Video/audio content support — PDF and text only for v1
- Mobile native app — PWA covers mobile use case

## Context

- FastAPI + SQLite + vanilla JS stack, Litellm for multi-model support (Claude, GPT, Gemini)
- Streamlit-based evaluation arena for model testing
- No formal automated tests — manual verification + LLM Judge
- PWA support for mobile installation
- Scheduler algorithm in `backend/brain/scheduler.py` uses greedy-fill with fragmentation support

## Constraints

- **Tech stack**: Continue with FastAPI + SQLite + vanilla JS — no framework migration
- **AI provider**: Multi-model support via Litellm/OpenRouter
- **Frontend**: No build step — keep CDN-based Tailwind + vanilla JS approach
- **Auth**: Supports both email/password and Google OAuth
- **Database**: SQLite with WAL mode for concurrent access
- **Budget**: Optimized token usage via compact JSON formats and split-brain architecture

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Replace brain chat with regenerate input | Chat was underused; global regeneration is more intuitive for schedule changes | ✓ Completed |
| Google OAuth over other providers | Most students have Google accounts; single provider keeps scope manageable | ✓ Completed |
| Keep vanilla JS frontend | Avoids migration cost; app complexity doesn't yet warrant a framework | ✓ Completed |
| PWA instead of native app | Lower cost, single codebase, students can install from browser | ✓ Completed |
| Hourly scheduling over vague tasks | Core usability improvement — students need to know exactly when to study | ✓ Completed |
| Split-Brain Architecture | Reduces token usage and improves reliability by separating analysis from planning | ✓ Completed |
| Automated Judge Logic | Enables quantitative quality measurement without manual schedule audits | ✓ Completed |

---
*Last updated: 2026-03-07 after Phase 20 resolution*
