# S01 — ייצוב וביטחון: תוכנית עבודה

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**מטרה:** בסוף ה-scope הריפו פרטי ואתר ה-Pages כבוי. כל הקומיטים המקומיים נמצאים ב-GitHub, הנתונים המקומיים מגובים מחוץ לריפו, והסודות הישנים הוחלפו או בוטלו.

**גישה:** קודם מגבים את הנתונים. אחר כך אתה סוגר את הריפו ואת האתר ב-GitHub, ואני מאמת את זה מבחוץ. רק אז דוחפים, וה-push הראשון הוא של ענף חדש ולא של `main`, כדי שה-workflow של Pages לא יופעל. את `main` מעדכנים בסוף, אחרי שה-workflow כבר נמחק ממנו.

**כלים:** git, curl, sqlite3, bsdtar, ה-Python שב-`.venv` של הפרויקט (`cryptography`, `python-dotenv`), הגדרות GitHub בדפדפן והדשבורד של OpenRouter.

**מסמך תכנון:** `docs/superpowers/specs/2026-10-19-studyflow-v2-design.md`, סעיפים 9 (שלב 0), 7.10 ו-7.11. במפת הדרכים שב-[artifact](https://claude.ai/code/artifact/29a3c52e-d399-425e-90b6-7c05e9146bfa) זו משימה S01, וההגדרה שלה ל"מוכן" היא: הריפו פרטי, Pages כבוי והמפתחות הישנים בוטלו.

## מה מצאתי לפני התכנון (2026-10-19)

| נושא | מצב |
|---|---|
| הריפו | `Eyal-Atar/study` ציבורי. אין לו forks ואין לו כוכבים |
| Pages | האתר `https://eyal-atar.github.io/study/` באוויר ומגיש את כל הריפו. למשל, `/.planning/STATE.md` ו-`/backend/server/config.py` מחזירים 200. הפריסה האחרונה הייתה ב-2026-03-20 |
| קומיטים | 14 קומיטים על `main` לא נדחפו. `origin/main` נמצא ב-`1c352f7` מ-2026-03-21, ואין בו קומיטים שחסרים אצלנו |
| סודות | `OPENROUTER_API_KEY`, `SESSION_SECRET_KEY` ומפתחות ה-VAPID נמצאים רק ב-`.env` שבשורש, ש-`.gitignore` מחריג. בדקתי את כל היסטוריית git, והערכים הנוכחיים לא הופיעו בה אף פעם |
| מפתחות VAPID ישנים | `scripts/test_old_key.py`, שגלוי לכולם, מכיל מפתח פרטי ישן שאינו המפתח הנוכחי. `backend/vapid_private.pem` הוא מפתח שלישי, מוחרג מ-git, ורק שני סקריפטי בדיקה ב-`scripts/` משתמשים בו |
| OpenRouter | המפתח שב-`.env` כבר פג, וה-API מחזיר 401 עם `API key expired` |
| איפה הקוד רץ | רק מקומית, דרך `start.sh` (ועם `--ngrok` לבדיקות ב-iOS). אין פריסה בענן, ולכן אין דשבורד נוסף שמחזיק את הסודות |
| נתונים | `backend/study_scheduler.db` (280K, 10 טבלאות) ו-`backend/uploads/` (69M, 45 קבצים). שניהם מוחרגים מ-git, ואין להם עותק נוסף |
| כלים | `gh` לא מותקן. את ההגדרות ב-GitHub משנים בדפדפן, ואני מאמת אותן דרך כתובות ציבוריות |

**המשמעות:** מה שחשוף באמת הוא אתר ה-Pages והריפו הציבורי. החלפת הסודות היא אמצעי זהירות, ולא תגובה לדליפה.

## אילוצים גלובליים

- לא דוחפים שום דבר לפני ש-Task 3 עבר: Pages כבוי, הריפו פרטי, Actions כבוי, והאימות מבחוץ עבר.
- כל commit וכל push מחכים לאישור שלך באותו רגע. העבודה נעשית בענף `s01-stabilization`.
- לא דוחפים את `main` כל עוד `.github/workflows/static.yml` נמצא בו.
- ערכים של סודות לא מודפסים לטרמינל. הפקודות מדפיסות רק שמות של משתנים, טביעות SHA-256 מקוצרות ו-True/False.
- לקומיט מוסיפים רק קבצים לפי שם (`git add <path>`), אף פעם לא `git add -A`. השינויים ב-`.planning/` נשארים כמו שהם, ומטופלים ב-S02.
- הגיבוי נשמר ב-`~/StudyFlow-backups/2026-10-19/`, מחוץ לריפו ומחוץ ל-Desktop.
- כל הפקודות רצות משורש הריפו.

## על מה לשים לב בבדיקה

1. **מטמון של Pages:** אחרי הכיבוי, האתר יכול להמשיך להחזיר 200 עוד כמה דקות. ב-Task 3 בודקים גם את השורש וגם קובץ עמוק, וחוזרים על הבדיקה עד 10 דקות.
2. **push שמפעיל את ה-workflow:** push ל-`main` כש-`static.yml` עדיין בו יפרסם את האתר מחדש אם Actions דלוק. לכן ה-push הראשון הוא של הענף בלבד (Task 4).
3. **קומיט שתופס יותר מדי:** קבצי `.planning/` או קובץ סודות עלולים להיכנס לקומיט. לפני כל קומיט מריצים `git diff --cached --name-only` ומשווים לרשימה הצפויה.
4. **`.env` שבור אחרי ההחלפה:** משתנה אחר עלול להימחק, או ששורה תישבר. ב-Task 6 משווים את רשימת השמות לפני ואחרי, וקוראים את הקובץ עם `python-dotenv`, כמו שהאפליקציה קוראת אותו.
5. **גיבוי חלקי:** את ה-DB בודקים עם `PRAGMA integrity_check` ועם ספירת שורות בכל טבלה. ב-uploads סופרים קבצים, ולשני הקבצים בודקים SHA-256.

## מי עושה מה

| Task | מה | מי | תלוי ב- |
|---|---|---|---|
| 1 | פתיחה: סטטוס "בעבודה", ענף, וקומיט של המסמכים | אני; הקומיט באישורך | — |
| 2 | גיבוי ה-DB וה-uploads | אני; העתקה למקום חיצוני אצלך, לא חובה | — |
| 3 | כיבוי Pages, הפיכת הריפו לפרטי וכיבוי Actions, ואימות מבחוץ | אתה, ואני מאמת | — |
| 4 | מחיקת `static.yml`, ו-push של הענף עם 14 הקומיטים | אני, באישורך | 3 |
| 5 | ניקוי המפתחות ב-OpenRouter | אתה | — |
| 6 | החלפת הסודות ב-`.env` | אני | — |
| 7 | סגירה: מיזוג ל-`main`, push וסטטוס "הושלם" | אני; המיזוג וה-push באישורך | 4, 6 |

את Task 3 ואת Task 5 אפשר לעשות ברצף, בערך ב-10 דקות.

---

### Task 1: פתיחת ה-scope

**Files:**
- Commit: `docs/superpowers/specs/2026-10-19-studyflow-v2-design.md`, `docs/superpowers/plans/2026-10-19-s01-stabilization.md`

**מייצר:** ענף מקומי `s01-stabilization` עם קומיט אחד של המסמכים.

- [ ] **Step 1: הסטטוס של S01 ל"בעבודה"**
  בטבלת "מפת הדרכים" שב-artifact, משנים את הסטטוס של S01 ל"בעבודה" עם כלי ה-Docs.
  Expected: בקריאה חוזרת, בשורה של S01 כתוב "בעבודה".

- [ ] **Step 2: פתיחת הענף**
  Run: `git switch -c s01-stabilization`
  Expected: `Switched to a new branch 's01-stabilization'`. ב-`git status -sb` עדיין רואים את השינויים ב-`.planning/` ואת `docs/` כשינויים שלא נשמרו.

- [ ] **Step 3: הכנת הקומיט**
  Run: `git add docs/superpowers/specs/2026-10-19-studyflow-v2-design.md docs/superpowers/plans/2026-10-19-s01-stabilization.md && git diff --cached --name-only`
  Expected: בדיוק שני הקבצים האלה.

- [ ] **Step 4: קומיט, אחרי שאישרת**
  ```bash
  git commit -m "docs: add approved v2 design spec and S01 plan" \
    -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```
  Expected: `git log --oneline -1` מראה את הקומיט על `s01-stabilization`.

### Task 2: גיבוי הנתונים המקומיים

**Files:** הריפו לא משתנה. נוצרים `study_scheduler.db`, `uploads.tar.gz` ו-`SHA256SUMS` בתוך `~/StudyFlow-backups/2026-10-19/`.

- [ ] **Step 1: תיקיית הגיבוי**
  Run: `mkdir -p ~/StudyFlow-backups/2026-10-19 && ls -A ~/StudyFlow-backups/2026-10-19`
  Expected: התיקייה קיימת וריקה.

- [ ] **Step 2: עותק עקבי של ה-DB**
  Run: `sqlite3 backend/study_scheduler.db ".backup '$HOME/StudyFlow-backups/2026-10-19/study_scheduler.db'"`
  Expected: אין פלט, והקובץ החדש שוקל בערך 280K. בניגוד ל-`cp`, הפקודה `.backup` מעתיקה נכון גם כשהשרת פתוח.

- [ ] **Step 3: בדיקת ה-DB**
  ```bash
  B=~/StudyFlow-backups/2026-10-19/study_scheduler.db
  sqlite3 "$B" "PRAGMA integrity_check;"
  for t in $(sqlite3 backend/study_scheduler.db "SELECT name FROM sqlite_master WHERE type='table'"); do
    a=$(sqlite3 backend/study_scheduler.db "SELECT count(*) FROM \"$t\""); b=$(sqlite3 "$B" "SELECT count(*) FROM \"$t\"")
    [ "$a" = "$b" ] || echo "MISMATCH $t: $a vs $b"
  done; echo "tables checked"
  ```
  Expected: `ok`, ואחריו רק `tables checked`.

- [ ] **Step 4: ארכיון של ה-uploads**
  ```bash
  COPYFILE_DISABLE=1 tar -czf ~/StudyFlow-backups/2026-10-19/uploads.tar.gz -C backend uploads
  tar -tzf ~/StudyFlow-backups/2026-10-19/uploads.tar.gz | grep -vc '/$'
  ```
  Expected: `45`, כמו הפלט של `find backend/uploads -type f | wc -l`. בלי `COPYFILE_DISABLE=1`, ה-tar של macOS מוסיף לארכיון קבצי `._*`.

- [ ] **Step 5: טביעות SHA-256**
  Run: `(cd ~/StudyFlow-backups/2026-10-19 && shasum -a 256 study_scheduler.db uploads.tar.gz > SHA256SUMS && shasum -a 256 -c SHA256SUMS)`
  Expected: `study_scheduler.db: OK` ו-`uploads.tar.gz: OK`. הסוגריים מריצים את ה-`cd` ב-subshell, כך שהתיקייה הנוכחית נשארת שורש הריפו.

- [ ] **Step 6 (אתה, לא חובה): עותק מחוץ למחשב**
  להעתיק את `~/StudyFlow-backups/2026-10-19/` לדיסק חיצוני או ל-Google Drive. בלי העתק כזה, הגיבוי מגן מטעויות בריפו אבל לא מאובדן המחשב.

### Task 3: סגירת הריפו והאתר

**מייצר:** מצב שבו בטוח לדחוף.

שלושת הצעדים הראשונים הם שלך, ב-`https://github.com/Eyal-Atar/study/settings` ולפי הסדר הזה. צריך את שלושתם. כיבוי האתר לבד לא מונע מהריצה הבאה של ה-workflow לפרסם אותו מחדש. ובמסלול בתשלום של GitHub, גם ריפו פרטי יכול לפרסם אתר Pages ציבורי.

- [ ] **Step 1 (אתה): כיבוי Pages**
  Settings → Pages → התפריט "⋯" ליד "Your site is live at" → **Unpublish site**.

- [ ] **Step 2 (אתה): הפיכת הריפו לפרטי**
  Settings → General → Danger Zone → **Change visibility** → Private → **I have read and understand these effects** → **Make this repository private**. לריפו אין forks, ולכן לא יישאר ממנו עותק ציבורי ב-GitHub.

- [ ] **Step 3 (אתה): כיבוי Actions**
  Settings → Actions → General → Actions permissions → האפשרות שמכבה את Actions → **Save**. נדליק אותו שוב ב-S03, כשנוסיף CI.
  כשתסיים את שלושת הצעדים, כתוב לי שסיימת ושה-Actions כבוי. מבחוץ אין לי דרך לבדוק את Actions בריפו פרטי.

- [ ] **Step 4: הריפו לא גלוי מבחוץ**
  Run: `curl -s -o /dev/null -w '%{http_code}\n' https://api.github.com/repos/Eyal-Atar/study`
  Expected: `404`.

- [ ] **Step 5: האתר כבוי**
  ```bash
  for p in "" ".planning/STATE.md"; do
    printf '/%s -> %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "https://eyal-atar.github.io/study/$p")"
  done
  ```
  Expected: שני הנתיבים מחזירים `404`. אם אחד מהם עדיין מחזיר 200, בודקים שוב כל כמה דקות, עד 10 דקות בסך הכול. אם גם אחרי זה מתקבל 200, עוצרים.

- [ ] **Step 6: עדיין יש לנו גישה לריפו**
  Run: `git ls-remote origin refs/heads/main`
  Expected: `1c352f79b6441886f1bbb344db2a81be683d9065	refs/heads/main`. אם git מבקש סיסמה או נכשל, עוצרים ומעדכנים את פרטי הכניסה ל-GitHub ב-Keychain.

אם אחת הבדיקות נכשלת, לא ממשיכים ל-Task 4.

### Task 4: מחיקת ה-workflow ו-push של הענף

**צורך:** ש-Task 3 עבר, ואת הענף מ-Task 1.
**מייצר:** `origin/s01-stabilization` עם 14 הקומיטים ועם הקומיטים של S01. `origin/main` נשאר ב-`1c352f7`.

- [ ] **Step 1: מחיקת ה-workflow**
  Run: `git rm .github/workflows/static.yml && ls -A .github 2>&1`
  Expected: `rm '.github/workflows/static.yml'`, ואחריו `No such file or directory`. זה היה הקובץ היחיד ב-`.github/`, ו-git מוחק תיקייה שהתרוקנה.

- [ ] **Step 2: בדיקת הקומיט**
  Run: `git diff --cached --name-only`
  Expected: רק `.github/workflows/static.yml`.

- [ ] **Step 3: קומיט, אחרי שאישרת**
  ```bash
  git commit -m "chore(ci): remove the Pages workflow that published the whole repo" \
    -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

- [ ] **Step 4: push של הענף, אחרי שאישרת**
  Run: `git push -u origin s01-stabilization`
  Expected: `* [new branch] s01-stabilization -> s01-stabilization`. ה-push הזה לא מפעיל את `static.yml`, כי הוא מאזין רק ל-`main`, וגם Actions כבוי.

- [ ] **Step 5: אימות**
  ```bash
  [ "$(git ls-remote origin refs/heads/s01-stabilization | cut -f1)" = "$(git rev-parse s01-stabilization)" ] && echo "branch on GitHub"
  git ls-remote origin refs/heads/main
  git branch -r --contains 3d231b5
  ```
  Expected: מודפס `branch on GitHub`, ו-`main` ב-GitHub עדיין ב-`1c352f7…`. בפלט האחרון מופיע `origin/s01-stabilization`, כלומר הענף מכיל את `3d231b5`, האחרון מבין 14 הקומיטים.

### Task 5: ניקוי ב-OpenRouter (אתה)

המפתח שב-`.env` כבר פג, ולכן כאן רק מנקים.

- [ ] **Step 1:** ב-`https://openrouter.ai/settings/keys`, למחוק את המפתח שפג וכל מפתח אחר שאתה לא משתמש בו.
- [ ] **Step 2:** ב-`https://openrouter.ai/settings/credits`, לכבות את הטעינה האוטומטית (auto top-up) אם היא דלוקה.
- [ ] **Step 3:** לכתוב לי שסיימת.

### Task 6: החלפת הסודות ב-`.env`

**Files:**
- Modify: `.env`. הקובץ מוחרג מ-git ולא נכנס לשום קומיט
- Delete: `backend/vapid_private.pem`. גם הוא מוחרג, והשרת לא משתמש בו

**מייצר:** קובץ `.env` עם `LLM_MODEL`, `ENVIRONMENT`, `SESSION_SECRET_KEY` חדש, זוג חדש של `VAPID_PUBLIC_KEY` ו-`VAPID_PRIVATE_KEY`, ו-`VAPID_SUB_EMAIL`. `OPENROUTER_API_KEY` כבר לא יהיה בו.

**ההשפעה על הקוד הישן:** בקוד הישן, ההתחברויות וההרשמות ל-Push יפסיקו לעבוד. זה לא משנה, כי ב-S02 הקוד עובר ל-`legacy/` ולא יישאר במצב שאפשר להריץ. ל-v2 ייווצרו מפתחות VAPID משלו ב-S16 (סעיף 7.10 במסמך התכנון).

- [ ] **Step 1: טביעות לפני ההחלפה**
  ```bash
  .venv/bin/python -I - <<'EOF'
  import hashlib
  from dotenv import dotenv_values
  for k, v in dotenv_values(".env").items():
      print(k, hashlib.sha256((v or "").encode()).hexdigest()[:12])
  EOF
  ```
  Expected: 7 שורות, בכל אחת שם וטביעה. שומרים את הפלט להשוואה ב-Step 4.

- [ ] **Step 2: ההחלפה**
  זה סקריפט חד-פעמי, בלי קובץ בריפו. הוא יוצר זוג מפתחות P-256 באותו פורמט כמו `scripts/generate_vapid.py`, ו-`SESSION_SECRET_KEY` חדש. הוא מוחק את השורה של `OPENROUTER_API_KEY`, משאיר את שאר השורות בסדר שלהן, וכותב את הקובץ באופן אטומי עם הרשאות 600:
  ```bash
  .venv/bin/python -I - <<'EOF'
  import base64, os, secrets, tempfile
  from cryptography.hazmat.primitives import serialization
  from cryptography.hazmat.primitives.asymmetric import ec

  def b64u(b): return base64.urlsafe_b64encode(b).decode().rstrip("=")

  key = ec.generate_private_key(ec.SECP256R1())
  new = {
      "SESSION_SECRET_KEY": secrets.token_urlsafe(32),
      "VAPID_PRIVATE_KEY": b64u(key.private_numbers().private_value.to_bytes(32, "big")),
      "VAPID_PUBLIC_KEY": b64u(key.public_key().public_bytes(
          serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)),
  }
  out, log = [], []
  for line in open(".env").read().splitlines():
      name = line.split("=", 1)[0].strip()
      if name == "OPENROUTER_API_KEY":
          log.append("removed " + name); continue
      if name in new:
          line = f"{name}={new.pop(name)}"; log.append("replaced " + name)
      out.append(line)
  assert not new, f"not found in .env: {sorted(new)}"
  fd, tmp = tempfile.mkstemp(dir=".", prefix=".env.")
  with os.fdopen(fd, "w") as f:
      f.write("\n".join(out) + "\n")
  os.chmod(tmp, 0o600)
  os.replace(tmp, ".env")
  print("\n".join(log))
  EOF
  ```
  Expected: `removed OPENROUTER_API_KEY`, `replaced SESSION_SECRET_KEY`, `replaced VAPID_PUBLIC_KEY`, `replaced VAPID_PRIVATE_KEY`.

- [ ] **Step 3: מחיקת ה-PEM הישן**
  Run: `rm backend/vapid_private.pem && ls backend/vapid_private.pem 2>&1`
  Expected: `No such file or directory`. השתמשו בו רק `scripts/manual_push_test.py` ו-`scripts/generate_vapid_pem.py`.

- [ ] **Step 4: אימות**
  ```bash
  .venv/bin/python -I - <<'EOF'
  import base64, hashlib
  from cryptography.hazmat.primitives import serialization
  from cryptography.hazmat.primitives.asymmetric import ec
  from dotenv import dotenv_values
  v = dotenv_values(".env")
  print(sorted(v))
  raw = base64.urlsafe_b64decode(v["VAPID_PRIVATE_KEY"] + "=" * (-len(v["VAPID_PRIVATE_KEY"]) % 4))
  pub = ec.derive_private_key(int.from_bytes(raw, "big"), ec.SECP256R1()).public_key().public_bytes(
      serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
  print("pair ok:", base64.urlsafe_b64encode(pub).decode().rstrip("=") == v["VAPID_PUBLIC_KEY"])
  for k in ("SESSION_SECRET_KEY", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"):
      print(k, hashlib.sha256(v[k].encode()).hexdigest()[:12])
  EOF
  ls -l .env | cut -c1-10
  ```
  Expected: `['ENVIRONMENT', 'LLM_MODEL', 'SESSION_SECRET_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_SUB_EMAIL']`, ואחריו `pair ok: True`. אחר כך שלוש טביעות ששונות מאלה של Step 1, ובסוף `-rw-------`.

- [ ] **Step 5: שום דבר חדש לא הגיע ל-git**
  Run: `git status --short`
  Expected: רק ארבעת השינויים ב-`.planning/`. לא `.env`, ולא קובץ `.env.*` זמני שנשאר מהסקריפט.

### Task 7: סגירת ה-scope

**צורך:** ש-Task 4 ו-Task 6 עברו.

- [ ] **Step 1: מיזוג ל-`main` ו-push, אחרי שאישרת**
  ```bash
  git switch main
  git merge --ff-only s01-stabilization
  git push origin main
  ```
  Expected: `Fast-forward`, ו-`main` ב-GitHub עובר מ-`1c352f7` לראש הענף. שום workflow לא רץ, כי `static.yml` כבר לא קיים בקומיט הזה וגם Actions כבוי. השינויים ב-`.planning/` עוברים איתנו ל-`main` כמו שהם.

- [ ] **Step 2: אימות**
  Run: `git status -sb | head -1 && [ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$(git rev-parse main)" ] && echo "main in sync"`
  Expected: `## main...origin/main` בלי `ahead`, ואחריו `main in sync`.

- [ ] **Step 3: מחיקת הענף, אחרי שאישרת**
  Run: `git branch -d s01-stabilization && git push origin --delete s01-stabilization`
  Expected: הענף נמחק גם מקומית וגם ב-GitHub.

- [ ] **Step 4: בדיקה סופית מול ההגדרה של "מוכן"**
  מריצים שוב את Steps 4 ו-5 של Task 3 ואת Step 4 של Task 6. לגבי OpenRouter, מספיק האישור שלך מ-Task 5.
  Expected: כל הבדיקות עוברות.

- [ ] **Step 5: עדכון הניהול**
  - ב-artifact, הסטטוס של S01 עובר ל"הושלם".
  - ב-memory נרשם ש-Actions כבוי, ושצריך להדליק אותו ב-S03.
  Expected: בשורה של S01 ב-artifact כתוב "הושלם".
