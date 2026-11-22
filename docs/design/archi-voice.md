# הקול של Archi

מסמך קצר שמחייב כל טקסט במוצר: `web/src/i18n/en.ts`, טקסטי השרת (`PROBLEMS`, תזכורות Push), וההדמיות. הוא מיישם את סעיפים 6 ו-14 במסמך הביקורת (`2026-11-21-archi-ux-audit.md`). המסמך כתוב בעברית; הדוגמאות באנגלית, כי המוצר באנגלית.

## מי מדבר

Archi הוא מלווה לימודים רגוע: דמות אחת, שמדברת ישירות אל הסטודנט. אין "מערכת", אין "אפליקציה" ואין "צוות". כל משפט שהמוצר אומר הוא משפט ש-Archi אומר.

## שישה עקרונות

1. **גוף ראשון.** Archi אומר `I`, ‏`me`, ‏`my`, ופונה ב-`you`. אף פעם לא "Archi will…", לא "the app", ולא ה-"we" של חברה ("we couldn't load"). ‏"we" מותר רק כשהוא באמת משותף ל-Archi ולסטודנט ("What exams are we preparing for?"), ובמשורה.
2. **רגוע.** משפטים קצרים. בלי סימני קריאה, בלי "Oops", בלי "Awesome". נקודה בסוף משפט, בלי נקודה בכפתור ובכותרת.
3. **מדויק.** אומרים מה קרה ומה קורה עכשיו, עם השעה והמספר המדויקים. "I moved it to tomorrow at 09:00", לא "Rescheduled successfully".
4. **מעודד בלי ללחוץ.** בלוק שלא נעשה הוא עובדה, לא כישלון. לא מאשימים, לא מתנצלים יותר מפעם אחת, ולא משתמשים באשמה כדי להניע.
5. **Archi מוביל.** קודם ההקשר או השאלה של Archi, ורק אחריהם הפקדים שעונים לו. שאלה נשאלת כשאלה ("When do you like to study?"), לא ככותרת של טופס ("Study windows").
6. **אנגלית טבעית.** קיצורים (`I'll`, ‏`couldn't`, ‏`you're`), sentence case בכל מקום, ובלי תרגום מילולי מעברית ובלי ז׳רגון של המערכת ("placement failed", "invalid state").

## כללי כתיבה

- **כפתורים ותוויות** הם פעלים קצרים, לא משפטים של Archi: `Save`, ‏`Defer`, ‏`Skip`, ‏`Add exam`. כפתור שמתחיל פעולה של Archi יכול לומר `my`: ‏`Build my plan`.
- **שעות** בשעון 24 שעות (`16:05`), טווח במקף ארוך (`09:00–10:30`). **תאריכים:** מלא `22 November 2026`; קצר `Sun, 22 Nov` (עם שעה: `Sun, 22 Nov, 09:00`). אין צורה עם לוכסן (`22/11`): היא דו-משמעית לקורא אנגלית.
- **מספרים ויחידות:** ‏`45 min`, ‏`1 hour`, ‏`1.5 hours`, ‏`1 task` / ‏`2 tasks`. תמיד יחיד ורבים נכונים.
- **פעולה שנמשכת:** ‏`Loading…`, ‏`Deferring…` (שלוש נקודות בתו אחד).
- **בלי נקודה אמצעית** (`·`) בממשק: פסיקים ונקודות.
- **איות בריטי:** analyse, cancelled, colour. לא מערבבים עם האיות האמריקאי.
- **toast:** משפט של Archi נגמר בנקודה ("I moved it to tomorrow at 09:00."); צירוף קצר בלי פועל של Archi לא ("Calendar updated", "Exam details saved").
- **בלי אימוג׳י**, אף פעם. רגש מביעים במילים ובאיור של Archi.
- **תוכן המשתמש** (שם מבחן, משימה, קובץ) נשאר כמו שהמשתמש כתב אותו, בלי מירכאות ובלי שינוי רישיות. בקוד: `UserText` ב-JSX, ‏`isolate()` בתוך מחרוזת.
- **השם** הוא Archi. הוא מופיע בלוגו ובהיכרות ("Hi, I'm Archi"), ולא כנושא של משפט. היוצא מן הכלל היחיד: טקסט חלופי (`alt`) שמתאר את האיור ("Archi watering a pot…").

## 20 דוגמאות: עשה ואל תעשה

| # | אל תעשה | עשה |
|---|---|---|
| 1 | Archi will build your plan. | I'll build your plan. |
| 2 | Archi is reading your materials… | I'm reading your materials… |
| 3 | We couldn't reach the server. | I couldn't reach the server. Please try again in a moment. |
| 4 | Oops! Something went wrong!! | Something went wrong on my side. Please try again later. |
| 5 | Task rescheduled successfully. | I moved it to tomorrow at 09:00. |
| 6 | Placement failed. | I couldn't find a free spot for this task. |
| 7 | Invalid state. | That can't be done right now. |
| 8 | Study windows | When do you like to study? |
| 9 | Daily study hours | How many hours a day feels realistic for you? |
| 10 | Upload materials. The system will analyze them. | Share your materials, and I'll build tasks from them. |
| 11 | You missed 3 tasks! | 3 blocks went by without a mark. What happened with them? |
| 12 | Don't break your streak! | One block today keeps your streak going. |
| 13 | Awesome job!!! You're crushing it! | That's every past block sorted. |
| 14 | The user has reached the daily limit. | You've reached today's limit. You can try again tomorrow. |
| 15 | File too big. | That file is too large. I can take up to 20 MB. |
| 16 | Click here to configure hobby time | Me time every day |
| 17 | The schedule has been updated by the application. | Calendar updated |
| 18 | Are you sure you want to defer? This will hurt your progress. | Defer |
| 19 | No data. | Your calendar is empty. I build it from your exams and their materials. |
| 20 | Archi found 3 free hours for you. | I found 3 free hours for you. |

## מילון קבוע

המונחים האלה נכתבים תמיד כך, באות גדולה רק בתחילת משפט או כשם של סוג.

| מונח | משמעות | לא לכתוב |
|---|---|---|
| Calendar | הלוח של המשתמש, מסך הבית | board, schedule |
| Timetable | מערכת השעות של המוסד, שהמשתמש מצלם כדי למלא זמן תפוס (S35) | schedule, calendar |
| Commitment | שם בקוד בלבד לזמן תפוס שחוזר כל שבוע (עבודה, שיעור). בטקסט למשתמש כותבים Busy time | commitment, recurring event |
| Event | זמן תפוס חד-פעמי | appointment |
| Exam | מבחן | test, course |
| Task | יחידת עבודה של מבחן | item, to-do |
| Block | זמן לימוד משובץ ביומן | slot, session, event |
| Plan | כל המשימות והבלוקים יחד | schedule, program |
| Learning | סוג משימה: למידה והבנה | Study, Learn |
| Practice | סוג משימה: תרגול | Exercise, Drill |
| Review | סוג משימה: חזרה | Revision, Repeat |
| Simulation | סוג משימה: סימולציה של מבחן מלא | Mock exam, Test |
| Simulation review | בדיקה של סימולציה | |
| Streak | רצף ימי לימוד | Chain, Run |
| XP | נקודות | Points, Score |
| Level | רמה | Rank, Stage |
| Badge | תג הישג | Achievement, Trophy |
| Busy time | זמן שבו לא לומדים (התחייבות קבועה או אירוע) | Blocked time, Unavailable |
| Me time | הזמן היומי של המשתמש לעצמו | Hobby, Free time |
| Defer | לדחות בלוק למועד אחר ש-Archi מוצא | Postpone, Snooze, Reschedule |
| Skip | לוותר על בלוק או משימה | Dismiss, Ignore |
| Move | להזיז בלוק לשעה אחרת באותו יום | Drag, Shift |
| Lock / Unlock | לקבע בלוק במקומו | Pin, Freeze |
| Done | בוצע | Completed, Finished |
| Missed | בלוק שעבר בלי סימון | Failed, Lost |
| Replan | לבנות מחדש את השיבוץ | Regenerate, Rebuild |
| Materials | הקבצים של הקורס | Documents, Uploads |
| Reminders | תזכורות Push | Alerts, Notifications (חוץ מהשם של הרשאת הדפדפן) |
| Morning review | המעבר על הבלוקים של אתמול | Daily check, Recap |

## איך זה נאכף

- `web/src/test/sourceGuards.test.ts` נכשל על "Archi" ואחריו פועל בגוף שלישי או פועל עזר (`Archi will`, ‏`Archi is`, ‏`Archi builds`) ב-`en.ts`, על כל אימוג׳י ב-`web/src`, ועל אות עברית מחוץ לנתוני הדמה.
- מחרוזת חדשה: מוסיפים מפתח בסעיף של המסך ב-`en.ts`, בקול הזה, ומשתמשים בו ב-JSX (`{en.today.title}`). כלל ESLint אוסר טקסט ישיר ב-JSX.
