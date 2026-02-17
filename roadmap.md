# StudyFlow — Roadmap

## Phase 1: Backend Core ✅ DONE
- [x] Project structure (backend folder, venv, dependencies)
- [x] SQLite database (users, tasks, schedule_blocks, exams, exam_files tables)
- [x] FastAPI server with CORS
- [x] User CRUD endpoints
- [x] Task CRUD endpoints
- [x] PDF upload + text extraction (PyMuPDF)
- [x] Claude AI integration for syllabus parsing
- [x] Scheduling algorithm (pomodoro/continuous, priority by deadline + difficulty)

## Phase 2: Exam-Centric "Brain" App ✅ DONE
- [x] New `exams` + `exam_files` tables — exams are first-class entities
- [x] Exam CRUD: create, list, delete with cascade
- [x] Multi-file upload per exam (syllabus, past exams, notes)
- [x] AI Brain (`ExamBrain`) — analyzes all exams + uploaded files, generates study tasks
- [x] Fallback task generation when no API key / no files
- [x] Multi-exam scheduler with **exclusive zones** (4 days before exam = that exam only)
- [x] Daily study hours cap (6h) to spread work evenly across days
- [x] "Generate Roadmap" — one click: AI builds tasks + scheduler builds timeline
- [x] "Talk to the Brain" chat — ask AI to adjust your roadmap in natural language
- [x] Regenerate schedule endpoint

## Phase 3: Auth + Frontend ✅ DONE
- [x] Login / Register / Logout with token-based auth (PBKDF2-SHA256 + session tokens)
- [x] All API endpoints protected — require `Authorization: Bearer <token>`
- [x] Full SPA frontend: welcome → login/register → dashboard
- [x] Multi-step registration (account → study method → daily schedule)
- [x] Exam cards with countdown, progress bar, file count
- [x] Color-coded roadmap timeline with exam milestones
- [x] Exclusive zone badges ("Focus: Exam Name") on roadmap days
- [x] Today's Focus sidebar
- [x] Task completion with confetti animation
- [x] Brain chat sidebar
- [x] Stats row (nearest exam, hours left, tasks done)
- [x] DB migration support (ALTER TABLE for existing databases)

## Phase 4: Code Restructure ✅ DONE
- [x] Domain-driven folder structure created
- [x] `server/` — FastAPI app, config, database, migrations
- [x] `auth/` — routes, utils (hashing, tokens), schemas
- [x] `users/` — routes, schemas
- [x] `exams/` — routes, schemas (CRUD + file upload)
- [x] `tasks/` — routes, schemas
- [x] `brain/` — routes, schemas, exam_brain, scheduler, syllabus_parser
- [x] `frontend/` — separated HTML, CSS (`css/styles.css`), JS (`js/app.js`)
- [x] Updated `run.py` entry point → `server:app`
- [x] Removed old `app/` and `static/` folders
- [x] Tested full flow: auth, exams, roadmap, schedule, edge cases
- [x] Fixed Python 3.9 compatibility (`list[dict]` → `from __future__ import annotations`)

## Phase 5: Polish & Features (Upcoming)
- [ ] Google Calendar integration (OAuth + sync)
- [ ] Motivational notifications (Claude-powered)
- [ ] Better scheduling (avoid back-to-back hard subjects, subject interleaving)
- [ ] Task editing and manual rescheduling
- [ ] Admin panel / user management

## Phase 6: Deploy (Future)
- [ ] Backend → Render / Railway
- [ ] Frontend → Vercel or served by backend
- [ ] PWA support (installable on phone)
- [ ] Custom domain

## Current Folder Structure
```
study/
├── backend/
│   ├── server/          # App factory, config, database
│   │   ├── __init__.py  # FastAPI app + middleware + routers
│   │   ├── config.py    # Paths, env vars
│   │   └── database.py  # SQLite setup + migrations
│   ├── auth/            # Authentication
│   │   ├── routes.py    # register, login, logout, /me
│   │   ├── utils.py     # password hashing, token mgmt, get_current_user
│   │   └── schemas.py   # RegisterRequest, LoginRequest, AuthResponse
│   ├── users/           # User profiles
│   │   ├── routes.py    # GET/PATCH /users/me
│   │   └── schemas.py   # UserResponse, UserUpdate
│   ├── exams/           # Exam management
│   │   ├── routes.py    # CRUD + file upload/delete
│   │   └── schemas.py   # ExamCreate, ExamResponse, ExamFileResponse
│   ├── tasks/           # Task management
│   │   ├── routes.py    # GET /tasks, PATCH done/undone
│   │   └── schemas.py   # TaskResponse
│   ├── brain/           # AI + Scheduling engine
│   │   ├── routes.py    # generate-roadmap, brain-chat, regenerate-schedule
│   │   ├── schemas.py   # BrainMessage, ScheduleBlock
│   │   ├── exam_brain.py    # AI analysis + fallback task generation
│   │   ├── scheduler.py     # Multi-exam scheduler with exclusive zones
│   │   └── syllabus_parser.py  # PDF text extraction
│   ├── run.py           # Entry point (uvicorn server:app)
│   └── requirements.txt
├── frontend/            # Static frontend (served by backend)
│   ├── index.html
│   ├── css/styles.css
│   └── js/app.js
└── roadmap.md
```

## Tech Stack
- **Backend**: Python, FastAPI, SQLite, PyMuPDF, Anthropic Claude API
- **Frontend**: HTML, Tailwind CSS (CDN), vanilla JS
- **Auth**: PBKDF2-SHA256 password hashing, session tokens (secrets.token_urlsafe)
- **AI**: Claude Sonnet for exam analysis, task generation, and brain chat
