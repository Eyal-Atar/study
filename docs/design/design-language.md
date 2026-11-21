# השפה העיצובית של Archi

הכיוון: **יומן, בצבעים של ארצ׳י.** נקבע ב-18.11.2026, ומחליף את כיוון "נייר" של S25–S28.

- המבנה: אב-הטיפוס של היומן, [`prototype/calendar-prototype.html`](prototype/calendar-prototype.html), שאייל אישר. מה שהמסמך לא מפרט נלקח ממנו.
- הצבעים והדמות: [`prototype/archie-moods.html`](prototype/archie-moods.html), והמסמך `docs/superpowers/specs/2026-11-18-archie-look-and-gamification.md`. האינדיגו של אב-הטיפוס יצא.
- מסמכי התכנון: `docs/superpowers/specs/2026-11-18-calendar-redesign-design.md` ו-`2026-11-18-archie-look-and-gamification.md`. ההחלטות של S31 בתוכנית `docs/superpowers/plans/2026-11-18-s31-redesign-foundation.md`.

המסמך הזה הוא מקור האמת של S32–S34. הערכים נמצאים ב-`web/src/index.css`, ו-`web/src/theme.test.ts` בודק שכל token קיים ושכל זוג צבעים שמותר כאן עומד בניגודיות. הרכיבים נמצאים ב-`web/src/ui/` ו-`web/src/archie/`, וכולם מוצגים בכל מצב ב-`/dev/components` (רק ב-`npm run dev`). מי שמשנה ערך משנה אותו ב-`index.css`. מי שמוסיף זוג צבעים מוסיף אותו קודם לבדיקה.

ההדמיות של "נייר" נשארות ב-[`mockups/`](mockups/README.md) כהיסטוריה.

## 1. העקרונות

1. **בהיר בלבד.** אין מצב כהה (החלטה של אייל). רקע פשתן ירקרק, משטחים בהירים, טקסט בצבע קליפת עץ.
2. **היומן במרכז.** מסך הבית הוא יומן: יום בטלפון, שבוע במחשב, עם קו "עכשיו". כל מסך אחר הוא צעד הצידה מהיומן.
3. **צבע המבחן הוא הזהות של המשימה.** לכל מבחן צבע קבוע מתוך שמונה. בלוק, נקודה בפס הימים וכרטיס "המשימה הבאה" נושאים אותו. צבע מבחן לא משמש לשום דבר אחר.
4. **ירוק הוא פעולה ו"בוצע".** העלה (`brand`) הוא הכפתור הראשי, הסימון של "בוצע", המקום הנוכחי וטבעת הפוקוס. אף צבע מבחן אינו הירוק הזה, כדי ש"בוצע" יישאר מזוהה.
5. **הגיימיפיקציה גלויה.** הרצף והרמה תמיד בסרגל העליון. "בוצע" מקבל תגובה מיד. זה מבטל את "בטון שקט, בלי אנימציות" של S19.
6. **Archi שקט וקצר.** הוא מופיע ברגעים, לא בכל מסך. הודעה שלו נסגרת לבד, לא חוסמת ולא משמיעה צליל.
7. **קו ולא צל.** כרטיס מוגדר בקו. צל שמור למה שמעל העמוד: תפריט, toast, דיאלוג, גיליון, בלוק נגרר.
8. **נגיש לכולם.** AA לכל טקסט, 3:1 לכל חלק של פקד, מקלדת לכל פעולה, ומצב שלא נישא רק בצבע.

## 1א. שפה, כיוון ותוכן משתמש (S39, 21.11.2026)

**מסמך הביקורת** [`2026-11-21-archi-ux-audit.md`](2026-11-21-archi-ux-audit.md) גובר על המסמך הזה ועל כל מסמך עיצוב ישן ממנו. מה שכתוב כאן בעברית כדוגמת טקסט של ממשק (בסעיפים שנכתבו לפני S39) הוא היסטוריה; הטקסט האמיתי ב-`web/src/i18n/en.ts`.

- **הממשק באנגלית, LTR, והשם Archi.** `<html lang="en" dir="ltr">`, ‏locale אחד: `en-IL` (`web/src/i18n/locale.ts`): שעון 24 שעות (`16:05`), יום לפני חודש (`22 November 2026`, ‏`Sun, 22 Nov`), ושבוע שמתחיל ביום ראשון. אזור הזמן נשאר של המשתמש (`Asia/Jerusalem`).
- **הקול:** [`archi-voice.md`](archi-voice.md). Archi מדבר בגוף ראשון (`I` / `me` / `my`), פונה ב-`you`, ולעולם לא "Archi will".
- **Archi מוביל:** בכל זרימה קודם Archi והשאלה או ההקשר שלו, ומתחתיו רק הפקדים שעונים לו.
- **מחלקות לוגיות נשארות** (`ms-`, ‏`pe-`, ‏`start-`, ‏`text-start`): הכלל ב-ESLint לא השתנה, כי תוכן בעברית עדיין קובע כיוון בתוך האלמנט שלו.

**תוכן המשתמש נשאר בשפה שלו.** שם מבחן, משימה, נושא, קובץ, אירוע או התחייבות, וכל טקסט שנוצר מהחומרים, מוצגים כמו שנכתבו. הרכיב היחיד שמציג אותם הוא `ui/UserText`:

| מצב | מה הוא עושה | איפה |
| --- | --- | --- |
| `<UserText>` | `<bdi dir="auto">` בתוך השורה: הטקסט מקבל כיוון משלו (שם עברי עם מספר או סוגריים נקרא בסדר הנכון) ומבודד, כך שהוא לא מזיז את האנגלית שסביבו | שם בתוך שורה, כותרת של שורת רשימה, כותרת מסך, בתוך משפט |
| `<UserText truncate>` | בלוק שנחתך ב-`…` ב**סוף** הטקסט (בבלוק LTR כותרת עברית חתוכה הייתה מאבדת את ההתחלה שלה) | כותרת של בלוק ביומן, כל כותרת בשורה אחת שעלולה להיחתך |
| `<UserText prose>` | בלוק שמיושר לפי השפה שלו | פסקה: הנימוק של משימה, "על מה זה מבוסס" |

- **יישור (החלטה של מי שבונה):** כותרת של שורה אחת נשארת על הקצה של הממשק, שמאל, גם כשהיא בעברית, כך שלכל מסך יש קצה אחד והעין לא קופצת בין ימין לשמאל בכל שורה (כך גם ב-Google Calendar וב-Gmail באנגלית). פסקה מיושרת לפי השפה שלה. ההחלטה יושבת ב-`UserText` וב-`.user-text-truncate` (`index.css`), ואפשר להפוך אותה שם בלי לגעת במסכים.
- **בתוך מחרוזת** (aria-label, toast) אין אלמנט: עוטפים ב-`isolate(name)` מ-`i18n/bidi.ts` (תווי FSI/PDI). כל פונקציה ב-`en.ts` שמקבלת תוכן משתמש כבר עושה את זה.
- **לא עוטפים במירכאות** ולא משנים רישיות בתוכן משתמש.
- **אין עברית ב-`web/src`** חוץ מקובצי בדיקה, `src/test/` ו-`dev/sampleContent.ts` (נתוני דמה של תוכן משתמש). `sourceGuards.test.ts` שומר על זה.

## 2. צבע

כל צבע הוא מחלקת Tailwind לפי שם ה-token: `bg-surface`, ‏`text-ink-muted`, ‏`border-line`, ‏`stroke-gold`. אסור צבע מהלוח של Tailwind (`slate-600`, ‏`green-500`) או ערך hex בתוך רכיב. שקיפות מותרת רק בשני מקומות: הרקע שמאחורי דיאלוג (`bg-ink/35`) והסרגל התחתון (`bg-surface/97` עם `backdrop-blur-sm`). אף פעם לא על טקסט.

הניגודיות בטבלאות נמדדה על הערכים של `index.css`.

### 2.1 הבסיס

| token | ערך | משתמשים בו ל | לא משתמשים בו ל |
| --- | --- | --- | --- |
| `canvas` | `#eef0e4` | רקע העמוד (`body`), והאריח של שורה ברשימה (5.2) | כרטיס, שדה, סרגל |
| `surface` | `#f8f7f0` | כרטיס, תפריט, דיאלוג, גיליון, הסרגל העליון והתחתון, מרכז טבעת הרמה | רקע העמוד, שדה |
| `surface-muted` | `#e6e7d8` | מילוי שקט בתוך משטח (ה-`soft` של ההדמיה המלאה): תג ניטרלי, הערה, hover, פריט תפריט בפוקוס, המסילה של מתג מקוטע ושל פס התקדמות, רקע של אייקון, שלד טעינה | כרטיס שלם |
| `field` | `#ffffff` | הלבן של שדה ושל כרטיס בחירה (`.field` ו-`.opt` של ההדמיה): `TextField`, ‏`Select`, ‏`DatePicker`, ‏`TimeField`, ‏`RadioCards`, ‏`CheckboxCards`, ‏`OptionGrid`, ‏`CompactSelect`, והמסילה של `Switch` כבוי. הגבול נשאר `line-strong` | כרטיס, רקע של אזור |
| `ink` | `#3b2a1e` | כותרות וטקסט ראשי, וכל טקסט בתוך בלוק של מבחן (11.6–12.7:1) | — |
| `ink-muted` | `#6e5948` | טקסט משני: שעה, משך, תיאור, placeholder, יעד לא פעיל בניווט (5.27–6.59:1) | טקסט על צבע של מבחן; טקסט שחייבים לקרוא כדי לפעול |
| `line` | `#d9d6c3` | קו הפרדה, קצה של כרטיס ושל popover, גבול של כפתור משני | גבול של שדה (אין לו כלל ניגודיות) |
| `line-strong` | `#8c7b67` | הגבול שמזהה פקד: שדה, תיבת סימון ריקה, המקטע הנבחר (3.26 על `surface-muted`, 3.54–3.80 על הרקעים, 4.08 על `field`) | קו הפרדה |

### 2.2 המותג והצבעים של ארצ׳י

| token | ערך | משתמשים בו ל | לא משתמשים בו ל |
| --- | --- | --- | --- |
| `brand` | `#4f7a3a` עלה | מילוי הכפתור הראשי, מתג פועל, שדה בפוקוס, טבעת הפוקוס, אפשרות נבחרת ב-`OptionGrid` | **טקסט.** הוא 4.36 על `canvas` ו-4.02 על `surface-muted` |
| `brand-strong` | `#3f6430` | כל טקסט ירוק (קישור, כפתור שקט, יעד נוכחי, תג "עכשיו"), ו-hover של הכפתור הראשי (5.8–5.9:1) | — |
| `brand-soft` | `#e2ead3` | הרקע של יעד נוכחי בסרגל העליון, hover של כפתור שקט, אפשרות נבחרת, העיגול של הפרופיל ושל `EmptyState` | כרטיס שלם |
| `on-brand` | `#ffffff` | טקסט ואייקון על `brand`, ‏`brand-strong`, ‏`success`, ‏`danger` ועל הצבע החזק של מבחן | — |
| `sprout` | `#8db45e` נבט | קישוט: טבעות התקדמות, נקודות רצף | טקסט, וכל דבר שצריך 3:1 (2.2:1 על `surface`) |
| `clay` | `#9a5f38` חימר | מילוי של פעולה משנית, עם `on-clay` עליו (5.2:1) | טקסט (4.48 על `canvas`) |
| `on-clay` | `#ffffff` | טקסט על `clay` | — |
| `sand` | `#c9a77c` חול | קישוט: הגבולות של אזורי ארצ׳י | טקסט, גבול של פקד |
| `gold` | `#d4a24c` זהב | XP, הרמה והתגים: הקשת של טבעת הרמה, מילוי עם `ink` עליו (5.9:1) | טקסט; סימן שנושא מידע לבד (1.85 על `surface-muted`, 1.75 על `gold-track`) |
| `gold-soft` / `gold-ink` | `#f6e7c6` / `#6b4a12` | הצ'יפ הזהוב של XP (`.chip.gold` של ההדמיה): `gold-ink` על `gold-soft` (6.57:1) | — |
| `gold-track` | `#eadfc4` | המסילה של טבעת הרמה, מתחת לקשת `gold`. קישוט: המספר שבטבעת אומר את הרמה | טקסט, גבול של פקד |
| `sky-from` / `sky-to` | `#96c6e8` / `#d6ecf8` | מעבר "שחר" מלמעלה למטה: גיליון החגיגה והגן (S33 / S41 יחליטו אם הוא נשאר). **לא הרקע של Archi:** מ-S39 לדמות אין רקע | רקע של מסך רגיל |
| `sky` | `#a9d3ee` | הגוון שבין שני הקצוות: רקע אחיד מתחת למעבר (מ-S39 לא הרקע של `avatar`) | — |

`success` ו-`success-soft` שווים היום ל-`brand-strong` ול-`brand-soft`. הם tokens נפרדים כי התפקיד שונה: "בוצע" מול "פעולה".

### 2.3 מצב ו"עכשיו"

| token | ערך | משתמשים בו ל | לא משתמשים בו ל |
| --- | --- | --- | --- |
| `now` | `#c2502e` טרקוטה | קו "עכשיו" של היומן (4.1–4.4:1, נבדק כ-3:1) | טקסט |
| `now-text` | `#a8401f` | השעה של קו "עכשיו" כטקסט, על שלושת הרקעים | — |
| `success` / `success-soft` | `#3f6430` / `#e2ead3` | "בוצע": תיבה מלאה, מילוי פס התקדמות וטבעת היום, תג "בוצע", כרטיס הצלחה | כפתור "שמירה" ירוק |
| `warning` / `warning-soft` | `#80520e` / `#f5ead0` | דורש תשומת לב ולא נכשל: "עבר הזמן", הדוח "לא נכנס" | — |
| `danger` / `danger-soft` | `#a33a1c` / `#f6e2d8` | לבנה, לא אדום. רק שגיאה ופעולה הרסנית | משימה שלא בוצעה, רצף שנשבר (אלה `ink-muted`; "בלי אדום ובלי שפה של כישלון") |

### 2.4 ה-toast הכהה

| token | ערך | למה |
| --- | --- | --- |
| `inverse` | `#3b2a1e` | הרקע של ה-toast, קליפת עץ |
| `on-inverse` | `#f3ead9` | הטקסט שלו, השמנת של ההדמיה (11.45:1) |
| `inverse-action` | `#cfe3b4` | הפעולה שבו ("בטל", 9.96:1), וטבעת הפוקוס על הכהה |
| `inverse-success` / `inverse-danger` | `#c5dea0` / `#f0a98e` | אייקון המצב |

### 2.5 זוגות טקסט מותרים (4.5:1)

כל זוג כאן נבדק ב-`theme.test.ts` (`PAIRS`). זוג שלא כאן אסור, גם אם במקרה הוא עובר.

| טקסט | על |
| --- | --- |
| `ink`, ‏`ink-muted`, ‏`brand-strong`, ‏`danger`, ‏`success`, ‏`warning`, ‏`now-text` | `canvas`, ‏`surface`, ‏`surface-muted` |
| `ink`, ‏`ink-muted`, ‏`brand-strong` | `brand-soft` |
| `ink` וצבע המצב עצמו | `danger-soft`, ‏`success-soft`, ‏`warning-soft` (כל אחד עם הצבע שלו) |
| `on-brand` | `brand`, ‏`brand-strong`, ‏`success`, ‏`danger`, ‏`exam-0`…`exam-7` |
| `on-clay` | `clay` |
| `ink` | `gold`, ‏`gold-soft`, ‏`sky`, ‏`sky-from`, ‏`sky-to` |
| `gold-ink` | `gold-soft` |
| `ink`, ‏`ink-muted`, ‏`danger` | `field` |
| `on-inverse`, ‏`inverse-action`, ‏`inverse-success`, ‏`inverse-danger` | `inverse` |
| `ink` | `exam-N-soft`, ‏`exam-N-line` |
| `ink`, ‏`ink-muted` | `busy-soft` |

### 2.6 חלקים של פקדים (3:1)

WCAG 1.4.11: מה שמזהה פקד או נושא מידע בלי טקסט. נבדק ב-`NON_TEXT_PAIRS`.

| סימן | על |
| --- | --- |
| `line-strong`, ‏`brand` | `canvas`, ‏`surface`, ‏`surface-muted`, ‏`field`; ‏`brand` גם על `brand-soft` |
| `danger` (גבול של שדה בשגיאה) | `field` |
| `success`, ‏`brand` (מילוי של פס) | `surface-muted` (המסילה); ‏`success` גם על `line` |
| `now` | `surface`, ‏`canvas` |
| `exam-N` (פס, נקודה, גבול) | `exam-N-soft`, ‏`surface`, ‏`canvas` |
| `busy` | `busy-soft`, ‏`surface` |

### 2.7 מה אסור

- **`text-brand`.** הירוק כטקסט הוא `text-brand-strong`. בדיקה ב-`theme.test.ts` סורקת כל `.tsx` ונכשלת על `text-brand`.
- **`clay`, ‏`sprout`, ‏`sand` ו-`gold` כטקסט.** הם מילוי או קישוט.
- **`ink-muted` על צבע של מבחן.** בתוך בלוק כל הטקסט `ink`, גם השעה.
- **`text-exam-N` כטקסט לקריאה.** הצבע החזק נבדק רק כ-3:1 (על ה-soft שלו הוא 4.07–5.57). המחלקה קיימת בשביל `currentColor` של הפס ושל תיבת הסימון.
- **`ink-muted` על `danger-soft`, ‏`success-soft` או `warning-soft`.** לכן כרטיס של מצב ו-`Note` של אזהרה מחזיקים רק `ink`.
- **צבע מצב על הגרסה הרכה של מצב אחר**, ו-`on-brand` על `warning`, על `clay` או על `now`.
- **שקיפות על טקסט או על בלוק** (`opacity-50`, ‏`text-ink/70`). כבוי הוא `surface-muted` עם `ink-muted`.
- **מצב בצבע בלבד.** לכל תג יש מילים, לסימון יש ✓, ל-toast יש אייקון.

### 2.8 צבעי המבחנים

שמונה גוונים אדמתיים. לכל אחד שלושה tokens: `exam-N` (חזק), ‏`exam-N-soft` (המילוי של בלוק) ו-`exam-N-line` (הגבול שלו). ארבעת הראשונים הם של ההדמיה המלאה (`docs/design/prototype/all-screens.html`), בסדר שלה; ארבעת האחרים נשארו מהפלטה של ארצ׳י.

| N | שם | `exam-N` | `exam-N-soft` | `exam-N-line` | לבן על החזק |
| --- | --- | --- | --- | --- | --- |
| 0 | זית | `#6b7a2f` | `#eef0d9` | `#c9cf9c` | 4.72 |
| 1 | טרקוטה | `#b0532f` | `#f8e6dc` | `#e8b79d` | 5.09 |
| 2 | אבן כחולה | `#4a6b84` | `#e2ebf2` | `#a9c0d2` | 5.63 |
| 3 | שזיף | `#7b4a6d` | `#f1e3ec` | `#d2aec6` | 6.90 |
| 4 | חרדל | `#8a6410` | `#f7ecd2` | `#e2c78a` | 5.37 |
| 5 | מנטה כהה | `#2f6f62` | `#dcefe9` | `#9dcdc0` | 5.88 |
| 6 | ורד עתיק | `#a3485b` | `#f7e2e6` | `#e2aab5` | 5.78 |
| 7 | אדמה | `#7a5236` | `#f1e6dc` | `#d2b49c` | 6.80 |

**הכללים** (כולם נבדקים):

- `ink` על `soft` ועל `line`: ‏4.5 לפחות (6.91–11.79).
- `on-brand` (לבן) על `exam-N`: ‏4.5 לפחות (4.72–6.90), כי כרטיס "המשימה הבאה" הוא לבן על צבע המבחן.
- `exam-N` על `soft` (4.07–5.57), על `surface` ועל `canvas`: ‏3:1 לפחות.
- שמונת הגוונים שונים זה מזה, ואף אחד אינו `brand` או `brand-strong`. הזית (0) שונה מ-`brand` בגוון: צהבהב, מול הירוק של העלה, כמו בהדמיה שאייל אישר.
- הסדר מרחיק גוונים קרובים.

**מאיפה המספר:** ה-API נותן לכל מבחן `color_index` (‏0–7), ולכל בלוק ולכל שורה בדוח "לא נכנס" את `exam_color_index` של המבחן שלו (מיגרציה 0013). מבחן חדש מקבל את הצבע הראשון שלא בשימוש בין המבחנים החיים של המשתמש. מחיקה של מבחן אחר לא משנה צבע. אין עדיין בחירה ידנית.

**`examColor()`** (`web/src/ui/examColor.ts`) הופך מספר למחלקות. Tailwind מוצא רק מחלקות שכתובות במלואן, ולכן הטבלה כתובה ביד. אסור לבנות `bg-exam-${n}`.

| שדה | מחלקה | למה |
| --- | --- | --- |
| `solid` | `bg-exam-N` | פס, נקודה, כרטיס "המשימה הבאה" |
| `text` | `text-exam-N` | `currentColor` לפס ולתיבה, לא טקסט לקריאה |
| `soft` | `bg-exam-N-soft` | המילוי של בלוק |
| `line` | `border-exam-N-line` | הגבול של בלוק |
| `borderStrong` | `border-exam-N` | גבול חזק |
| `fill` | `fill-exam-N` | מילוי של SVG |

מספר שבור מעוגל למטה, מספר מחוץ לטווח מסתובב (8 → 0, ‏‎-1 → 7), ו-`null` או `undefined` → 7, כדי שתשובה ישנה מה-cache לא תפיל מסך. `examColorIndex()` מחזיר את המספר עצמו, ו-`EXAM_COLOR_COUNT` הוא 8.

```tsx
// בלוק (הדוגמה של /dev/components; S32 בונה את הבלוק האמיתי)
const c = examColor(block.exam_color_index)
<div className={cx('rounded-control border border-s-4 border-s-current px-2 py-1.5 text-small', c.soft, c.line, c.text)}>
  <div className="flex items-start gap-1.5">
    <span aria-hidden="true" className="mt-px size-[18px] shrink-0 rounded-[6px] border-2 border-current bg-surface" />
    <div className="min-w-0 flex-1">
      <p className="font-semibold text-ink">תרגול תוחלת ושונות</p>
      <p className="text-caption text-ink"><span dir="ltr">10:00–11:30</span></p>
    </div>
  </div>
</div>

// המשימה הבאה: לבן על הצבע החזק
<div className={cx('rounded-card p-4 text-on-brand', examColor(next.exam_color_index).solid)}>…</div>
```

### 2.9 זמן תפוס

זמן שהמשתמש לא פנוי בו (התחייבות קבועה, אירוע חד-פעמי). הוא לא משימה, ולכן אין לו צבע מבחן ואין לו תיבת סימון. S32 מצייר אותו ביומן עם קווים אלכסוניים, מתחת לבלוקי הלימוד (מסמך הזמינות, סעיף 7).

| token | ערך | למה |
| --- | --- | --- |
| `busy-soft` | `#e5e2d6` | המילוי, עם `ink` ו-`ink-muted` עליו (5.1:1 ומעלה). שונה מ-`surface-muted` ומ-`exam-7-soft` (נבדק) |
| `busy-line` | `#c9c3b3` | הגבול, קישוט |
| `busy` | `#7d7062` | הגוון החזק: פס, אייקון, הקווים האלכסוניים (3:1 על `busy-soft` ועל `surface`) |

```tsx
<div className="rounded-control border border-s-4 border-busy-line border-s-busy bg-busy-soft px-2 py-1.5 text-small">
  <p className="font-semibold text-ink">עבודה</p>
  <p className="text-caption text-ink-muted"><span dir="ltr">16:00–22:00</span></p>
</div>
```

## 3. טיפוגרפיה

**הפונטים:** Rubik לכל הממשק, ו-Amatic SC לתצוגה. שניהם מאוחסנים אצלנו, ברישיון OFL.

**Rubik** (`web/src/assets/fonts/OFL.txt`): שני קובצי variable עם ציר משקל 400–700: עברית (`rubik-hebrew.woff2`, ‏7KB) ולטינית (`rubik-latin.woff2`, ‏35KB). הדפדפן מוריד קובץ רק כשיש בעמוד תווים מה-`unicode-range` שלו, ו-`font-display: swap` מציג את פונט המערכת עד שהוא נטען. `font-synthesis: none`: ל-Rubik אין נטייה, ל-Amatic SC יש רק 700, והדפדפן לא מזייף משקל.

**Amatic SC** (`web/src/assets/fonts/OFL-AmaticSC.txt`), פונט התצוגה (`font-display`, ‏`--font-display: 'Amatic SC', 'Rubik', system-ui, sans-serif`): משקל 700 בלבד, עברית (`amatic-hebrew.woff2`, ‏9KB) ולטינית (`amatic-latin.woff2`, ‏24KB), עם אותם `unicode-range` של Rubik ו-`swap`. הוא משמש עכשיו רק את הלוגו (30px), ובהמשך את הכותרות הגדולות של ארצ׳י (חגיגה, גן, כניסה). **רק מ-24px ומעלה, ותמיד עם `font-bold`**: בגודל קטן הוא לא קריא. תו שחסר בו נופל ל-Rubik.

**ארבעה משקלים:**

| משקל | מחלקה | למה |
| --- | --- | --- |
| 400 | `font-normal` | טקסט לקריאה, טקסט משני, משימה שבוצעה |
| 500 | `font-medium` | תוויות: כפתור, תווית שדה, לשונית, תג, כותרת קטע |
| 600 | `font-semibold` | שמות וכותרות: שם משימה, כותרת כרטיס ודיאלוג, מספר שרוצים שיראו, יעד נוכחי |
| 700 | `font-bold` | כותרת המסך (`h1`), המספר שבטבעת הרמה, ו-Amatic SC (שאין לו משקל אחר) |

**חמישה גדלים.** כל מחלקה קובעת גם את גובה השורה.

| מחלקה | גודל / שורה | למה |
| --- | --- | --- |
| `text-display` | 26px / 1.15 | כותרת המסך (`h1` של `PageHeader`), אחת בכל מסך, ב-700 |
| `text-title` | 20px / 1.3 | כותרת של דיאלוג, הכותרת של הכרטיס הראשי |
| `text-body` | 16px / 1.5 | ברירת המחדל: שם בשורה, טקסט רגיל, שדה קלט, לשונית בסרגל העליון |
| `text-small` | 14px / 1.4 | טקסט משני, כפתור, תג, תווית שדה, כותרת קטע |
| `text-caption` | 12px / 1.35 | תווית בסרגל התחתון, תיאור בכרטיס בחירה, שעה בתוך בלוק |

- **שדה קלט תמיד ב-`text-body`**, אחרת iOS מגדיל את התצוגה בפוקוס.
- **כותרת קטע** (`SectionHeading`) היא `text-small font-medium text-ink-muted`: תווית, לא כותרת, כמו "המשימות של היום" בסרגל הצד של אב-הטיפוס.
- **מספרים ושעות:** `tabular-nums`. הממשק LTR מ-S39, ולכן שעה או טווח (`10:00–11:30`) לא צריכים עטיפה. `dir="ltr"` מפורש נשאר רק על טקסט טכני (שגיאת מפתח).
- **אורך שורה:** טקסט רץ עד `max-w-prose`.
- **גודל אחד מחוץ לסולם, בכוונה:** שם האפליקציה בלוגו (`font-display text-[1.875rem]`, ‏30px, כמו `.logo` של ההדמיה). מעבר לו, רק החמישה.
- **לא משתמשים** באותיות רישיות לתוויות, בקו תחתון לטקסט שאינו קישור, או בצבע כדי להדגיש מילה במשפט.

**הפונטים אחרי המעבר לאנגלית (S39, 21.11.2026):** שני הפונטים נבדקו שוב בלטינית ונשארו. Rubik תוכנן לעברית וללטינית יחד, כך ששם מבחן בעברית בתוך שורה אנגלית יושב על אותו קו בסיס, באותו גובה אות ובאותו משקל: זה בדיוק המצב של המוצר (ממשק אנגלי, תוכן עברי), ופונט לטיני אחר היה מחייב פונט שני לעברית ושובר את האחידות. Amatic SC בלטינית הוא פונט של אותיות רישיות קטנות בכתב יד, והלוגו "Archi" ב-30px קריא ומתאים לגזירות הנייר; הכלל "רק מ-24px, רק Bold" נשאר. קובצי העברית של שני הפונטים נשארים, כי תוכן המשתמש בעברית, והדפדפן מוריד אותם רק כשיש בעמוד אותיות עבריות (`unicode-range`).

**פונט התצוגה נבחר ב-S31** (החלטה 28 בתוכנית): ההחלטה הקודמת לחכות ל-S33 בוטלה, כי ההדמיה המלאה, שהיא המקור החזותי, משתמשת ב-Amatic SC בלוגו ובכותרות של ארצ׳י, והוא 33KB בשני הקבצים.

## 4. ריווח, פינות, צללים

**ריווח:** הסולם של Tailwind (קפיצות של 4px). לערכים שחוזרים יש שם:

| token | ערך | מחלקה לדוגמה | למה |
| --- | --- | --- | --- |
| `touch` | 44px | `min-h-touch`, ‏`size-touch` | הגודל הקטן ביותר של כל דבר שלוחצים עליו |
| `gutter` | 18px | דרך `px-page` | השוליים של העמוד בטלפון |
| `card` | 16px | `p-card` | הריפוד בתוך כרטיס ודיאלוג |
| `section` | 24px | `space-y-section`, ‏`py-section` | הרווח בין שני קטעים במסך |
| `topbar` | 60px | `h-topbar` | גובה הסרגל העליון מ-`lg` (כמו ההדמיה) |
| `bottombar` | 56px | `min-h-bottombar` | גובה הסרגל התחתון |

- `px-page` הוא ה-gutter, או ה-safe-area של הטלפון כשהוא רחב יותר. `px-safe` הוא ה-safe-area לבד, לסרגל שנוגע בקצוות המסך.
- בתוך קטע: 8px בין פקדים סמוכים (`gap-2`), 4px בין כותרת שורה לשורת המשנה (`gap-1`), 12–16px בין קבוצות. שורה ברשימה גבוהה לפחות 64px.

**פינות:**

| token | ערך | מחלקה | למה |
| --- | --- | --- | --- |
| `badge` | 6px | `rounded-badge` | מקטע של תאריך או שעה בשדה, פוקוס של קישור בטקסט |
| `control` | 12px | `rounded-control` | שדה (`.field`), כרטיס בחירה, פריט תפריט, הערה, בלוק, `IconButton`, לשונית |
| `button` | 14px | `rounded-button` | כפתור (`Button`, ‏`ButtonLink`; `.btn` של ההדמיה) |
| `card` | 18px | `rounded-card` | כרטיס, דיאלוג במחשב, תפריט, popover, ‏toast |
| `sheet` | 24px | `rounded-t-sheet` | הגיליון התחתון בטלפון, רק בפינות העליונות |
| — | מלא | `rounded-full` | גלולה ועיגול: תג, שני חלקי צ'יפ ההתקדמות, הפרופיל, מתג, פס התקדמות |

פינות של אב-הטיפוס שנכתבות כמו שהן, ורק במקום שלהן: 12px לאריח של שורה ברשימה, 8px למקטע בתוך מתג מקוטע, 7px לתיבת הסימון, 6px לתיבה בתוך בלוק.

**צללים:** כרטיס מוגדר בקו ובלי צל. צל אומר שהדבר נמצא מעל משהו.

| token | ערך | למה |
| --- | --- | --- |
| `shadow-raised` | `0 1px 3px rgb(59 42 30 / 0.1)` | המקטע הנבחר במתג |
| `shadow-overlay` | שתי שכבות, `0 1px 2px` ו-`0 18px 40px -10px`, בגוון קליפת העץ | מה שצף: תפריט, popover, ‏toast, דיאלוג במחשב |
| `shadow-lift` | `0 12px 28px rgb(59 42 30 / 0.24)` | בלוק בזמן גרירה (S32) |
| `shadow-sheet` | `0 -10px 40px rgb(59 42 30 / 0.25)` | הגיליון התחתון: הצל עולה למעלה |

## 5. רכיבים

כל מסך מורכב מרכיבי `web/src/ui/`. מסך לא כותב `<button>`, ‏`<input>` או תג משלו, ולא מעתיק מחלקות של רכיב. אם חסר מצב, מוסיפים אותו לרכיב. הרכיבים בנויים על React Aria Components, שנותן תפקיד, מקלדת, פוקוס ו-RTL, ושם על האלמנט `data-hovered`, ‏`data-pressed`, ‏`data-focus-visible`, ‏`data-disabled`. הסגנון נשען רק עליהם.

`ui/styles.ts` מחזיק את מה שמשותף: `cx(...)`, ‏`FOCUS_RING` (לרכיב של React Aria), ‏`FOCUS_RING_NATIVE` (לאלמנט רגיל), ‏`FOCUS_RING_INVERSE` ו-`FOCUS_RING_INVERSE_NATIVE` (על ה-toast הכהה), ‏`ICON_STROKE` (1.75), ‏`BUTTON_BASE`, ‏`BUTTON_REST` ו-`ICON_BUTTON_CLASS`.

### 5.1 כרטיס

- `rounded-card border border-line bg-surface p-card`. בלי צל.
- כרטיס הוא למשהו **אחד שעומד בפני עצמו**: טופס, הדוח "לא נכנס", האזור המסוכן בהגדרות. לא לכל פריט ברשימה.
- כרטיס בתוך כרטיס: אסור. בתוך כרטיס מפרידים בקו (`border-t border-line`) או ב-`Note`.
- כרטיס של מצב (`tone`): הגבול בצבע המצב, הרקע בגרסה הרכה, הטקסט `ink`, והכותרת (`title`) בצבע המצב.
- **המשימה הבאה** (S32) היא היוצא מהכלל: כרטיס מלא בצבע המבחן עם טקסט לבן, כמו `.next` של אב-הטיפוס.

### 5.2 רשימה

- פריטים מאותו סוג הם שורות של `List` ו-`ListRow`, לא ערימה של כרטיסים.
- **שורה** היא האריח של `.task` באב-הטיפוס: `bg-canvas`, פינות 12px, גובה 64px לפחות, 6px בין שורה לשורה, בלי קו ביניהן. היא נראית כאריח על `surface` (כרטיס, סרגל הצד, גיליון). על `canvas` של העמוד היא לא נראית (סעיף 11).
- מבנה, מימין לשמאל: `leading` (עמודה קבועה, `tabular-nums`, ‏600), השם (600) ומתחתיו שורת משנה (`text-small text-ink-muted`), ובקצה `trailing`.
- **כפתור הסימון** (`CheckButton`): אזור של 44px, ובתוכו ריבוע של 22px עם פינות 7px וגבול 2px ב-`line-strong`. כשבוצע: מילוי `brand` ו-✓ ב-`on-brand` (5.0), גם בתוך בלוק בצבע מבחן, כדי ש"בוצע" יישאר ירוק עלה.
- **משימה שבוצעה:** השם ב-`ink-muted`, משקל 400, קו חוצה. השורה נשארת במקומה.
- פעולות נוספות על שורה בתפריט, לא בשורה של כפתורים. פרטים בשורת המשנה מופרדים בפסיק ובנקודה ("הסתברות, תרגול. שעה"), לא ב-·.

### 5.3 כפתור

כל כפתור: `min-h-touch rounded-button border px-4 text-small font-medium`, עם טבעת פוקוס. הפינות של 14px הן של `.btn` בהדמיה, קצת יותר עגולות מה-12px של שדה.

| `variant` | מראה | מתי |
| --- | --- | --- |
| `primary` | `bg-brand text-on-brand`; ‏hover: `bg-brand-strong` | הפעולה האחת שהמסך קיים בשבילה. **אחד לכל היותר במסך או בכרטיס** |
| `secondary` | `border-line bg-surface text-ink`; ‏hover: `bg-surface-muted` | כל פעולה אחרת. הגבול שקט כמו "היום" של אב-הטיפוס: לכפתור יש טקסט, והגבול לא מזהה אותו |
| `quiet` | `text-brand-strong` בלי גבול; ‏hover: `bg-brand-soft` | פעולה בתוך טקסט או בהערה ("לנסות שוב") |
| `danger` | כמו `secondary`, עם `text-danger`; ‏hover: `bg-danger-soft` | פעולה שאי אפשר לבטל. אף פעם לא במילוי |
| `inverse` | `text-inverse-action`; ‏hover: `text-on-inverse`; טבעת `FOCUS_RING_INVERSE` | רק הפעולה של ה-toast הכהה ("בטל") |

- הכפתור הראשי ראשון בסדר הקריאה, ובשורה של כמה כפתורים הוא מתרחב (`flex-1`).
- **כבוי** (`isDisabled`): `bg-surface-muted text-ink-muted border-line`, בלי שקיפות. ב-`inverse` הטקסט `line-strong`.
- **בטעינה** (`isPending`): הטקסט נשאר, לפניו מחוון מסתובב, והכפתור לא מגיב. משתמשים בו בכל כפתור ששולח בקשה, במקום לכבות אותו.
- הטקסט אומר מה יקרה ("שמירה", "הוספת מבחן").
- `ButtonLink` נראה כמו כפתור (אותם `variant`, ברירת מחדל `secondary`) והוא קישור.
- `IconButton`: ריבוע של 44px עם `aria-label` חובה. `quiet` (ברירת המחדל, `.iconbtn` של אב-הטיפוס), ‏`secondary` (עם הקו של כפתור משני), ‏`inverse` (על ה-toast).

### 5.4 שדה

- `min-h-touch rounded-control border border-line-strong bg-field px-3 text-body`. הלבן של `field` מבדיל את השדה מהמשטח שסביבו, כמו `.field` של ההדמיה. הגבול הוא מה שמזהה את השדה, ולכן `line-strong` (4.08 על הלבן).
- בפוקוס: `border-brand` וטבעת `ring-2 ring-brand`, בלי רווח. בשגיאה: `border-danger`, והודעה ב-`text-small text-danger` מתחת לשדה.
- התווית מעל השדה, גלויה, ב-`text-small font-medium`. ‏placeholder אינו תווית.
- כבוי: `bg-surface-muted text-ink-muted border-line`.
- מקטע בפוקוס (תאריך, שעה): מילוי `brand` עם `on-brand`.
- כרטיס בחירה (`RadioCards`, ‏`CheckboxCards`, ‏`OptionGrid`): `bg-field` עם גבול `line`, כמו `.opt` של ההדמיה (לכרטיס יש טקסט משלו, ולכן הגבול לא מה שמזהה אותו, כמו בכפתור המשני; בצילומים `line-strong` היה כבד מדי); ‏hover: `bg-surface-muted`; נבחר: `border-brand bg-brand-soft text-brand-strong font-semibold`. הבחירה נישאת בגבול, במילוי ובמשקל יחד.

### 5.5 תג

- גלולה: `rounded-full px-2.5 text-small font-medium`, בשורה אחת, ונחתך ב-… כשאין מקום.
- `brand` ("עכשיו"): `bg-brand-soft text-brand-strong`. ‏`success` ("בוצע"): `bg-success-soft text-success`. ‏`warning` ("עבר הזמן"): `bg-warning-soft text-warning`. ‏`neutral` ("הוחמץ", "דולג"): `bg-surface-muted text-ink-muted`.
- אין `danger`, בכוונה: משימה שלא בוצעה אף פעם לא אדומה.
- תג הוא למצב. מידע שאינו מצב (שם המבחן, "נעול") הוא טקסט בשורת המשנה.

### 5.6 פס התקדמות

- מסילה של 6px ב-`bg-surface-muted`, מילוי `bg-success`, שניהם `rounded-full`, כמו הפס של המבחנים באב-הטיפוס.
- מעליו שורה: התווית ב-`text-small text-ink-muted`, והערך ("60 מתוך 345 דקות") ב-`text-small font-medium tabular-nums`.
- ירוק הוא "בוצע", ולכן הפס הוא להתקדמות של עבודה, לא למכסה או לאזהרה.

### 5.7 אייקונים

**אפס אימוג׳י, ואין תו שמשמש אייקון** (`✓`, `×`, חץ). כל אייקון הוא רכיב מ-`web/src/ui/icons/`, הסט האחד של המוצר (S39, מסמך הביקורת סעיפים 2 ו-13). כלל ESLint אוסר לייבא `lucide-react` מכל מקום אחר, ובדיקה (`src/test/sourceGuards.test.ts`) וכלל ESLint (`archi/no-emoji`) נכשלים על אימוג׳י.

**שתי משפחות באותו קו** (רשת 24, קצוות ופינות עגולים, `currentColor`):

- **האייקונים של Archi**, מצוירים ביד (`archi.tsx`, ‏`dayparts.tsx`, ‏`kinds.tsx`, ‏`actions.tsx`): קו 1.75, ו"מילוי נייר" על הצורה הראשית (`fill="currentColor"` ב-14% אטימות), שנותן את התחושה של נייר חתוך ועדיין עוקב אחרי צבע הטקסט. אין בהם צבע קבוע.
- **גליפים כלליים** של lucide (`glyphs.ts`): חץ, X, פח, מנעול ודומיהם, בשמות המקוריים. ציור מחדש שלהם לא מוסיף אופי.

| אייקון | למה |
| --- | --- |
| `StreakLeafIcon` | רצף ימי הלימוד (במקום `Leaf`) |
| `XpSparkIcon` | XP |
| `TeaCupIcon` | הפסקה, יום מנוחה |
| `SproutIcon`, ‏`StoneIcon`, ‏`BlossomIcon` | התחלה, אבן דרך, הישג (התגים המאוירים עצמם ב-S33) |
| `MorningIcon`, ‏`NoonIcon`, ‏`EveningIcon`, ‏`NightIcon` | זמני הלימוד; `DAYPART_ICON[window]` |
| `LearningIcon`, ‏`PracticeIcon`, ‏`ReviewIcon`, ‏`SimulationIcon`, ‏`SimulationReviewIcon`, ‏`TaskIcon` | סוג המשימה; `KIND_ICON[kind]`. ביומן (S32) האייקון הוא מה שמבדיל בין סוגי הבלוקים במבט אחד |
| `FreeTimeIcon`, ‏`NextSlotIcon`, ‏`PickTimeIcon`, ‏`PracticeExamIcon` | "יש לי זמן עכשיו", המקום הפנוי הבא, בחירת שעה, מבחן תרגול |
| `OfflineIcon`, ‏`WorkIcon`, ‏`ClassIcon` | לא מקוון; זמן תפוס של עבודה ושל שיעור |
| `CheckMarkIcon` | סימון, במקום התו `✓` |

- **ה-API:** ‏`<StreakLeafIcon size={18} />`. ‏`size` (ברירת מחדל 20), ‏`className`, ו-`label`: עם `label` האייקון הוא `role="img"` עם שם נגיש, ובלעדיו `aria-hidden`. אייקון ליד טקסט לא מקבל `label`; אייקון לבד יושב בכפתור עם `aria-label`.
- **גודל:** 22px בסרגל התחתון, 18px בכפתור או ליד טקסט, 14–16px בתוך שורת משנה, בלוק או תיבת סימון.
- **גליפים של lucide:** ‏`strokeWidth={ICON_STROKE}` (1.75), כדי שיישבו ליד האייקונים של Archi.
- **בניווט:** יומן `CalendarDays`, מבחנים `FileText`, התקדמות `Sprout`. סימון `Check`, נעילה `Lock`, פרופיל `User` או האות הראשונה.
- **כיוון:** הממשק LTR בלבד: "הקודם" ו"חזרה" הם `ChevronLeft`, "הבא" הוא `ChevronRight`. אין `rtl:` במחלקות.
- **אייקון חדש** מצטייר באותו קו, נכנס ל-`ARCHI_ICONS` (הבדיקה עוברת על כולם), ונבדק בגיליון ב-16, 20, 24 ו-48px על `canvas` ועל `surface`.

### 5.8 רכיבי הבסיס (`web/src/ui/`)

| רכיב | מתי | מתי לא |
| --- | --- | --- |
| `Button` | כל פעולה עם טקסט (5.3) | ניווט למסך אחר |
| `ButtonLink` | מעבר למסך שיש לו משקל של פעולה ("מחיקת חשבון") | פעולה שלא מנווטת |
| `IconButton` | פעולה שהאייקון שלה מובן לבד: סגירה, תפריט | פעולה ראשית |
| `Menu`, ‏`MenuItem` | שתי פעולות נוספות ומעלה על שורה או על הפרופיל. ‏`tone="danger"` להרסנית | פעולה אחת; בחירת ערך |
| `TextField` | שורת טקסט | בחירה מרשימה סגורה |
| `Select` | בחירה אחת מיותר מחמש אפשרויות, או מרשימה שאורכה לא ידוע | עד חמש אפשרויות קצרות (`RadioCards`) |
| `CompactSelect` | בחירה קצרה בתוך שורה של רשימה, בלי תווית גלויה, עם `aria-label` שכולל את שם הפריט | שדה בטופס |
| `DatePicker` | תאריך | שעה |
| `TimeField` | שעה ביום, ערך `'HH:MM'` או `''` | משך |
| `RadioCards` | בחירה אחת מ-2–5 אפשרויות שכדאי לראות יחד | רשימה ארוכה |
| `CheckboxCards` | כמה בחירות מקבוצה קטנה (חלונות לימוד) | הסכמה בודדת |
| `SegmentedControl` | מעבר בין 2–3 תצוגות שפועל מיד ("יום / שבוע"). מסילה `surface-muted`, הנבחר `bg-surface shadow-raised border-line-strong` | ערך בטופס; ניווט בין מסכים |
| `OptionGrid` | אחת מהרבה אפשרויות קצרות (השעות הפנויות). ‏`ltr` לשעות. הנבחרת `bg-brand text-on-brand` עם ✓ | עד חמש (`RadioCards`) |
| `Switch` | הגדרה של פועל / כבוי שנשמרת עם הטופס | פעולה מיידית |
| `Card` | דבר אחד שעומד בפני עצמו (5.1) | פריט ברשימה |
| `Note` | הערה שקטה בתוך מסך, כרטיס או דיאלוג: `surface-muted`, בלי גבול. ‏`tone="warning"`, ‏`title`, ‏`action`, ‏`role` | תוכן שלא נטען (`ErrorState`); תוצאה של פעולה (toast) |
| `List`, ‏`ListRow` | פריטים מאותו סוג (5.2). ‏`to` לקישור, ‏`onPress` לכפתור | טבלה |
| `CheckButton` | הסימון של משימה (5.2). ‏toggle ולא checkbox | בחירה בטופס |
| `SectionHeading` | כותרת קטע (`h2` או `h3`) | כותרת המסך |
| `Badge` | מצב, עם מילים (5.5) | ספירה; מידע שאינו מצב |
| `ProgressBar` | התקדמות עם ערך ידוע (5.6). בלי תווית גלויה: `aria-label` | טעינה בלי אחוז |
| `TextLink` | קישור בטקסט, תמיד עם קו תחתון, ב-`text-brand-strong`. ‏`to` או `href` | פעולה |
| `Disclosure` | פרט משני בתוך שורה (הנימוק של משימה) | תוכן שחייבים לקרוא |
| `CollapsibleSection` | קטע משני של מסך עמוס, סגור עד שמבקשים. קטע שדורש את המשתמש נפתח לבד | הערה בתוך שורה |
| `Dialog` | שאלה או טופס קצר שעוצרים בשבילו. ‏`onSubmit` עוטף בטופס | הודעה (toast); "בטוח?" לפני מחיקה ("בטל" ל-10 שניות במקום) |
| `useToast()` | תוצאה של פעולה: נשמר, נכשל, "בטל" | שגיאה של שדה; תוכן שלא נטען |
| `LoadingState` | מחכה לנתונים, בצורה של מה שיגיע: `list`, ‏`card`, ‏`text`. ‏`Skeleton` לחלק בודד | פעולה שנשלחה (`isPending`) |
| `EmptyState` | עוד אין כלום: אייקון בעיגול `bg-brand-soft text-brand-strong`, משפט, פעולה | שגיאה |
| `ErrorState` | תוכן שלא נטען: אייקון, משפט, "לנסות שוב" | פעולה שנכשלה |
| `PageHeader` | ה-`h1` היחיד של המסך, ב-`text-display font-bold`, עם תת-כותרת ופעולה. קובע את שם הלשונית | כותרת קטע |
| `StandalonePage` | מסך מחוץ לשלד (כניסה, 404, פרידה): אותו רוחב ושוליים | מסך בתוך השלד |
| `examColor()` | המחלקות של צבע מבחן (2.8) | כל צבע אחר |

**ה-toast הכהה.** כל toast הוא `bg-inverse text-on-inverse rounded-button shadow-overlay` (14px, כמו `.toast` של ההדמיה), בלי גבול, כמו באב-הטיפוס. המצב באייקון: `CircleCheck` ב-`inverse-success`, ‏`CircleAlert` ב-`inverse-danger`; ל-`info` אין אייקון. הפעולה היא `Button variant="inverse"`, והסגירה `IconButton variant="inverse"`. מתחת ל-`lg` הוא יושב מעל הסרגל התחתון (6rem ועוד ה-safe-area), ומ-`lg` במרחק 1rem מהתחתית. ‏`z-[60]`, שכבה מעל הרקע של דיאלוג, כדי ש"בטל" יישאר לחיץ. בלי `action`: ‏6 שניות. עם `action`: ‏10 שניות.

**דיאלוג בטלפון הוא גיליון.** מתחת ל-`md` (768px) הדיאלוג מוצמד לתחתית: `rounded-t-sheet`, בלי גבול, `shadow-sheet`, ידית 38×5px ב-`bg-line` (`aria-hidden`, היא לא נגררת), וה-safe-area מתחתיו. מ-`md` הוא חלון במרכז: `rounded-card border border-line shadow-overlay`. הגובה עד 85% מה-visual viewport, כך שהוא נשאר מעל המקלדת. הרקע `bg-ink/35`. הדיאלוג נשאר על `md` ולא על `lg`, כי הוא תלוי ברוחב החלון ולא בשלד.

**דוגמאות.** הטקסטים כתובים ישר בקוד כדי לקצר. במוצר כל טקסט בא מ-`en.ts`, באנגלית (הדוגמאות כאן נכתבו לפני S39).

```tsx
// כותרת מסך עם הפעולה הראשית
<PageHeader title="מבחנים" subtitle="3 מבחנים קרובים" action={<Button onPress={add}>הוספת מבחן</Button>} />

// כפתורים: הראשי ראשון ומתרחב; שמירה שנשלחת
<div className="flex gap-2">
  <Button className="flex-1" isPending={save.isPending} onPress={submit}>שמירה</Button>
  <Button variant="secondary" onPress={cancel}>ביטול</Button>
</div>
<Button variant="danger" isDisabled={!confirmed}>מחיקת החשבון לצמיתות</Button>

// כפתור של אייקון בלבד
<IconButton aria-label="סגירה" onPress={close}>
  <X aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
</IconButton>

// תפריט פעולות של שורה
<Menu trigger={<IconButton aria-label={`פעולות: ${task.title}`}><Ellipsis aria-hidden="true" size={18} strokeWidth={ICON_STROKE} /></IconButton>}>
  <MenuItem icon={Clock} onAction={postpone}>דחייה</MenuItem>
  <MenuItem icon={Lock} onAction={pin}>נעילה</MenuItem>
  <MenuItem icon={Trash2} tone="danger" onAction={remove}>מחיקה</MenuItem>
</Menu>

// שדות
<TextField label="שם המבחן" value={name} onChange={setName} errorMessage={error} />
<Select label="נושא" value={topicId} options={topics} onChange={setTopicId} />
<DatePicker label="תאריך המבחן" value={date} onChange={setDate} minValue={tomorrow} />
<TimeField label="שעת קימה" value={wake} onChange={setWake} errorMessage={wakeError} />
<RadioCards label="קושי" options={LEVELS} value={level} onChange={setLevel} />
<CheckboxCards label="מתי נוח ללמוד" options={WINDOWS} value={windows} onChange={setWindows} />

// רשימה של שורות, בתוך כרטיס (על surface האריח נראה)
<Card>
  <SectionHeading>המשימות של היום</SectionHeading>
  <List aria-label="המשימות של היום">
    <ListRow
      leading={<span dir="ltr">10:00</span>}
      title="תרגול תוחלת ושונות"
      subtitle="הסתברות, תרגול. שעה"
      trailing={<CheckButton isDone={false} aria-label="בוצע: תרגול תוחלת ושונות" onChange={toggle} />}
    />
    <ListRow title="אלגוריתמים" subtitle="בעוד 12 ימים" to="/exams/e1" />
  </List>
</Card>
<Card tone="warning" title="3 משימות לא נכנסו" role="status">…</Card>

// תג, פס, מתג תצוגה, הערה
<Badge tone="warning">עבר הזמן</Badge>
<ProgressBar label="היום" value={60} max={345} valueText="60 מתוך 345 דקות" />
<SegmentedControl aria-label="תצוגה" options={[{ id: 'day', label: 'יום' }, { id: 'week', label: 'שבוע' }]} value={view} onChange={setView} />
<Note action={<Button variant="quiet" onPress={retry}>לנסות שוב</Button>}>לא הצלחנו לרענן.</Note>

// שלושת המצבים של מסך
if (query.isPending) return <LoadingState shape="list" rows={4} />
if (query.isError) return <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
if (query.data.length === 0) return <EmptyState icon={FileText} title="עוד אין מבחנים" action={<Button onPress={add}>הוספת מבחן</Button>} />

// דיאלוג: גיליון בטלפון, חלון במחשב
<Dialog title="תכנון מחדש" description="נזיז 4 בלוקים." isOpen={open} onOpenChange={setOpen}
  footer={<><Button className="flex-1" onPress={confirm}>אישור</Button><Button variant="secondary" onPress={() => setOpen(false)}>לא עכשיו</Button></>}>
  …
</Dialog>

// toast: כהה תמיד; עם "בטל" ל-10 שניות
const toast = useToast()
toast.show({ text: 'ההגדרות נשמרו', tone: 'success' })
toast.show({ text: 'המבחן נמחק', action: { label: 'בטל', onAction: undo } })
```

**כללים שחוזרים בכל הרכיבים:**

- כבוי הוא `surface-muted` עם `ink-muted`, אף פעם לא שקיפות.
- לכל שדה אותם props: ‏`label`, ‏`description`, ‏`errorMessage`. השגיאה מתחת לשדה ומקושרת אליו.
- **סדר המחלקות לא קובע מי מנצח.** Tailwind 4 פולט `data-[…]` לפי סדר האלף-בית של המאפיין, באותה specificity. כדי לקבוע מנצח משרשרים (`data-[focused]:data-[placeholder]:text-on-brand`), או בוחרים את הצבע ב-JS מתוך מצב הרינדור (`CheckButton`, ‏`SegmentedControl`, ‏`OptionGrid`, ‏`Switch`).
- שתי מחלקות צבע לאותה תכונה על אותו אלמנט מוכרעות לפי סדר ה-stylesheet. לכן לכל `variant` יש את כל הצבעים שלו, ולכל פקד טבעת אחת (`FOCUS_RING` או `FOCUS_RING_INVERSE`).
- מה שצף (`Menu`, הרשימה של `Select`, לוח השנה, דיאלוג במחשב) הוא `rounded-card border border-line bg-surface shadow-overlay`, ונכנס בשקיפות ב-240ms. הדיאלוג גם עולה 8px.
- טקסט ארוך בלי רווחים נשבר (`break-words`, ‏`min-w-0`), ולא מרחיב את העמוד.

## 6. השלד והניווט

`web/src/app/AppShell.tsx`. נקודת השבירה של השלד היא **`lg` (1024px)**: "במחשב, מ-1024px".

**שלושה יעדים:** יומן (`/calendar`), מבחנים (`/exams`), התקדמות (`/progress`). הגדרות ויציאה אינן יעדים: הן בתפריט הפרופיל. ב"הגדרות" אף יעד לא מסומן.

**`nav` אחד ב-DOM לשני הרוחבים**, עם `aria-label="ניווט ראשי"`, לפני `main`. קורא מסך פוגש ניווט אחד, וסדר ה-Tab זהה בטלפון ובמחשב.

**הסרגל העליון** (`header`, ה-`banner` היחיד): לכל רוחב המסך, `bg-surface` עם `border-b border-line`, וה-safe-area העליון מעליו.

| מ-`lg` (גובה `topbar`, 60px) | מתחת ל-`lg` (גובה 56px) |
| --- | --- |
| `Logo` | `Logo` |
| הניווט כלשוניות: `text-body`, הנוכחית `bg-brand-soft text-brand-strong font-semibold`, השאר `text-ink-muted font-medium` | — (הניווט בתחתית) |
| המקום של `ShellToolbar` (`flex-1`, מיושר לסוף) | — |
| `ProgressChip` | `ProgressChip` |
| `ProfileMenu` | `ProfileMenu` |

- **`Logo`:** כמו `.logo` של ההדמיה: ארצ׳י (`<Archie mood="joy" size="avatar" decorative className="size-[34px]" />`, ראש וכתפיים בלי עיגול, 34px, ‏`alt=""`) ולידו `en.appName` ("Archi") ב-`font-display` (Amatic SC), ‏30px ו-700. השם הוא `PRODUCT_NAME`, "ארצ׳י" (`web/src/product.ts`, החלטה של אייל מ-18.11.2026). זהה בשני הרוחבים.
- **`ShellToolbar`:** מקום ריק בסרגל, ש-S32 ממלא בפקדי התאריך של היומן (היום, חצים, טווח, יום / שבוע). מסך מרנדר `<ShellToolbar>…</ShellToolbar>`, והילדים עוברים לסרגל ב-portal, עם ה-state וה-context של המסך, ונעלמים כשהמסך יורד. המקום מוצג רק מ-`lg`; מתחת לו המסך שומר את הפקדים בתוכן שלו.
- **`ProgressChip`:** קישור אחד ל-`/progress` בגובה 44px, בשני חלקים כמו `gam` של ההדמיה: גלולה `bg-brand-soft text-brand-strong` עם `Leaf` ומספר ימי הרצף (600), וטבעת רמה של 34px: מסילה `gold-track` ברוחב 4px, קשת `gold` לפי ההתקדמות לרמה הבאה, מרכז `surface`, והרמה במרכז ב-700. ‏hover: מילוי `surface-muted` מאחורי שניהם. שם נגיש אחד: "רצף של 5 ימים, רמה 3". ה-SVG `aria-hidden`. בטעינה ובשגיאה של `GET /progress` הוא פשוט לא מוצג, בלי שגיאה. הוא קורא את `useProgress()`, ולכן מתרענן אחרי כל פעולה על בלוק. ‏`ProgressChipView` מקבל נתונים ביד (לדף הרכיבים).
- **`ProfileMenu`:** ‏`IconButton` בשם "פרופיל", ובו עיגול 36px `bg-brand-soft text-brand-strong font-semibold` עם האות הראשונה של השם מ-Google, אחרת של המייל, אחרת `User`. התפריט: "הגדרות" ו"יציאה". יציאה מבטלת קודם את המנוי של ה-push במכשיר (עד 3 שניות).
- **באונבורדינג** בסרגל יש רק הלוגו: אין ניווט, צ'יפ ופרופיל.

**הסרגל התחתון** (מתחת ל-`lg`): אותו `nav`, ‏`fixed` בתחתית, `bg-surface/97` עם `backdrop-blur-sm` עם `border-t border-line`, ‏`px-safe` וה-safe-area התחתון. כל יעד הוא עמודה ברוחב שווה ובגובה `bottombar`: אייקון 22px ותווית `text-caption`. הנוכחי `text-brand-strong font-semibold`, השאר `text-ink-muted`. המשקל הוא הסימן שאינו צבע. טבעת הפוקוס `ring-inset`, כי הסרגל נוגע בקצוות. ה-`main` מקבל ריפוד תחתון של `7rem` ועוד ה-safe-area, כדי שהשורה האחרונה לא תוסתר. מ-`lg` ‏`3rem`.

**רוחב:** ‏`main` הוא `mx-auto max-w-3xl px-page py-section` לכל המסכים. S32 יפתח רוחב מלא ליומן. מסך לא מוסיף רוחב או שוליים משלו.

**הנתיבים** (`routes.tsx`, ‏`legacyRedirects.tsx`):

| נתיב | מה קורה |
| --- | --- |
| `/` | מפנה ל-`CALENDAR_PATH` (`/calendar`) |
| `/calendar` | הבית. היום, או השבוע עם `?view=week` |
| `/today?x` | מפנה ל-`/calendar?x`, עם ה-query וה-hash כמו שהם |
| `/week?from=X` | מפנה ל-`/calendar?view=week&from=X`: ‏`view` ראשון, השאר אחריו |
| `/exams`, ‏`/exams/:examId`, ‏`/progress`, ‏`/settings`, ‏`/settings/delete-account` | כמו קודם |

- כל ההפניות הן `<Navigate replace>`: "אחורה" לא חוזר אליהן, ו-`useRouteFocus` לא מזיז את הפוקוס ב-`REPLACE`.
- `/today` ו-`/week` בתוך `OnboardingGate`: משתמש בלי תוכנית עובר מהם ישר לאונבורדינג. ‏`OnboardingGate` שולח משתמש עם תוכנית ל-`/calendar`.
- **למה `/today` נשאר:** ‏`manifest.start_url` נשאר `/today`. למניפסט אין `id`, ולכן ה-id של אפליקציה מותקנת הוא ה-`start_url`; שינוי שלו היה הופך את האפליקציה המותקנת לאפליקציה אחרת. גם ברירת המחדל של לחיצה על התראה (`pwa/notification.ts`) נשארת `/today`, כי התראות שכבר נשלחו מצביעות לשם. שניהם מגיעים ליומן דרך ההפניה.
- ‏`theme_color` הוא `#4f7a3a` (`brand`) ו-`background_color` הוא `#eef0e4` (`canvas`). מניפסט לא קורא משתני CSS, ולכן הם כתובים שם שוב.

**"דלג לתוכן"** הוא ה-Tab הראשון בכל מסך. הוא קישור ל-`#main`, ו-Enter מעביר את הפוקוס ל-`main` (`tabIndex={-1}`).

**פוקוס במעבר בין מסכים** (`useRouteFocus`): אחרי ניווט שהמשתמש יזם, הפוקוס עובר ל-`h1` של המסך החדש. לא בטעינה הראשונה, לא בהפניה ולא כשרק ה-query השתנה. לכן **כל מסך צריך `h1` שמופיע מיד**, גם בזמן טעינה. ל-`main` ול-`h1` עם `tabIndex=-1` אין טבעת (`index.css`).

**`CalendarPage` זמני.** עד S32 הוא מציג `SegmentedControl` "יום / שבוע", ומתחתיו את `TodayPage` או את `WeekPage`. התצוגה ב-URL, ולכן "אחורה" וקישור משותף שומרים אותה, והפוקוס נשאר על המתג. "יומן" בניווט מבקש את היום (`DAY_CHOSEN` ב-`calendar/calendarState.ts`, ב-`state` של הקישור): מתצוגת שבוע הוא נוחת על היום ברשומת היסטוריה אחת, ולא מחזיר את השבוע.

## 7. Archi (הדמות)

Archi הוא דמות בגזירות נייר בגוונים חמים, מהאיור של אייל. **לא מציירים אותו מחדש.** כל תנועה היא שכבה מעל האיור. הרכיב `web/src/archie/Archie.tsx` (שם הקוד נשאר `Archie`) הוא **נקודת ההחלפה היחידה**: כשאייל יביא קבצים סופיים (Lottie / Rive או PNG שקוף), רק הרכיב הזה והנכסים שלו משתנים.

**בלי רקע ובלי מסגרת (S39, מסמך הביקורת סעיף 3).** הרקע הוסר מששת האיורים, והדמות עומדת ישר על `canvas` או על `surface`: אין שמיים, אין עיגול, אין מסגרת ואין צל, וב-`card` וב-`scene` אין `overflow-hidden` שחותך אותה (ה-`avatar` הוא חיתוך של ראש וכתפיים שנמוג בקצוות, כך שלא רואים קצה). ארבע מהדמויות (`intentions`, ‏`eureka`, ‏`wisdom`, ‏`joy`) חתוכות ישר בתחתית, כי כך נחתכו באיור המקורי: הן תמיד עומדות על קו (קצה של כרטיס, סרגל, קו מפריד), כאילו הן מציצות מאחוריו.

```tsx
<Archie mood="eureka" />                        // card: ברירת המחדל
<Archie mood="joy" size="scene" />
<Archie mood="joy" size="avatar" className="size-16" />
<Archie mood="intentions" decorative />         // alt="" כשהטקסט שלידו אומר הכול
```

| prop | ערכים | הערה |
| --- | --- | --- |
| `mood` | `intentions`, ‏`eureka`, ‏`wisdom`, ‏`flow`, ‏`rest`, ‏`joy` | |
| `size` | `avatar`, ‏`card`, ‏`scene` | ברירת מחדל `card` |
| `decorative` | `boolean` | בלעדיו השם הנגיש הוא `en.archie.alt[mood]` |
| `eager` | `boolean` | ל-Archi שתמיד במסך הראשון (הלוגו) |
| `className` | | הגודל של `avatar`, או מקום |

**המצבים, ומתי כל אחד מופיע** (המשפטים בקול של [`archi-voice.md`](archi-voice.md)):

| מצב | השכבה | מתי | משפט לדוגמה |
| --- | --- | --- | --- |
| `intentions` | נבטים על שפת העציץ, טיפות מהכד, דף שעולה מהספר | סקירת הבוקר, תכנון השבוע, סוף האונבורדינג | "I've set three blocks for today. The rest can wait." |
| `eureka` | הילה רכה מאחורי הראש, ניצוצות, זוהר האבן | כל הבלוקים של היום בוצעו, עלייה ברמה, תג חדש | "That's every block for today." |
| `wisdom` | עשן מהקטורת, קו דיו בקצה המכחול | בניית התוכנית, התחלה של בלוק ארוך, הסיכום השבועי | "I'm building your plan." |
| `flow` | אדוות בחול סביב המגרפה, עלה נופל | משימה שנדחתה שוב, "לא נכנס", רצף שנשבר | "This one didn't fit. Here's what I can do." |
| `rest` | אדים משני הספלים, עלי פריחה | הפסקה אחרי 90 דקות, סוף היום, יום מנוחה | "You've studied for 90 minutes. Time for tea." |
| `joy` | זוהר וניצוצות באבן שביד | הלוגו, מסך הכניסה והפרידה, היכרות | "Hi, I'm Archi. What exams are we preparing for?" |

**הגדלים:**

| גודל | מה | תנועה |
| --- | --- | --- |
| `avatar` | ראש וכתפיים, חתוכים מהאיור ונמוגים בתחתית ובצדדים (mask), כך שאין קצה של ריבוע. ‏40px, אלא אם `className` נותן גודל | אין |
| `card` | האיור השקוף ברוחב המקום שלו ובפרופורציות שלו | שכבת המצב |
| `scene` | אותו דבר, ממורכז, ולא רחב מרוחב האיור בפיקסלים | שכבת המצב |

**כללי התנועה:**

- השכבה (`motionLayer.tsx`, ‏`emitters.ts`, ‏`archie.css`) ממוקמת ביחידות של האיור (`--archie-u`), ולכן היא נשארת מעוגנת לחפצים (העציץ, הספל, הקטורת, המגרפה, האבן) בכל גודל. חלקיקים נמוגים לפני קצה התיבה, ושום דבר לא נחתך במלבן.
- היא רצה רק כשהדמות במסך או 80px ממנו (`IntersectionObserver`). בלשונית מוסתרת לא נולדים חלקיקים, ויש תקרה של 60.
- עם `prefers-reduced-motion` היא לא רצה בכלל, וההעדפה נקראת חיה.
- השכבה `aria-hidden`. רק האיור נושא שם.
- אנימציות חדשות (נשימה ומצמוץ, נפנוף, חגיגה) שייכות ל-S41. העוגן הקבוע בתחתית והתפריט שייכים ל-S40.

**כמה Archi:** בכל רגע פעם אחת לכל היותר. הודעה שלו נסגרת לבד או בהחלקה, ולא חוסמת פעולה. בלי צלילים כברירת מחדל.

**הנכסים:** ‏`web/src/assets/archie/<mood>-450.webp` והקובץ הרחב `<mood>-900.webp` (שקופים, ‏`cwebp -q 82`; הרוחב האמיתי של כל קובץ ב-`moods.ts`, יחד עם ריבוע החיתוך של ה-`avatar`, ‏`bust`). המקור השקוף ברזולוציה מלאה, שגם ההדמיה משתמשת בו: `docs/design/prototype/archie/cut/<mood>.png`. הרקע הוסר בהשוואה בין שלוש גרסאות השמיים של כל איור (מה שלא משתנה ביניהן הוא הדמות), עם מסכת AI ל-`eureka` ול-`flow`. מה שהוסר מהאיורים: השמיים, ההילה המצוירת של `eureka`, ענפי הדובדבן של `rest`, והענף, הסלעים והגבעות של `flow`. פגמים ידועים עד שיגיעו הקבצים הסופיים: קצוות השיער מעט רכים ב-`flow`, ידית הקומקום ב-`rest` צוירה מחדש כקו נקי, וב-`avatar` של `flow` נשארת רצועה דהויה של גלימה.

## 8. תנועה

התנועה עונה לפעולה ומראה מה השתנה. החגיגות של הגיימיפיקציה הן תוספת, לא קישוט שרץ לבד.

| token | ערך | למה |
| --- | --- | --- |
| `--duration-fast` | 120ms | צבע או שקיפות שעונים ל-hover או ללחיצה |
| `--duration-base` | 160ms | ברירת המחדל של כל `transition-*`: שינוי של גודל או מקום |
| `--duration-slow` | 240ms | כניסה ויציאה של toast, דיאלוג, תפריט, גיליון |
| `ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | העקומה היחידה, וגם ברירת המחדל |

- `transition-colors` מקבל לבד 160ms ואת העקומה. למשך אחר: `duration-(--duration-fast)`.
- מה שנכנס: שקיפות, ותזוזה של 8px לכל היותר. בלי bounce ובלי סיבוב.
- סימון "בוצע" משתנה מיד. רק הצבע של התיבה עובר ב-120ms.
- **חגיגות (S32–S33):** חגיגה רגילה ("+XP" שעף לטבעת, טבעת היום, היום הושלם) נגמרת תוך **600ms**. חגיגה של רמה או שלב בגן היא גיליון שנסגר בלחיצה, והתנועה בו נגמרת תוך שנייה וחצי. אף אנימציה לא חוסמת פעולה. ביטול סימון מחזיר את המספרים בשקט, בלי אנימציה הפוכה.
- **לכל מה שעף או מהבהב יש טקסט ב-live region** ("בוצע. 30 XP. רמה 4").
- **`prefers-reduced-motion`:** כלל גלובלי ב-`index.css` מקצר כל מעבר ואנימציה ל-0.01ms (ולא 0, כדי ש-`transitionend` ו-`animationend` עדיין יגיעו), עם חזרה אחת ובלי גלילה חלקה. רכיב לא עוקף אותו. במצב הזה מוצגים מצב הסיום וההודעה, בלי תנועה. ארצ׳י עוצר גם בעצמו (סעיף 7).
- `shadow-lift` ו"תפוס" בזמן גרירה שייכים ל-S32.

## 9. נגישות

היעד: WCAG 2.2 AA.

- **ניגודיות:** רק הזוגות של 2.5 ו-2.6. טקסט 4.5:1, חלקי פקדים 3:1. זוג חדש נכנס קודם ל-`theme.test.ts`.
- **יעד מגע:** 44px לפחות (`min-h-touch`, ‏`size-touch`), גם כשהציור קטן יותר (תיבה של 22px באזור של 44px).
- **פוקוס:** תמיד גלוי, רק למקלדת: `ring-2 ring-brand` עם רווח של 2px. על ה-toast: `ring-inverse-action` עם רווח בצבע `inverse`. שדה: הגבול נהיה `brand` והטבעת בלי רווח. פריט תפריט ויעד בסרגל התחתון: `ring-inset`. אף פעם `outline-none` בלי טבעת במקומו.
- **לכל מחווה יש כפתור גלוי.** גרירה והחלקה ביומן הן קיצור. לכל בלוק תפריט פעולות למקלדת ולקורא מסך, ו"הזז" כחלופה לגרירה.
- **שם נגיש:** כפתור שחוזר ברשימה מקבל את שם הפריט ("בוצע: תרגול תוחלת ושונות"). צ'יפ ההתקדמות אומר הכול בשם אחד.
- **מבנה:** `h1` אחד בכל מסך, ‏`h2` לכל קטע, ‏`nav` עם `aria-label`, ‏`aria-current="page"` ליעד הנוכחי, `banner` אחד.
- **מצב לא בצבע בלבד:** מילים בתג, ✓ בסימון ובבחירה, אייקון ב-toast וב-`ErrorState`, משקל ביעד הנוכחי, קו חוצה במשימה שבוצעה.
- **תנועה:** סעיף 8. ‏`prefers-reduced-motion` עוצר הכול.
- **הגדלת טקסט:** כל הגדלים ב-`rem`. מסך עובד ב-200% בלי גלילה אופקית.
- **כיוון:** הממשק LTR, ועדיין רק logical properties (`ms-`, ‏`me-`, ‏`ps-`, ‏`pe-`, ‏`start-`, ‏`end-`, ‏`text-start`, ‏`border-s-`). לא `ml-`, ‏`mr-`, ‏`left-`, ‏`right-`. 
- **טקסט:** כולו ב-`en.ts`, בקול של Archi (של דף הרכיבים ב-`dev/devText.ts` ו-`dev/archieText.ts`). בלי `alert` ו-`confirm`.

## 10. כן / לא

| כן | לא |
| --- | --- |
| כפתור ראשי אחד במסך או בכרטיס | שני כפתורים ירוקים זה ליד זה |
| `text-brand-strong` לטקסט ירוק | `text-brand` |
| `bg-brand` לכפתור הראשי ולמתג פועל | ירוק לכפתור "שמירה" משני, או לצבע של מבחן |
| `examColor(block.exam_color_index).soft` | `` `bg-exam-${n}-soft` `` |
| `text-ink` לשם ולשעה בתוך בלוק | `text-ink-muted` או `text-exam-N` לטקסט בבלוק |
| רשימת שורות על `surface` | `ListRow` ישר על `canvas` של העמוד |
| `border border-line` לכרטיס | `shadow-lg` לכרטיס |
| `rounded-control` לשדה, `rounded-button` לכפתור, ‏`rounded-card`, ‏`rounded-t-sheet` | `rounded-2xl`, ‏`rounded-3xl` |
| `bg-field` לשדה ולכרטיס בחירה | `bg-white` או `bg-surface` לשדה |
| `font-display font-bold` מ-24px ומעלה | Amatic SC בטקסט רץ, בתווית או בגודל קטן |
| `rounded-full` לתג, לצ'יפ ולעיגול | כפתור בצורת גלולה |
| `text-ink-muted` לשעה ולמשך | אפור בהיר יותר "כי זה משני" |
| תג "עבר הזמן" ב-`warning` | אדום למשימה שלא בוצעה |
| רצף שנשבר כהזמנה, עם ארצ׳י ב-`flow` | שפה של כישלון |
| `font-medium` לתווית, `font-semibold` לשם | `font-bold` לשם משימה |
| `StreakLeafIcon` לרצף, ואייקון מ-`ui/icons` בכל מקום | אימוג'י או תו במקום אייקון |
| `"הסתברות, תרגול. שעה"` | `"הסתברות · תרגול · שעה"` |
| `<CalendarDays aria-hidden="true" size={22} strokeWidth={ICON_STROKE} />` ליד תווית | אייקון לבד בלי `aria-label` |
| `min-h-touch` לכל מה שלוחצים עליו | קישור של 20px בגובה בתוך רשימה |
| `transition-colors`; חגיגה של 600ms | `duration-1000`, ‏`animate-bounce`, כניסה מונפשת לכל קטע |
| `<Archie mood="flow" />` כשמשהו לא נכנס | ארצ׳י בכל מסך, או שתי הודעות שלו ברצף |
| `Button variant="inverse"` בתוך ה-toast | `variant="quiet"` על הכהה |
| `ms-2`, ‏`pe-4`, ‏`text-start` | `ml-2`, ‏`pr-4`, ‏`text-left` |
| tokens בלבד | `text-slate-600`, ‏`#3b2a1e` בתוך רכיב |

## 11. מה S32–S34 בונים

S31 בנה את השפה, את הצבע לכל מבחן, את השלד, את המראה של רכיבי `ui/` ואת רכיב `Archie`. המסכים עצמם עוד לא עוצבו מחדש: הם מקבלים מראה חדש רק דרך ה-tokens והרכיבים.

**S32, מסך היומן:**

- מחליף את כל `web/src/calendar/CalendarPage.tsx` במסך "יומן": שבוע במחשב, יום בטלפון, קו "עכשיו" (`now`, השעה ב-`now-text`), גלילה אוטומטית ל"עכשיו", בלוק בצבע המבחן (2.8), סימון בתוך הבלוק, גרירה בקפיצות של 15 דקות עם `shadow-lift`, החלקה בטלפון, תפריט פעולות לכל בלוק, סרגל צד (300px באב-הטיפוס) וגיליון "המשימות של היום".
- ממלא את `ShellToolbar` בפקדי התאריך, ופותח ל-`main` של היומן רוחב מלא.
- מצייר זמן תפוס (2.9) עם הקווים האלכסוניים, ואת הממשק של הזמינות (מסמך הזמינות, סעיף 7).
- ארצ׳י: `intentions` בפס סקירת הבוקר, `flow` בדוח "לא נכנס", `rest` בהודעת ההפסקה, ו"בוצע" בסיסי בבלוק (מסמך ארצ׳י, 4.1).
- מעביר את `BuildingStep` של האונבורדינג (`navigate('/today')`) ל-`CALENDAR_PATH`, אם S34 לא עשה את זה קודם.

**S33, גיימיפיקציה:** מחליף את `ProgressChip` בגיימיפיקציה המלאה ואת מסך ההתקדמות: "+XP" שעף לטבעת, היום שהושלם, הרצף כשורת עלים, הגן לפי רמה ותגים כאבנים (מסמך ארצ׳י, 4.1–4.7), עם placeholders עד שיגיעו האיורים. משתמש ב-`font-display` לכותרות הגדולות של ארצ׳י (סעיף 3). ההחלטה על "עלה כל 100 XP" מחכה לאייל.

**S34, שאר המסכים:** כניסה, אונבורדינג, מבחנים ומסך מבחן, הגדרות, מחיקת חשבון, פרידה ו-404, בשפה הזו. ארצ׳י `joy` בכניסה ובפרידה, `intentions` בסוף האונבורדינג. שלב הלו"ז הקבוע באונבורדינג וקטע "לו"ז קבוע" בהגדרות (מסמך הזמינות). האונבורדינג עדיין נגמר תוך 5 דקות.

**S29, ליטוש:** גיוון בטקסטים של ארצ׳י (קובץ אחד, כמה ניסוחים לכל רגע; היום יש רק `en.archie.alt`), קורא מסך על כל הרגעים, axe לכל מסך ולדף הרכיבים, הגדלה ל-200%, ומעבר על הניסוחים. גם מה שנשאר ברכיבים מ-S27 ו-S28 (לא נבדק מחדש ב-S31): `ref` ל-`Card`, ‏`ListRow`, ‏`Button` ו-`IconButton`; שם נגיש ו-`id` ל-`ListRow`; ‏`footer` של `Dialog` מתוך תוכן עם state; ‏`aria-labelledby` ל-`List`; ‏`meter` במקום `progressbar`; מחלקה לאייקון ב-`MenuItem`; ‏`CompactSelect` מתאחד עם `Select`; הכותרת של `Dialog` היא `h3`; היישור של `TimeField`; והציר של מסך המבחן בלי פוקוס מקלדת.

**פתוח, ומחכה למי שבונה:**

- **`ListRow` על `canvas` לא נראה.** האריח הוא `bg-canvas`, ועל העמוד עצמו הוא נבלע. S34 שם רשימות על `surface` (כרטיס או סרגל), או מוסיף קו. אותו דבר ל-`LoadingState shape="list"`.
- **`BuildingStep` עדיין מנווט ל-`/today`** (`web/src/onboarding/BuildingStep.tsx`). זה עובד דרך ההפניה, אבל S32 או S34 מעבירים אותו ל-`CALENDAR_PATH`.
- **הכותרת בטלפון.** בשלד יש כותרת של 56px (לוגו, צ'יפ ופרופיל), כי ה-brief של S31 ביקש פרופיל בכותרת. בשתי ההדמיות אין כותרת כזו: כותרת המסך, והצ'יפ והאווטאר לידה, הם חלק מהמסך. S32 מאחד את כותרת השלד עם כותרת היומן (למשל דרך `ShellToolbar` או מקום דומה בטלפון), כדי שהשלד לא יתפוס 112px מתוך 844.
- **`CalendarPage` זמני.** S32 מחליף את הקובץ כולו. ‏`/today` ו-`/week` נשארים כהפניות.
- **שם האפליקציה הוא "Archi" (באנגלית, מ-S39) בממשק בלבד.** ‏`PRODUCT_NAME` מגיע ללשונית, ל-manifest, להתראות ולמסך הכניסה. שם ה-API, הריפו והמסמכים הטכניים עדיין StudyFlow.
- **כפתור הפרופיל** נשאר האות של המשתמש. בהדמיה במקומו מופיע ארצ׳י כ-placeholder, אבל התפריט הוא של המשתמש.
- **`text-exam-N` לא נבדק כטקסט:** על ה-soft שלו הוא 4.07–5.57, ולכן הוא רק `currentColor` (2.7). מי שרוצה טקסט בצבע המבחן מוסיף קודם זוג לבדיקה.
- **בלוק שבוצע או שעבר.** באב-הטיפוס הוא מתעמעם בשקיפות ובהורדת רוויה. שקיפות על טקסט אסורה כאן (2.7), ולכן S32 מוצא דרך שעומדת בזוגות של 2.5, או מוסיף זוג חדש לבדיקה קודם.
- **תווית השעה של קו "עכשיו".** באב-הטיפוס היא לבן על `now`, וזה לא זוג מותר. כאן השעה היא `now-text` על הרקע. גלולה לבנה על `now` דורשת זוג חדש בבדיקה.

**אם חסר רכיב או מצב:** מוסיפים אותו ב-`web/src/ui/` עם בדיקה (תפקיד, שם נגיש, מקלדת, פוקוס), מציגים אותו ב-`web/src/dev/ComponentsPage.tsx`, ומוסיפים שורה ל-5.8. צבע חדש נכנס כ-token ב-`index.css`, עם הערה, לרשימת `TOKENS`, ועם הזוגות שלו ב-`theme.test.ts`.
