# S03 — שלד ה-API: תוכנית עבודה

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**מטרה:** ב-`api/` יש אפליקציית FastAPI שמאמתת JWT של Supabase מול ה-JWKS של הפרויקט, ו-`GET /me` מחזיר את המשתמש. כל שגיאה חוזרת כ-`application/problem+json` עם הודעה בעברית. ב-GitHub רצים CI ל-api וסריקת סודות, ו-Dependabot פעיל.

**גישה:** העבודה נעשית בענף `s03-api-skeleton`. קודם מתקנים את `.gitignore`, לפני שיש קוד של v2. אחר כך בונים את `api/` בשלוש שכבות, כל אחת עם בדיקות משלה: שלד והגדרות, פורמט שגיאות ואימות. את האימות בודקים פעמיים: בבדיקות, עם מפתח EC שנוצר בזמן הריצה, ומול פרויקט Supabase אמיתי לפיתוח. בסוף מוסיפים CI, מדליקים את Actions ודוחפים את הענף.

**כלים:** Python 3.14, uv, FastAPI, pydantic-settings, PyJWT (`PyJWKClient`), pytest, ruff, mypy, gitleaks, GitHub Actions ו-Dependabot. בנוסף, הדשבורד של Supabase והגדרות GitHub בדפדפן.

**מסמך תכנון:** `docs/superpowers/specs/2026-10-19-studyflow-v2-design.md`, סעיפים 7.1 (מבנה הריפו), 7.7 (API: אימות ושגיאות), 7.11 (אבטחה) ו-7.12 (CI). במפת הדרכים שב-[artifact](https://claude.ai/code/artifact/29a3c52e-d399-425e-90b6-7c05e9146bfa) זו משימה S03, וההגדרה שלה ל"מוכן" היא: בקשה עם JWT תקין מחזירה את המשתמש, וה-CI ירוק.

## מה מצאתי לפני התכנון (2026-10-21)

| נושא | מצב |
|---|---|
| כלים במק | יש Python 3.14.3 ו-Homebrew. אין `uv`, `gitleaks`, `gh` ו-Docker, ולכן גם `supabase start` לא אפשרי כרגע |
| `.env` ו-`.venv/` בשורש | שניהם של הקוד הישן. ב-`.env` יש 6 משתנים: `LLM_MODEL`, `ENVIRONMENT`, `SESSION_SECRET_KEY` ושלושה של VAPID, שהוחלפו ב-S01. בגיבוי של S01 אין עותק שלו |
| `.gitignore` | `uploads/` תופס היום רק את `legacy/backend/uploads/`. `Screenshot*` תופס רק את 5 הקבצים שב-`legacy/planning/printscreens/`, שיש לה כבר כלל משלה. לכן אפשר לעגן את שניהם בלי שאף קובץ יתחיל להופיע ב-git |
| `.superpowers/` | מוסתרת רק בזכות `.superpowers/sdd/.gitignore`, שכתוב בו `*`. תיקיית העבודה של S01 שוקלת 192K, ובחמישה מהקבצים שבה מופיע VAPID |
| Python ב-`legacy/` | 35 קבצי `.py` ושני קבצי requirements: `legacy/backend/requirements.txt` ו-`legacy/backend/eval/requirements.txt` |
| Supabase | פרויקטים חדשים חותמים JWT במפתח אסימטרי כברירת מחדל מאז 2025-10-01. המפתחות הציבוריים נמצאים ב-`/auth/v1/.well-known/jwks.json`, וה-edge של Supabase שומר אותם ב-cache ל-10 דקות. ה-`iss` הוא `https://<ref>.supabase.co/auth/v1`, ו-`aud` יכול להיות מחרוזת או רשימה |
| PyJWT 2.15.1 | דוחה טוקן שה-`iat` שלו בעתיד. בלי leeway, הפרש שעון של שבריר שנייה מול Supabase יספיק כדי לדחות טוקן טרי |
| FastAPI 0.154.0 | מגרסה 0.122, `HTTPBearer` מחזיר 401 ולא 403. כאן הוא רץ עם `auto_error=False`, כדי שגם ה-401 יחזור בפורמט שלנו |
| gitleaks 8.30.1 | `gitleaks git` מריץ כברירת מחדל `git log -p --full-history --all`, כלומר סורק את כל ההיסטוריה בכל הענפים. ב-`.gitleaksignore` אפשר לכתוב הערות עם `#` |
| Dependabot | יש תמיכה ב-`uv`. כללי `ignore` חלים גם על security updates. התראות מופיעות לכל manifest בריפו, בלי קשר להגדרות |
| Actions | `actions/checkout` v7.0.1 (2026-07-17) ו-`astral-sh/setup-uv` v9.0.0 (2026-07-21). השינוי השובר היחיד ב-v9 הוא ש-`prune-cache` כבוי כברירת מחדל |

## מה לא נכלל ולמה

- **CORS.** הצרכן הראשון של ה-API הוא ה-web, ולכן CORS נכנס ב-S04, יחד עם ה-origin של Vite.
- **`supabase/`, Postgres מקומי ו-Alembic.** בלי Docker אי אפשר להריץ את Supabase מקומית. S05 יחליט איך מריצים Postgres לבדיקות, ויעדכן את סעיף 7.12 אם צריך. עד אז, האימות בפיתוח עובד מול פרויקט Supabase בענן.
- **פרופיל והעדפות ב-`GET /me`.** בלי טבלאות אין פרופיל. כאן `/me` מחזיר את המזהה ואת המייל מהטוקן, ו-S05 ו-S09 מוסיפים את השאר.
- **Dependabot ל-`/web`.** נכנס ב-S04, יחד עם `web/.gitignore`.
- **בדיקת מיגרציות ו-Playwright ב-CI.** נכנסים עם המיגרציות ב-S05 ועם בדיקת ה-E2E הראשונה.
- **הגדרות לכלים בשורש הריפו.** pytest, ruff ו-mypy מוגדרים ב-`api/pyproject.toml` ורצים רק מתוך `api/`, גם ב-CI. אחרי ש-`.venv/` שבשורש נמחק, אין בשורש pytest או ruff שאפשר להריץ, ולכן הם לא מגיעים ל-`legacy/`.
- **סריקת סודות לפני commit.** בריפו פרטי מספיקה סריקה ב-CI על כל push. אם סוד יגיע ל-push, מחליפים אותו בכל מקרה.
- **שכתוב היסטוריה בגלל ממצאים של gitleaks.** כמו ב-S02, מפתח שבוטל לא מצדיק force-push.

## אילוצים גלובליים

- Python `>=3.14` (בקובץ `api/.python-version` כתוב `3.14`) ו-uv `>=0.13` (`required-version` ב-`api/pyproject.toml`).
- כל פקודות Python רצות מתוך `api/`: `uv run pytest`, `uv run ruff check .`, `uv run ruff format --check .` ו-`uv run mypy`.
- את האפליקציה בונים רק דרך `create_app()`. אין אובייקט app ברמת המודול, ו-uvicorn רץ עם `--factory`.
- אין סודות בריפו. `api/.env` מוחרג, ורק `api/.env.example` נכנס ל-git. גם ה-Project URL וה-publishable key של Supabase לא נכנסים לקוד, אף על פי שהם לא סודות.
- כל הודעה למשתמש כתובה בעברית ומגיעה מ-`PROBLEMS` שב-`api/app/errors.py`. תשובת שגיאה לא מכילה טקסט של חריגה, stack trace או את הקלט שנשלח (סעיף 7.7).
- כל Action ב-workflows מקובע ל-SHA מלא, והגרסה כתובה בהערה.
- כל commit מחכה לאישור. את הקומיטים המקומיים שבטבלה בסוף אפשר לאשר מראש, יחד עם התוכנית. push, מיזוג ל-`main` ומחיקת ענפים מקבלים אישור נפרד.
- פעולות git רצות בשיחה הראשית, לא ב-subagent. מוסיפים לקומיט נתיבים לפי שם, אף פעם לא `git add -A` או `git add .`. הקומיט של כל Task נעשה אחרי שהסקירה שלו עברה, כך שתיקונים מהסקירה נכנסים לאותו קומיט.
- לא נוגעים בתוכן של `legacy/`. החריג היחיד הוא `.env` שבשורש, שעובר ל-`legacy/.env` ונשאר שם מוחרג.
- פקודות git, ופקודות שלא מתחילות ב-`cd api`, רצות משורש הריפו.

## על מה לשים לב בבדיקה

1. **טוקן אמיתי שונה מטוקן הבדיקה:** אם `aud` מגיע כרשימה, האלגוריתם הוא RS256 או שה-`iss` לא בנוי בדיוק כמו בבדיקות, כל המשתמשים יקבלו 401. Task 4 בודק `aud` שמגיע כרשימה, ו-Task 5 בודק טוקן אמיתי.
2. **הפרש שעון:** טוקן שה-`iat` שלו מקדים בכמה שניות את השעון של השרת צריך לעבור. Task 4 בודק `iat` שנמצא 5 שניות בעתיד, וגם טוקן שפג לפני 60 שניות, מעבר ל-leeway של 30.
3. **Supabase לא זמין:** כשאי אפשר להוריד את ה-JWKS, התשובה היא 503 עם `auth_unavailable`. תשובת 401 הייתה גורמת ל-web לנתק משתמשים מחוברים, ו-500 היה נראה כמו באג. Task 4 בודק את זה מול כתובת שלא עונה.
4. **`SUPABASE_URL` לא מדויק:** לוכסן בסוף הכתובת צריך לעבוד. כתובת עם נתיב, כמו `/auth/v1`, צריכה להיכשל כבר בהפעלה עם הודעה ברורה, ולא להחזיר 401 בכל בקשה. Task 2 בודק את שני המקרים.
5. **שגיאה שחושפת פרטים פנימיים:** 500 לא מחזיר את טקסט החריגה, 422 לא מחזיר את הקלט, וכל הכותרות בעברית. Task 3 בודק את שלושתם.

## מי עושה מה

| Task | מה | מי | תלוי ב- |
|---|---|---|---|
| 1 | פתיחה: סטטוס, ענף, `.gitignore` וקומיט של התוכנית | אני | — |
| 2 | שלד `api/`: uv, הגדרות, `/health`, README ו-`CLAUDE.md` | subagent; ניקוי השורש והקומיט אצלי | 1 |
| 3 | שגיאות בפורמט problem+json | subagent | 2 |
| 4 | אימות JWT מול JWKS ו-`GET /me` | subagent | 3 |
| 5 | פרויקט Supabase לפיתוח ובדיקה עם JWT אמיתי | הפרויקט בצד שלך; הבדיקה אצלי, עם סקריפט שרץ אצלך | 4 |
| 6 | CI, סריקת סודות ו-Dependabot | subagent; הסריקה המקומית, מסמך התכנון והקומיטים אצלי | 4 |
| 7 | הגדרות GitHub, push של הענף ו-CI ירוק | ההגדרות בצד שלך; ה-push אצלי, באישור נפרד | 6 |
| 8 | סקירה סופית, מיזוג, ניקוי וסטטוס "הושלם" | אני; מיזוג, push ומחיקת ענף באישור נפרד | 5, 7 |

את החלקים שלך ב-Tasks 5 ו-7 אפשר לעשות כבר עכשיו, במקביל ל-Tasks 1–4. ביחד זה בערך 20 דקות.

## מבנה הקבצים

```
.github/workflows/api.yml          ruff, mypy ו-pytest בכל push שנוגע ב-api/
.github/workflows/secret-scan.yml  gitleaks על כל ההיסטוריה, בכל push
.github/dependabot.yml             uv ב-/api ו-github-actions; ל-legacy בלי pull requests
.gitleaksignore                    רק אם הסריקה מוצאת מפתח שכבר בוטל
CLAUDE.md                          הנחיות לעבודה בריפו, בעברית
api/pyproject.toml, uv.lock, .python-version, .env.example
api/app/config.py                  Settings
api/app/main.py                    create_app()
api/app/errors.py                  ApiError, PROBLEMS, register_error_handlers()
api/app/auth.py                    TokenVerifier, CurrentUser, get_current_user
api/app/routers/health.py, me.py
api/tests/conftest.py, tokens.py, test_config.py, test_health.py, test_errors.py, test_auth.py, test_me.py
```

---

### Task 1: פתיחת ה-scope

**Files:**
- Modify: `.gitignore` (החלפה מלאה)
- Commit: `docs/superpowers/plans/2026-10-21-s03-api-skeleton.md`
- Delete, מקומית: `.superpowers/sdd/2026-10-19-s01-stabilization/`

**צורך:** `main` ב-cd41df9, אחרי S02.
**מייצר:** ענף `s03-api-skeleton` עם שני קומיטים: קודם `.gitignore`, ואחריו התוכנית.

- [ ] **Step 1: הסטטוס של S03 ל"בעבודה"**
  בטבלת "מפת הדרכים" שב-artifact, משנים את הסטטוס של S03 ל"בעבודה" עם כלי ה-Docs.
  Expected: בשורה של S03 כתוב "בעבודה".

- [ ] **Step 2: פתיחת הענף**
  Run: `git switch -c s03-api-skeleton main && git diff --cached --name-only`
  Expected: `Switched to a new branch 's03-api-skeleton'`, בלי פלט נוסף.

- [ ] **Step 3: `.gitignore` חדש**
  התוכן המלא של הקובץ. הכללים של `legacy/` מעוגנים בזכות הלוכסן שבאמצע, ו-`Screenshot*` מעוגן לשורש:
  ```gitignore
  # Secrets
  .env
  .env.*
  !.env.example
  *.pem

  # Python
  .venv/
  venv/
  __pycache__/
  .pytest_cache/
  .ruff_cache/
  .mypy_cache/
  .coverage
  .coverage.*
  htmlcov/
  *.egg-info/
  api/build/
  api/dist/

  # Local data: legacy SQLite and uploaded study materials
  *.db
  *.db-wal
  *.db-shm
  legacy/backend/uploads/

  # Logs
  *.log

  # Screenshots dropped in the repo root
  /Screenshot*
  legacy/planning/printscreens/

  # Agent workspaces
  .superpowers/

  # OS and editors
  .DS_Store
  .vscode/
  .idea/
  .claude/
  ```

- [ ] **Step 4: ההחרגות תופסות רק את מה שצריך**
  ```bash
  git check-ignore --no-index web/src/features/uploads/List.tsx web/src/features/Uploads/List.tsx \
    web/src/ScreenshotGuard.tsx api/app/build/plan.py api/.env.example; echo "exit $?"
  git check-ignore --no-index legacy/backend/uploads/exam.pdf 'Screenshot 2026-10-21.png' \
    legacy/planning/printscreens/a.png .superpowers/sdd/x.md api/.env api/.env.local api/.coverage \
    api/htmlcov/index.html api/build/lib/x.py api/dist/x.whl api/studyflow_api.egg-info/PKG-INFO \
    api/.pytest_cache/x api/.ruff_cache/x api/.mypy_cache/x | wc -l
  git ls-files -ci --exclude-standard
  git status --short
  find legacy/backend/uploads -type f | wc -l
  ```
  Expected: בפקודה הראשונה מודפס רק `exit 1`, כלומר אף נתיב לא מוחרג, גם כשהאות הראשונה גדולה. אחריה `14`. אחר כך אין פלט, כי אף קובץ מעוקב לא מוחרג. אחר כך רק ` M .gitignore`, ובסוף `45`.

- [ ] **Step 5: מחיקת תיקיית העבודה של S01**
  Run: `rm -rf .superpowers/sdd/2026-10-19-s01-stabilization && ls -A .superpowers/sdd`
  Expected: `.gitignore` בלבד.

- [ ] **Step 6: קומיט של `.gitignore`, באישורך מראש**
  ```bash
  git add .gitignore && git diff --cached --name-only
  git commit -m "chore(gitignore): anchor legacy-only rules and ignore tool artifacts" \
    -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```
  Expected: לפני הקומיט מופיע רק `.gitignore`.

- [ ] **Step 7: קומיט של התוכנית, באישורך מראש**
  ```bash
  git add docs/superpowers/plans/2026-10-21-s03-api-skeleton.md && git diff --cached --name-only
  git commit -m "docs: add S03 API skeleton plan" \
    -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```
  Expected: לפני הקומיט מופיע רק קובץ התוכנית.

### Task 2: שלד `api/` והגדרות

**Files:**
- Create: `api/pyproject.toml`, `api/.python-version`, `api/uv.lock` (נוצר ב-`uv add`), `api/.env.example`, `api/app/__init__.py`, `api/app/config.py`, `api/app/main.py`, `api/app/routers/__init__.py`, `api/app/routers/health.py`, `api/tests/__init__.py`, `api/tests/conftest.py`, `api/tests/test_config.py`, `api/tests/test_health.py` ו-`CLAUDE.md`
- Modify: `README.md`
- מקומית, בלי git: מוחקים את `.venv/` שבשורש, ו-`.env` שבשורש עובר ל-`legacy/.env`

**מייצר:**
- `Settings` ב-`app/config.py`, מ-pydantic-settings. השדה `supabase_url: HttpUrl` נקרא מ-`SUPABASE_URL` בסביבה או ב-`api/.env`. יש לו שתי properties: `jwt_issuer: str`, שהוא `<url>/auth/v1`, ו-`jwks_url: str`, שהוא `<url>/auth/v1/.well-known/jwks.json`.
- `create_app(settings: Settings | None = None) -> FastAPI` ב-`app/main.py`. בלי ארגומנט היא יוצרת `Settings()`, ואת ההגדרות היא שומרת ב-`app.state.settings`.
- `GET /health`, בלי אימות, שמחזיר 200 ו-`{"status": "ok"}`.
- שלושה fixtures ב-`tests/conftest.py`: `settings` מחזיר `Settings(supabase_url="https://test-ref.supabase.co", _env_file=None)`, `app` מחזיר `create_app(settings)`, ו-`client` מחזיר `TestClient(app)`.

- [ ] **Step 1 (בשיחה הראשית): התקנת הכלים**
  Run: `brew install uv gitleaks && uv --version && gitleaks version`
  Expected: `uv 0.13.x` ו-`8.30.x`. את gitleaks צריך ב-Task 6.

- [ ] **Step 2 (בשיחה הראשית): ניקוי השורש**
  ```bash
  rm -rf .venv
  [ ! -e legacy/.env ] && mv .env legacy/.env
  ls -A | tr '\n' ' '; echo
  stat -f '%Lp' legacy/.env && git check-ignore legacy/.env && git status --short
  ```
  Expected: ברשימת השורש אין `.env` ואין `.venv`. אחריה `600`, `legacy/.env`, ואין שינויים ב-git. אם `legacy/.env` כבר קיים, ה-`mv` לא רץ, ועוצרים.

- [ ] **Step 3: פרויקט uv**
  `api/.python-version` מכיל שורה אחת: `3.14`. זה התוכן ההתחלתי של `api/pyproject.toml`:
  ```toml
  [project]
  name = "studyflow-api"
  version = "0.1.0"
  description = "StudyFlow v2 API"
  requires-python = ">=3.14"
  dependencies = []

  [tool.uv]
  required-version = ">=0.13"

  [tool.pytest.ini_options]
  testpaths = ["tests"]
  pythonpath = ["."]
  addopts = ["-ra", "--strict-markers"]

  [tool.ruff]
  target-version = "py314"
  line-length = 100

  [tool.ruff.lint]
  select = ["E", "F", "W", "I", "B", "UP", "S", "FAST", "RUF"]

  [tool.ruff.lint.per-file-ignores]
  "tests/**" = ["S101", "S105", "S106"]

  [tool.mypy]
  strict = true
  plugins = ["pydantic.mypy"]
  files = ["app", "tests"]
  ```
  Run: `cd api && uv add fastapi "uvicorn[standard]" pydantic pydantic-settings && uv add --dev pytest httpx ruff mypy`
  Expected: נוצרים `api/uv.lock` ו-`api/.venv/`, וב-`pyproject.toml` מופיעות התלויות עם גבול תחתון.

- [ ] **Step 4: הבדיקות שנכשלות**
  `tests/__init__.py` ריק, כדי ש-mypy ו-pytest יכירו את `tests` כחבילה. ב-`tests/conftest.py` נמצאים שלושת ה-fixtures שב"מייצר".
  ```python
  # tests/test_health.py
  def test_health_returns_ok(client: TestClient) -> None:
      response = client.get("/health")
      assert response.status_code == 200
      assert response.json() == {"status": "ok"}

  # tests/test_config.py
  @pytest.mark.parametrize("url", ["https://test-ref.supabase.co", "https://test-ref.supabase.co/"])
  def test_auth_urls_derive_from_the_project_url(url: str) -> None:
      settings = Settings(supabase_url=url, _env_file=None)
      assert settings.jwt_issuer == "https://test-ref.supabase.co/auth/v1"
      assert settings.jwks_url == "https://test-ref.supabase.co/auth/v1/.well-known/jwks.json"

  def test_project_url_comes_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
      monkeypatch.setenv("SUPABASE_URL", "https://env-ref.supabase.co")
      assert Settings(_env_file=None).jwt_issuer == "https://env-ref.supabase.co/auth/v1"

  def test_missing_project_url_fails_at_startup(monkeypatch: pytest.MonkeyPatch) -> None:
      monkeypatch.delenv("SUPABASE_URL", raising=False)
      with pytest.raises(ValidationError, match="supabase_url"):
          Settings(_env_file=None)

  @pytest.mark.parametrize("url", ["https://test-ref.supabase.co/auth/v1", "test-ref.supabase.co"])
  def test_project_url_must_be_the_bare_project_url(url: str) -> None:
      with pytest.raises(ValidationError):
          Settings(supabase_url=url, _env_file=None)
  ```
  כל בדיקה מעבירה `_env_file=None`, כדי ש-`api/.env` של מי שמריץ לא ישפיע על התוצאה.

- [ ] **Step 5: הבדיקות נכשלות**
  Run: `cd api && uv run pytest -q`
  Expected: שגיאת import של `app`.

- [ ] **Step 6: `Settings`, `create_app()` ו-`/health`**
  ב-`Settings` יש `model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")`. מוסיפים `field_validator` על `supabase_url`, שדוחה כתובת עם נתיב (כל path שאינו ריק או `/`). הודעת השגיאה שלו אומרת ש-`SUPABASE_URL` צריך להיות כתובת הפרויקט, למשל `https://<ref>.supabase.co`, בלי נתיב. ה-properties בונות את הכתובות מ-`str(self.supabase_url).rstrip("/")`. ב-FastAPI הכותרת היא `StudyFlow API`. ה-router של health נמצא ב-`app/routers/health.py`, ו-`app/__init__.py` ו-`app/routers/__init__.py` ריקים.

- [ ] **Step 7: כל הבדיקות והכלים עוברים**
  Run: `cd api && uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run mypy`
  Expected: `7 passed`, `All checks passed!`, הודעה שכל הקבצים כבר מפורמטים, ו-`Success: no issues found`.

- [ ] **Step 8: השרת עולה, ובלי `SUPABASE_URL` הוא נכשל עם הודעה ברורה**
  ```bash
  cd api
  SUPABASE_URL=https://test-ref.supabase.co uv run uvicorn app.main:create_app --factory --port 8765 --log-level warning &
  curl -s --retry 10 --retry-connrefused --retry-delay 1 http://127.0.0.1:8765/health; echo
  kill $!
  env -u SUPABASE_URL uv run uvicorn app.main:create_app --factory --port 8765 2>&1 | grep -c supabase_url
  ```
  Expected: `{"status":"ok"}`, ואחריו מספר שגדול מ-0. ב-Task 2 עדיין אין `api/.env`, ולכן הריצה השנייה באמת רצה בלי הכתובת.

- [ ] **Step 9: `api/.env.example`**
  ```
  # Copy to api/.env and fill in. api/.env is ignored by git.
  # The Supabase Project URL, with no path: https://<project-ref>.supabase.co
  SUPABASE_URL=https://your-project-ref.supabase.co
  ```

- [ ] **Step 10: `README.md` ו-`CLAUDE.md`**
  ב-`README.md` מוסיפים בראש הרשימה את הבולט `` - `api/`: ה-API של v2, ב-FastAPI עם Python 3.14 ו-uv. ``. בסוף הקובץ מוסיפים:
  ````markdown
  ## הרצת ה-API

  הפקודות רצות מתוך `api/`, וצריך [uv](https://docs.astral.sh/uv/).

  ```bash
  cd api
  uv sync
  cp .env.example .env    # וממלאים את SUPABASE_URL
  uv run uvicorn app.main:create_app --factory --reload
  ```

  בדיקות: `uv run pytest`. lint ופורמט: `uv run ruff check .` ו-`uv run ruff format --check .`. טיפוסים: `uv run mypy`.
  ````
  `CLAUDE.md` כתוב בעברית ומכיל:
  - הפניה למסמך התכנון, לתוכניות שב-`docs/superpowers/plans/` ולמפת הדרכים שב-artifact.
  - כל scope מקבל תוכנית לפני שמתחילים, ונעשה בענף משלו.
  - באג שלא קשור למשימה הנוכחית לא מתקנים. רושמים אותו בטבלה "באגים שנרשמו" שב-artifact, עם כלי ה-Docs, וממשיכים במשימה.
  - `legacy/` לעיון בלבד: לא מריצים אותו, לא עורכים אותו ולא מריצים עליו כלים.
  - אין commit, push או מיזוג בלי אישור מפורש לרשימת הפעולות.
  - טבלה של פקודות `api/`, אותן פקודות כמו ב-README.

  בשיחה הראשית מוסיפים ב-artifact, מתחת למפת הדרכים, את הכותרת "באגים שנרשמו" וטבלה ריקה עם העמודות תאריך, איפה, מה קורה, ונמצא ב-scope.

- [ ] **Step 11: קומיט, בשיחה הראשית ובאישורך מראש**
  ```bash
  git add api/.python-version api/.env.example api/pyproject.toml api/uv.lock api/app/__init__.py \
    api/app/config.py api/app/main.py api/app/routers/__init__.py api/app/routers/health.py \
    api/tests/__init__.py api/tests/conftest.py api/tests/test_config.py api/tests/test_health.py \
    README.md CLAUDE.md
  git diff --cached --name-only | wc -l && git status --short
  git commit -m "feat(api): add the uv project with settings and a health check" \
    -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```
  Expected: `15`, ו-`git status --short` מראה רק את הקבצים שבקומיט. `api/.venv/` והתיקיות של ה-cache לא מופיעים.

### Task 3: שגיאות בפורמט problem+json

**Files:**
- Create: `api/app/errors.py`, `api/tests/test_errors.py`
- Modify: `api/app/main.py`

**צורך:** `create_app()` וה-fixtures `settings`, `app` ו-`client` מ-Task 2.
**מייצר:**
- `PROBLEM_JSON = "application/problem+json"`.
- `Problem(status: int, title: str)`, dataclass קפוא, ו-`PROBLEMS: Mapping[str, Problem]`.
- `ApiError(code: str, *, headers: Mapping[str, str] | None = None)`. קוד שלא נמצא ב-`PROBLEMS` מעלה `KeyError` כבר ביצירה.
- `register_error_handlers(app: FastAPI) -> None`, ש-`create_app()` קוראת לה.
- גוף התשובה: `{"type": "about:blank", "title": <title>, "status": <status>, "code": <code>}`. ב-422 מתווסף `"errors": [{"loc": [...], "type": "..."}]`, בלי `msg` ובלי `input`.

הקודים, בדיוק כך:

| code | status | title |
|---|---|---|
| `unauthenticated` | 401 | צריך להתחבר מחדש. |
| `auth_unavailable` | 503 | שירות ההתחברות לא זמין כרגע. נסו שוב בעוד רגע. |
| `not_found` | 404 | לא מצאנו את מה שחיפשת. |
| `method_not_allowed` | 405 | אי אפשר לבצע את הפעולה הזו כאן. |
| `validation_error` | 422 | חלק מהפרטים שנשלחו לא תקינים. |
| `bad_request` | 400 | הבקשה לא תקינה. |
| `internal_error` | 500 | משהו השתבש אצלנו. נסו שוב מאוחר יותר. |

ארבעה handlers. `ApiError` מחזיר את הקוד שלו עם ה-headers שלו. ב-`HTTPException` של Starlette, ‏401 הופך ל-`unauthenticated`, ‏404 ל-`not_found` ו-405 ל-`method_not_allowed`, וה-header `Allow` נשמר. כל 4xx אחר הופך ל-`bad_request` עם ה-status המקורי, וכל 5xx ל-`internal_error` עם 500. `RequestValidationError` הופך ל-`validation_error`. כל `Exception` אחר נרשם בלוג עם `logger.exception` וחוזר כ-`internal_error`.

- [ ] **Step 1: הבדיקות שנכשלות**
  ```python
  def test_unknown_route_is_problem_json(client: TestClient) -> None:
      response = client.get("/no-such-route")
      assert response.status_code == 404
      assert response.headers["content-type"] == "application/problem+json"
      assert response.json() == {
          "type": "about:blank", "title": "לא מצאנו את מה שחיפשת.", "status": 404, "code": "not_found",
      }

  def test_wrong_method_is_405_with_allow_header(client: TestClient) -> None:
      response = client.post("/health")
      assert response.status_code == 405
      assert response.json()["code"] == "method_not_allowed"
      assert "GET" in response.headers["allow"]

  def test_validation_error_names_fields_without_echoing_input(app: FastAPI) -> None:
      # route: GET /probe/{number} with `number: int`, added to the app in the test
      response = TestClient(app).get("/probe/secret-input")
      assert response.status_code == 422
      assert response.json()["errors"] == [{"loc": ["path", "number"], "type": "int_parsing"}]
      assert "secret-input" not in response.text

  def test_api_error_uses_the_catalog(app: FastAPI) -> None:
      # route: GET /unavailable raises ApiError("auth_unavailable")
      response = TestClient(app).get("/unavailable")
      assert response.status_code == 503
      assert response.json()["title"] == PROBLEMS["auth_unavailable"].title

  def test_unhandled_exception_hides_details(app: FastAPI) -> None:
      # route: GET /boom raises RuntimeError("database password is hunter2")
      response = TestClient(app, raise_server_exceptions=False).get("/boom")
      assert response.status_code == 500
      assert response.json()["code"] == "internal_error"
      assert "hunter2" not in response.text

  def test_every_title_is_hebrew() -> None:
      hebrew = re.compile("[֐-׿]")
      assert [code for code, problem in PROBLEMS.items() if not hebrew.search(problem.title)] == []
  ```
  את ה-routes של הבדיקה מוסיפים עם `app.add_api_route(...)` על ה-app מה-fixture.

- [ ] **Step 2: הבדיקות נכשלות**
  Run: `cd api && uv run pytest tests/test_errors.py -q`
  Expected: שגיאת import של `app.errors`.

- [ ] **Step 3: `app/errors.py` וקריאה ל-`register_error_handlers` ב-`create_app()`**
  התשובה נבנית עם `JSONResponse(..., media_type=PROBLEM_JSON)`.

- [ ] **Step 4: כל הבדיקות והכלים עוברים**
  Run: `cd api && uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run mypy`
  Expected: `13 passed`, ושלושת הכלים נקיים.

- [ ] **Step 5: קומיט, בשיחה הראשית ובאישורך מראש**
  ```bash
  git add api/app/errors.py api/app/main.py api/tests/test_errors.py && git diff --cached --name-only
  git commit -m "feat(api): return errors as problem+json with Hebrew messages" \
    -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```
  Expected: לפני הקומיט מופיעים רק שלושת הקבצים.

### Task 4: אימות JWT מול JWKS ו-`GET /me`

**Files:**
- Create: `api/app/auth.py`, `api/app/routers/me.py`, `api/tests/tokens.py`, `api/tests/test_auth.py`, `api/tests/test_me.py`
- Modify: `api/app/main.py`, `api/tests/conftest.py`, `api/pyproject.toml`, `api/uv.lock`

**צורך:** `ApiError("unauthenticated" | "auth_unavailable")` מ-Task 3, ו-`Settings.jwt_issuer` ו-`Settings.jwks_url` מ-Task 2.
**מייצר:**
- `CurrentUser(id: UUID, email: str | None, claims: Mapping[str, Any])`, dataclass קפוא. `claims` מכיל את כל ה-claims שאומתו, לקריאה בלבד (`MappingProxyType`). S05 ישתמש בו אם יחליט להעביר את ה-claims ל-Postgres ב-`request.jwt.claims`.
- `SigningKeySource`, Protocol עם `get_signing_key_from_jwt(token: str) -> jwt.PyJWK`. `jwt.PyJWKClient` מממש אותו.
- `TokenVerifier(keys: SigningKeySource, *, issuer: str)`, עם `verify(token: str) -> CurrentUser`. במקרה של כשל הוא מעלה `ApiError("unauthenticated", headers={"WWW-Authenticate": "Bearer"})`, או `ApiError("auth_unavailable")` כשאי אפשר להוריד את ה-JWKS.
- `jwks_client(settings: Settings) -> jwt.PyJWKClient`.
- `get_current_user(request: Request, credentials: HTTPAuthorizationCredentials | None) -> CurrentUser`, ו-`AuthenticatedUser = Annotated[CurrentUser, Depends(get_current_user)]`.
- `create_app(settings: Settings | None = None, *, signing_keys: SigningKeySource | None = None) -> FastAPI`. בלי `signing_keys` היא משתמשת ב-`jwks_client(settings)`.
- `GET /me`, שמחזיר 200 ו-`{"id": "<uuid>", "email": "<str>" | null}`.
- `tests/tokens.py`: `USER_ID = UUID("6f1c9a52-3d0e-4b8e-9a51-2c7f0e4d8b13")`, `TEST_KID = "test-key-1"`, `TokenFactory = Callable[..., str]`, `bearer(token: str) -> dict[str, str]` ו-`StaticKeys(jwks: Mapping[str, Any])`. `StaticKeys` מממש את `SigningKeySource` מעל JWKS קבוע, ומעלה `jwt.PyJWKClientError` כשה-`kid` לא מוכר, כמו `PyJWKClient`.
- fixtures חדשים ב-`tests/conftest.py`: `signing_key` ו-`other_key`, מפתחות EC P-256 שנוצרים בריצה, `jwks` עם המפתח הציבורי של `signing_key` תחת `TEST_KID`, ו-`make_token(*, drop=(), key=None, kid=TEST_KID, algorithm="ES256", **claims) -> str`. ה-fixture `app` עובר ל-`create_app(settings, signing_keys=StaticKeys(jwks))`.

ה-claims שבברירת המחדל של `make_token`: `iss` = `settings.jwt_issuer`, `aud` = `"authenticated"`, `role` = `"authenticated"`, `sub` = `str(USER_ID)`, `email` = `"student@example.com"`, `iat` = עכשיו, `exp` = עכשיו ועוד 3600, `session_id`, `aal` = `"aal1"` ו-`is_anonymous` = `False`. `algorithm="none"` בונה טוקן לא חתום ביד: header ו-payload ב-base64url, וחתימה ריקה.

הקבועים ב-`app/auth.py`, בדיוק כך:

| שם | ערך |
|---|---|
| `JWT_AUDIENCE` | `"authenticated"` |
| `ALLOWED_ALGORITHMS` | `frozenset({"ES256", "RS256"})` |
| `CLOCK_SKEW_SECONDS` | `30` |
| `JWKS_CACHE_SECONDS` | `600`, כמו ה-cache של Supabase |
| `JWKS_TIMEOUT_SECONDS` | `5.0` |

הסדר של `verify`:
1. `keys.get_signing_key_from_jwt(token)`. `jwt.PyJWKClientConnectionError` הופך ל-`auth_unavailable`, וכל `jwt.PyJWTError` אחר ל-`unauthenticated`.
2. אלגוריתם המפתח חייב להיות ב-`ALLOWED_ALGORITHMS`.
3. `jwt.decode` עם `algorithms=[key.algorithm_name]`, ‏`audience=JWT_AUDIENCE`, ‏`issuer=self.issuer`, ‏`leeway=CLOCK_SKEW_SECONDS`, ו-`options={"require": ["exp", "iat", "sub", "aud", "iss"]}`.
4. `role` חייב להיות `"authenticated"`, ו-`is_anonymous` לא יכול להיות `True`. במוצר אין משתמשים אנונימיים (סעיף 11.4).
5. `sub` חייב להיות UUID. `email` שאינו מחרוזת, או מחרוזת ריקה, הופך ל-`None`.

`get_current_user` היא `def` רגילה ולא `async def`. `PyJWKClient` מוריד את ה-JWKS עם urllib, שחוסם, ו-FastAPI מריץ תלות סינכרונית ב-thread pool, כך שה-event loop לא נעצר. בלוג נרשם רק שם החריגה, אף פעם לא הטוקן.

- [ ] **Step 1: התלות**
  Run: `cd api && uv add "pyjwt[crypto]"`
  Expected: `pyjwt` נוסף ל-`pyproject.toml` ול-`uv.lock`.

- [ ] **Step 2: הבדיקות שנכשלות**
  ```python
  # tests/test_me.py
  def test_me_returns_the_user_from_a_valid_token(client: TestClient, make_token: TokenFactory) -> None:
      response = client.get("/me", headers=bearer(make_token()))
      assert response.status_code == 200
      assert response.json() == {"id": str(USER_ID), "email": "student@example.com"}

  @pytest.mark.parametrize("headers", [{}, {"Authorization": "Token abc"}, {"Authorization": "Bearer"}])
  def test_me_without_a_bearer_token_is_401(client: TestClient, headers: dict[str, str]) -> None:
      response = client.get("/me", headers=headers)
      assert response.status_code == 401
      assert response.headers["www-authenticate"] == "Bearer"
      assert response.headers["content-type"] == "application/problem+json"
      assert response.json()["code"] == "unauthenticated"

  @pytest.mark.parametrize("overrides", [{"drop": ("email",)}, {"email": ""}])
  def test_me_email_is_null_without_an_email(
      client: TestClient, make_token: TokenFactory, overrides: dict[str, Any]
  ) -> None:
      assert client.get("/me", headers=bearer(make_token(**overrides))).json()["email"] is None
  ```
  ב-`tests/test_auth.py`, הבדיקה `test_rejected_tokens_get_401` עוברת על המקרים שבטבלה. בכל מקרה היא מצפה ל-401 ול-`"code": "unauthenticated"`. `now` הוא `int(time.time())`.

  | מקרה | הטוקן |
  |---|---|
  | `expired` | `make_token(iat=now - 4000, exp=now - 60)` |
  | `wrong-audience` | `make_token(aud="anon")` |
  | `wrong-issuer` | `make_token(iss="https://other-ref.supabase.co/auth/v1")` |
  | `anon-role` | `make_token(role="anon")` |
  | `service-role` | `make_token(role="service_role")` |
  | `anonymous-user` | `make_token(is_anonymous=True)` |
  | `sub-not-uuid` | `make_token(sub="not-a-uuid")` |
  | `no-sub` | `make_token(drop=("sub",))` |
  | `no-exp` | `make_token(drop=("exp",))` |
  | `unknown-kid` | `make_token(key=other_key, kid="other-key")` |
  | `wrong-key-same-kid` | `make_token(key=other_key)` |
  | `hs256` | `make_token(key="x" * 32, algorithm="HS256")` |
  | `alg-none` | `make_token(algorithm="none")` |
  | `garbage` | `"not-a-jwt"` |

  ```python
  # tests/test_auth.py, continued
  def test_clock_skew_within_30_seconds_is_accepted(client: TestClient, make_token: TokenFactory) -> None:
      now = int(time.time())
      assert client.get("/me", headers=bearer(make_token(iat=now + 5))).status_code == 200
      assert client.get("/me", headers=bearer(make_token(iat=now - 3600, exp=now - 5))).status_code == 200

  def test_audience_may_be_a_list(client: TestClient, make_token: TokenFactory) -> None:
      assert client.get("/me", headers=bearer(make_token(aud=["authenticated"]))).status_code == 200

  def test_unreachable_jwks_is_503(make_token: TokenFactory) -> None:
      settings = Settings(supabase_url="http://127.0.0.1:9", _env_file=None)  # nothing listens there
      response = TestClient(create_app(settings)).get("/me", headers=bearer(make_token()))
      assert response.status_code == 503
      assert response.json()["code"] == "auth_unavailable"

  def test_verifier_keeps_the_claims_read_only(
      settings: Settings, jwks: dict[str, Any], make_token: TokenFactory
  ) -> None:
      user = TokenVerifier(StaticKeys(jwks), issuer=settings.jwt_issuer).verify(make_token(session_id="s-1"))
      assert user.id == USER_ID
      assert user.claims["session_id"] == "s-1"
      with pytest.raises(TypeError):
          user.claims["role"] = "service_role"  # type: ignore[index]
  ```

- [ ] **Step 3: הבדיקות נכשלות**
  Run: `cd api && uv run pytest tests/test_auth.py tests/test_me.py -q`
  Expected: שגיאות import של `app.auth` ו-`tests.tokens`.

- [ ] **Step 4: `app/auth.py`, `app/routers/me.py` ו-`tests/tokens.py`, וחיבור ב-`create_app()`**
  `bearer_scheme = HTTPBearer(auto_error=False)`. כשאין header, או שה-scheme אינו Bearer, `get_current_user` מעלה `unauthenticated`. `TokenVerifier` נשמר ב-`app.state.token_verifier`. ב-`me.py` מוגדר `MeResponse(BaseModel)` עם `id: UUID` ו-`email: str | None`.

- [ ] **Step 5: כל הבדיקות והכלים עוברים**
  Run: `cd api && uv run pytest -q && uv run ruff check . && uv run ruff format --check . && uv run mypy`
  Expected: `37 passed`: 13 מ-Tasks 2–3, 6 ב-`test_me.py` ו-18 ב-`test_auth.py`. שלושת הכלים נקיים. אם מספר הבדיקות שונה, מוודאים שכל 14 המקרים שבטבלה רצים.

- [ ] **Step 6: קומיט, בשיחה הראשית ובאישורך מראש**
  ```bash
  git add api/app/auth.py api/app/routers/me.py api/app/main.py api/pyproject.toml api/uv.lock \
    api/tests/conftest.py api/tests/tokens.py api/tests/test_auth.py api/tests/test_me.py
  git diff --cached --name-only | wc -l
  git commit -m "feat(api): verify Supabase JWTs against JWKS and add GET /me" \
    -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```
  Expected: `9`.

### Task 5: פרויקט Supabase לפיתוח ובדיקה עם JWT אמיתי

**צורך:** השרת מ-Task 4.
**מייצר:** פרויקט `studyflow-dev` ב-Supabase, ו-`api/.env` מקומי ומוחרג. אין קומיט.

- [ ] **Step 1 (בצד שלך): הפרויקט**
  ב-`https://supabase.com/dashboard`: New project, בשם `studyflow-dev`, במסלול Free ובאזור Central EU (Frankfurt). את סיסמת ה-DB שומרים במנהל סיסמאות, כי S05 יצטרך אותה.

- [ ] **Step 2 (בצד שלך): מפתח החתימה**
  ב-Project Settings → JWT Keys, המפתח הנוכחי (Current key) צריך להיות ECC (P-256). אם כתוב שם Legacy JWT secret, לוחצים Migrate JWT secret ואחר כך Rotate keys.

- [ ] **Step 3 (בצד שלך): משתמש בדיקה**
  Authentication → Users → Add user → Create new user, עם כתובת מייל שלך (אפשר עם `+dev`), סיסמה ו-Auto Confirm User מסומן. המשתמש והסיסמה קיימים רק בפרויקט הפיתוח, ומשמשים רק לבדיקות ידניות.

- [ ] **Step 4 (בצד שלך): לשלוח לי שני ערכים**
  את ה-Project URL ואת ה-publishable key (`sb_publishable_…`). שניהם נמצאים בחלון Connect, ושניהם ציבוריים מעצם הגדרתם. את הסיסמה לא שולחים.

- [ ] **Step 5: `api/.env` וה-JWKS**
  ```bash
  printf 'SUPABASE_URL=%s\n' '<Project URL>' > api/.env && chmod 600 api/.env
  git check-ignore api/.env && git status --short
  curl -sS "<Project URL>/auth/v1/.well-known/jwks.json" | python3 -c \
    'import json,sys; ks=json.load(sys.stdin)["keys"]; print(len(ks), sorted({k["alg"] for k in ks}), all("kid" in k for k in ks))'
  ```
  Expected: `api/.env`, ואין שינויים ב-git. אחר כך מספר המפתחות, `['ES256']` (או `RS256`) ו-`True`.

- [ ] **Step 6: השרת מול הפרויקט**
  מריצים ברקע `cd api && uv run uvicorn app.main:create_app --factory --port 8000`.
  Run: `curl -s http://127.0.0.1:8000/health; echo; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/me`
  Expected: `{"status":"ok"}` ו-`401`.

- [ ] **Step 7: סקריפט בדיקה, שרץ אצלך**
  אני כותב `check-me.zsh` בתיקיית ה-scratchpad, לא בריפו. הסקריפט:
  - קורא את `SUPABASE_URL` מ-`api/.env`, וה-publishable key כתוב בתוכו.
  - שואל מייל וסיסמה. הסיסמה לא מוצגת על המסך.
  - מבקש טוקן מ-`<url>/auth/v1/token?grant_type=password`, ולא מדפיס אותו.
  - מדפיס את `alg` ו-`kid` מה-header, ואת `iss`, `aud` ו-`role` מה-payload.
  - קורא ל-`GET /me` עם הטוקן, ומדפיס את ה-status ואת הגוף.
  - קורא שוב עם טוקן שתו אחד באמצע החתימה שלו שונה, ומדפיס את ה-status.

  Run (אצלך): `zsh <הנתיב שאשלח>/check-me.zsh`
  Expected: `alg=ES256`, ‏`iss` שהוא `<Project URL>/auth/v1`, ‏`role=authenticated`. אחר כך `200` עם ה-UUID של המשתמש, כמו ב-Authentication → Users, ועם המייל שלו. בסוף `tampered: 401`. זה החלק הראשון של "מוכן": בקשה עם JWT תקין מחזירה את המשתמש.

- [ ] **Step 8: עצירת השרת**
  אם הבדיקה נכשלה, בלוג של השרת רשום שם החריגה (למשל `InvalidIssuerError`). מתקנים ב-Task 4 בקומיט תיקון, באישור נפרד.

### Task 6: CI, סריקת סודות ו-Dependabot

**Files:**
- Create: `.github/workflows/api.yml`, `.github/workflows/secret-scan.yml`, `.github/dependabot.yml`, ו-`.gitleaksignore` רק אם צריך
- Modify: `README.md`, ובסעיף 7.11 במסמך התכנון משפט אחד (וגם בלשונית שלו ב-artifact)

**צורך:** `api/` מ-Tasks 2–4 עם `uv.lock` מעודכן.

- [ ] **Step 1 (בשיחה הראשית): סריקה מקומית של כל ההיסטוריה**
  ```bash
  gitleaks git --redact --no-banner --report-format json --report-path "$SCRATCH/gitleaks.json" .; echo "exit $?"
  python3 -c 'import json,sys; [print(f["RuleID"], f["File"], f["Commit"][:7], f["Fingerprint"]) for f in json.load(open(sys.argv[1]))]' "$SCRATCH/gitleaks.json"
  ```
  `$SCRATCH` היא תיקיית ה-scratchpad. Expected: `exit 0`, או `exit 1` עם רשימת ממצאים. הערכים עצמם מוסתרים בגלל `--redact`.

- [ ] **Step 2 (בשיחה הראשית): מיון הממצאים**
  - ממצא ב-`scripts/test_old_key.py` הוא מפתח ה-VAPID הישן. S01 בדק שהוא לא המפתח הנוכחי וגם לא זה שהוחלף, ו-S02 מחק את הקובץ. ה-fingerprint שלו נכנס ל-`.gitleaksignore`, עם הערה שמסבירה את זה.
  - כל ממצא אחר: עוצרים ומציגים לך את הרשימה (קובץ, קומיט וסוג). על כל ממצא מחליטים יחד אם מבטלים את הסוד או מתעלמים ממנו. שום fingerprint לא נכנס ל-`.gitleaksignore` בלי הערה עם ההחלטה.
  - בראש הקובץ: `# Findings in old history that were checked and are not live secrets.` ו-`# Each line is a gitleaks fingerprint: <commit>:<file>:<rule>:<line>.`

  Run: `gitleaks git --redact --no-banner . ; echo "exit $?"`
  Expected: `no leaks found` ו-`exit 0`.

- [ ] **Step 3 (בשיחה הראשית): הסריקה תופסת סוד חדש**
  בריפו זמני בתוך `$SCRATCH` יוצרים קומיט עם קובץ שיש בו `ghp_` ואחריו 36 תווים אקראיים (אותיות וספרות, עם `secrets.choice`), ומריצים עליו `gitleaks git --redact --no-banner .`.
  Expected: ממצא `github-pat` ו-exit code 1. כך יודעים שה-exit code של הסריקה ב-CI באמת נכשל על סוד.

- [ ] **Step 4: `.github/workflows/api.yml`**
  ```yaml
  name: api

  on:
    push:
      paths:
        - "api/**"
        - ".github/workflows/api.yml"
    workflow_dispatch:

  permissions:
    contents: read

  concurrency:
    group: api-${{ github.ref }}
    cancel-in-progress: true

  jobs:
    checks:
      runs-on: ubuntu-24.04
      timeout-minutes: 10
      defaults:
        run:
          working-directory: api
      steps:
        - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
          with:
            persist-credentials: false
        - uses: astral-sh/setup-uv@c771a70e6277c0a99b617c7a806ffedaca235ff9 # v9.0.0
          with:
            version-file: api/pyproject.toml
            enable-cache: true
            cache-dependency-glob: api/uv.lock
        - run: uv sync --locked
        - run: uv run ruff check .
        - run: uv run ruff format --check .
        - run: uv run mypy
        - run: uv run pytest
  ```

- [ ] **Step 5: `.github/workflows/secret-scan.yml`**
  ```yaml
  name: secret-scan

  on: [push, workflow_dispatch]

  permissions:
    contents: read

  jobs:
    gitleaks:
      runs-on: ubuntu-24.04
      timeout-minutes: 10
      env:
        GITLEAKS_VERSION: 8.30.1
        GITLEAKS_SHA256: 551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
      steps:
        - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
          with:
            fetch-depth: 0
            persist-credentials: false
        - name: Install gitleaks
          working-directory: ${{ runner.temp }}
          run: |
            curl -sSfL -o gitleaks.tar.gz \
              "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
            echo "${GITLEAKS_SHA256}  gitleaks.tar.gz" | sha256sum --check --strict
            tar -xzf gitleaks.tar.gz gitleaks
        - name: Scan all history on all branches
          run: |
            "$RUNNER_TEMP/gitleaks" git --redact --no-banner --verbose .
  ```
  ה-SHA256 הוא של `gitleaks_8.30.1_linux_x64.tar.gz`, מקובץ ה-checksums של ה-release.

- [ ] **Step 6: `.github/dependabot.yml`**
  ```yaml
  version: 2
  updates:
    - package-ecosystem: uv
      directory: /api
      schedule:
        interval: weekly
      cooldown:
        default-days: 7
      groups:
        api:
          patterns: ["*"]

    - package-ecosystem: github-actions
      directory: /
      schedule:
        interval: weekly
      cooldown:
        default-days: 7
      groups:
        actions:
          patterns: ["*"]

    # legacy/ is reference only and is deleted at the end of phase 4. Its alerts
    # still show in the Security tab; this entry only stops update pull requests.
    - package-ecosystem: pip
      directories:
        - /legacy/backend
        - /legacy/backend/eval
      schedule:
        interval: monthly
      ignore:
        - dependency-name: "*"
  ```
  ב-S04 נוסיף כאן רשומה של `npm` ל-`/web`.

- [ ] **Step 7: הקבצים תקינים, וה-CI עובר מקומית מאפס**
  ```bash
  cd api && uv run --with pyyaml python -c 'import sys, yaml; [yaml.safe_load(open(p)) for p in sys.argv[1:]]; print("yaml ok")' \
    ../.github/workflows/api.yml ../.github/workflows/secret-scan.yml ../.github/dependabot.yml
  rm -rf .venv && uv sync --locked && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest -q
  ```
  Expected: `yaml ok`, ואחריו אותן תוצאות כמו ב-Task 4, Step 5.

- [ ] **Step 8: README**
  ברשימה שב-`README.md` מוסיפים את הבולט `` - `.github/`: CI ל-api, סריקת סודות ו-Dependabot. ``.

- [ ] **Step 9 (בשיחה הראשית): סעיף 7.11 במסמך התכנון**
  את הבולט הראשון בסעיף מחליפים ב: "ריפו פרטי, בלי סודות בקוד, ו-Dependabot פעיל. כל push נסרק עם gitleaks על כל ההיסטוריה, כי בריפו פרטי אין סריקת סודות חינמית של GitHub." את אותו שינוי עושים בלשונית "מסמך תכנון v2" שב-artifact, עם כלי ה-Docs.
  Expected: `git diff --stat` מראה שורה אחת ששונתה במסמך, ובלשונית מופיע אותו משפט.

- [ ] **Step 10: שני קומיטים, בשיחה הראשית ובאישורך מראש**
  ```bash
  git add .github/workflows/api.yml .github/workflows/secret-scan.yml .github/dependabot.yml README.md
  [ -f .gitleaksignore ] && git add .gitleaksignore
  git diff --cached --name-only
  git commit -m "ci: run API checks and a gitleaks scan, and configure Dependabot" \
    -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  git add docs/superpowers/specs/2026-10-19-studyflow-v2-design.md && git diff --cached --name-only
  git commit -m "docs(spec): add secret scanning to section 7.11" \
    -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```
  Expected: בקומיט הראשון ארבעה או חמישה קבצים, ובשני רק מסמך התכנון.

### Task 7: הגדרות GitHub, push של הענף ו-CI ירוק

**צורך:** הקומיטים של Task 6.

את Steps 1–4 עושים בצד שלך, ב-`https://github.com/Eyal-Atar/study/settings`. צריך את כולם לפני ה-push.

- [ ] **Step 1 (בצד שלך): להדליק את Actions**
  Actions → General → Actions permissions → "Allow Eyal-Atar, and select non-Eyal-Atar, actions and reusable workflows". לסמן "Allow actions created by GitHub", ולכתוב בשדה של ה-actions המותרים `astral-sh/setup-uv@*`. Save. את "Require actions to be pinned to a full-length commit SHA" לא מסמנים: לא מצאתי אישור שזה לא חוסם את Dependabot, וה-workflows שלנו מקובעים ל-SHA בכל מקרה.
  באותו עמוד, ב-Workflow permissions: לבחור "Read repository contents and packages permissions", ולהשאיר את "Allow GitHub Actions to create and approve pull requests" לא מסומן. Save.

- [ ] **Step 2 (בצד שלך): Pages**
  Pages: אם עדיין מוגדר שם מקור, לשנות אותו ל-None ולשמור. אם בעמוד יש רק הצעה לשדרג את המסלול, אין שם מה למחוק: האתר לא יכול להתפרסם מריפו פרטי במסלול החינמי.

- [ ] **Step 3 (בצד שלך): ה-environment של Pages**
  Environments → `github-pages` → Delete environment, אם הוא קיים.

- [ ] **Step 4 (בצד שלך): Dependabot**
  Advanced Security (או Code security): להפעיל את Dependency graph, את Dependabot alerts ואת Dependabot security updates. אחר כך לכתוב לי שסיימת, ומה מצאת ב-Steps 2 ו-3.

- [ ] **Step 5: push של הענף, באישור נפרד**
  Run: `git push -u origin s03-api-skeleton`
  Expected: `* [new branch] s03-api-skeleton -> s03-api-skeleton`.

- [ ] **Step 6 (בצד שלך): CI ירוק**
  בלשונית Actions אמורות להופיע שתי ריצות על `s03-api-skeleton`, ‏`api` ו-`secret-scan`, ושתיהן ירוקות. אם `api` לא התחילה, מריצים אותה ידנית עם Run workflow על הענף. אם ריצה אדומה, להעתיק לי את הלוג של ה-step שנכשל.
  Expected: שתי ריצות ירוקות. זה החלק השני של "מוכן", על הענף, ו-Task 8 בודק אותו שוב על `main`.

### Task 8: סקירה סופית וסגירה

**צורך:** Tasks 5 ו-7.

- [ ] **Step 1: סקירה סופית של כל הענף**
  subagent סוקר את `main..s03-api-skeleton` מול התוכנית ומול סעיפים 7.7, 7.11 ו-7.12. אם צריך תיקון, הוא נכנס בקומיט נפרד, באישור נפרד.

- [ ] **Step 2: אימות מקומי**
  ```bash
  (cd api && uv sync --locked && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest -q)
  git status --short
  git ls-files -z | tr '\0' '\n' | cut -d/ -f1 | sort -u
  ```
  Expected: הכל עובר, ואין שינויים שלא נשמרו. בשורש יש קבצים מעוקבים רק ב-`.github`, `.gitignore`, `CLAUDE.md`, `README.md`, `api`, `docs` ו-`legacy`, ועוד `.gitleaksignore` אם נוצר.

- [ ] **Step 3: מיזוג ל-`main` ו-push, באישור נפרד**
  ```bash
  git switch main && git merge --ff-only s03-api-skeleton && git push origin main
  ```
  Expected: `Fast-forward`, ו-push שמעדכן את `main`. עד שהמיזוג וה-push מאושרים, הסטטוס של S03 נשאר "בעבודה".

- [ ] **Step 4 (בצד שלך): CI על `main` ו-Dependabot**
  ב-Actions, הריצות על `main` ירוקות. ב-Insights → Dependency graph → Dependabot מופיעות שלוש רשומות: uv ב-`/api`, ‏github-actions ב-`/`, ו-pip ב-`legacy`. בשבוע הקרוב Dependabot עשוי לפתוח pull request ל-`/api` או ל-actions. התראות על הקוד הישן צפויות עד שלב 4.

- [ ] **Step 5: מחיקת הענף, באישור נפרד**
  Run: `git branch -d s03-api-skeleton && git push origin --delete s03-api-skeleton; git branch -a --list '*s03*'`
  Expected: אין פלט בפקודה האחרונה.

- [ ] **Step 6: עדכון הניהול**
  ב-artifact, הסטטוס של S03 עובר ל"הושלם". ב-memory מעדכנים את `s03-github-followups`, את `v2-followups-from-s02-review` ואת `studyflow-commercialization-goal`. בנוסף רושמים את הפריטים להמשך: CORS, `/web` ב-Dependabot ו-`web/.gitignore` ל-S04; `supabase/`, Postgres מקומי ו-`CurrentUser.claims` ל-S05; והפרויקט `studyflow-dev` עם משתמש הבדיקה.
  Expected: בשורה של S03 כתוב "הושלם".

## קומיטים מקומיים לאישור מראש

| # | Task | הודעה | קבצים |
|---|---|---|---|
| 1 | 1 | `chore(gitignore): anchor legacy-only rules and ignore tool artifacts` | `.gitignore` |
| 2 | 1 | `docs: add S03 API skeleton plan` | התוכנית הזו |
| 3 | 2 | `feat(api): add the uv project with settings and a health check` | 13 קבצים ב-`api/`, `README.md` ו-`CLAUDE.md` |
| 4 | 3 | `feat(api): return errors as problem+json with Hebrew messages` | `api/app/errors.py`, `api/app/main.py`, `api/tests/test_errors.py` |
| 5 | 4 | `feat(api): verify Supabase JWTs against JWKS and add GET /me` | 9 הקבצים של Task 4 |
| 6 | 6 | `ci: run API checks and a gitleaks scan, and configure Dependabot` | `.github/` (3 קבצים), `README.md`, ו-`.gitleaksignore` אם יהיה |
| 7 | 6 | `docs(spec): add secret scanning to section 7.11` | מסמך התכנון |

כל הקומיטים בענף `s03-api-skeleton`, וכולם נגמרים בשורה `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. לא כלולים כאן, ומקבלים אישור נפרד: ה-push של הענף (Task 7), קומיט תיקון מהסקירה הסופית אם יהיה, המיזוג וה-push של `main`, ומחיקת הענף (Task 8).
