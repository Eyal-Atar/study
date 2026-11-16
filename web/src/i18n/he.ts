import { PRODUCT_NAME } from '../product'

// Every text the user reads or hears. One section per screen; shared pieces in `common`,
// `errors` and `codes`. A screen fills only its own section.
export const he = {
  appName: PRODUCT_NAME,
  tagline: 'תוכנית לימודים יומית לתקופת המבחנים',
  common: {
    loading: 'טוען…',
    retry: 'לנסות שוב',
    undo: 'בטל',
    close: 'סגירה',
    next: 'הבא',
    back: 'חזרה',
    skip: 'דלג',
    save: 'שמירה',
    cancel: 'ביטול',
    delete: 'מחיקה',
    notifications: 'הודעות',
  },
  shell: {
    signOut: 'יציאה',
    mainNav: 'ניווט ראשי',
  },
  login: {
    google: 'התחברות עם Google',
    failed: 'לא הצלחנו להתחיל את ההתחברות. נסו שוב.',
  },
  callback: {
    working: 'מסיימים את ההתחברות…',
    failed: 'ההתחברות לא הושלמה. אפשר לנסות שוב.',
    backToLogin: 'חזרה למסך הכניסה',
  },
  errors: {
    generic: 'משהו השתבש. נסו שוב בעוד רגע.',
    unreachable: 'לא הצלחנו להגיע לשרת. נסו שוב בעוד רגע.',
  },
  // The Hebrew text of every code the API, the worker and the planner send (codes.ts reads it).
  // A function takes the problem's extra fields, already checked by codes.ts.
  codes: {
    // API problems
    unauthenticated: 'צריך להתחבר מחדש.',
    not_found: 'לא מצאנו את מה שחיפשת.',
    validation_error: 'חלק מהפרטים לא תקינים. בדקו ונסו שוב.',
    database_unavailable: 'השירות לא זמין כרגע. נסו שוב בעוד רגע.',
    plan_conflict: 'השינוי מתנגש בבלוק אחר בלוח. רעננו ונסו שוב.',
    stale_plan: 'התוכנית השתנתה בינתיים. מציגים את המצב העדכני.',
    placement_failed: 'לא מצאנו מקום פנוי למשימה. אפשר לתכנן מחדש את הלוח.',
    invalid_state: 'אי אפשר לבצע את הפעולה הזו במצב הנוכחי.',
    nothing_to_undo: 'אין שינוי לבטל.',
    dependency_cycle: 'התלות הזו יוצרת מעגל בין משימות.',
    exam_in_past: 'תאריך המבחן כבר עבר. בחרו תאריך מהיום והלאה.',
    network: 'לא הצלחנו להגיע לשרת. בדקו את החיבור ונסו שוב.',
    timeout: 'השרת לא ענה בזמן. נסו שוב בעוד רגע.',
    // Materials (S10)
    file_missing: 'הקובץ לא הגיע אלינו. נסו להעלות אותו שוב.',
    file_too_large: (limitMb: number | null) =>
      limitMb === null ? 'הקובץ גדול מדי.' : `הקובץ גדול מדי. אפשר להעלות עד ${String(limitMb)} MB.`,
    unsupported_file: 'אפשר להעלות רק PDF, ‏JPG או PNG.',
    pdf_unreadable: 'לא הצלחנו לקרוא את ה-PDF. אולי הוא פגום או מוגן בסיסמה.',
    storage_unavailable: 'אחסון הקבצים לא זמין כרגע. נסו שוב בעוד רגע.',
    material_missing: 'הקובץ נמחק לפני שסיימנו לקרוא אותו.',
    internal_error: 'משהו השתבש אצלנו. נסו שוב מאוחר יותר.',
    worker_crashed: 'העיבוד נעצר באמצע. נסו שוב.',
    unknown_kind: 'משהו השתבש אצלנו. נסו שוב מאוחר יותר.',
    pages_truncated: 'הקובץ ארוך, ולכן קראנו רק את העמודים הראשונים שלו.',
    text_truncated: 'חלק מהטקסט ארוך מדי, ולכן קראנו רק את תחילתו.',
    too_many_materials: (limit: number | null) =>
      limit === null
        ? 'הגעתם למספר הקבצים המקסימלי למבחן הזה. מחקו קובץ כדי להוסיף אחר.'
        : `אפשר עד ${String(limit)} קבצים למבחן. מחקו קובץ (גם כזה שנכשל) כדי להוסיף אחר.`,
    already_exists: 'הקובץ הזה כבר נרשם.',
    // Course analysis (S11)
    exam_missing: 'המבחן נמחק לפני שסיימנו לנתח אותו.',
    already_analyzed: 'המבחן הזה כבר נותח.',
    no_study_time: 'אין זמן לימוד לפני המבחן הזה. בדקו את התאריך ואת השעות שבחרתם.',
    analysis_invalid: 'לא הצלחנו לבנות משימות מהחומרים של המבחן הזה. נסו שוב.',
    ai_unavailable: 'שירות הניתוח עמוס כרגע. נסו שוב בעוד כמה דקות.',
    ai_rejected: 'שירות הניתוח דחה את החומרים. נסו להעלות קבצים אחרים.',
    ai_refused: 'שירות הניתוח סירב לעבד את החומרים האלה.',
    ai_not_configured: 'שירות הניתוח לא מוגדר כרגע. נסו שוב מאוחר יותר.',
    response_truncated: 'הניתוח נקטע באמצע. נסו שוב.',
    // Analysis warnings (S11)
    under_budget: 'החומרים מכסים פחות מהזמן שיש לכם, אז נשאר זמן פנוי.',
    trimmed_to_budget: 'היו יותר משימות מהזמן שיש לכם, אז ויתרנו על חלק מהתרגול.',
    materials_not_ready: 'חלק מהקבצים עוד לא היו מוכנים, ולא נכנסו לניתוח.',
    scanned_pages_skipped: 'חלק מהעמודים הסרוקים לא נכנסו לניתוח, כי היו יותר מדי.',
    budget_raised_to_minimum: 'הזמן עד המבחן קצר מהמשימות ההכרחיות, אז התוכנית צפופה.',
    // Plan generation (S12)
    ai_no_credit: 'שירות הניתוח לא זמין כרגע. אנחנו מטפלים בזה, נסו שוב מאוחר יותר.',
    ai_quota_exceeded: (resetsAt: string | null) =>
      resetsAt === null
        ? 'הגעתם למספר יצירות התוכנית היומי. אפשר לנסות שוב מחר.'
        : `הגעתם למספר יצירות התוכנית היומי. אפשר לנסות שוב מ-${resetsAt}.`,
    nothing_to_analyze: 'כל המבחנים כבר נותחו. אפשר לתכנן מחדש את הלוח.',
    materials_processing: 'עוד קוראים את הקבצים שהעליתם.',
    // Planner reasons: why a task is not on the board (S06–S08)
    no_study_days: 'אין ימי לימוד לפני המבחן.',
    not_enough_time: 'אין מספיק זמן לפני המבחן.',
    no_contiguous_window: 'אין חלון רציף ארוך מספיק.',
    dependency_not_scheduled: 'המשימה שהיא תלויה בה לא נכנסה ללוח.',
    dependency_too_late: 'המשימה שהיא תלויה בה נגמרת מאוחר מדי.',
    longer_than_daily_minutes: 'היא ארוכה משעות הלימוד שלכם ביום.',
    dependent_too_early: 'משימה שתלויה בה כבר משובצת לפני המקום הזה.',
  },
  // "Did not fit" reports, with the exam name (codes.ts).
  report: {
    cycle: 'היא חלק ממעגל של משימות שתלויות זו בזו.',
    hours: (minutes: number) => {
      const hours = Math.round((minutes / 60) * 2) / 2
      if (hours <= 0.5) return 'חצי שעה'
      if (hours === 1) return 'שעה'
      if (hours === 2) return 'שעתיים'
      return `${String(hours)} שעות`
    },
    shortfall: (exam: string, missing: string, daily: string | null) =>
      daily === null
        ? `חסרות ${missing} לפני המבחן ב${exam}. אפשר לוותר על משימות, להוסיף חלונות לימוד, או לדחות את המבחן.`
        : `חסרות ${missing} לפני המבחן ב${exam}. אפשר להעלות ל-${daily} ביום, או לוותר על משימות.`,
  },
  notFound: { title: 'הדף לא נמצא', backHome: 'לדף הבית' },
  config: {
    title: 'האפליקציה לא מוגדרת',
    body: 'חסרים משתני סביבה ב-web/.env, או שהערכים שלהם לא תקינים:',
  },
  // S13
  onboarding: {
    stepOf: (step: number, total: number) => `שלב ${String(step)} מתוך ${String(total)}`,
    stepsLabel: 'שלבי ההרשמה',
    steps: ['מבחנים', 'חומרים', 'שאלות', 'בניית התוכנית'],
  },
  onboardingExams: {
    title: 'אילו מבחנים יש לך?',
    intro: 'מוסיפים כל מבחן עם התאריך שלו וכמה הוא קשה לך. אפשר לשנות את זה גם אחר כך.',
    name: 'שם המבחן',
    namePlaceholder: 'למשל: אלגוריתמים',
    nameRequired: 'צריך לכתוב שם למבחן.',
    nameTooLong: 'השם ארוך מדי. אפשר עד 200 תווים.',
    date: 'תאריך המבחן',
    dateRequired: 'צריך לבחור תאריך מלא למבחן.',
    dateTooEarly: 'אפשר לבחור תאריך ממחר והלאה.',
    dateTooLate: 'אפשר לבחור תאריך עד שנתיים מהיום.',
    difficulty: 'כמה המבחן קשה לך?',
    difficultyLevels: ['קל מאוד', 'קל', 'בינוני', 'קשה', 'קשה מאוד'],
    add: 'הוספת מבחן',
    adding: 'מוסיפים…',
    listTitle: 'המבחנים שלך',
    empty: 'עוד לא הוספת מבחנים. מתחילים מהמבחן הקרוב ביותר.',
    deleteExam: (name: string) => `מחיקה של ${name}`,
    deleted: (name: string) => `המבחן "${name}" נמחק`,
    restored: (name: string) => `המבחן "${name}" חזר`,
    difficultyOf: (label: string) => `קושי: ${label}`,
  },
  onboardingMaterials: {
    title: 'חומרי לימוד',
    intro: 'זה לא חובה, אבל עם חומרים התוכנית מתאימה לקורס שלכם. הכי עוזרים מבחני עבר עם פתרונות.',
    privacy: 'הקבצים נשלחים לעיבוד אצל Anthropic, כדי לבנות מהם משימות.',
    fileTypes: 'PDF, ‏JPG או PNG, עד 20 MB לקובץ ועד 15 קבצים למבחן.',
    addFiles: 'הוספת קבצים',
    // Starts with the visible text, so a screen reader user and a voice control user find the same button.
    addFilesFor: (exam: string) => `הוספת קבצים ל${exam}`,
    filesOf: (exam: string) => `הקבצים של ${exam}`,
    empty: 'עוד לא הוספתם קבצים למבחן הזה.',
    noExams: 'עוד אין מבחנים. חזרו לשלב הקודם כדי להוסיף מבחן.',
    uploading: 'מעלה…',
    processing: 'קוראים את הקובץ…',
    ready: (pages: number | null) => {
      if (pages === null) return 'מוכן'
      if (pages === 1) return 'מוכן, עמוד אחד'
      return `מוכן, ${String(pages)} עמודים`
    },
    remove: 'הסרה',
    removeNamed: (name: string) => `הסרה: ${name}`,
    retryNamed: (name: string) => `לנסות שוב: ${name}`,
    deleteNamed: (name: string) => `מחיקה: ${name}`,
    deleted: (name: string) => `הקובץ "${name}" יימחק`,
    deleteFailed: (name: string) => `הקובץ "${name}" לא נמחק.`,
    kinds: {
      syllabus: 'סילבוס',
      summary: 'סיכום',
      past_exam: 'מבחן עבר',
      solution: 'פתרון',
      notes: 'הערות',
      other: 'אחר',
    },
  },
  onboardingSchedule: {
    title: 'עוד שתי שאלות',
    intro: 'לפי התשובות נשבץ את הלימוד בשעות שמתאימות לך.',
    hoursQuestion: 'כמה שעות ביום אפשר ללמוד?',
    hours: (hours: number) => (hours === 1 ? 'שעה' : hours === 2 ? 'שעתיים' : `${String(hours)} שעות`),
    windowsQuestion: 'מתי נוח לך ללמוד?',
    windowsHint: 'אפשר לבחור כמה.',
    windows: {
      morning: { label: 'בוקר', range: '06:00–12:00' },
      afternoon: { label: 'צהריים', range: '12:00–17:00' },
      evening: { label: 'ערב', range: '17:00–21:00' },
      night: { label: 'לילה', range: '21:00–02:00' },
    },
    windowsRequired: 'צריך לבחור לפחות זמן אחד ביום.',
    nightNote: 'הלילה שלפני מבחן או יום מנוחה נגמר בחצות.',
    build: 'בניית התוכנית',
    saving: 'שומרים…',
  },
  building: {
    title: 'בונים לך תוכנית',
    intro: 'זה לוקח כמה דקות. אפשר לסגור את הדף: התוכנית תמשיך להיבנות, ותחכה לך כשתחזרו.',
    waitingMaterials: 'קוראים את הקבצים…',
    starting: 'מתחילים…',
    progressLabel: 'התקדמות בניית התוכנית',
    // The stages of generate_plan (spec 7.8). An unknown stage shows `starting`.
    stages: {
      reading_materials: 'קוראים את החומרים',
      analyzing: 'מנתחים את החומר ובונים משימות',
      validating: 'בודקים את המשימות',
      saving: 'שומרים את המשימות',
      planning: 'משבצים את המשימות בלוח',
    },
    doneTitle: 'התוכנית מוכנה',
    examsTitle: 'המבחנים',
    unknownExam: 'מבחן',
    examTasks: (count: number) => (count === 1 ? 'משימה אחת' : `${String(count)} משימות`),
    examSkipped: 'לא נותח הפעם, המשימות הקיימות נשארות.',
    examFailed: 'לא נותח:',
    someFailed: 'חלק מהמבחנים לא נותחו. התוכנית נבנתה מהשאר, ואפשר לנסות שוב אחר כך.',
    gapsTitle: 'נושאים שחסר עליהם חומר',
    gap: (topic: string, note: string) => `${topic}: ${note}`,
    blocks: (count: number) => (count === 1 ? 'בלוק לימוד אחד בלוח.' : `${String(count)} בלוקי לימוד בלוח.`),
    unscheduled: (count: number) =>
      count === 1 ? 'משימה אחת לא נכנסה ללוח.' : `${String(count)} משימות לא נכנסו ללוח.`,
    toToday: 'למסך היום',
    failedTitle: 'לא הצלחנו לבנות את התוכנית',
    scheduleAnalyzed: 'לשבץ את מה שכבר נותח',
    replanReason: 'אפשר לשבץ בלוח את המשימות של המבחנים שכבר נותחו.',
  },
  replan: {
    title: 'תכנון מחדש של הלוח',
    loading: 'מחשבים מה ישתנה…',
    added: (count: number) => (count === 1 ? 'בלוק לימוד אחד חדש' : `${String(count)} בלוקי לימוד חדשים`),
    removed: (count: number) => (count === 1 ? 'בלוק אחד יוצא מהלוח' : `${String(count)} בלוקים יוצאים מהלוח`),
    noChange: 'הלוח כבר מעודכן. אין מה לשנות.',
    unscheduledTitle: 'מה לא נכנס ללוח',
    unscheduledGroup: (count: number, reason: string) =>
      count === 1 ? `משימה אחת: ${reason}` : `${String(count)} משימות: ${reason}`,
    confirm: 'אישור',
    notNow: 'לא עכשיו',
    applied: 'הלוח עודכן.',
    timezoneChanged: 'עדכנו את אזור הזמן לפי המכשיר. כדאי לתכנן מחדש את הלוח לפי השעות המקומיות.',
    timezoneReason: 'אזור הזמן במכשיר השתנה, ולכן חלונות הלימוד שלך זזו.',
    showChange: 'הצגת השינוי',
  },
  // S14
  today: {
    title: 'היום',
    placeholder: 'כאן תופיע התוכנית של היום.',
    signedInAs: (email: string) => `התחברת בתור ${email}`,
    noEmail: 'התחברת בלי כתובת מייל',
    userId: 'מזהה משתמש',
  },
  week: {},
} as const
