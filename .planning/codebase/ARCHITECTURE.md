# Architecture

**Analysis Date:** 2026-02-17

## Pattern Overview

**Overall:** Layered REST API + Web Frontend with AI-powered study planning

**Key Characteristics:**
- FastAPI backend with modular route-based organization
- SQLite relational database with user isolation
- Single-page frontend with vanilla JavaScript
- AI integration (Claude/Anthropic) for intelligent study roadmap generation
- Multi-exam support with file uploads (PDFs) and AI content analysis
- Task-based scheduler with day-by-day planning

## Layers

**Presentation (Frontend):**
- Purpose: Single-page application providing user interface for auth, exam management, task tracking, and study planning
- Location: `frontend/`
- Contains: HTML structure, vanilla JavaScript application logic, CSS styles
- Depends on: FastAPI HTTP API endpoints
- Used by: Browser clients accessing the web application

**API Layer (Routes):**
- Purpose: RESTful HTTP endpoints handling user requests and responses
- Location: `backend/auth/routes.py`, `backend/users/routes.py`, `backend/exams/routes.py`, `backend/tasks/routes.py`, `backend/brain/routes.py`
- Contains: Route handlers, request/response marshalling, dependency injection (current user)
- Depends on: Database layer, authentication utilities, business logic (ExamBrain)
- Used by: Frontend, external clients

**Business Logic (Brain/AI Layer):**
- Purpose: Intelligent study planning using Claude API to analyze exams and generate study tasks
- Location: `backend/brain/exam_brain.py`, `backend/brain/scheduler.py`
- Contains: ExamBrain class for AI analysis, PDF extraction, calendar generation, chat logic
- Depends on: Anthropic SDK, PyMuPDF (fitz), database models
- Used by: Brain routes (/generate-roadmap, /brain-chat)

**Authentication & Authorization:**
- Purpose: Token-based authentication and user session management
- Location: `backend/auth/routes.py`, `backend/auth/utils.py`, `backend/auth/schemas.py`
- Contains: User registration/login, token generation/validation, password hashing
- Depends on: Database, Pydantic schemas
- Used by: All protected routes via `get_current_user` dependency

**Data Access (Database):**
- Purpose: SQLite connection management, schema initialization, and database interactions
- Location: `backend/server/database.py`, `backend/server/config.py`
- Contains: Connection pooling, schema creation, migrations, index definitions
- Depends on: SQLite3, environment configuration
- Used by: All route handlers and business logic

**Data Models (Schemas):**
- Purpose: Pydantic schema validation for HTTP requests/responses
- Location: `backend/auth/schemas.py`, `backend/users/schemas.py`, `backend/exams/schemas.py`, `backend/tasks/schemas.py`, `backend/brain/schemas.py`
- Contains: Pydantic BaseModel definitions for validation and serialization
- Depends on: Pydantic library
- Used by: Route handlers for request validation and response models

**Server Startup & Configuration:**
- Purpose: FastAPI app initialization, middleware setup, static file mounting
- Location: `backend/server/__init__.py`, `backend/server/config.py`, `backend/run.py`
- Contains: App creation, CORS middleware, static routes, startup hooks
- Depends on: FastAPI, environment variables
- Used by: Application startup

## Data Flow

**User Registration/Login Flow:**

1. User submits registration form in frontend (`frontend/js/app.js`)
2. Frontend calls `POST /auth/register` with name, email, password, study preferences
3. Backend validates input in `backend/auth/routes.py` → `register()`
4. Password hashed using `backend/auth/utils.py` → `hash_password()`
5. User inserted into `users` table with generated auth token
6. Token and user profile returned to frontend
7. Frontend stores token in `localStorage` as `studyflow_token`
8. Token included in all subsequent requests via Authorization header

**Exam Creation & File Upload Flow:**

1. User adds exam in frontend, calls `POST /exams`
2. Route handler `backend/exams/routes.py` → `create_exam()` validates exam data
3. Exam inserted into `exams` table, linked to current user via `user_id`
4. User uploads PDF (syllabus/past exam) via `POST /exams/{exam_id}/upload`
5. File stored in `backend/uploads/user_{user_id}/exam_{exam_id}/` directory
6. File metadata inserted into `exam_files` table with file type (syllabus, past_exam, notes, other)

**AI Roadmap Generation Flow:**

1. User clicks "Generate Roadmap" button in frontend
2. Frontend calls `POST /generate-roadmap`
3. Route handler `backend/brain/routes.py` → `generate_roadmap()` retrieves:
   - All upcoming exams for user from `exams` table
   - Associated files from `exam_files` table
4. Instantiates `ExamBrain` class from `backend/brain/exam_brain.py`
5. ExamBrain extracts text from PDFs using PyMuPDF: `extract_text_from_pdf()`
6. Builds prompt with exam context (name, date, special needs, file contents)
7. Calls Claude API (Sonnet 4.5) via Anthropic SDK
8. Claude returns JSON with day-by-day study tasks (title, topic, difficulty, hours, day_date)
9. Tasks validated and inserted into `tasks` table
10. Tasks returned to frontend, displayed in calendar view

**Brain Chat Flow (Interactive Scheduling):**

1. User types study adjustment request in frontend (e.g., "Give me more time for eigenvalues")
2. Frontend calls `POST /brain-chat` with user message
3. Route handler `backend/brain/routes.py` → `brain_chat()` builds context:
   - Current exams list
   - Current pending tasks with due dates and difficulty
4. Creates detailed prompt including current schedule state
5. Calls Claude API to generate updated task list
6. Parses response JSON with new/modified/deleted tasks
7. Replaces pending tasks in database with new schedule
8. Returns updated calendar to frontend with brain's explanation

**Task Status Update Flow:**

1. User marks task as done in frontend UI
2. Frontend calls `PATCH /tasks/{task_id}/done` or `PATCH /tasks/{task_id}/undone`
3. Route handler updates `tasks.status` to 'done' or 'pending'
4. Calendar view refreshes to reflect completion status

## Key Abstractions

**ExamBrain (AI Planning Engine):**
- Purpose: Encapsulates Claude API integration for intelligent study planning
- Examples: `backend/brain/exam_brain.py`
- Pattern: Class-based, async methods, fallback to basic calendar if AI fails
- Responsibility: Context analysis, prompt engineering, JSON parsing, date-based task generation

**User Context (Authentication Dependency):**
- Purpose: Extract and validate current user from auth token
- Examples: `backend/auth/utils.py` → `get_current_user()`
- Pattern: FastAPI dependency injection, used in route handlers
- Responsibility: Token validation, user lookup, authorization

**Database Connection Management:**
- Purpose: Provide consistent database access with proper isolation
- Examples: `backend/server/database.py` → `get_db()`, `init_db()`
- Pattern: Function-based factory, connection per request, row factory for dict-like access
- Responsibility: Connection pooling, schema initialization, migration

**Route-Based Module Organization:**
- Purpose: Separate concerns by domain (auth, users, exams, tasks, brain)
- Examples: Each module has `routes.py`, `schemas.py`, optional `utils.py`
- Pattern: FastAPI routers included with prefix/tags
- Responsibility: Endpoint definition, validation, response serialization

## Entry Points

**Backend Server:**
- Location: `backend/run.py`
- Triggers: `python -m uvicorn server:app --reload` or `python backend/run.py`
- Responsibilities: Starts FastAPI server on http://0.0.0.0:8000

**Frontend HTML:**
- Location: `frontend/index.html`
- Triggers: Served by `GET /` from FastAPI server
- Responsibilities: Renders login/register screens, exam management, task calendar, study interface

**Database Initialization:**
- Location: `backend/server/__init__.py` → `startup()` event
- Triggers: When FastAPI app starts
- Responsibilities: Creates tables, migrations, indexes, uploads directory

**Application Entry Point:**
- Location: `backend/server/__init__.py` → FastAPI app object `app`
- Triggers: Via uvicorn or ASGI server
- Responsibilities: Mounts routers, middleware, static files, serves frontend

## Error Handling

**Strategy:** HTTP exceptions with descriptive messages, database transaction rollback on error

**Patterns:**
- Route handlers raise `HTTPException` with status codes (400 bad request, 409 conflict, etc.)
- Database connections wrapped in try/finally to ensure close()
- ExamBrain catches AI failures and falls back to basic calendar generation
- Frontend displays error messages in modal/toast notifications

**Examples:**
- Auth: "Email already registered" (409), "Password must be at least 6 characters" (400)
- Exams: "No upcoming exams found" (400)
- AI: Claude API timeout → fallback to basic calendar without error
- Database: Foreign key constraint violations on delete cascade

## Cross-Cutting Concerns

**Logging:**
- Minimal logging present in codebase
- Brain route prints AI analysis failures to stdout
- No centralized logging framework configured

**Validation:**
- Pydantic schemas validate all HTTP request/response payloads
- Custom validators in routes (password length, email format, exam date validation)
- Exams tied to exam_ids returned by AI to prevent unauthorized exam access

**Authentication:**
- Token-based with Bearer scheme in Authorization header
- Tokens generated randomly in `backend/auth/utils.py`
- All user data routes protected by `Depends(get_current_user)`
- User isolation: queries filtered by user_id to prevent cross-user access

**File Upload Security:**
- Files stored in user-specific directories: `backend/uploads/user_{user_id}/exam_{exam_id}/`
- File type validation (only PDFs extracted for content)
- File path not directly exposed to AI (only content extracted)

---

*Architecture analysis: 2026-02-17*
