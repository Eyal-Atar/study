# השפה העיצובית של StudyFlow

הכיוון: **נייר**. אייל בחר בו ב-17.11.2026 מתוך שלוש הדמיות ([`mockups/`](mockups/README.md), ההדמיה שנבחרה: [`mockups/a.png`](mockups/a.png)).

המסמך הזה הוא מקור האמת של S26–S29. הרכיבים עצמם נמצאים ב-`web/src/ui/` (סעיף 5.8), ואפשר לראות את כולם בכל מצב ב-`/dev/components` (רק ב-`npm run dev`). הערכים עצמם נמצאים ב-`web/src/index.css`, ו-`web/src/theme.test.ts` בודק שהם קיימים ושכל זוג צבעים שמותר כאן עומד בניגודיות. מי שמשנה ערך משנה אותו שם, ומי שמוסיף זוג צבעים מוסיף אותו קודם לבדיקה.

## 1. העקרונות

1. **שקט כמו דף ביומן.** רקע לבן חם, טקסט כהה, קווים דקים. המסך לא מתחרה בתוכן.
2. **דבר אחד בולט בכל מסך.** הפעולה הראשית בכחול מלא, פעם אחת. כל השאר בקו או בטקסט.
3. **קו ולא צל.** כרטיס מוגדר בקו דק. צל שמור למה שצף מעל העמוד (תפריט, toast, דיאלוג).
4. **צבע הוא מידע.** כחול = פעולה או "אתה כאן". ירוק, כתום ואדום = מצב בלבד. אף פעם לא קישוט.
5. **רשימה לפני כרטיסים.** פריטים מאותו סוג הם שורות עם קו הפרדה, לא ערימה של קופסאות.
6. **טלפון קודם.** כל מסך מתוכנן ל-390px, ומתרחב למחשב. לא להפך.
7. **שני משקלים, חמישה גדלים.** היררכיה נבנית מגודל, ממשקל ומצבע הטקסט, לא מעוד גופן או עוד צבע.

## 2. צבע

כל הצבעים הם מחלקות Tailwind לפי השם: `bg-surface`, ‏`text-ink-muted`, ‏`border-line`. אסור להשתמש בצבע מהלוח של Tailwind (`slate-600`, ‏`blue-500`) או בערך hex בתוך רכיב.

| Token | ערך | משתמשים בו ל | לא משתמשים בו ל |
| --- | --- | --- | --- |
| `canvas` | `#faf9f6` | הרקע של העמוד (`body`) בלבד | רקע של כרטיס או של שדה |
| `surface` | `#ffffff` | כרטיס, שדה, תפריט, דיאלוג, סרגל הניווט | רקע העמוד |
| `surface-muted` | `#f2f0eb` | מילוי שקט בתוך משטח: תג ניטרלי, הערה, שורה ב-hover, פריט תפריט בפוקוס | כרטיס שלם, רקע העמוד |
| `ink` | `#1c2024` | כותרות וטקסט ראשי | — |
| `ink-muted` | `#5a6068` | טקסט משני: תאריך, משך, תיאור, placeholder, קישור ניווט לא פעיל | טקסט שחייבים לקרוא כדי לפעול |
| `line` | `#e4e1da` | קו הפרדה, קצה של כרטיס, המסילה של פס התקדמות | גבול של שדה או של כפתור (ניגודיות נמוכה מדי) |
| `line-strong` | `#8a8880` | גבול של פקד: שדה, כפתור משני, כרטיס בחירה, תיבת סימון ריקה | קו הפרדה (כבד מדי) |
| `brand` | `#2f5aa8` | הכפתור הראשי, הקישור הפעיל בניווט, טבעת הפוקוס, קישור בטקסט | רקע של אזור גדול, כותרות |
| `brand-strong` | `#1f3f7d` | hover ולחיצה על כפתור ראשי; טקסט על `brand-soft` | — |
| `brand-soft` | `#eaf0fa` | תג "עכשיו", hover של כפתור שקט, פריט נבחר | רקע של כרטיס שלם (ראו 5.1); מילוי שנושא מידע בלי טקסט (עמודה בגרף), כי הוא כמעט לא נראה על לבן |
| `on-brand` | `#ffffff` | טקסט ואייקון על `brand`, ‏`brand-strong`, ‏`success` ו-`danger` | — |
| `success` / `success-soft` | `#1d6b3a` / `#e6f4ea` | בוצע: סימון מלא, המילוי של פס ההתקדמות, תג "בוצע" | כפתור ראשי, "חיובי" באופן כללי |
| `warning` / `warning-soft` | `#8a4b0f` / `#fbf1e0` | משהו שדורש תשומת לב ולא נכשל: "עבר הזמן", הדוח "לא נכנס" | — |
| `danger` / `danger-soft` | `#b3261e` / `#fcebe9` | שגיאה, ופעולה שאי אפשר לבטל | רצף שנשבר, יום שהוחמץ (אלה `ink-muted`; ראו 7.9 במסמך התכנון: "בלי אדום") |

### זוגות מותרים

טקסט רגיל צריך 4.5:1. כל זוג בטבלה נבדק ב-`theme.test.ts`.

| טקסט | על הרקעים |
| --- | --- |
| `ink` | `canvas`, ‏`surface`, ‏`surface-muted`, ‏`brand-soft`, ‏`success-soft`, ‏`warning-soft`, ‏`danger-soft` |
| `ink-muted` | `canvas`, ‏`surface`, ‏`surface-muted`, ‏`brand-soft` |
| `brand`, ‏`brand-strong` | `canvas`, ‏`surface`, ‏`surface-muted`; ‏`brand-strong` גם על `brand-soft` |
| `success`, ‏`warning`, ‏`danger` | `canvas`, ‏`surface`, ‏`surface-muted`, והגרסה הרכה של עצמו |
| `on-brand` | `brand`, ‏`brand-strong`, ‏`success`, ‏`danger` |

**זוגות שאסורים** (לא נבדקים, ולכן לא משתמשים): `ink-muted` על `success-soft`, ‏`warning-soft` או `danger-soft`; ‏`brand` על `brand-soft` כטקסט (משתמשים ב-`brand-strong`); ‏`on-brand` על `warning`; צבע מצב אחד על הגרסה הרכה של צבע מצב אחר.

חלקים של פקדים (גבול, טבעת פוקוס, מילוי של מד) צריכים 3:1 (WCAG 1.4.11): ‏`line-strong` ו-`brand` על שלושת הרקעים, ‏`brand` על `brand-soft`, ו-`success` על `line`.

**הרקע שמאחורי דיאלוג** הוא `bg-ink/40`: ‏`ink` בשקיפות 40%. זה המקום היחיד שבו מותר צבע עם שקיפות.

**מצב לא מועבר רק בצבע.** לכל תג מצב יש טקסט ("בוצע", "עבר הזמן"), ולסימון יש אייקון ✓.

## 3. טיפוגרפיה

**הפונט:** Assistant (רישיון OFL), מאוחסן אצלנו ב-`web/src/assets/fonts/` כשני קובצי variable: עברית (6KB) ולטינית (20KB). הדפדפן מוריד כל קובץ רק אם יש בעמוד תווים מהטווח שלו, ו-`font-display: swap` מציג טקסט בפונט המערכת עד שהוא נטען. אין פונט שני, ואין נטייה (italic).

**משקלים:** שניים בלבד.

| משקל | מחלקה | למה |
| --- | --- | --- |
| 400 | `font-normal` | טקסט לקריאה, טקסט משני, משימה שבוצעה |
| 600 | `font-semibold` | כותרות, שם של משימה, כפתור, תג, מספר שרוצים שיראו, הקישור הפעיל בניווט |

`font-medium` ו-`font-bold` שנשארו ברכיבים מלפני S25 נותנים שניהם 600. בקוד חדש כותבים רק `font-normal` ו-`font-semibold`.

**גדלים:** חמישה. כל מחלקה קובעת גם את גובה השורה.

| מחלקה | גודל / גובה שורה | למה | משקל |
| --- | --- | --- | --- |
| `text-display` | 34px / 1.1 | כותרת העמוד (`h1`), אחת בכל מסך | 600 |
| `text-title` | 20px / 1.3 | הכותרת של הכרטיס הראשי (המשימה הבאה), כותרת של דיאלוג | 600 |
| `text-body` | 16px / 1.45 | ברירת המחדל: שם של פריט ברשימה (600), טקסט רגיל (400), שדה קלט | 400 / 600 |
| `text-small` | 14px / 1.4 | טקסט משני, כותרת של קטע (`h2`), כפתור, תג, תווית של שדה | 400 / 600 |
| `text-caption` | 12px / 1.35 | תווית בניווט התחתון בלבד | 400 / 600 |

- **שדה קלט תמיד ב-`text-body` (16px)**, אחרת iOS מגדיל את התצוגה בפוקוס.
- **כותרת של קטע** (`h2`, כמו "עוד היום") היא `text-small font-semibold text-ink-muted`. היא קטנה מהתוכן שמתחתיה בכוונה: היא תווית, לא כותרת.
- **מספרים ושעות:** `tabular-nums`, ושעה או טווח שעות בתוך `dir="ltr"`, כדי ש-`10:00–11:30` לא יתהפך.
- **אורך שורה:** טקסט רץ לא רחב מ-65 תווים (`max-w-prose`).
- **לא משתמשים** באותיות רישיות לתוויות, בקו תחתון לטקסט שאינו קישור, או בצבע כדי להדגיש מילה בתוך משפט.
- המחלקות הישנות (`text-xs` … `text-3xl`) עובדות עד ש-S26–S28 מחליפים אותן. בקוד חדש: רק החמש.

## 4. ריווח, פינות, צל

**ריווח:** הסולם של Tailwind (קפיצות של 4px). לארבעה ערכים יש שם, כי הם חוזרים בכל מסך:

| Token | ערך | מחלקה לדוגמה | למה |
| --- | --- | --- | --- |
| `touch` | 44px | `min-h-touch`, ‏`size-touch` | הגודל הקטן ביותר של כל דבר שלוחצים עליו |
| `gutter` | 20px | `px-gutter` | השוליים של העמוד בטלפון |
| `card` | 16px | `p-card` | הריפוד בתוך כרטיס |
| `section` | 24px | `space-y-section`, ‏`mt-section` | הרווח בין שני קטעים במסך |

בתוך קטע: 8px בין פקדים סמוכים (`gap-2`), ‏4px בין שורת כותרת לשורת המשנה שלה (`gap-1`), ‏12–16px בין קבוצות. שורה ברשימה גבוהה לפחות 64px.

**פינות:**

| Token | ערך | מחלקה | למה |
| --- | --- | --- | --- |
| `badge` | 4px | `rounded-badge` | תג מצב |
| `control` | 8px | `rounded-control` | כפתור, שדה, כרטיס בחירה, פריט תפריט, הערה |
| `card` | 12px | `rounded-card` | כרטיס, דיאלוג, תפריט, toast |
| — | מלא | `rounded-full` | רק לעיגול אמיתי: תיבת הסימון של משימה, תמונת הפרופיל, מתג, פס התקדמות |

אין פינות גדולות מ-12px, ואין כפתור בצורת גלולה.

**צל:** אחד, `shadow-overlay`, ורק למה שצף מעל העמוד: תפריט, popover, ‏toast, דיאלוג. לכרטיס, לכפתור ולסרגל הניווט אין צל.

## 5. רכיבים

### 5.1 כרטיס

- `rounded-card border border-line bg-surface p-card`. בלי צל.
- כרטיס הוא למשהו **אחד שעומד בפני עצמו**: המשימה הבאה, טופס, הדוח "לא נכנס". לא לכל פריט ברשימה.
- **המשימה הבאה** היא כרטיס לבן רגיל. מה שמבליט אותו הוא התווית "המשימה הבאה" ב-`brand-strong`, כותרת ב-`text-title` והכפתור הראשי, לא רקע צבעוני.
- כרטיס בתוך כרטיס: אסור. בתוך כרטיס מפרידים בקו (`border-t border-line`) או במילוי `surface-muted` עם `rounded-control`.
- כרטיס של מצב (שגיאה, אזהרה): הגבול בצבע המצב והרקע בגרסה הרכה שלו, עם טקסט ב-`ink` וכותרת בצבע המצב.

### 5.2 רשימה

- פריטים מאותו סוג (בלוקים, מבחנים, משימות) הם שורות, עם `border-b border-line` בין שורה לשורה, על רקע העמוד, בלי קופסה סביב כל אחת.
- מבנה של שורת בלוק, מימין לשמאל: שעת ההתחלה (עמודה קבועה, `tabular-nums`, ‏600), שם המשימה (600) ומתחתיו שורת משנה (`text-small text-ink-muted`: המבחן, הסוג, המשך), ובקצה כפתור הסימון.
- **כפתור הסימון:** אזור לחיצה של 44px, ובתוכו עיגול של 24px עם גבול `line-strong`. כשבוצע: מילוי `success` ו-✓ ב-`on-brand`.
- **משימה שבוצעה:** השם ב-`ink-muted`, משקל 400, עם קו חוצה. השורה נשארת במקומה.
- פעולות נוספות על שורה (דחייה, נעילה) נמצאות בתפריט, לא בשורה של כפתורים.
- פרטים בשורת המשנה מופרדים בפסיק ובנקודה ("הסתברות, תרגול. שעה"), לא בנקודה אמצעית (·).

### 5.3 כפתור

כל כפתור: `min-h-touch rounded-control px-4 text-small font-semibold`, עם טבעת פוקוס.

| סוג | מראה | מתי |
| --- | --- | --- |
| ראשי | `bg-brand text-on-brand`; ‏hover ולחיצה: `bg-brand-strong` | הפעולה האחת שהמסך קיים בשבילה. **אחד לכל היותר במסך או בכרטיס** |
| משני | `border border-line-strong bg-surface text-ink`; ‏hover: `bg-surface-muted` | כל פעולה אחרת שיש לה כפתור |
| שקט | `text-brand`, בלי גבול; ‏hover: `bg-brand-soft` | פעולה בתוך טקסט או בתוך toast ("בטל", "נסו שוב") |
| מסוכן | כמו משני, עם `text-danger`; ‏hover: `bg-danger-soft` | פעולה שאי אפשר לבטל. אף פעם לא במילוי אדום |

- הכפתור הראשי ראשון בסדר הקריאה (בצד ימין), ובשורה של כמה כפתורים הוא מתרחב (`flex-1`).
- אייקון בכפתור: 18px, לפני הטקסט, `aria-hidden`. כפתור של אייקון בלבד: `size-touch` ו-`aria-label`.
- **כפתור כבוי** (`isDisabled`): `bg-surface-muted text-ink-muted border-line`, בלי שקיפות, בכל הסוגים (בסוג השקט בלי מילוי). כך הטקסט נשאר קריא גם על רקע רך. ‏`opacity-50` אסור: הוא נבדק ב-S25 ונמצא חלש מדי.
- **כפתור בטעינה** (`isPending`): הטקסט נשאר, לפניו מחוון מסתובב, והכפתור לא מגיב ללחיצה. משתמשים בו בכל כפתור ששולח בקשה, במקום לכבות אותו.
- הטקסט אומר מה יקרה ("שמירה", "הוספת מבחן"), ונשאר זהה לאורך כל הזרימה.

### 5.4 שדה

- `min-h-touch rounded-control border border-line-strong bg-surface px-3 text-body`.
- בפוקוס: `border-brand` וטבעת `ring-2 ring-brand`. בשגיאה: `border-danger`, והודעה ב-`text-small text-danger` מתחת לשדה.
- התווית תמיד מעל השדה, גלויה, ב-`text-small font-semibold`. ‏placeholder אינו תווית.
- שדה כבוי: `bg-surface-muted text-ink-muted border-line`, בלי שקיפות, כמו כפתור כבוי.
- תווית של קבוצת כרטיסי בחירה היא תווית של שדה, באותו סגנון.

### 5.5 תג

- `rounded-badge px-2 text-small font-semibold`, עם הרקע הרך וצבע הטקסט של המצב: "עכשיו" ב-`brand-soft` ו-`brand-strong`, ‏"בוצע" ב-`success-soft` ו-`success`, ‏"עבר הזמן" ב-`warning-soft` ו-`warning`, ‏"הוחמץ" ו"דולג" ב-`surface-muted` ו-`ink-muted`.
- תג הוא למצב. מידע שאינו מצב (שם המבחן, "נעול") הוא טקסט בשורת המשנה, ו"נעול" מקבל אייקון מנעול קטן.

### 5.6 פס התקדמות

- מסילה בגובה 4px ב-`bg-line`, מילוי ב-`bg-success`, שניהם `rounded-full`.
- מעליו שורה אחת: התווית ב-`text-small text-ink-muted`, והערך ("60 מתוך 345 דקות") ב-`text-small font-semibold tabular-nums`.

### 5.7 אייקונים

- **הספרייה:** `lucide-react` (רישיון ISC). אין ספרייה נוספת, ואין SVG שמצויר ביד בתוך רכיב.
- מייבאים כל אייקון בשמו (`import { Sun } from 'lucide-react'`), כדי שרק מה שבשימוש ייכנס ל-bundle.
- **גודל:** 22px בניווט, 18px בתוך כפתור או ליד טקסט, 14px בתוך שורת משנה.
- **עובי הקו:** `strokeWidth={1.75}` תמיד. הצבע הוא `currentColor`, כלומר הצבע של הטקסט שלידו.
- אייקון שיש לידו טקסט: `aria-hidden="true"`. אייקון לבד: רק בתוך כפתור עם `aria-label`.
- האייקונים של הניווט: היום `Sun`, שבוע `CalendarDays`, מבחנים `FileText`, התקדמות `TrendingUp`. סימון `Check`, נעילה `Lock`, פרופיל `User` או האות הראשונה של השם.
- אייקון עם כיוון (חץ "הבא", "הקודם") מתהפך ב-RTL: משתמשים ב-`rtl:-scale-x-100` או בוחרים את האייקון לפי הכיוון.

### 5.8 רכיבי הבסיס (`web/src/ui/`)

כל מסך מורכב מהרכיבים האלה. מסך לא כותב `<button>`, ‏`<input>`, ‏`<select>` או תג משלו, ולא מעתיק מחלקות של רכיב: אם חסר מצב, מוסיפים אותו לרכיב. כל הרכיבים בנויים על React Aria Components, שנותן את התפקיד, המקלדת, ניהול הפוקוס וה-RTL, ושם על האלמנט `data-hovered`, ‏`data-pressed`, ‏`data-focus-visible` ו-`data-disabled`; הסגנון נשען רק עליהם.

`ui/styles.ts` מחזיק את מה שמשותף: `cx(...)` לחיבור מחלקות, `FOCUS_RING` (לרכיב של React Aria), ‏`FOCUS_RING_NATIVE` (לאלמנט רגיל, כמו קישור של הראוטר) ו-`ICON_STROKE` (1.75).

| רכיב | מתי משתמשים בו | מתי לא |
| --- | --- | --- |
| `Button` | כל פעולה שיש לה טקסט. `primary` פעם אחת במסך או בכרטיס | ניווט למסך אחר (זה `TextLink` או שורה עם `to`) |
| `IconButton` | פעולה שהאייקון שלה מובן לבד: סגירה, פתיחת תפריט, לוח שנה | פעולה ראשית; פעולה שצריך לקרוא כדי להבין |
| `Menu`, ‏`MenuItem` | פעולות נוספות על שורה או על הפרופיל (שתיים ומעלה) | פעולה אחת (כפתור); בחירת ערך (`Select`) |
| `TextField` | שורת טקסט אחת | בחירה מתוך רשימה סגורה |
| `Select` | בחירה אחת מרשימה של יותר מחמש אפשרויות, או רשימה שהאורך שלה לא ידוע (נושאים) | עד חמש אפשרויות קצרות: `RadioCards`, שנבחרות בלחיצה אחת |
| `DatePicker` | תאריך | שעה (אין עדיין רכיב; שעות ההגדרות הן `RadioCards` או `Select`) |
| `RadioCards` | בחירה אחת מתוך 2–5 אפשרויות שכדאי לראות את כולן | רשימה ארוכה |
| `CheckboxCards` | כמה בחירות מתוך קבוצה קטנה (חלונות לימוד) | הסכמה בודדת |
| `Card` | דבר אחד שעומד בפני עצמו (5.1). ‏`tone` למצב: שגיאה, אזהרה, הצלחה | פריט ברשימה; כרטיס בתוך כרטיס |
| `List`, ‏`ListRow` | פריטים מאותו סוג (5.2). ‏`to` הופך את השורה לקישור | טבלה של נתונים |
| `Badge` | מצב של פריט, עם טקסט (5.5) | מידע שאינו מצב; ספירה |
| `ProgressBar` | התקדמות עם ערך ידוע (5.6) | טעינה בלי אחוז (זה `LoadingState`, או `isPending` של כפתור) |
| `TextLink` | קישור בתוך טקסט או קישור משני שעומד לבד ("לדף הבית") | פעולה (זה כפתור) |
| `Disclosure` | פרט משני שרוב המשתמשים לא צריכים (הנימוק של משימה) | תוכן שחייבים לקרוא |
| `Dialog` | שאלה או טופס קצר שעוצרים בשבילו את המסך. בטלפון הוא נפתח מלמטה | הודעה (toast); אישור של מחיקה (הכלל הוא "בטל" ל-10 שניות, לא "בטוח?") |
| `useToast()` | תוצאה של פעולה: נשמר, נכשל, "בטל" | שגיאה של שדה (מתחת לשדה); תוכן שלא נטען (`ErrorState`) |
| `LoadingState` | מסך או קטע שמחכה לנתונים. ‏`shape` לפי מה שיגיע: `list`, ‏`card`, ‏`text` | פעולה שנשלחה (`isPending` על הכפתור) |
| `EmptyState` | רשימה או מסך שעוד אין בהם כלום: אייקון, משפט, פעולה | שגיאה |
| `ErrorState` | תוכן שלא נטען: משפט, "לנסות שוב" | פעולה שנכשלה (toast) |
| `PageHeader` | הכותרת של כל מסך: ה-`h1` היחיד, תת-כותרת ופעולה. קובע גם את שם הלשונית | כותרת של קטע (`h2`) |
| `StandalonePage` | מסך שמחוץ לשלד (כניסה, 404, פרידה): אותו רוחב ואותם שוליים | מסך בתוך השלד (ה-`main` של `AppShell` כבר נותן אותם) |

**דוגמאות.** הטקסטים בדוגמאות כתובים ישר בקוד כדי לקצר; במוצר כל טקסט בא מ-`he.ts`.

```tsx
// כותרת מסך, עם הפעולה הראשית של המסך
<PageHeader title="מבחנים" subtitle="3 מבחנים קרובים" action={<Button onPress={add}>הוספת מבחן</Button>} />

// כפתורים: הראשי ראשון ומתרחב; שמירה שנשלחת
<div className="flex gap-2">
  <Button className="flex-1" isPending={save.isPending} onPress={submit}>שמירה</Button>
  <Button variant="secondary" onPress={cancel}>ביטול</Button>
</div>
<Button variant="danger" isDisabled={!confirmed}>מחיקת החשבון לצמיתות</Button>

// כפתור של אייקון בלבד: השם הנגיש חובה, והאייקון 18px
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
<RadioCards label="קושי" options={LEVELS} value={level} onChange={setLevel} />
<CheckboxCards label="מתי נוח ללמוד" options={WINDOWS} value={windows} onChange={setWindows} />

// כרטיס אחד, ורשימה של שורות
<Card>
  <p className="text-small font-semibold text-brand-strong">המשימה הבאה</p>
  <h2 className="text-title font-semibold">תרגול תוחלת ושונות</h2>
</Card>
<Card tone="warning" role="status">…</Card>

<List aria-label="עוד היום">
  <ListRow
    leading={<span dir="ltr">10:00</span>}
    title="תרגול תוחלת ושונות"
    subtitle="הסתברות, תרגול. שעה"
    trailing={<Badge tone="brand">עכשיו</Badge>}
  />
  <ListRow title="אלגוריתמים" subtitle="בעוד 12 ימים" to="/exams/e1" />
  <ListRow title="קריאת פרק 3" done />
</List>

// תג ופס התקדמות
<Badge tone="warning">עבר הזמן</Badge>
<ProgressBar label="היום" value={60} max={345} valueText="60 מתוך 345 דקות" />

// קישור, ופרט מתקפל
<TextLink to="/">לדף הבית</TextLink>
<Disclosure label="למה המשימה הזו?">הנושא הופיע בשלושה מבחני עבר.</Disclosure>

// שלושת המצבים של מסך
if (query.isPending) return <LoadingState shape="list" rows={4} />
if (query.isError) return <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
if (query.data.length === 0) return <EmptyState icon={FileText} title="עוד אין מבחנים" action={<Button onPress={add}>הוספת מבחן</Button>} />

// דיאלוג: sheet בטלפון, חלון במחשב
<Dialog title="תכנון מחדש" description="נזיז 4 בלוקים." isOpen={open} onOpenChange={setOpen}
  footer={<><Button className="flex-1" onPress={confirm}>אישור</Button><Button variant="secondary" onPress={() => setOpen(false)}>לא עכשיו</Button></>}>
  …
</Dialog>

// toast
const toast = useToast()
toast.show({ text: 'ההגדרות נשמרו', tone: 'success' })
toast.show({ text: 'המבחן נמחק', action: { label: 'בטל', onAction: undo } })
```

**כללים שחוזרים בכל הרכיבים:**

- כבוי הוא תמיד `surface-muted` עם `ink-muted`, אף פעם לא שקיפות.
- פוקוס של מקלדת הוא תמיד `ring-2 ring-brand`. לשדה אין רווח בין הגבול לטבעת (הגבול עצמו נהיה כחול); לכפתור יש רווח של 2px.
- מצב (שגיאה, הצלחה, נבחר) מועבר באייקון או בטקסט, ולא רק בצבע: ‏✓ ליד האפשרות שנבחרה ב-`Select`, אייקון ב-toast של שגיאה וב-`ErrorState`.
- מה שצף (`Menu`, הרשימה של `Select`, לוח השנה, `Dialog`, ‏toast) הוא `rounded-card border border-line bg-surface shadow-overlay`, ונכנס בשקיפות ב-240ms; הדיאלוג גם עולה 8px.
- טקסט ארוך בלי רווחים נשבר (`break-words` ו-`min-w-0`), ולא מרחיב את העמוד.

## 6. ניווט

**בטלפון (עד `md`, ‏768px):**

- סרגל תחתון קבוע עם ארבעה יעדים, בסדר הזה: היום, שבוע, מבחנים, התקדמות.
- `bg-surface` עם `border-t border-line`, בלי צל. ריפוד תחתון של `env(safe-area-inset-bottom)`.
- כל יעד: אייקון של 22px ומתחתיו תווית ב-`text-caption`, באזור לחיצה בגובה 52px לפחות.
- היעד הפעיל: `text-brand font-semibold` ו-`aria-current="page"`. השאר: `text-ink-muted`. בלי רקע, בלי קו ובלי נקודה.
- למעלה: שורה עם השם StudyFlow בצד אחד וכפתור הפרופיל (`size-touch`, עיגול של 32px עם האות הראשונה) בצד השני. הכפתור פותח תפריט עם "הגדרות" ו"יציאה".
- לתוכן יש ריפוד תחתון בגובה הסרגל, כדי שהשורה האחרונה לא תוסתר, וה-toast מופיע מעל הסרגל.
- באונבורדינג אין סרגל ואין תפריט פרופיל.

**במחשב (`md` ומעלה):**

- אותם ארבעה יעדים בשורה העליונה, ליד השם, כטקסט ב-`text-small` (עם האייקון לפניו, 18px). הפעיל: `text-brand font-semibold`.
- תפריט הפרופיל בקצה השורה.
- התוכן בעמודה אחת ממורכזת ברוחב `max-w-3xl`. לא מותחים רשימה לכל רוחב המסך.

הגדרות ויציאה אינן יעדים בניווט, בשני הרוחבים.

**איך זה בנוי (S26, ‏`web/src/app/AppShell.tsx`):**

- **`nav` אחד ב-DOM** לשני הרוחבים: מתחת ל-`md` הוא `fixed` בתחתית, ומ-`md` הוא `static` בשורה העליונה. כך קורא מסך פוגש ניווט אחד. הוא לפני `main` ב-DOM, ולכן סדר ה-Tab זהה בטלפון ובמחשב.
- **"דלג לתוכן"** הוא ה-Tab הראשון בכל מסך, ומעביר את הפוקוס ל-`main`.
- **פוקוס במעבר בין מסכים** (`useRouteFocus`): אחרי ניווט שהמשתמש יזם, הפוקוס עובר ל-`h1` של המסך החדש, וקורא מסך מקריא אותו. לא בטעינה הראשונה, לא בהפניה (`REPLACE`) ולא כשרק ה-`?query` השתנה. לכן **כל מסך צריך `h1` שמופיע מיד**, גם בזמן טעינה: הכותרת מחוץ לתנאי של הטעינה.
- **כפתור הפרופיל** מציג את האות הראשונה של השם מ-Google, אחרת של המייל, ואחרת אייקון `User`. השם הנגיש שלו "פרופיל".
- כשנמצאים ב"הגדרות" אף יעד בסרגל לא מסומן; הכותרת של המסך אומרת איפה נמצאים.
- **רוחב ושוליים:** `main` של השלד הוא `mx-auto max-w-3xl px-gutter py-section`. מסך לא מוסיף רוחב או שוליים משלו; מסך שמחוץ לשלד עוטף את עצמו ב-`StandalonePage`.
- **`index.html`** מבקש `viewport-fit=cover`, אחרת `env(safe-area-inset-bottom)` שווה 0 באייפון.

## 7. תנועה

התנועה עונה לפעולה של המשתמש ומראה מה השתנה. היא לא מקשטת.

| Token | ערך | למה |
| --- | --- | --- |
| `--duration-fast` | 120ms | צבע או שקיפות שעונים ל-hover או ללחיצה |
| `--duration-base` | 160ms | ברירת המחדל של כל `transition-*`: שינוי של גודל או מקום (מד, מתג) |
| `--duration-slow` | 240ms | כניסה ויציאה של toast, דיאלוג או תפריט |
| `ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | העקומה היחידה, וגם ברירת המחדל |

- מחלקה כמו `transition-colors` מקבלת לבד 160ms ואת העקומה. למשך אחר: `duration-(--duration-fast)`.
- מה שנכנס: שקיפות, ותזוזה של 8px לכל היותר. בלי קפיצה (bounce), בלי סיבוב, בלי הגדלה מעל 1.
- אין אנימציה בטעינת עמוד, ואין אנימציה שרצה בלולאה חוץ ממחוון טעינה.
- סימון "בוצע" משתנה מיד; רק הצבע של העיגול עובר ב-120ms.
- **`prefers-reduced-motion`:** כלל גלובלי ב-`index.css` מקצר כל מעבר ואנימציה לאפס. רכיב לא צריך לטפל בזה בעצמו, ואסור לו לעקוף את הכלל.

## 8. נגישות

היעד: WCAG 2.2 AA.

- **ניגודיות:** רק הזוגות שבסעיף 2. טקסט 4.5:1, חלקי פקדים 3:1.
- **יעד מגע:** 44px לפחות (`min-h-touch`, ‏`size-touch`), גם כשהציור עצמו קטן יותר (עיגול של 24px בתוך אזור של 44px).
- **פוקוס:** תמיד גלוי: `ring-2 ring-brand`, ועל רקע שאינו `surface` גם `ring-offset-2`. אף פעם `outline-none` בלי טבעת במקומו.
- **לכל פעולה יש כפתור גלוי.** מחווה (גרירה, החלקה) היא קיצור, לא הדרך היחידה.
- **שם נגיש:** כפתורים שחוזרים ברשימה מקבלים `aria-label` עם שם הפריט ("בוצע: תרגול תוחלת ושונות").
- **מבנה:** `h1` אחד בכל מסך, ‏`h2` לכל קטע, ‏`nav` עם `aria-label`, ‏`aria-current="page"` ליעד הפעיל.
- **הגדלת טקסט:** כל הגדלים ב-`rem`. מסך צריך לעבוד בהגדלה של 200% בלי גלילה אופקית.
- **RTL:** רק logical properties (`ms-`, ‏`me-`, ‏`ps-`, ‏`pe-`, ‏`start-`, ‏`end-`, ‏`text-start`). לא `ml-`, ‏`mr-`, ‏`left-`, ‏`right-`.
- **טקסט:** כולו ב-`he.ts`. בלי `alert` ו-`confirm`.

## 9. כן / לא

| כן | לא |
| --- | --- |
| כפתור ראשי אחד בכרטיס, והשאר משניים | שני כפתורים כחולים זה ליד זה |
| רשימת בלוקים כשורות עם קו הפרדה | כרטיס עם גבול לכל בלוק |
| `border border-line` לכרטיס | `shadow-lg` לכרטיס |
| `rounded-card`, ‏`rounded-control` | `rounded-2xl`, ‏`rounded-3xl`, כפתור בצורת גלולה |
| `text-ink-muted` לשעה ולמשך | אפור בהיר יותר "כי זה משני" |
| תג "עבר הזמן" ב-`warning` | אדום למשימה שלא בוצעה |
| ירוק רק ל"בוצע" ולפס ההתקדמות | כפתור "שמירה" ירוק |
| `bg-surface` לכרטיס על `canvas` | `bg-surface-muted` לכרטיס שלם |
| `text-small font-semibold text-ink-muted` לכותרת קטע | כותרת קטע גדולה ומודגשת מעל כל רשימה |
| `font-semibold` לשם המשימה | `font-bold`, ‏`font-medium`, או משקל שלישי |
| "הסתברות, תרגול. שעה" | "הסתברות · תרגול · שעה" |
| `<Sun aria-hidden="true" size={22} strokeWidth={1.75} />` ליד תווית | אייקון לבד בלי `aria-label`; אימוג'י במקום אייקון |
| `min-h-touch` לכל מה שלוחצים עליו | קישור טקסט של 20px בגובה בתוך רשימה |
| `transition-colors` (מקבל 160ms לבד) | `duration-500`, ‏`animate-bounce`, כניסה מונפשת לכל קטע |
| `ms-2`, ‏`pe-4`, ‏`text-start` | `ml-2`, ‏`pr-4`, ‏`text-left` |
| `text-ink-muted` בעמוד הכניסה | `text-slate-600` או כל צבע מהלוח של Tailwind |

## 10. מה נשאר ל-scopes הבאים

S26 בנה את השלד ואת הרכיבים (סעיפים 5.8 ו-6), והעביר ל-`ui/` את `Select` ואת `Disclosure` שהיו ב-`exam/`. המסכים עצמם עדיין כותבים חלק מהדברים ביד. הרשימה כאן היא מה ש-S27 ו-S28 מחליפים, לפי קובץ. שני ה-scopes רצים במקביל, ולכן כל אחד נוגע רק בתיקיות שלו.

**בכל מסך, בשני ה-scopes:**

| מה יש היום | במה מחליפים |
| --- | --- |
| `<h1 className="text-2xl font-bold">` | `<PageHeader title=… />`, מחוץ לתנאי של הטעינה |
| `<p role="status" className="text-ink-muted">{he.common.loading}</p>` | `<LoadingState shape=… />` |
| `<p role="alert" className="text-danger">` עם כפתור "לנסות שוב" לתוכן שלא נטען | `<ErrorState message=… onRetry=… />`. שגיאה של שדה או של טופס נשארת טקסט ב-`text-small text-danger` מתחת לשדה |
| רשימה ריקה עם משפט בלבד | `<EmptyState icon=… title=… action=… />` |
| `rounded-xl border … bg-surface p-4` | `<Card>` |
| `<ul>` של קופסאות, אחת לכל פריט | `<List>` ו-`<ListRow>` |
| `<span className="rounded-full px-2 … text-xs">` למצב | `<Badge tone=…>` |
| `<div className="h-2 … rounded-full">` עם מילוי | `<ProgressBar>` |
| `<Link className="… underline">` | `<TextLink>` |
| `isDisabled={mutation.isPending}` על כפתור ששולח | `isPending={mutation.isPending}` |
| `text-xs`…`text-3xl`, ‏`font-medium`, ‏`font-bold`, ‏`rounded-lg`/`xl`/`2xl`, ‏`min-h-11`, ‏`shadow-sm`/`lg` | ה-tokens של סעיפים 3 ו-4 |

**S27 (`today/`, ‏`week/`, ‏`progress/`, ‏`board/`, ‏`plan/`, ‏`pages/TodayPage.tsx`):**

- `plan/ReplanOffer.tsx`: בונה דיאלוג משלו (`ModalOverlay`). עובר ל-`ui/Dialog` (הכותרת, התיאור והכפתורים ב-`footer`).
- `board/BlockCard.tsx`: התפריט שלו (`MenuTrigger`) עובר ל-`ui/Menu` ו-`MenuItem`; התגים (`STATE_BADGE`, "נעול") ל-`Badge`, ו"נעול" לטקסט עם אייקון `Lock` (5.5); הכרטיס לכל בלוק הופך ל-`ListRow` (5.2).
- `board/MoveDialog.tsx` (מגיע עם S18): עובר ל-`ui/Dialog`.
- `week/WeekDay.tsx`: ‏`rounded-xl border` לכל יום ותג "היום" ב-`rounded-full bg-brand`: כותרת קטע ו-`List`, ותג `Badge tone="brand"`.
- `today/DayProgress.tsx`, ‏`progress/LevelCard.tsx`: פס שמצויר ביד עובר ל-`ProgressBar`. ב-`LevelCard` המילוי היום `bg-brand` על `bg-brand-soft`; לפי 5.6 הוא `success` על `line`.
- `board/PlanReport.tsx`: ‏`<p role="status">` ו-`<p role="alert">` בלי סגנון; הדוח כולו הוא `Card tone="warning"`.
- `progress/BadgeGrid.tsx`, ‏`StreakCard.tsx`, ‏`LevelCard.tsx`: 30 מחלקות ישנות.
- הבדיקה `today/today.test.tsx` "sign out still works from /today" עודכנה ב-S26 לפתוח את תפריט הפרופיל.

**S28 (`pages/`, ‏`onboarding/`, ‏`exam/`, ‏`settings/`, ‏`auth/RequireAuth.tsx`):**

- `text-slate-*` ו-`text-red-700` ב-`pages/LoginPage.tsx`, ‏`pages/AuthCallbackPage.tsx`, ‏`pages/ConfigErrorScreen.tsx` ו-`auth/RequireAuth.tsx`; ‏`bg-slate-50 text-slate-900` ב-`web/index.html`. ארבעת המסכים האלה, `settings/GoodbyePage.tsx` ו-`pages/NotFoundPage.tsx` עוטפים את עצמם ב-`StandalonePage` במקום `<main className="mx-auto max-w-2xl px-4 py-16">`.
- `auth/RequireAuth.tsx`: הטעינה שלו היא `<p role="status">`; עובר ל-`LoadingState` בתוך `StandalonePage`.
- `onboarding/OnboardingLayout.tsx`: ה-`h1` שלו עובר ל-`PageHeader`; פס השלבים (`h-1.5 rounded-full`) נשאר רכיב של האונבורדינג, עם ה-tokens.
- `onboarding/BuildingStep.tsx`, ‏`exam/AnalysisSection.tsx`: פס התקדמות שמצויר ביד (`h-3`, ‏`duration-500`) עובר ל-`ProgressBar`; כרטיס השגיאה (`role="alert"` עם `bg-danger-soft`) ל-`Card tone="danger"`.
- `exam/AnalysisPreview.tsx`: דיאלוג משלו, עובר ל-`ui/Dialog`.
- `exam/ExamsPage.tsx`: רשימת המבחנים ל-`List` עם `ListRow to=…`; התג של הימים שנשארו (`rounded-full px-3`) ל-`Badge` או לטקסט בשורת המשנה.
- `exam/TaskRow.tsx`: התג המקומי (`rounded-full … text-xs`) ל-`Badge`; `exam/ExamPage.tsx`: ה-SVG של החץ "חזרה" לאייקון של lucide, והקישור ל-`TextLink`.
- `exam/TopicList.tsx`: נקודות המשקל (`size-2 rounded-full`) נשארות רכיב מקומי; לבדוק ש-`line-strong` מול `brand` מספיק כדי להבדיל בלי צבע.
- `settings/PreferencesForm.tsx`: המתג (`h-7 w-12 rounded-full` עם `shadow-sm`) הוא הרכיב היחיד שאין לו בית ב-`ui/`. S28 מעביר אותו ל-`ui/Switch.tsx` (על `Switch` של React Aria: מסילה `line-strong`, נבחר `brand`, בלי צל) ומוסיף אותו לדף הרכיבים ולסעיף 5.8.
- `settings/SettingsPage.tsx`, ‏`DeleteAccountPage.tsx`, ‏`GoodbyePage.tsx`, ‏`pages/AuthCallbackPage.tsx`: ‏`<Link className="… underline">` ל-`TextLink`.
- **(מהבדיקה בדפדפן של S25):** בציר של מסך המבחן העמודות "מתוכנן" והריבוע שלהן במקרא הם `bg-brand-soft` על לבן, וכמעט לא נראים. מילוי שנושא מידע צריך 3:1 מול הרקע שלו (למשל `brand` למתוכנן ו-`success` למבוצע, או קו `line-strong` סביב העמודה).

**אם חסר רכיב או מצב:** מוסיפים אותו ב-`web/src/ui/` עם בדיקה (תפקיד, שם נגיש, מקלדת, פוקוס), מציגים אותו ב-`web/src/dev/ComponentsPage.tsx`, ומוסיפים שורה לטבלה שב-5.8. S27 ו-S28 רצים במקביל: מי שמוסיף רכיב יוצר קובץ חדש ולא משנה רכיב קיים, כדי שלא יהיו התנגשויות; שינוי ברכיב קיים נרשם ל-S29.

**S29:** בדיקת axe לכל מסך ולדף הרכיבים, הגדלה ל-200%, מעבר על כל המסכים מול סעיף 9, ומעבר על הניסוחים ("לנסות שוב" מול "נסו שוב").
