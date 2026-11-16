import { PRODUCT_NAME } from '../product'

// A name the user typed (an exam, a file) can be in any language: First Strong Isolate and Pop
// Directional Isolate keep a Latin name from reordering the Hebrew sentence around it.
const isolate = (name: string) => `\u2068${name}\u2069`

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
    today: 'היום',
    week: 'שבוע',
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
    exam_in_past: 'תאריך המבחן כבר עבר. בחרו תאריך עתידי.',
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
        ? `חסרות ${missing} לפני המבחן ${isolate(exam)}. אפשר לוותר על משימות, להוסיף חלונות לימוד, או לדחות את המבחן.`
        : `חסרות ${missing} לפני המבחן ${isolate(exam)}. אפשר להעלות ל-${daily} ביום, או לוותר על משימות.`,
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
    title: 'אילו מבחנים יש לכם?',
    intro: 'מוסיפים כל מבחן עם התאריך שלו וכמה הוא קשה לכם. אפשר לשנות את זה גם אחר כך.',
    name: 'שם המבחן',
    namePlaceholder: 'למשל: אלגוריתמים',
    nameRequired: 'צריך לכתוב שם למבחן.',
    nameTooLong: 'השם ארוך מדי. אפשר עד 200 תווים.',
    date: 'תאריך המבחן',
    dateRequired: 'צריך לבחור תאריך מלא למבחן.',
    dateTooEarly: 'אפשר לבחור תאריך ממחר והלאה.',
    dateTooLate: 'אפשר לבחור תאריך עד שנתיים מהיום.',
    difficulty: 'כמה המבחן קשה לכם?',
    difficultyLevels: ['קל מאוד', 'קל', 'בינוני', 'קשה', 'קשה מאוד'],
    add: 'הוספת מבחן',
    adding: 'מוסיפים…',
    listTitle: 'המבחנים שלכם',
    empty: 'עוד לא הוספתם מבחנים. מתחילים מהמבחן הקרוב ביותר.',
    deleteExam: (name: string) => `מחיקה של ${isolate(name)}`,
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
    addFilesFor: (exam: string) => `הוספת קבצים למבחן ${isolate(exam)}`,
    filesOf: (exam: string) => `הקבצים של ${isolate(exam)}`,
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
    intro: 'לפי התשובות נשבץ את הלימוד בשעות שמתאימות לכם.',
    hoursQuestion: 'כמה שעות ביום אפשר ללמוד?',
    hours: (hours: number) => (hours === 1 ? 'שעה' : hours === 2 ? 'שעתיים' : `${String(hours)} שעות`),
    windowsQuestion: 'מתי נוח לכם ללמוד?',
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
    title: 'בונים לכם תוכנית',
    intro: 'זה לוקח כמה דקות. אפשר לסגור את הדף: התוכנית תמשיך להיבנות, ותחכה לכם כשתחזרו.',
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
    nothingToSchedule: 'אין עדיין מה לשבץ: אין בלוח משימות של מבחן.',
    unscheduledTitle: 'מה לא נכנס ללוח',
    unscheduledGroup: (count: number, reason: string) =>
      count === 1 ? `משימה אחת: ${reason}` : `${String(count)} משימות: ${reason}`,
    confirm: 'אישור',
    notNow: 'לא עכשיו',
    applied: 'הלוח עודכן.',
    timezoneChanged: 'עדכנו את אזור הזמן לפי המכשיר. כדאי לתכנן מחדש את הלוח לפי השעות המקומיות.',
    timezoneReason: 'אזור הזמן במכשיר השתנה, ולכן חלונות הלימוד שלכם זזו.',
    showChange: 'הצגת השינוי',
  },
  // S14: the board pieces that "today" and "week" share (web/src/board).
  board: {
    kinds: {
      learn: 'לימוד',
      practice: 'תרגול',
      review: 'חזרה',
      simulation: 'סימולציה',
      simulation_review: 'סקירת סימולציה',
      custom: 'משימה',
    },
    states: {
      in_progress: 'עכשיו',
      overdue: 'עבר הזמן',
      done: 'בוצע',
      missed: 'הוחמץ',
      skipped: 'דולג',
    },
    part: (index: number, count: number) => `חלק ${String(index)} מתוך ${String(count)}`,
    pinned: 'נעול',
    complete: 'בוצע',
    uncomplete: 'ביטול הסימון',
    defer: 'דחייה',
    deferring: 'דוחה…',
    pin: 'נעילה',
    unpin: 'שחרור',
    actions: 'פעולות',
    // Every list has several "בוצע" buttons, so the accessible name says which task.
    completeLabel: (title: string) => `בוצע: ${title}`,
    uncompleteLabel: (title: string) => `ביטול הסימון: ${title}`,
    deferLabel: (title: string) => `דחייה: ${title}`,
    pinLabel: (title: string) => `נעילה: ${title}`,
    unpinLabel: (title: string) => `שחרור: ${title}`,
    actionsLabel: (title: string) => `פעולות: ${title}`,
    completed: 'סומן כבוצע',
    uncompleted: 'הסימון בוטל',
    pinnedDone: 'הבלוק ננעל במקומו',
    unpinnedDone: 'הנעילה שוחררה',
    deferred: (day: string, time: string) => `נדחה ל${day} בשעה ${time}`,
    deferredSomewhere: 'המשימה נדחתה',
    deferUndone: 'הדחייה בוטלה',
    toReport: 'לדוח',
    replanOffer: 'חלק מהמשימות לא נכנסו ללוח. אפשר לתכנן מחדש.',
    weekdays: ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'],
    day: (weekday: string, day: number, month: number) => `יום ${weekday}, ${String(day)}.${String(month)}`,
    today: 'היום',
    tomorrow: 'מחר',
    yesterday: 'אתמול',
    // durationText (time.ts): minutes under an hour, whole and half hours, else hours and minutes.
    minute: 'דקה',
    minutes: (n: number) => `${String(n)} דקות`,
    hour: 'שעה',
    hourAndHalf: 'שעה וחצי',
    twoHours: 'שעתיים',
    hours: (n: number) => `${String(n)} שעות`,
    hoursAndMinutes: (hours: string, minutes: number) => `${hours} ו-${String(minutes)} דקות`,
    report: {
      title: 'מה לא נכנס ללוח',
      loading: 'בודקים למה…',
      failed: 'לא הצלחנו לבדוק למה המשימות האלה לא נכנסו.',
      tasks: 'משימות שלא נכנסו',
      task: (title: string, duration: string) => `${title} (${duration})`,
      raise: (duration: string) => `להעלות ל-${duration} ביום`,
      raised: (duration: string) => `זמן הלימוד היומי עודכן ל-${duration}. אפשר לתכנן מחדש את הלוח.`,
    },
  },
  // S14
  today: {
    title: 'היום',
    progressLabel: 'ההתקדמות של היום',
    progress: (done: number, total: number) => `${String(done)} מתוך ${String(total)} דקות`,
    next: 'המשימה הבאה',
    // The next block when it is on a later day: "מחר, 09:00".
    nextAt: (day: string, time: string) => `${day}, ${time}`,
    blocks: 'הבלוקים של היום',
    // Today's list when the next block (today's) has its own card above it.
    moreBlocks: 'עוד היום',
    noBlocksToday: 'אין בלוקים היום.',
    noTasks: 'אין משימות בלוח.',
    noMoreTasks: 'אין עוד משימות בלוח.',
    planFailed: 'לא הצלחנו לבדוק את הימים הבאים.',
    stale: 'לא הצלחנו לרענן, ולכן ייתכן שהלוח לא עדכני.',
  },
  // S14: the week screen (web/src/week).
  week: {
    title: 'שבוע',
    range: (first: string, last: string) => `${first} עד ${last}`,
    moves: 'מעבר בין שבועות',
    previous: 'הקודם',
    thisWeek: 'השבוע',
    next: 'הבא',
    free: 'יום פנוי',
    total: (duration: string) => `סך הכול ${duration}`,
    stale: 'לא הצלחנו לרענן את הלוח, וייתכן שהוא לא מעודכן. ננסה שוב בעוד דקה.',
  },
} as const
