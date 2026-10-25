# StudyFlow

אפליקציה לתכנון לימודים לסטודנטים בישראל. הריפו בבנייה מחדש (v2).

- `api/`: ה-API של v2, ב-FastAPI עם Python 3.14 ו-uv.
- `.github/`: CI ל-api, סריקת סודות ו-Dependabot.
- `docs/superpowers/specs/`: מסמך התכנון של v2.
- `docs/superpowers/plans/`: תוכנית עבודה לכל scope.
- `legacy/`: הקוד הקודם, לעיון בלבד. הוא לא מתוחזק ולא רץ, ונמחק בסוף שלב 4.
- `legacy/planning/`: ארכיון התכנון של הגרסה הקודמת.

המשימות והסטטוסים מנוהלים במפת הדרכים שב-[artifact](https://claude.ai/code/artifact/29a3c52e-d399-425e-90b6-7c05e9146bfa).

## הרצת ה-API

הפקודות רצות מתוך `api/`, וצריך [uv](https://docs.astral.sh/uv/).

```bash
cd api
uv sync
cp .env.example .env    # וממלאים את SUPABASE_URL
uv run uvicorn app.main:create_app --factory --reload
```

בדיקות: `uv run pytest`. lint ופורמט: `uv run ruff check .` ו-`uv run ruff format --check .`. טיפוסים: `uv run mypy`.
