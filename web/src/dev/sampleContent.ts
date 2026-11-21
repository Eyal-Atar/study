// The user content of the components page (/dev/components): exam names, task titles, topics, file
// names. It is what a student would type or what would come from their materials, so it stays in
// the student's language (Hebrew here, with English and mixed samples beside it) and the page shows
// it through <UserText>. This is the only non-test file of src/dev/ that may hold Hebrew; the
// source guard allows it by name. Everything the product itself says is in devText.ts, in English.

export const sample = {
  // The eight exams of the palette, in the order of the exam colours.
  exams: ['הסתברות', 'אלגוריתמים', 'שפת C', 'פיתוח משחקים', 'מבני נתונים', 'לינארית', 'חדו״א', 'לוגיקה'],
  // An exam name with a digit and brackets: the case where bidi reordering bites.
  examWithBrackets: 'חדו״א 1 (מועד ב׳)',
  // A 200-character exam name, to show the cut at the end of the text.
  longExamName:
    'מבוא למדעי המחשב ולתכנות מונחה עצמים בשפת ג׳אווה, כולל מבני נתונים בסיסיים, אלגוריתמי חיפוש ומיון, רקורסיה, ניתוח סיבוכיות והסתברות בסיסית לצורכי תכנון ניסויים (מועד ב׳, סמסטר חורף תשפ״ז)',
  // A name of one long word with no spaces, which must wrap and not widen the page.
  longWord: 'שםארוךמאודבלירווחיםשצריךלהישברבאמצעהשורהולאלהרחיבאתהעמודבטלפוןברוחבשל390פיקסלים',
  // The titles of tasks and blocks.
  tasks: {
    bayes: 'תרגול: נוסחת בייס',
    lecture5: 'סיכום הרצאה 5',
    expectation: 'תרגול תוחלת ושונות',
    chapter3: 'קריאת פרק 3',
    pastExam: 'מבחן עבר 2024, מועד א׳',
  },
  // A commitment of the student's.
  busyTitle: 'משמרת בעבודה',
  // A fixed lecture of the student's timetable.
  lectureTitle: 'הרצאה באלגוריתמים',
  // What a student types into a text field.
  examNameValue: 'אלגוריתמים, מועד א׳',
  examNamePlaceholder: 'למשל: הסתברות, מועד א׳',
  topicName: 'התפלגות נורמלית',
  // A file name, with and without Hebrew.
  fileName: 'סילבוס.pdf',
  longFileName: 'קובץ_סיכום_הרצאות_הסתברות_סמסטר_א_תשפז_גרסה_אחרונה_באמת_סופית.pdf',
  // The twelve topics of the long list.
  topics: [
    'מרחבי הסתברות',
    'הסתברות מותנית',
    'נוסחת בייס',
    'אי־תלות',
    'משתנים מקריים בדידים',
    'תוחלת ושונות',
    'התפלגות בינומית',
    'התפלגות פואסון',
    'משתנים מקריים רציפים',
    'התפלגות נורמלית',
    'אי־שוויון צ׳בישב',
    'משפט הגבול המרכזי',
  ],
  // For the "User content" section: the three kinds of text, in Hebrew, in English and mixed.
  hebrew: 'סיכום הרצאה 5: נוסחת בייס (חלק ב׳)',
  english: 'Lecture 5 summary: Bayes formula (part 2)',
  mixed: 'סיכום Lecture 5: נוסחת Bayes (Part 2) 2026',
  // A paragraph, as a task's reason or a topic's evidence would be.
  paragraphHebrew:
    'הנושא הופיע בשלושה מבחנים קודמים, ועוד לא תרגלת אותו השבוע. כדאי להתחיל מהדוגמאות בשקפים 12 עד 18.',
  paragraphEnglish: 'This topic appeared in three past exams, and you haven’t practised it this week. Start with the examples on slides 12 to 18.',
} as const
