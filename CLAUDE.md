# StudyFlow v2

## מסמכים

המפה המלאה: `docs/README.md`.

- מסמך התכנון: `docs/spec/2026-10-19-studyflow-v2-design.md`
- עיצוב: `docs/design/design-language.md`, הקול: `docs/design/archi-voice.md`, ההדמיה המחייבת: `docs/design/prototype/all-screens.html`
- תוכניות של scopes פעילים: `docs/plans/` (גם כש-skill מציע נתיב אחר). scope שהושלם: התוכנית שלו עוברת ל-`docs/archive/plans/`.
- `docs/archive/`: היסטוריה. לא קוראים משם אלא אם התבקש.
- מפת הדרכים והסטטוסים: [artifact](https://claude.ai/code/artifact/29a3c52e-d399-425e-90b6-7c05e9146bfa). הלשונית "מצב עכשיו" קצרה, ורק בה מעדכנים סטטוס.

## צוות ותהליך

אייל מדבר רק עם **המנהל**: השיחה הראשית שנפתחת מ-`~/studyflow`. המנהל לא כותב קוד. הוא מפעיל שלושה סוכנים שמוגדרים ב-`.claude/agents/`, ואייל רואה אותם בשיחה:

| תפקיד | סוכן | מה הוא עושה |
| --- | --- | --- |
| מתכנן | `planner` | כותב תוכנית ל-scope ב-`docs/plans/`, עם משימות `### Task N` |
| מפתח | `developer` | מממש משימה אחת: בדיקה לפני קוד, commit, דוח קצר |
| סוקר | `reviewer` | בודק כל משימה מול הדרישות ואיכות הקוד, ובסוף את כל הענף |

הסדר לכל scope: תוכנית ← לכל משימה מפתח ואז סוקר (תיקונים חוזרים למפתח) ← סקירה סופית של הענף ← המנהל מריץ את כל הבדיקות, ממזג ומעדכן את מפת הדרכים. המנהל עובד לפי ה-skill ‏`superpowers:subagent-driven-development`.

- כל scope בענף וב-worktree משלו: `~/studyflow-manager/worktrees/sNN`. scopes שלא תלויים זה בזה רצים במקביל.
- כל קריאה לסוכן מקבלת `model` לפי הקושי: `haiku` לשינוי מכני, `sonnet` למימוש רגיל, `opus` ללוגיקה עדינה ולסקירה, `fable` לעיצוב, לניסוחים של Archi ולסקירה הסופית.
- קובצי העבודה של הסוכנים (תקצירים, דוחות, חבילות סקירה) נכתבים ל-`.superpowers/`, שמחוץ ל-git, ונמחקים כשה-scope מוזג. לא יוצרים קובצי דוח או תכנון במקום אחר.

## כללי עבודה

- באג שאינו קשור למשימה הנוכחית לא מתוקן. הוא נרשם בטבלה "באגים שנרשמו" ב-artifact, באמצעות כלי ה-Docs, והעבודה במשימה נמשכת.
- הגרסה הראשונה (`legacy/`) נמחקה מהריפו ב-21.11.2026. הסיכום שלה: `docs/archive/legacy-summary.md`.
- commit, push, מיזוג ל-`main` (רק `--ff-only`) ומחיקת ענף שמוזג מאושרים מראש. מדווחים מה נעשה. git רץ בשיחה הראשית, ומוסיפים קבצים לפי שם.
- מסמכים, תוכניות, commits והודעות: בעברית, מונחים טכניים באנגלית.
- **המוצר עצמו באנגלית (מ-S39, 21.11.2026):** כל טקסט שהמשתמש רואה נכתב ב-`web/src/i18n/en.ts`, בקול של Archi בגוף ראשון (`docs/design/archi-voice.md`). אין עברית ב-`web/src` חוץ מבדיקות ומנתוני דמה של תוכן משתמש.
- תוכן המשתמש (שם מבחן, משימה, קובץ, אירוע) מוצג דרך `ui/UserText` ב-JSX, ודרך `isolate()` (`i18n/bidi.ts`) בתוך מחרוזת.
- אפס אימוג׳י. אייקון הוא רכיב מ-`web/src/ui/icons/` (גם הגליפים של lucide מיובאים רק משם).
- מסמך הביקורת `docs/design/2026-11-21-archi-ux-audit.md` גובר על מסמכי עיצוב ישנים ממנו.

## פקודות `api/`

הפקודות רצות מתוך `api/`.

| פעולה | פקודה |
| --- | --- |
| התקנת תלויות | `uv sync` |
| הרצת השרת | `uv run uvicorn app.main:create_app --factory --reload` |
| הרצת ה-worker | `uv run python -m app.jobs` (גם התזכורות, כשמפתחות VAPID ב-`api/.env`) |
| בדיקות | `uv run pytest` |
| lint | `uv run ruff check .` |
| בדיקת פורמט | `uv run ruff format --check .` |
| טיפוסים | `uv run mypy` |
| Postgres מקומי לבדיקות | `brew services start postgresql@17` (פעם אחת; הבדיקות יוצרות את `studyflow_test` לבד) |
| מיגרציות על פרויקט ה-dev | `uv run alembic upgrade head` (קורא את `MIGRATION_DATABASE_URL` מ-`api/.env`) |
| מיגרציה חדשה | `uv run alembic revision --rev-id <NNNN> -m "<name>"`, עם SQL מפורש ב-`op.execute` |
| eval ניתוח הקורס | `uv run python eval/analysis_eval.py` (הערכת עלות בלי רשת); `--run --max-usd 5` להרצה אמיתית (דורש `ANTHROPIC_API_KEY` ב-`api/.env`) |
| eval מחומר ועד לוח | `uv run python eval/generate_eval.py` (הערכת עלות בלי רשת ובלי מסד); `--run --max-usd 1.5 [--reanalyze]` להרצה אמיתית על המסד המקומי `studyflow_eval` (נמחק ונוצר מחדש בכל ריצה; דורש `ANTHROPIC_API_KEY` ב-`api/.env`) |
| eval מאגר המקרים: מתכנן וסטודנטים וירטואליים | `uv run python eval/bank_eval.py planner` (חינם, בלי רשת, כמה דקות); `--compare eval/baseline-<תאריך>.json` להשוואה מול הבסיס; `--quick` להרצה קצרה |

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
| ה-build עם service worker (בדיקת PWA ו-Push) | `npm run build && npm run preview` (פורט 5173) |

ב-`web/.npmrc` מוגדר `min-release-age=7`: גרסה צעירה מ-7 ימים לא מותקנת (הגנת supply-chain), וזה מעכב גם תיקוני אבטחה; לתיקון דחוף מוסיפים את החבילה הבודדת ל-`web/.npmrc` בשורה `min-release-age-exclude=<pkg>` (ואם היא נעולה לחבילות אחיות שיצאו איתה, גם אותן, בשורה נוספת כמו `min-release-age-exclude[]=@typescript-eslint/*`), מתקינים ומסירים את השורה אחר כך, וכותבים בקומיט למה. `devEngines` עוצר Node או npm בגרסה אחרת.
