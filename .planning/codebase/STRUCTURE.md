# Codebase Structure

**Analysis Date:** 2026-02-17

## Directory Layout

```
project-root/
├── backend/                    # Python FastAPI backend
│   ├── auth/                   # Authentication module
│   │   ├── __init__.py
│   │   ├── routes.py          # Login/register endpoints
│   │   ├── schemas.py         # Auth request/response models
│   │   └── utils.py           # Token generation, password hashing
│   ├── brain/                  # AI study planning module
│   │   ├── __init__.py
│   │   ├── exam_brain.py      # Core AI engine (PDF extraction, Claude integration)
│   │   ├── routes.py          # /generate-roadmap, /brain-chat endpoints
│   │   ├── scheduler.py       # (exists but not actively used)
│   │   ├── schemas.py         # BrainMessage, ScheduleBlock models
│   │   └── syllabus_parser.py # (exists but not actively used)
│   ├── exams/                  # Exam management module
│   │   ├── __init__.py
│   │   ├── routes.py          # CRUD endpoints, file upload
│   │   └── schemas.py         # ExamCreate, ExamResponse models
│   ├── tasks/                  # Task/calendar module
│   │   ├── __init__.py
│   │   ├── routes.py          # Task list, mark done/undone
│   │   └── schemas.py         # TaskResponse model
│   ├── users/                  # User profile module
│   │   ├── __init__.py
│   │   ├── routes.py          # Get/update user profile
│   │   └── schemas.py         # UserResponse, UserUpdate models
│   ├── server/                 # Server core
│   │   ├── __init__.py        # FastAPI app creation, middleware, routers
│   │   ├── config.py          # Paths, env vars (BASE_DIR, DB_PATH, UPLOAD_DIR)
│   │   └── database.py        # SQLite connection, schema, migrations
│   ├── uploads/                # User file storage
│   │   └── user_{user_id}/
│   │       └── exam_{exam_id}/
│   │           └── [uploaded PDF files]
│   ├── run.py                  # Entry point (uvicorn runner)
│   ├── requirements.txt        # Python dependencies
│   ├── .env                    # Environment variables (ANTHROPIC_API_KEY)
│   ├── .gitignore             # Git ignore rules
│   ├── venv/                   # Python virtual environment
│   └── study_scheduler.db     # SQLite database file
├── frontend/                   # Browser-based frontend
│   ├── index.html             # Single-page app (all screens/logic inline)
│   ├── css/                   # Stylesheets
│   │   └── custom.css         # Custom styles (if any)
│   └── js/                    # JavaScript
│       └── app.js             # Application logic (auth, screens, API calls)
├── docs/                       # Documentation
├── .planning/                  # GSD planning documents
│   └── codebase/              # Architecture/structure analysis (this location)
├── .git/                       # Git repository
├── .gitignore                 # Root-level git ignore
├── BUG_TRACKER.md             # Bug tracking notes
├── TODO.md                    # Development TODOs
├── roadmap.md                 # Project roadmap/vision
└── claude.md                  # (Project-specific instructions)
```

## Directory Purposes

**backend/**
- Purpose: Python FastAPI REST API server with modular organization
- Contains: Route handlers, data models, database code, AI integration
- Key files: `server/__init__.py` (app), `server/database.py` (schema), `run.py` (entry)

**backend/auth/**
- Purpose: User registration, login, token generation
- Contains: Route handlers for /auth/register, /auth/login, authentication utilities
- Key files: `routes.py`, `utils.py` (hash_password, generate_token, get_current_user)

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

**backend/server/**
- Purpose: FastAPI app initialization and configuration
- Contains: App creation, middleware (CORS), route registration, database initialization
- Key files: `__init__.py` (app), `config.py` (paths), `database.py` (schema)

**backend/uploads/**
- Purpose: Persistent storage for user-uploaded exam files
- Structure: `user_{user_id}/exam_{exam_id}/[files]` for isolation
- Generated: Yes (created at runtime for each exam upload)

**frontend/**
- Purpose: Single-page web application interface
- Contains: HTML structure (all screens), JavaScript logic, CSS styling
- Key files: `index.html` (entire app inline), `js/app.js` (main logic)

**docs/**
- Purpose: Project documentation
- Currently sparse, available for future docs

## Key File Locations

**Entry Points:**
- `backend/run.py`: Starts FastAPI server via uvicorn
- `frontend/index.html`: Serves to browser, runs embedded JavaScript
- `backend/server/__init__.py`: Creates FastAPI app, registers routers, initializes DB

**Configuration:**
- `backend/server/config.py`: BASE_DIR, DB_PATH, UPLOAD_DIR, ANTHROPIC_API_KEY
- `backend/.env`: Environment variables (ANTHROPIC_API_KEY required for AI features)
- `frontend/index.html`: Has embedded API_KEY constant and color scheme (EXAM_COLORS)

**Core Logic:**
- `backend/server/database.py`: Schema definition, migrations, connection management
- `backend/brain/exam_brain.py`: ExamBrain class, PDF extraction, AI analysis, fallback logic
- `frontend/js/app.js`: All application logic (auth, screens, API calls, UI updates)

**Testing:**
- No test files present in codebase

**Database:**
- `backend/study_scheduler.db`: SQLite database (generated at runtime)

## Naming Conventions

**Files:**
- Python modules: `snake_case` (e.g., `exam_brain.py`, `get_current_user`)
- Route files: Always named `routes.py` per module
- Schema files: Always named `schemas.py` per module
- Utility files: `utils.py` for helper functions
- HTML: Single `index.html` for entire frontend
- JavaScript: Single `app.js` for entire frontend logic
- CSS: `custom.css` or module-specific

**Directories:**
- Module directories: `snake_case`, correspond to domain (auth, exams, tasks, brain)
- Upload paths: `user_{user_id}/exam_{exam_id}/` for isolation
- Python package dirs: All have `__init__.py`

**Functions/Methods:**
- Python: `snake_case` for functions and methods
- JavaScript: `camelCase` for functions (e.g., `handleLogin()`, `showScreen()`)
- API routes: HTTP method prefix style (POST /exams, GET /tasks, PATCH /tasks/{id}/done)

**Variables:**
- Python: `snake_case` for variables and module-level constants
- JavaScript: `camelCase` for variables, `UPPER_CASE` for constants (e.g., `EXAM_COLORS`)
- Database: Columns in `snake_case`, tables in lowercase

**Classes:**
- Python: `PascalCase` (e.g., `ExamBrain`, `UserResponse`, `ExamCreate`)
- Pydantic models: `PascalCase` with suffix (Response, Request, Create, Update)

**Routes/Endpoints:**
- RESTful: `/resource` for collections, `/resource/{id}` for items
- Pattern: `/exams`, `GET /exams`, `POST /exams`, `PATCH /exams/{id}`
- Special: `/auth/register`, `/auth/login`, `/users/me`, `/generate-roadmap`, `/brain-chat`

## Where to Add New Code

**New Feature (e.g., Exam Recommendations):**
- Primary code: Create new module `backend/recommendations/` with `routes.py`, `schemas.py`, `utils.py`
- Database changes: Add tables in `backend/server/database.py` → `init_db()` migration
- Frontend integration: Add screen and functions in `frontend/js/app.js`
- Route registration: Import and include router in `backend/server/__init__.py`

**New Endpoint:**
- Implementation: Add function in existing `routes.py` (e.g., `backend/exams/routes.py`)
- Validation: Add Pydantic model in corresponding `schemas.py`
- Database: Use `get_db()` to access connection, follow transaction patterns (commit/close)
- Authorization: Depend on `get_current_user` for protected endpoints

**New Component/Module:**
- Structure: Create directory `backend/{module_name}/` with:
  - `__init__.py` (empty or re-exports)
  - `routes.py` (endpoints)
  - `schemas.py` (Pydantic models)
  - `utils.py` (helpers, optional)
- Registration: Include router in `backend/server/__init__.py` with prefix and tags
- Database: Use queries via `get_db()`, follow patterns in `database.py`

**Utilities/Helpers:**
- Shared utilities: `backend/{module}/utils.py` for module-specific
- Server-wide utilities: `backend/server/utils.py` (not present, create if needed)
- Frontend helpers: Inline in `frontend/js/app.js` or extract to `frontend/js/utils.js`

**Database Schema Changes:**
- Location: `backend/server/database.py` → `init_db()` function
- Pattern: Add CREATE TABLE IF NOT EXISTS block or ALTER TABLE migration
- Migration: Add conditional column existence check (see auth columns migration example)
- Indexes: Create indexes for columns used in WHERE/JOIN (see idx_exams_user_date example)

**Frontend Screens:**
- Structure: Add HTML div with id `screen-{name}` in `frontend/index.html`
- CSS classes: Use Tailwind (via CDN), follow dark theme (dark-700, dark-800)
- Logic: Add show/hide in `showScreen()`, event handlers in `frontend/js/app.js`
- Color scheme: Use EXAM_COLORS array for exam-specific colors

## Special Directories

**backend/uploads/**
- Purpose: Persistent storage for user-uploaded exam files (syllabi, past exams)
- Generated: Yes, created at runtime when files are uploaded
- Committed: No (user data, not committed to git)
- Structure: `user_{user_id}/exam_{exam_id}/` for isolation and easy cleanup

**backend/venv/**
- Purpose: Python virtual environment with dependencies
- Generated: Yes, created by `python -m venv venv`
- Committed: No (excluded by .gitignore)
- Update: Run `pip install -r requirements.txt`

**backend/__pycache__/**
- Purpose: Python bytecode cache
- Generated: Yes, auto-created during runtime
- Committed: No (excluded by .gitignore)
- Ignored: Can be safely deleted

**.planning/codebase/**
- Purpose: Architecture and structure analysis documents for GSD orchestration
- Generated: Yes, by mapping commands
- Committed: Yes (part of planning docs)
- Contents: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md

**docs/**
- Purpose: Project documentation and notes
- Currently: Sparse, available for future docs
- Structure: Not enforced, can add subdirectories as needed

---

*Structure analysis: 2026-02-17*
