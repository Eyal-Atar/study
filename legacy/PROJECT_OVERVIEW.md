# StudyFlow - Project Overview & Code Documentation

**Generated:** 2026-03-20 | **Total Source Files:** 49 | **Total Lines:** ~14,000

---

## What is StudyFlow?

StudyFlow is an **AI-powered study planner** built as a Progressive Web App (PWA). Students input their exams, upload syllabi/past exams, and the AI generates a personalized study schedule with hourly time blocks on a calendar view.

**Core Flow:** Student adds exams -> AI analyzes materials -> AI generates task breakdown -> AI schedules tasks on calendar -> Student studies and marks blocks done -> Gamification tracks progress

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                   Frontend (SPA)                │
│  index.html + frontend/js/*.js + Tailwind CSS   │
│  PWA with Service Worker + Push Notifications    │
└────────────────────┬────────────────────────────┘
                     │ REST API (JSON)
┌────────────────────┴────────────────────────────┐
│               Backend (FastAPI/Python)           │
│                                                  │
│  ┌──────────┐ ┌──────────┐ ┌────────────────┐   │
│  │  Auth     │ │  Users   │ │  Exams         │   │
│  │  (OAuth)  │ │  (CRUD)  │ │  (CRUD+Upload) │   │
│  └──────────┘ └──────────┘ └────────────────┘   │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │  Brain Module (Split-Brain AI)           │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ │    │
│  │  │ Auditor  │→│Strategist│→│ Enforcer │ │    │
│  │  │ (LLM)   │ │ (LLM)    │ │ (Python) │ │    │
│  │  └──────────┘ └──────────┘ └──────────┘ │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  ┌──────────┐ ┌──────────┐ ┌────────────────┐   │
│  │  Tasks   │ │ Notifs   │ │ Gamification   │   │
│  │  (CRUD)  │ │ (Push)   │ │ (XP/Badges)    │   │
│  └──────────┘ └──────────┘ └────────────────┘   │
│                                                  │
│  SQLite (study_scheduler.db) + File uploads      │
└──────────────────────────────────────────────────┘
```

---

## Split-Brain AI Architecture

The AI system has 3 phases:

### Phase 1: Auditor (LLM, parallel per exam)
- **File:** `backend/brain/exam_brain.py` -> `call_split_brain()`
- Runs N parallel LLM calls (one per exam)
- Analyzes syllabus + uploaded materials
- Generates a detailed task breakdown per exam (topics, sub-topics, focus scores, estimated hours)
- Hebrew task titles
- Output: Draft task list for user review

### Phase 2: Strategist (LLM, single call)
- **File:** `backend/brain/exam_brain.py` -> `call_strategist()`
- Takes approved tasks from Auditor review
- Assigns each task a `day_index` (which day to study it)
- Respects anchoring rules (simulations late, reviews early)
- Output: Tasks with day assignments

### Phase 3: Enforcer (Pure Python, deterministic)
- **File:** `backend/brain/scheduler.py` -> `generate_multi_exam_schedule()`
- Converts day indices into concrete time slots
- Greedy-fill algorithm respecting: wake/sleep times, study hours, breaks, peak productivity, hobby time
- Handles task splitting across blocks, padding, motivation blocks
- Output: Calendar schedule blocks

---

## File Structure (Source Code Only)

```
studyflow/
├── index.html                          # SPA HTML (all screens + modals)
├── start.sh                            # Dev startup script
│
├── backend/
│   ├── run.py                          # Entry point (uvicorn)
│   ├── requirements.txt                # Python dependencies
│   │
│   ├── server/                         # Core
│   │   ├── __init__.py                 # FastAPI app, middleware, routes
│   │   ├── config.py                   # Environment config
│   │   └── database.py                 # SQLite init + migrations
│   │
│   ├── auth/                           # Authentication
│   │   ├── routes.py                   # Register, login, logout, Google OAuth
│   │   ├── schemas.py                  # Pydantic models
│   │   ├── utils.py                    # Password hashing, tokens, CSRF
│   │   └── oauth_config.py             # Google OAuth Authlib setup
│   │
│   ├── users/                          # User Profiles
│   │   ├── routes.py                   # GET/PATCH /users/me
│   │   └── schemas.py                  # User model (28+ fields)
│   │
│   ├── exams/                          # Exam Management
│   │   ├── routes.py                   # CRUD + file upload + text extraction
│   │   └── schemas.py                  # Exam models
│   │
│   ├── tasks/                          # Task/Block Management
│   │   ├── routes.py                   # Block CRUD, done/undone, defer, shift
│   │   └── schemas.py                  # Task/Block models
│   │
│   ├── brain/                          # AI Core
│   │   ├── routes.py                   # Onboard, generate, approve, schedule APIs
│   │   ├── exam_brain.py               # Auditor + Strategist LLM logic
│   │   ├── scheduler.py                # Enforcer (deterministic scheduler)
│   │   ├── schemas.py                  # Brain-specific models
│   │   └── syllabus_parser.py          # PDF text extraction + AI digest
│   │
│   ├── notifications/                  # Push Notifications
│   │   ├── routes.py                   # Subscribe/unsubscribe/test
│   │   ├── scheduler.py                # Background APScheduler (60s interval)
│   │   └── utils.py                    # Web Push delivery helper
│   │
│   ├── gamification/                   # XP, Streaks, Badges
│   │   ├── routes.py                   # Login-check, award/revoke XP, badges
│   │   └── utils.py                    # XP/level/streak/badge calculations
│   │
│   ├── debug/                          # Dev-only Debug Tools
│   │   └── routes.py                   # Debug endpoints (trigger push, set streak, etc.)
│   │
│   ├── eval/                           # LLM Evaluation Dashboard
│   │   ├── dashboard.py                # Streamlit eval dashboard
│   │   ├── judge_logic.py              # LLM-as-judge evaluation
│   │   ├── golden_cases.json           # Test cases
│   │   ├── prompts/                    # Judge/scheduler/strategist prompts
│   │   └── requirements.txt            # Eval-specific deps
│   │
│   └── uploads/                        # User uploaded files (PDFs)
│
├── frontend/
│   ├── js/
│   │   ├── app.js                      # Entry point, SPA routing, init
│   │   ├── auth.js                     # Login/register/onboarding UI
│   │   ├── brain.js                    # Regen command bar
│   │   ├── calendar.js                 # Calendar with hourly grid
│   │   ├── interactions.js             # Drag & drop (touch + desktop)
│   │   ├── notifications.js            # Push subscription + toasts
│   │   ├── profile.js                  # Gamification UI (XP, badges, streaks)
│   │   ├── store.js                    # Centralized state + authFetch
│   │   ├── tasks.js                    # Exam cards, roadmap wizard, completion
│   │   └── ui.js                       # Shared UI utilities
│   │
│   ├── css/
│   │   └── styles.css                  # Custom styles (Tailwind via CDN)
│   │
│   ├── sw.js                           # Service worker (cache + push)
│   ├── manifest.json                   # PWA manifest
│   └── static/
│       ├── icon-192.png
│       └── icon-512.png
│
└── scripts/                            # Utility scripts
    ├── generate_vapid.py
    ├── generate_vapid_pem.py
    ├── list_anthropic_models.py
    ├── test_anthropic_models.py
    ├── test_scheduler.py
    ├── manual_push_test.py
    ├── manual_push_test_env.py
    ├── test_old_key.py
    └── verify-auth.sh
```

---

## API Endpoints Summary

### Auth (`/auth`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Create account |
| POST | `/auth/login` | Login with email/password |
| POST | `/auth/logout` | Logout |
| GET | `/auth/me` | Get current user |
| GET | `/auth/google/login` | Google OAuth redirect |
| GET | `/auth/google/callback` | Google OAuth callback |

### Users (`/users`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/users/me` | Get profile |
| PATCH | `/users/me` | Update profile |

### Exams (`/exams`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/exams` | Create exam |
| GET | `/exams` | List exams |
| DELETE | `/exams/{id}` | Delete exam (cascading) |
| PATCH | `/exams/{id}` | Update exam |
| POST | `/exams/{id}/upload` | Upload PDF files |
| GET | `/exams/{id}/files` | List exam files |
| DELETE | `/exam-files/{id}` | Delete file |

### Brain / AI (`/brain`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/brain/onboard` | Full onboarding pipeline |
| POST | `/brain/generate-roadmap` | Run Auditor (generate tasks) |
| GET | `/brain/auditor-draft` | Get stored draft |
| DELETE | `/brain/auditor-draft` | Discard draft |
| POST | `/brain/approve-and-schedule` | Run Strategist + Enforcer |
| POST | `/brain/regenerate-schedule` | Re-run Enforcer |
| POST | `/brain/regenerate-delta` | Delta regen (token-efficient) |
| GET | `/brain/schedule` | Get full schedule |
| POST | `/brain/brain-chat` | Free-form AI chat |

### Tasks
| Method | Path | Description |
|--------|------|-------------|
| GET | `/tasks` | List all tasks |
| PATCH | `/tasks/block/{id}` | Update block |
| DELETE | `/tasks/block/{id}` | Delete block |
| PATCH | `/tasks/block/{id}/done` | Mark done |
| PATCH | `/tasks/block/{id}/undone` | Mark undone |
| POST | `/tasks/block/{id}/defer` | Defer to next day |
| PATCH | `/tasks/{id}/shift-time` | Shift time |
| PATCH | `/tasks/{id}/duration` | Change duration |

### Notifications (`/push`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/push/vapid-public-key` | Get VAPID key |
| POST | `/push/subscribe` | Subscribe to push |
| DELETE | `/push/subscribe` | Unsubscribe |
| POST | `/push/test` | Test notification |

### Gamification (`/gamification`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/gamification/login-check` | Daily login (streak + morning prompt) |
| POST | `/gamification/award-xp` | Award XP for block |
| POST | `/gamification/revoke-xp` | Revoke XP |
| POST | `/gamification/reschedule-task/{id}` | Reschedule from morning prompt |
| POST | `/gamification/batch-reschedule` | Batch reschedule + delete |
| GET | `/gamification/summary` | Full gamification state |

### Debug (`/debug`, dev only)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/debug/trigger` | Test push with custom actions |
| POST | `/debug/set-streak` | Override streak |
| POST | `/debug/award-xp-debug` | Award arbitrary XP |
| POST | `/debug/mark-today-done` | Mark all today blocks done |
| POST | `/debug/reset-progress` | Reset gamification |
| POST | `/debug/trigger-morning-prompt` | Force morning prompt |
| POST | `/debug/backdate-tasks` | Move tasks to past |
| POST | `/debug/reset-onboarding` | Clear onboarding |
| POST | `/debug/restore-onboarding` | Restore onboarding |

---

## Database Schema (9 Tables)

1. **users** - 28+ columns (profile, preferences, auth, Google OAuth, notification settings)
2. **exams** - name, subject, exam_date, difficulty, grades
3. **exam_files** - uploaded PDFs with extracted text, file type classification
4. **tasks** - AI-generated study tasks linked to exams
5. **schedule_blocks** - time-slotted blocks on the calendar
6. **push_subscriptions** - Web Push per user/device
7. **user_xp** - XP, level, daily stats, tasks completed
8. **user_streaks** - consecutive login day tracking
9. **user_badges** - earned achievement badges

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.14, FastAPI, Uvicorn |
| Database | SQLite (WAL mode) |
| AI/LLM | LiteLLM (configurable), Anthropic SDK |
| Auth | Cookie-based sessions, Google OAuth (Authlib), CSRF protection |
| Frontend | Vanilla JS (ES6 modules), Tailwind CSS (CDN) |
| PWA | Service Worker, Web Push (pywebpush/VAPID), manifest.json |
| PDF | PyMuPDF for text extraction |
| Scheduler | APScheduler for background notifications |
| Dev | Uvicorn reload, optional ngrok for iOS testing |

---

## Key Configurations

- **Port:** 8000 (configurable via `.env`)
- **Database:** `backend/study_scheduler.db`
- **Uploads:** `backend/uploads/`
- **LLM Model:** `LLM_MODEL` env var (default: `openrouter/openai/gpt-4o-mini`)
- **VAPID keys:** Required for push notifications
- **Google OAuth:** Requires `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`
