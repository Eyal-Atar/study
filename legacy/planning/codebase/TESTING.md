# Testing Patterns

**Analysis Date:** 2026-02-17

## Test Framework

**Runner:**
- No test runner detected; no pytest, unittest, vitest, jest configuration
- No `pytest.ini`, `setup.cfg`, `pyproject.toml` with test config
- No `jest.config.js`, `vitest.config.js`, or similar

**Assertion Library:**
- Not detected

**Current Testing Approach:**
- Manual testing only; no automated test suite
- No test files found in codebase (`*.test.py`, `*.spec.py`, `*.test.js`, `*.spec.js`)

**Why Testing is Absent:**
- Codebase is in active development phase
- Backend uses FastAPI with built-in dependency injection suitable for testing
- Frontend is single-page vanilla JavaScript without complex state management framework

## Test File Organization

**Location:** Not applicable (no tests written)

**Expected Pattern (if tests were added):**
- Backend: `tests/` directory at project root or per-module
  ```
  backend/
  ├── auth/
  │   ├── routes.py
  │   ├── schemas.py
  │   └── tests/
  │       └── test_routes.py
  ├── users/
  │   └── tests/
  │       └── test_routes.py
  └── tests/
      ├── conftest.py
      ├── test_auth.py
      └── test_database.py
  ```
- Frontend: `__tests__/` or adjacent `.test.js` files for Vanilla JS

## Test Structure

**Recommended Pattern for Backend (FastAPI):**

```python
import pytest
from fastapi.testclient import TestClient
from server import app
from server.database import init_db

client = TestClient(app)

@pytest.fixture
def setup_db():
    """Initialize test database."""
    init_db()
    yield
    # Cleanup

def test_register_success(setup_db):
    response = client.post("/auth/register", json={
        "name": "Test User",
        "email": "test@example.com",
        "password": "password123",
        "wake_up_time": "08:00",
        "sleep_time": "23:00",
        "study_method": "pomodoro",
        "session_minutes": 50,
        "break_minutes": 10
    })
    assert response.status_code == 200
    data = response.json()
    assert "token" in data
    assert data["user"]["email"] == "test@example.com"

def test_register_invalid_email(setup_db):
    response = client.post("/auth/register", json={
        "name": "Test User",
        "email": "invalid",
        "password": "password123"
    })
    assert response.status_code == 400
    assert "email" in response.json()["detail"].lower()
```

**Test Structure Elements:**
- Setup fixtures with `@pytest.fixture` for database initialization
- Use `TestClient` from `fastapi.testclient` for synchronous testing
- Test both success and error paths
- Assert on status codes and response JSON
- Separate fixtures for: database, auth tokens, sample exams/tasks

## Mocking

**Framework:** Not in use; would recommend `unittest.mock` for Python

**Patterns for Mocking (recommended):**

```python
from unittest.mock import patch, MagicMock
import pytest

@patch('anthropic.Anthropic')
def test_brain_with_mock_api(mock_anthropic):
    """Test ExamBrain when Anthropic API fails."""
    mock_client = MagicMock()
    mock_anthropic.return_value = mock_client
    mock_client.messages.create.side_effect = Exception("API Error")

    brain = ExamBrain(user_dict, exam_list)
    result = await brain.analyze_all_exams()
    assert result == brain._generate_basic_calendar(exam_list)

@patch('os.environ.get')
def test_missing_api_key(mock_env):
    """Test ExamBrain behavior when API key missing."""
    mock_env.return_value = None
    brain = ExamBrain(user_dict, exam_list)
    assert brain.client is None
```

**What to Mock:**
- External API calls: `anthropic.Anthropic` for AI analysis
- File system operations: `os.makedirs()`, `os.path.exists()`
- Environment variables: `os.environ.get()`
- Database: Create test database or mock connections

**What NOT to Mock:**
- Internal route handlers: test through TestClient
- Database operations: use test database (init in fixture)
- Pydantic models: validate actual schema behavior
- Core business logic: `ExamBrain._analyze_with_ai()` should be tested with real prompt/response handling (or mock API only)

## Fixtures and Factories

**Test Data (recommended pattern):**

```python
# tests/fixtures.py
import pytest
from datetime import datetime, timedelta

@pytest.fixture
def test_user():
    return {
        "id": 1,
        "name": "Test User",
        "email": "test@example.com",
        "wake_up_time": "08:00",
        "sleep_time": "23:00",
        "study_method": "pomodoro",
        "session_minutes": 50,
        "break_minutes": 10
    }

@pytest.fixture
def test_exam(test_user):
    return {
        "id": 1,
        "user_id": test_user["id"],
        "name": "Calculus Final",
        "subject": "Mathematics",
        "exam_date": (datetime.now() + timedelta(days=7)).isoformat(),
        "special_needs": "",
        "status": "upcoming"
    }

@pytest.fixture
def test_task(test_user, test_exam):
    return {
        "id": 1,
        "user_id": test_user["id"],
        "exam_id": test_exam["id"],
        "title": "Solve integration problems",
        "topic": "Calculus",
        "subject": "Mathematics",
        "deadline": test_exam["exam_date"],
        "day_date": datetime.now().date().isoformat(),
        "estimated_hours": 2.0,
        "difficulty": 3,
        "status": "pending"
    }

@pytest.fixture
def auth_token(test_user):
    """Generate a test auth token."""
    from auth.utils import generate_token
    return generate_token()
```

**Location:**
- Backend: `tests/conftest.py` for shared fixtures
- Frontend: `__tests__/fixtures.js` or inline in test files (no standard)

## Coverage

**Requirements:** Not enforced; no coverage tool configured

**View Coverage (if pytest-cov added):**
```bash
pytest --cov=backend --cov-report=html
# Then open htmlcov/index.html
```

**Recommended target:** 80%+ for critical paths (auth, database, brain)

## Test Types

**Unit Tests:**
- Scope: Individual functions (hash_password, verify_password, generate_token)
- Approach: Test with various inputs, mock external dependencies
- Examples:
  ```python
  def test_hash_password_produces_different_hash():
      hash1 = hash_password("password")
      hash2 = hash_password("password")
      assert hash1 != hash2  # Different salts

  def test_verify_password_with_correct_password():
      password = "secret"
      hashed = hash_password(password)
      assert verify_password(password, hashed) == True

  def test_verify_password_with_wrong_password():
      hashed = hash_password("secret")
      assert verify_password("wrong", hashed) == False
  ```

**Integration Tests:**
- Scope: Full API flows (register → login → create exam → generate roadmap)
- Approach: Use TestClient, test database, verify database state changes
- Examples:
  ```python
  @pytest.mark.asyncio
  async def test_generate_roadmap_end_to_end(setup_db, auth_token, test_exam):
      # 1. Register user
      # 2. Create exam with files
      # 3. Call /generate-roadmap
      # 4. Verify tasks created in database
      pass

  def test_task_workflow(setup_db, auth_token):
      # Create task → mark done → verify status change
      pass
  ```

**E2E Tests:**
- Framework: Not used; would require Playwright, Cypress, or Selenium
- Not applicable to current codebase (frontend is lightweight)
- If added: Test user flows (register → login → upload exam → view calendar → mark tasks done)

## Async Testing

**Pattern (for FastAPI with async routes):**

```python
import pytest

@pytest.mark.asyncio
async def test_async_route():
    """Test async route handler."""
    response = client.post("/generate-roadmap", headers={"Authorization": f"Bearer {auth_token}"})
    assert response.status_code == 200
    data = response.json()
    assert "tasks" in data
```

**Note:** Current routes use `async def` in `brain/routes.py` for `/generate-roadmap` but others are synchronous. TestClient handles this transparently.

## Error Testing

**Pattern:**

```python
def test_login_invalid_email_password(setup_db):
    response = client.post("/auth/login", json={
        "email": "nonexistent@example.com",
        "password": "anypassword"
    })
    assert response.status_code == 401
    assert "Invalid email or password" in response.json()["detail"]

def test_protected_route_without_token():
    response = client.get("/tasks")
    assert response.status_code == 401
    assert "Not authenticated" in response.json()["detail"]

def test_protected_route_with_invalid_token():
    response = client.get("/tasks", headers={"Authorization": "Bearer invalid_token"})
    assert response.status_code == 401
    assert "Invalid or expired token" in response.json()["detail"]

@pytest.mark.asyncio
async def test_generate_roadmap_no_exams(setup_db, auth_token):
    """Test AI brain when no exams exist."""
    response = client.post(
        "/generate-roadmap",
        headers={"Authorization": f"Bearer {auth_token}"}
    )
    assert response.status_code == 400
    assert "No upcoming exams found" in response.json()["detail"]
```

## Database Testing

**Pattern:**

```python
import pytest
from server.database import get_db, init_db

@pytest.fixture
def db():
    """Test database connection."""
    init_db()  # Initialize schema
    db_conn = get_db()
    yield db_conn
    db_conn.close()

def test_user_creation(db):
    cursor = db.execute(
        "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
        ("Test", "test@test.com", "hash")
    )
    db.commit()
    user = db.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
    assert user["name"] == "Test"
    assert user["email"] == "test@test.com"

def test_foreign_key_constraint(db):
    """Test cascade delete on exam deletion."""
    cursor = db.execute(
        "INSERT INTO users (name, email) VALUES (?, ?)",
        ("User", "user@test.com")
    )
    user_id = cursor.lastrowid
    db.commit()

    cursor = db.execute(
        "INSERT INTO exams (user_id, name, subject, exam_date) VALUES (?, ?, ?, ?)",
        (user_id, "Math", "Math", "2026-03-01")
    )
    exam_id = cursor.lastrowid
    db.commit()

    cursor = db.execute(
        "INSERT INTO tasks (user_id, exam_id, title) VALUES (?, ?, ?)",
        (user_id, exam_id, "Study")
    )
    task_id = cursor.lastrowid
    db.commit()

    # Delete exam
    db.execute("DELETE FROM exams WHERE id = ?", (exam_id,))
    db.commit()

    # Task should be cascade deleted
    task = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    assert task is None
```

## Frontend Testing

**Current Status:** No tests; frontend is vanilla JavaScript

**Recommended Approach (if testing added):**
- Unit tests with Jest for utility functions:
  ```javascript
  // __tests__/authHeaders.test.js
  import { authHeaders } from '../js/app.js';

  test('authHeaders includes Bearer token', () => {
      localStorage.setItem('studyflow_token', 'test_token');
      const headers = authHeaders();
      expect(headers.Authorization).toBe('Bearer test_token');
  });
  ```

- Integration tests with `@testing-library/dom`:
  ```javascript
  import { render, screen, fireEvent } from '@testing-library/dom';

  test('handleLogin shows error on invalid credentials', async () => {
      render(document.body.innerHTML = /*html*/...);
      fireEvent.change(screen.getById('login-email'), { target: { value: 'test@test.com' } });
      fireEvent.change(screen.getById('login-password'), { target: { value: 'wrong' } });
      fireEvent.click(screen.getByText('Log In'));
      await screen.findByText(/invalid email or password/i);
  });
  ```

---

*Testing analysis: 2026-02-17*
