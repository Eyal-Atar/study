# Codebase Structure

**Analysis Date:** 2026-02-20

## Directory Layout

```
project-root/
├── backend/                    # Python FastAPI backend
│   ├── auth/                   # Authentication module
│   │   ├── routes.py          # Login/register endpoints
│   │   ├── schemas.py         # Auth request/response models
│   │   ├── utils.py           # Token generation, password hashing
│   │   └── oauth_config.py    # Google OAuth configuration
│   ├── brain/                  # AI study planning module
│   │   ├── exam_brain.py      # Core AI engine (PDF extraction, Claude integration)
│   │   ├── routes.py          # /generate-roadmap, /brain-chat endpoints
│   │   ├── scheduler.py       # (exists but not actively used)
│   │   ├── schemas.py         # BrainMessage, ScheduleBlock models
│   │   └── syllabus_parser.py # (exists but not actively used)
│   ├── exams/                  # Exam management module
│   │   ├── routes.py          # CRUD endpoints, file upload
│   │   └── schemas.py         # ExamCreate, ExamResponse models
│   ├── tasks/                  # Task/calendar module
│   │   ├── routes.py          # Task list, mark done/undone
│   │   └── schemas.py         # TaskResponse model
│   ├── users/                  # User profile module
│   │   ├── routes.py          # Get/update user profile
│   │   └── schemas.py         # UserResponse, UserUpdate models
│   ├── server/                 # Server core
│   │   ├── config.py          # Paths, env vars (BASE_DIR, DB_PATH, UPLOAD_DIR)
│   │   └── database.py        # SQLite connection, schema, migrations
│   ├── uploads/                # User file storage (ignored by git)
│   ├── run.py                  # Entry point (uvicorn runner)
│   ├── requirements.txt        # Python dependencies
│   └── .env                    # Environment variables (ANTHROPIC_API_KEY)
├── frontend/                   # Browser-based frontend
│   ├── index.html             # Single-page app HTML
│   ├── css/                   # Stylesheets
│   │   └── styles.css         # Main stylesheet
│   └── js/                    # Modularized JavaScript (Phase 5 refactor)
│       ├── app.js             # Main entry point and initialization
│       ├── auth.js            # Authentication logic (Google OAuth, Cookies)
│       ├── brain.js           # Brain chat and AI interactions
│       ├── calendar.js        # Event Calendar integration
│       ├── store.js           # Global state management
│       ├── tasks.js           # Task management and CRUD logic
│       └── ui.js              # Shared UI components and DOM manipulation
├── docs/                       # Documentation
├── scripts/                    # Utility scripts (e.g., verify-auth.sh)
├── .planning/                  # GSD planning documents
├── .venv/                      # Python virtual environment
└── claude.md                  # Project-specific instructions
```

## Directory Purposes

**backend/**
- Purpose: Python FastAPI REST API server with modular organization
- Contains: Route handlers, data models, database code, AI integration
- Key files: `server/__init__.py` (app), `server/database.py` (schema), `run.py` (entry)

**backend/auth/**
- Purpose: User registration, login, and Google OAuth
- Contains: Route handlers for /auth/register, /auth/login, Google OAuth callback, token/cookie utilities
- Key files: `routes.py`, `oauth_config.py`, `utils.py` (hash_password, generate_token, get_current_user)

**backend/brain/**
- Purpose: AI-powered study planning and interactive task scheduling
- Contains: Claude API integration, PDF text extraction, calendar generation logic
- Key files: `exam_brain.py` (ExamBrain class), `routes.py` (/generate-roadmap, /brain-chat)

**backend/exams/**
- Purpose: Exam CRUD operations and file uploads
- Contains: Create/read/update exams, upload syllabi/past exams
- Key files: `routes.py` (POST /exams, GET /exams, POST /exams/{id}/upload)

**backend/tasks/**
- Purpose: Study task management and calendar view
- Contains: List tasks, mark done/undone, task filtering by date
- Key files: `routes.py` (GET /tasks, PATCH /tasks/{id}/done)

**backend/users/**
- Purpose: User profile management
- Contains: Get/update study preferences (wake time, sleep time, study method)
- Key files: `routes.py` (GET /users/me, PATCH /users/me)

**frontend/js/**
- Purpose: Client-side logic split into ES6 modules
- Contains: Feature-specific logic, state management, UI rendering
- Key files: `app.js` (entry), `auth.js` (session), `store.js` (state)
