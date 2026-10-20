# External Integrations

**Analysis Date:** 2026-02-17

## APIs & External Services

**AI/LLM:**
- Anthropic Claude API - Generates personalized study schedules and handles brain chat queries
  - SDK/Client: `anthropic` Python package (0.34.2)
  - Auth: `ANTHROPIC_API_KEY` environment variable
  - Models used: `claude-sonnet-4-5-20250929`
  - Used in: `backend/brain/exam_brain.py`, `backend/brain/routes.py`
  - Endpoints: POST `/brain/generate-roadmap`, POST `/brain/brain-chat`

## Data Storage

**Databases:**
- SQLite (local file)
  - Connection: `backend/study_scheduler.db` (local file path)
  - Client: Python built-in `sqlite3` module
  - Location: `backend/server/database.py`

**File Storage:**
- Local filesystem only
  - Uploads directory: `backend/uploads/`
  - Structure: `uploads/user_{user_id}/exam_{exam_id}/`
  - File types supported: PDF (syllabus, past exams), text notes, other exam materials
  - Accessed in: `backend/exams/routes.py` (file upload/delete operations)

**Caching:**
- None

## Authentication & Identity

**Auth Provider:**
- Custom implementation (in-house)
  - Implementation: Token-based authentication with Bearer tokens
  - Token generation: `backend/auth/utils.py` - `generate_token()` function
  - Token validation: `backend/auth/utils.py` - `get_current_user()` dependency
  - Password hashing: SHA-256 via `hashlib` with secrets-based salt
  - Database: SQLite `users` table with `password_hash` and `auth_token` columns
  - Endpoints: POST `/auth/register`, POST `/auth/login`, POST `/auth/logout`, GET `/auth/me`

## Monitoring & Observability

**Error Tracking:**
- None

**Logs:**
- None configured
- Application uses print() statements for logging in `backend/brain/exam_brain.py`

## CI/CD & Deployment

**Hosting:**
- Local development (uvicorn)
- No deployment platform configured

**CI Pipeline:**
- None

## Environment Configuration

**Required env vars:**
- `ANTHROPIC_API_KEY` - API key for Claude AI integration (required for AI features)

**Optional env vars:**
- None explicitly documented
- Uses python-dotenv to load `.env` file in `backend/server/__init__.py`

**Secrets location:**
- `.env` file (not committed to git)
- Must be created manually in project root

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None

## PDF Processing

**Text Extraction:**
- PyMUPDF (fitz) 1.24.10
  - Used in: `backend/brain/exam_brain.py` - `extract_text_from_pdf()` function
  - Extracts up to 10 pages per PDF for exam analysis
  - Triggers on: POST `/brain/generate-roadmap` when exam files are processed

## API Endpoints Summary

**Authentication:**
- `POST /auth/register` - User registration with preferences
- `POST /auth/login` - User login returns auth token
- `POST /auth/logout` - User logout
- `GET /auth/me` - Get current user profile

**Exams:**
- `POST /exams` - Create exam entry
- `GET /exams` - List user's exams
- `DELETE /exams/{exam_id}` - Delete exam
- `POST /exams/{exam_id}/files` - Upload exam file (PDF, notes, etc.)
- `GET /exams/{exam_id}/files` - List files for exam
- `DELETE /exams/{exam_id}/files/{file_id}` - Delete exam file

**Brain/AI:**
- `POST /brain/generate-roadmap` - AI analyzes all exams and generates study tasks
- `POST /brain/regenerate-schedule` - Get current calendar tasks
- `POST /brain/brain-chat` - Interactive chat with AI to modify study plan

**Tasks:**
- `GET /tasks` - List user's tasks
- `GET /tasks/{task_id}` - Get task details
- `PUT /tasks/{task_id}` - Update task (status, estimated_hours, etc.)
- `DELETE /tasks/{task_id}` - Delete task

**Users:**
- `PUT /users` - Update user preferences (wake time, sleep time, study method)

**Health:**
- `GET /health` - Server health check

---

*Integration audit: 2026-02-17*
