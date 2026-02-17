# Coding Conventions

**Analysis Date:** 2026-02-17

## Naming Patterns

**Files:**
- Python files use `snake_case`: `exam_brain.py`, `auth_utils.py`, `database.py`
- JavaScript files use `snake_case`: `app.js`
- Directory names use `snake_case`: `backend/`, `auth/`, `brain/`, `exams/`

**Functions:**
- Python functions use `snake_case`: `get_db()`, `generate_token()`, `extract_text_from_pdf()`, `hash_password()`
- JavaScript functions use `camelCase`: `handleLogin()`, `handleRegister()`, `showScreen()`, `authFetch()`, `toggleDone()`
- Event handlers use `handle` prefix in JS: `handleLogin()`, `handleLogout()`, `handleRegister()`
- UI helper functions use descriptive names: `showError()`, `hideError()`, `shakeEl()`, `spawnConfetti()`, `addChatBubble()`

**Variables:**
- Python module-level constants use `UPPER_CASE`: `EXCLUSIVE_ZONE_DAYS`, `BASE_DIR`, `DB_PATH`, `UPLOAD_DIR`
- JavaScript module-level constants use `UPPER_CASE`: `API`, `EXAM_COLORS`
- JavaScript local variables use `camelCase`: `authToken`, `currentUser`, `currentExams`, `currentTasks`, `brainChatHistory`

**Types/Classes:**
- Python Pydantic models use `PascalCase`: `RegisterRequest`, `LoginRequest`, `AuthResponse`, `UserResponse`, `ExamResponse`, `TaskResponse`
- Python class names use `PascalCase`: `ExamBrain`

## Code Style

**Formatting:**
- No explicit linter detected; code follows PEP 8 for Python manually
- JavaScript uses variable-width indentation (4 spaces in Python, 2-4 in JS)
- No formatting tool configured (no `.prettierrc`, `black`, `flake8` configs found)

**Linting:**
- No linting configuration detected (no `.eslintrc`, `.flake8`, `pylintrc`)
- Code relies on manual review

**Comments:**
- Python docstrings use triple quotes for module and function docs: `"""Module description."""`
- Inline comments use `#` with section dividers: `# ─── Section Name ─────────────────`
- JavaScript comments use `//` for inline and `/* */` for multi-line
- Section headers in both languages use decorative dividers for visual organization

## Import Organization

**Python Order:**
1. Standard library imports (`os`, `json`, `sqlite3`, `datetime`, `hashlib`, `secrets`)
2. Third-party imports (`fastapi`, `pydantic`, `anthropic`, `fitz`, `uvicorn`, `dotenv`)
3. Local imports (from `server`, `auth`, `users`, etc.)

**Python Pattern:**
```python
"""Module docstring."""

import os
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from server.database import get_db
from auth.utils import hash_password, verify_password
from users.schemas import UserResponse
```

**JavaScript Pattern:**
- No imports; single monolithic `app.js` file with all code included
- Global variables declared at top level
- Functions organized in logical sections with comment headers
- No module system (no imports/exports)

## Error Handling

**Python Patterns:**
- FastAPI `HTTPException` for API errors with status codes and detail messages:
  ```python
  if not email or "@" not in body.email:
      raise HTTPException(status_code=400, detail="Valid email required")
  ```
- Try/except blocks in critical paths (AI calls, file operations):
  ```python
  try:
      return self._analyze_with_ai(exam_contexts)
  except Exception as e:
      print(f"AI analysis failed: {e}, falling back to basic calendar")
      return self._generate_basic_calendar(exam_contexts)
  ```
- Exception-agnostic fallback: catches `Exception` broadly and logs with `print()`
- Database cleanup in finally blocks:
  ```python
  try:
      cursor = db.execute(...)
      db.commit()
  finally:
      db.close()
  ```

**JavaScript Patterns:**
- Error display via `showError(elementId, message)` function
- Fetch response validation with `!res.ok` check:
  ```javascript
  if (!res.ok) {
      showError('login-error', data.detail || 'Login failed');
      return;
  }
  ```
- Try/catch for network failures:
  ```javascript
  try {
      const res = await fetch(...);
  } catch (e) {
      showError('login-error', 'Cannot connect to server');
  }
  ```
- Generic fallback messages when specific error unavailable
- Button state management during async operations (disabled=true, text change to "Loading...")

## Logging

**Framework:** No logging library; uses `print()` in Python and `console.error()` in JavaScript

**Python Patterns:**
- Simple `print()` for debug/fallback messages in exception handlers:
  ```python
  print(f"AI analysis failed: {e}, falling back to basic calendar")
  ```
- No structured logging; no log levels (DEBUG, INFO, ERROR)

**JavaScript Patterns:**
- `console.error()` for error logging:
  ```javascript
  console.error(e);
  ```
- No structured logging output
- Error messages shown to user via UI, not logged to console

## Comments

**When to Comment:**
- Section dividers with decorative borders separate logical blocks:
  ```python
  # ─── Auth helpers ─────────────────────────────────────
  ```
- Module docstrings explain purpose of file
- Function docstrings rarely used; function names are self-documenting
- Inline comments rare; code is expected to be self-explanatory

**JSDoc/TSDoc:**
- Not used; Python docstrings are simple triple-quote strings
- No type hints in docstrings; Pydantic models and type annotations define types

## Function Design

**Size:**
- Python functions range 10-50 lines; route handlers tend toward 30-40 lines
- JavaScript functions range 5-30 lines for helpers, up to 50 for complex operations
- AI analysis functions (`_analyze_with_ai`, `_build_calendar_prompt`) exceed 100 lines due to JSON processing and prompt construction

**Parameters:**
- Python: Pydantic request models for complex data; simple types for scalars
  ```python
  def register(body: RegisterRequest):
  ```
- FastAPI dependency injection for auth and database:
  ```python
  def get_me(current_user: dict = Depends(get_current_user)):
  ```
- JavaScript: Minimal parameters (1-3); state stored in module-level globals
  ```javascript
  function toggleDone(taskId, btn)
  ```

**Return Values:**
- Python: Explicit Pydantic response models for type safety:
  ```python
  @router.post("/register", response_model=AuthResponse)
  ```
- JavaScript: JSON objects from API calls, handler functions return void (side effects via UI update)

## Module Design

**Exports:**
- Python: Each module has a `router` object (FastAPI APIRouter) exported and included in `server/__init__.py`
  ```python
  # auth/routes.py
  router = APIRouter()

  # server/__init__.py
  from auth.routes import router as auth_router
  app.include_router(auth_router, prefix="/auth", tags=["auth"])
  ```
- Schema modules export Pydantic models for request/response validation
- Utility modules export helper functions (no classes)

**Barrel Files:**
- Not used; each module imports directly from specific files
- No `__init__.py` exports for convenience; minimal `__init__.py` files

**Organization Pattern:**
- Routes layer: `{domain}/routes.py` — handles HTTP endpoints
- Schema layer: `{domain}/schemas.py` — Pydantic request/response models
- Utility layer: `{domain}/utils.py` — business logic (e.g., `auth/utils.py` for crypto, token management)
- Core: `server/` — app initialization, config, database

## Dependency Injection

**FastAPI Pattern:**
- `Depends(get_current_user)` injects authenticated user into route handlers
- `Depends(get_db)` could be used but is instead called inline via `db = get_db()`
- Header-based auth: `authorization: str = Header(None)` in `get_current_user()`

## Database

**Pattern:** Raw SQLite with `sqlite3` module; no ORM
- Connection via `sqlite3.connect()` with `row_factory = sqlite3.Row` for dict-like access
- Parameterized queries prevent SQL injection: `execute("... WHERE id = ?", (id,))`
- Manual connection management with `db.close()` in finally blocks
- Migrations via `ALTER TABLE` in `init_db()` function (checked by inspecting existing columns)

## API Response Pattern

**Consistent structure:**
- Success: Pydantic model (auto-serialized to JSON) or dict with message
- Error: `HTTPException(status_code=..., detail="...")`
- Lists: `response_model=List[SomeModel]`

Example:
```python
@router.post("/register", response_model=AuthResponse)
def register(body: RegisterRequest):
    ...
    return AuthResponse(token=token, user=user)
```

## Constants and Configuration

**Location:** `server/config.py`
- Path constants: `BASE_DIR`, `PROJECT_DIR`, `DB_PATH`, `UPLOAD_DIR`, `FRONTEND_DIR`
- Environment variables read via `os.environ.get()`
- Defaults provided inline: `os.environ.get("ANTHROPIC_API_KEY", "")`

---

*Convention analysis: 2026-02-17*
