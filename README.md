# StudyFlow

אפליקציה לתכנון לימודים לסטודנטים בישראל. הריפו בבנייה מחדש (v2).

- `api/`: ה-API של v2, ב-FastAPI עם Python 3.14 ו-uv.
- `web/`: האפליקציה של v2, ב-React עם TypeScript ו-Vite, בעברית וב-RTL.
- `.github/`: CI ל-api ול-web, סריקת סודות ו-Dependabot.
- `docs/superpowers/specs/`: מסמך התכנון של v2.
- `docs/superpowers/plans/`: תוכנית עבודה לכל scope.
- `legacy/`: הקוד הקודם, לעיון בלבד. הוא לא מתוחזק ולא רץ, ונמחק בסוף שלב 4.
- `legacy/planning/`: ארכיון התכנון של הגרסה הקודמת.

המשימות והסטטוסים מנוהלים במפת הדרכים שב-[artifact](https://claude.ai/code/artifact/29a3c52e-d399-425e-90b6-7c05e9146bfa).

## הרצת ה-API

הפקודות רצות מתוך `api/`, וצריך [uv](https://docs.astral.sh/uv/). לבדיקות צריך גם Postgres 17 מקומי (`brew install postgresql@17 && brew services start postgresql@17`).

```bash
cd api
uv sync
cp .env.example .env    # וממלאים את SUPABASE_URL ואת MIGRATION_DATABASE_URL
uv run alembic upgrade head
uv run uvicorn app.main:create_app --factory --reload
```

בדיקות: `uv run pytest` (הן יוצרות מסד `studyflow_test` ב-Postgres המקומי). lint ופורמט: `uv run ruff check .` ו-`uv run ruff format --check .`. טיפוסים: `uv run mypy`.

## הרצת ה-worker

ה-worker הוא תהליך נפרד שמריץ את העבודות שבתור (למשל קליטת חומר שהועלה). הוא רץ מתוך `api/`:

```bash
cd api
uv run python -m app.jobs
```

הוא קורא את אותן הגדרות כמו ה-API, ובנוסף שני משתנים ב-`.env`: ‏`WORKER_DATABASE_URL` (חיבור כבעלים של הסכמה) ו-`SUPABASE_SECRET_KEY` (גישה ל-Storage). שני המשתנים האלה שייכים ל-worker בלבד: ה-API לא משתמש בהם, ובסביבת production מגדירים אותם רק לתהליך של ה-worker.

## הרצת ה-web

הפקודות רצות מתוך `web/`, וצריך Node 24 עם npm 11.17 ומעלה.

```bash
cd web
npm ci
cp .env.example .env    # וממלאים
npm run dev
```

ה-API צריך לרוץ, ו-`CORS_ORIGINS` שלו צריך לכלול את `http://localhost:5173`.
