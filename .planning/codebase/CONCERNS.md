# Codebase Concerns

**Analysis Date:** 2026-02-17

## Security Issues

**CORS Misconfiguration — Critical:**
- Issue: Wildcard CORS (`allow_origins=["*"]`) allows any origin to access the API
- Files: `backend/server/__init__.py` (line 25)
- Impact: Exposes all endpoints to CSRF attacks and unauthorized client access. Sensitive operations like roadmap generation, file uploads, and user data are at risk.
- Fix approach: Replace `allow_origins=["*"]` with explicit domain list. Example: `allow_origins=["http://localhost:3000", "https://yourdomain.com"]` during development/production.

**Token Storage in LocalStorage — High Risk:**
- Issue: Auth token stored in browser's `localStorage` without HttpOnly flag and no expiration
- Files: `frontend/js/app.js` (lines 4, 80, 138)
- Impact: Token exposed to XSS attacks. If a third-party script is injected, it can steal the token. Token has no expiration validation.
- Fix approach:
  1. Move to HttpOnly cookie (requires backend cookie setting in auth routes)
  2. Implement token expiration with refresh token pattern
  3. Add Content Security Policy headers to prevent XSS

**File Upload Path Traversal Risk — Medium:**
- Issue: Filename sanitization only removes forward/backslashes but doesn't validate file type, size, or content
- Files: `backend/exams/routes.py` (lines 102-106)
- Impact: Users can upload large files causing DOS. No validation of actual file content (only extension checking, no magic byte validation).
- Fix approach:
  1. Add file size limit (e.g., 50MB max per file)
  2. Add whitelist of allowed extensions: `.pdf`, `.txt`, `.docx`
  3. Use `python-magic` to validate magic bytes
  4. Add total storage quota per user

**No Rate Limiting — Medium:**
- Issue: No rate limiting on authentication endpoints and AI endpoints
- Files: `backend/auth/routes.py`, `backend/brain/routes.py`
- Impact: Brute force attacks on login possible. AI analysis endpoint can be abused for DOS (expensive Claude API calls).
- Fix approach: Add `slowapi` package. Implement per-IP rate limits on `/auth/login` (5 attempts/5min) and `/brain-chat` (10 requests/hour).

**API Key Exposure — Medium:**
- Issue: `ANTHROPIC_API_KEY` loaded in `backend/server/config.py` but validation missing
- Files: `backend/server/config.py` (line 11)
- Impact: If API key accidentally leaks in error messages or logs, costs could be incurred.
- Fix approach: Ensure API key is never serialized in API responses. Add env var validation at startup with clear errors if missing.

## Tech Debt

**Bare Exception Handling:**
- Issue: Broad `except Exception:` blocks without specific error types
- Files:
  - `backend/brain/exam_brain.py` (lines 23, 59)
- Impact: Difficult to debug. Hides real errors. Fallbacks silently occur without proper logging.
- Fix approach: Replace with specific exceptions (`ValueError`, `anthropic.APIError`, `json.JSONDecodeError`). Add structured logging with `logging` module instead of `print()`.

**Global Database Connections:**
- Issue: `get_db()` called multiple times per request, opens/closes connections repeatedly
- Files: `backend/auth/utils.py`, all route files
- Impact: Inefficient. Each route handler creates multiple connections. Database locking contention under load.
- Fix approach: Use FastAPI dependency injection with connection pooling. Implement context manager pattern to auto-close. Or migrate to SQLAlchemy with connection pool.

**Hardcoded Configuration Values:**
- Issue: Magic numbers scattered across code without named constants
- Files:
  - `backend/brain/exam_brain.py`: `EXCLUSIVE_ZONE_DAYS = 4`, `max_pages: int = 10`, `max_tokens=8000`
  - `backend/brain/scheduler.py`: `MAX_DAILY_STUDY_HOURS = 6`
  - `backend/auth/utils.py`: `100_000` (PBKDF2 iterations)
- Impact: Configuration changes require code edits. Inconsistent values across modules.
- Fix approach: Move all constants to `backend/server/config.py` using `pydantic.BaseSettings` to centralize config.

**Missing Input Validation:**
- Issue: No validation on exam dates, task hours, difficulty levels. AI-generated tasks not fully validated before insert.
- Files: `backend/exams/schemas.py`, `backend/brain/routes.py`
- Impact: Invalid data can corrupt schedule (negative hours, exam dates in past, invalid difficulty).
- Fix approach: Add Pydantic validators on all schemas. Clamp AI-generated values on all numeric fields (difficulty, hours, etc).

## Performance Bottlenecks

**Multi-Exam Schedule Generation O(n²) Complexity:**
- Issue: Nested loops in `backend/brain/scheduler.py` (lines 87-165) for each day, exam, and task with 30 rounds
- Files: `backend/brain/scheduler.py`
- Impact: For 60 days × 5 exams × 20 tasks = 6000+ iterations per request. Blocks AI generation endpoint.
- Improvement path:
  1. Optimize inner loop: Pre-sort tasks by deadline/difficulty once, not per round
  2. Add caching: Memoize schedule blocks for same exam/day combinations
  3. Add timeout: If loop exceeds 5 seconds, early exit with partial schedule
  4. Consider constraint solver library for optimal assignment

**AI Analysis Context Too Large:**
- Issue: All PDF content (up to 5000 chars per file) sent to Claude for each exam in analyze_all_exams()
- Files: `backend/brain/exam_brain.py` (lines 47-55, 78-85)
- Impact: Expensive token usage (~8000 max_tokens), slow response time, higher costs.
- Improvement path:
  1. Add document summarization step before sending to Claude
  2. Extract only key sections (TOC, learning objectives, practice problems)
  3. Implement file-level caching: Store extracted summaries per file ID

**Database Query N+1 Problem:**
- Issue: `get_exams()` executes separate COUNT queries for each exam
- Files: `backend/exams/routes.py` (lines 46-56)
- Impact: For 10 exams, 30 extra queries (1 list query + 3 COUNTs per exam).
- Fix approach: Use single JOIN with aggregation to fetch all data in one query.

## Fragile Areas

**JSON Parsing Without Validation:**
- Issue: AI response parsed as JSON without try-catch block. No schema validation.
- Files: `backend/brain/exam_brain.py` (lines 78-101)
- Impact: If Claude returns malformed JSON or refuses to return JSON array, entire roadmap generation fails silently.
- Safe modification:
  1. Wrap JSON parsing in try-except with `json.JSONDecodeError`
  2. Add retry logic if JSON parse fails
  3. Add Pydantic schema validation to validate parsed objects
- Test coverage: No unit tests for `_analyze_with_ai()`. Edge cases not covered.

**Scheduler Dependency on System Time:**
- Issue: `datetime.now()` used as baseline in multiple places
- Files: `backend/brain/scheduler.py` (line 36), `backend/brain/exam_brain.py` (line 69)
- Impact: Schedule breaks if system clock changes. Tests can't control time. Exam dates in past break scheduling silently.
- Safe modification: Inject current time as parameter from routes. Use `freeze_gun` in tests for time mocking.

**No Orphaned File Cleanup:**
- Issue: Files deleted from DB but left on disk if process crashes during deletion
- Files: `backend/exams/routes.py` (lines 152-154)
- Impact: Disk fills up over time. `os.remove()` fails silently with no error handling.
- Fix approach: Add transactional file deletion with rollback. Delete from DB first, catch exception, re-insert if file delete fails.

## Scaling Limits

**SQLite Concurrency:**
- Current capacity: Single SQLite database with default 5-second lock timeout
- Limit: With 2-3 concurrent users, write operations queue. Schedule generation blocks all other operations.
- Scaling path:
  1. Add connection pooling
  2. Migrate to PostgreSQL for production
  3. Implement async database driver (`databases` library or `sqlalchemy.ext.asyncio`)

**AI API Rate Limits:**
- Current capacity: Unlimited calls to Claude (no quota management)
- Limit: Multiple users generating roadmaps simultaneously or repeated brain-chat calls can hit Anthropic rate limits
- Scaling path:
  1. Add user-level rate limiting
  2. Implement request queue with background task processing (Celery)
  3. Cache AI responses: Same exam + files = same AI response

**File Storage:**
- Current capacity: Local filesystem (`backend/uploads/`)
- Limit: Grows linearly with no cleanup. No disk space checks.
- Scaling path:
  1. Migrate to S3 or cloud storage
  2. Implement auto-cleanup: Delete old exam files after 1 year
  3. Add storage quota per user

## Dependencies at Risk

**PyMuPDF (fitz) PDF Parsing:**
- Risk: Heavy C library. PDF parsing can crash on malformed files without recovery.
- Impact: File upload fails silently if PDF is corrupted. No user feedback.
- Migration plan: Consider `pdfplumber` (pure Python, more stable) or add PDF validation before processing.

**Anthropic Claude API Model Hard-coded:**
- Risk: Model name `claude-sonnet-4-5-20250929` hard-coded in code
- Impact: If model is deprecated, entire feature breaks. Need code update, not config change.
- Fix approach: Move to `backend/server/config.py`: `AI_MODEL = os.environ.get("AI_MODEL", "claude-sonnet-4-5-20250929")`

## Missing Critical Features

**No Email/Password Reset:**
- Problem: No password reset mechanism. User lockout is permanent.
- Blocks: User recovery. Data loss if password forgotten.

**No Data Export/Backup:**
- Problem: No export feature for user data (exams, tasks, schedule)
- Blocks: GDPR data portability requirement. User confidence.

**No Task Editing:**
- Problem: AI-generated tasks can't be manually edited (title, hours, difficulty)
- Blocks: Users can't fix incorrect AI outputs. Must regenerate entire roadmap.

**No Exam Date Changes:**
- Problem: Once set, exam dates can't be modified. Must delete and recreate.
- Blocks: Adaptation to rescheduled exams.

**No Conflict Detection:**
- Problem: Schedule can place 15+ hours on a single day if multiple exams due soon
- Blocks: Unrealistic schedules. User frustration.

## Test Coverage Gaps

**No Unit Tests:**
- What's not tested:
  - `backend/brain/exam_brain.py`: AI analysis logic, fallback calendar generation
  - `backend/brain/scheduler.py`: Edge cases (exam on exam day, overlapping exams, 0 tasks)
  - `backend/auth/utils.py`: Token generation, password hashing
- Files: No `tests/` directory exists
- Risk: Refactoring core logic breaks undetected. Regression bugs possible.
- Priority: High

**No Integration Tests:**
- What's not tested:
  - Full flow: Register → Create exam → Upload file → Generate roadmap → Check schedule
  - Database cascading deletes when exam is deleted
  - Auth token validation across all endpoints
- Risk: End-to-end workflows untested. Can't verify changes don't break full user flow.
- Priority: High

**No Frontend Tests:**
- What's not tested:
  - Login/register form validation and submission
  - Exam card rendering with various states
  - Calendar rendering with overlapping tasks
  - Brain chat message sending and history
- Files: `frontend/js/app.js` (581 lines) has no tests
- Risk: UI bugs (double-submission, broken forms) only caught by manual testing.
- Priority: Medium

---

*Concerns audit: 2026-02-17*
