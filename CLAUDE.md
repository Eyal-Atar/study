# StudyFlow v2

## מסמכים

- מסמך התכנון: `docs/superpowers/specs/2026-10-19-studyflow-v2-design.md`
- תוכניות לכל scope: `docs/superpowers/plans/`
- מפת הדרכים והסטטוסים: [artifact](https://claude.ai/code/artifact/29a3c52e-d399-425e-90b6-7c05e9146bfa)

## כללי עבודה

- כל scope מקבל תוכנית לפני תחילת העבודה, ונעשה בענף משלו.
- באג שאינו קשור למשימה הנוכחית לא מתוקן. הוא נרשם בטבלה "באגים שנרשמו" ב-artifact, באמצעות כלי ה-Docs, והעבודה במשימה נמשכת.
- `legacy/` לעיון בלבד: לא מריצים אותו, לא עורכים אותו ולא מריצים עליו כלים.
- commit, push, מיזוג ל-`main` (רק `--ff-only`) ומחיקת ענף שמוזג מאושרים מראש. מדווחים מה נעשה. git רץ בשיחה הראשית, ומוסיפים קבצים לפי שם.
- כתיבה בעברית, מונחים טכניים באנגלית.

## פקודות `api/`

הפקודות רצות מתוך `api/`.

| פעולה | פקודה |
| --- | --- |
| התקנת תלויות | `uv sync` |
| הרצת השרת | `uv run uvicorn app.main:create_app --factory --reload` |
| הרצת ה-worker | `uv run python -m app.jobs` |
| בדיקות | `uv run pytest` |
| lint | `uv run ruff check .` |
| בדיקת פורמט | `uv run ruff format --check .` |
| טיפוסים | `uv run mypy` |
| Postgres מקומי לבדיקות | `brew services start postgresql@17` (פעם אחת; הבדיקות יוצרות את `studyflow_test` לבד) |
| מיגרציות על פרויקט ה-dev | `uv run alembic upgrade head` (קורא את `MIGRATION_DATABASE_URL` מ-`api/.env`) |
| מיגרציה חדשה | `uv run alembic revision --rev-id <NNNN> -m "<name>"`, עם SQL מפורש ב-`op.execute` |

`api/eval/materials/` מקומית בלבד ומוגנת ב-`.gitignore` (רק ה-README שלה נכנס ל-git): יש בה קבצים אמיתיים לבדיקות, ולא שמים בה קבצים שצריכים להיכנס ל-git. בדיקת העשן: `uv run python eval/pdf_smoke.py eval/materials`.

הבדיקות פונות רק ל-`TEST_DATABASE_URL` (ברירת מחדל `postgresql://localhost:5432/postgres`), ומסרבות לכתובת שאינה מקומית. הן יוצרות ב-Postgres המקומי תפקידים שחלים על כל ה-cluster: `anon`, ‏`authenticated`, ‏`service_role`, ו-`studyflow_api` עם LOGIN ובלי סיסמה. לכן ה-Postgres הזה משמש רק לפיתוח. ‏`psql` נמצא ב-`/opt/homebrew/opt/postgresql@17/bin`. כל טבלה חדשה בסכמה `app` צריכה RLS, ו-`tests/db/test_schema.py` נכשל בלעדיו.

ב-`api/pyproject.toml` מוגדר `exclude-newer = "7 days"`: תלות צעירה מ-7 ימים לא נכנסת ל-lock (הגנת supply-chain), וזה מעכב גם תיקוני אבטחה; לתיקון דחוף מוסיפים את החבילה הבודדת ל-`exclude-newer-package` ב-`[tool.uv]` (או מעבירים `--exclude-newer-package <pkg>=<date>` ל-`uv lock`) ומסירים אותה אחר כך.

## פקודות `web/`

הפקודות רצות מתוך `web/`.

| פעולה | פקודה |
| --- | --- |
| התקנת תלויות | `npm ci` |
| הרצת שרת הפיתוח | `npm run dev` (פורט 5173 בלבד) |
| בדיקות | `npm test` |
| lint | `npm run lint` |
| טיפוסים | `npm run typecheck` |
| build | `npm run build` |

ב-`web/.npmrc` מוגדר `min-release-age=7`: גרסה צעירה מ-7 ימים לא מותקנת (הגנת supply-chain), וזה מעכב גם תיקוני אבטחה; לתיקון דחוף מוסיפים את החבילה הבודדת ל-`web/.npmrc` בשורה `min-release-age-exclude=<pkg>` (ואם היא נעולה לחבילות אחיות שיצאו איתה, גם אותן, בשורה נוספת כמו `min-release-age-exclude[]=@typescript-eslint/*`), מתקינים ומסירים את השורה אחר כך, וכותבים בקומיט למה. `devEngines` עוצר Node או npm בגרסה אחרת.
