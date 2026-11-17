import { PRODUCT_NAME } from '../product'
import { heCrash } from './heCrash'
import { hePwa } from './hePwa'

// A name the user typed (an exam, a file) can be in any language: First Strong Isolate and Pop
// Directional Isolate keep a Latin name from reordering the Hebrew sentence around it.
const isolate = (name: string) => `\u2068${name}\u2069`

// Every text the user reads or hears. One section per screen; shared pieces in `common`,
// `errors` and `codes`. A screen fills only its own section.
export const he = {
  appName: PRODUCT_NAME,
  tagline: 'תוכנית לימוד יומית לתקופת המבחנים, שנבנית מהמבחנים ומהחומרים שלכם.',
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
    // S26
    choose: 'בחירה',
  },
  // S16: the crash screen (AppErrorBoundary, and the boot fallback in index.html); texts in heCrash.ts.
  crash: heCrash,
  shell: {
    signOut: 'יציאה',
    mainNav: 'ניווט ראשי',
    today: 'היום',
    week: 'שבוע',
    // S15
    exams: 'מבחנים',
    settings: 'הגדרות',
    // S19
    progress: 'התקדמות',
    // S26
    skipToContent: 'דלג לתוכן',
    profile: 'פרופיל',
  },
  login: {
    google: 'התחברות עם Google',
    failed: 'לא הצלחנו להתחיל את ההתחברות. נסו שוב.',
  },
  callback: {
    title: 'התחברות',
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
    no_study_time: 'אין זמן לימוד לפני המבחן הזה. בדקו את התאריך ואת השעות שבחרתם, או שהזמן לעצמי מכסה אותן.',
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
    // S18: the morning review and moving a block within its day
    no_time_today: 'אין היום מקום פנוי שמחזיק את כל המשימה.',
    slot_taken: 'השעה הזו תפוסה בבלוק אחר.',
    outside_day: 'אפשר להזיז בלוק רק לשעה פנויה בהמשך אותו יום.',
    // Push reminders (S16)
    push_endpoint_invalid: 'הדפדפן הזה נתן כתובת תזכורות שאנחנו לא תומכים בה. נסו דפדפן אחר.',
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
  notFound: { title: 'הדף לא נמצא', body: 'הכתובת לא קיימת, או שהדף הועבר.', backHome: 'לדף הבית' },
  config: {
    title: 'האפליקציה לא מוגדרת',
    body: 'חסרים משתני סביבה ב-web/.env, או שהערכים שלהם לא תקינים:',
  },
  // S13
  onboarding: {
    stepOf: (step: number, total: number) => `שלב ${String(step)} מתוך ${String(total)}`,
    stepsLabel: 'שלבי ההרשמה',
    steps: ['מבחנים', 'חומרים', 'שאלות', 'בניית התוכנית'],
    // S28: the one button of steps 1 and 2 (step 3 says what it starts: "בניית התוכנית").
    continue: 'המשך',
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
    listTitle: 'המבחנים שלכם',
    empty: 'עוד לא הוספתם מבחנים',
    deleteExam: (name: string) => `מחיקה של ${isolate(name)}`,
    deleted: (name: string) => `המבחן "${name}" נמחק`,
    restored: (name: string) => `המבחן "${name}" חזר`,
    difficultyOf: (label: string) => `קושי: ${label}`,
    // The subtitle of an exam's row: "20 בינואר 2027. קושי: קשה".
    details: (date: string, difficulty: string) => `${date}. קושי: ${difficulty}`,
  },
  onboardingMaterials: {
    title: 'יש לכם חומרים מהקורס?',
    intro: 'זה לא חובה, אבל עם חומרים התוכנית מתאימה לקורס שלכם. הכי עוזרים מבחני עבר עם פתרונות.',
    // S28: the same button as "המשך", when no exam has a file: the skip is said in the button itself.
    continueWithout: 'המשך בלי חומרים',
    privacy: 'הקבצים נשלחים לעיבוד אצל Anthropic, כדי לבנות מהם משימות.',
    fileTypes: 'PDF, ‏JPG או PNG, עד 20 MB לקובץ ועד 15 קבצים למבחן.',
    addFiles: 'הוספת קבצים',
    // Starts with the visible text, so a screen reader user and a voice control user find the same button.
    addFilesFor: (exam: string) => `הוספת קבצים למבחן ${isolate(exam)}`,
    filesOf: (exam: string) => `הקבצים של ${isolate(exam)}`,
    empty: 'עוד לא הוספתם קבצים למבחן הזה.',
    noExams: 'עוד אין מבחנים',
    noExamsHint: 'חזרו לשלב הקודם כדי להוסיף מבחן.',
    // The start of a file's subtitle, before its status: "מבחן עבר, PDF." The kind is missing when a
    // control shows it, and the type when the name has no extension.
    fileLead: (kind: string | null, type: string | null) => {
      const parts = [kind, type].filter((part) => part !== null)
      return parts.length === 0 ? '' : `${parts.join(', ')}.`
    },
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
    // A range of hours reads left to right inside Hebrew text: U+2066 (LRI) and U+2069 (PDI) are
    // dir="ltr" for a plain string, so "06:00–12:00" is not shown as "12:00–06:00" (S28 decision 6).
    windows: {
      morning: { label: 'בוקר', range: '\u206606:00–12:00\u2069' },
      afternoon: { label: 'צהריים', range: '\u206612:00–17:00\u2069' },
      evening: { label: 'ערב', range: '\u206617:00–21:00\u2069' },
      night: { label: 'לילה', range: '\u206621:00–02:00\u2069' },
    },
    windowsRequired: 'צריך לבחור לפחות זמן אחד ביום.',
    nightNote: 'הלילה שלפני מבחן או יום מנוחה נגמר בחצות.',
    build: 'בניית התוכנית',
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
    // The only button when there is nothing to apply. Not "סגירה": the dialog's own close button
    // has that name, and two buttons must not share one.
    understood: 'הבנתי',
    applied: 'הלוח עודכן',
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
    // blockName (blockName.ts): two parts of one task on one day must not share a button name.
    partName: (title: string, part: string) => `${title} (${part})`,
    // S27: the subtitle of a block's row (BlockRow): "הסתברות, תרגול. שעה". Commas and full stops,
    // never a middle dot (design language 5.2).
    meta: (exam: string, kind: string, duration: string) => `${isolate(exam)}, ${kind}. ${duration}`,
    // The same in the "next" card (NextBlock), after the time range: ", שעה וחצי. אלגוריתמים, לימוד".
    nextMeta: (duration: string, exam: string, kind: string) => `, ${duration}. ${isolate(exam)}, ${kind}`,
    // A split task adds its part to either line: ". חלק 1 מתוך 2".
    metaPart: (part: string) => `. ${part}`,
    pinned: 'נעול',
    complete: 'בוצע',
    uncomplete: 'ביטול הסימון',
    defer: 'דחייה',
    deferring: 'דוחה…',
    pin: 'נעילה',
    unpin: 'שחרור',
    // Every list has several "בוצע" buttons, so the accessible name says which task.
    completeLabel: (title: string) => `בוצע: ${title}`,
    uncompleteLabel: (title: string) => `ביטול הסימון: ${title}`,
    deferLabel: (title: string) => `דחייה: ${title}`,
    pinLabel: (title: string) => `נעילה: ${title}`,
    unpinLabel: (title: string) => `שחרור: ${title}`,
    actionsLabel: (title: string) => `פעולות: ${title}`,
    completed: 'סומן כבוצע',
    uncompleted: 'הסימון בוטל',
    // S18: what the "done" toast adds from S19's progress, joined to the text above with ". ".
    // In words, not "+10 XP", so the sign does not jump sides in RTL.
    xpGained: (xp: number) => `קיבלתם ${String(xp)} XP`,
    xpLost: (xp: number) => `ירדו ${String(xp)} XP`,
    levelUp: (level: number) => `עליתם לרמה ${String(level)}`,
    badgeEarned: (names: string) => `תג חדש: ${names}`,
    pinnedDone: 'ננעל במקומו',
    unpinnedDone: 'הנעילה שוחררה',
    deferred: (day: string, time: string) => `נדחה ל${day} בשעה ${time}`,
    deferredSomewhere: 'המשימה נדחתה',
    deferUndone: 'הדחייה בוטלה',
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
      // After the task, when the preview said why: "פרק 3 (שעה וחצי): אין מספיק זמן לפני המבחן."
      reason: (reason: string) => `: ${reason}`,
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
    // A line above the next block when it is on a later day.
    noBlocksToday: 'אין בלוקים היום.',
    // The empty screen: a title, one line, and a link to the exams screen (S27 decision 11).
    noTasks: 'אין משימות בלוח',
    noTasksHint: 'הלוח נבנה מהמבחנים ומהחומר שלהם.',
    toExams: 'למבחנים',
    // Nothing is planned from now on: the title of an empty state with no action.
    noMoreTasks: 'אין עוד משימות בלוח',
    noMoreTasksHint: 'אין משימה מתוכננת לשבוע הקרוב.',
    planFailed: 'לא הצלחנו לבדוק את הימים הבאים.',
    stale: 'לא הצלחנו לרענן, ולכן ייתכן שהלוח לא עדכני.',
  },
  // S18: the morning review card in "today" (web/src/today/ReviewCard.tsx).
  review: {
    title: 'סקירת בוקר',
    lead: (count: number) =>
      count === 1 ? 'בלוק אחד עבר בלי סימון. מה קרה איתו?' : `${String(count)} בלוקים עברו בלי סימון. מה קרה איתם?`,
    // After the last block was handled, until the screen is left: the heading keeps the focus.
    allDone: 'סימנתם את כל הבלוקים שעברו.',
    // "אתמול, 14:00–15:00" (the time range is shown left to right).
    when: (day: string) => `${day}, `,
    // After the time range, on the same line: ". הסתברות" or ". הסתברות. חלק 1 מתוך 2".
    details: (exam: string, part: string | null) => `. ${isolate(exam)}${part === null ? '' : `. ${part}`}`,
    complete: 'בוצע',
    moveToday: 'העבר להיום',
    moving: 'מעביר…',
    skip: 'דלג',
    // Every row has the same three buttons, so the accessible name says which block (and which part).
    completeLabel: (name: string) => `בוצע: ${name}`,
    moveTodayLabel: (name: string) => `העברה להיום: ${name}`,
    skipLabel: (name: string) => `דילוג: ${name}`,
    moved: (day: string, time: string) => `הועבר ל${day} בשעה ${time}`,
    movedSomewhere: 'המשימה הועברה',
    moveUndone: 'ההעברה בוטלה',
    // The action of the no_time_today toast: POST reschedule {today_only: false}.
    moveNext: 'למקום הפנוי הבא',
    skipped: (title: string) => `דילגתם על ${title}`,
    skipUndone: 'הדילוג בוטל',
  },
  // S18: moving a block within its day: drag, keyboard and the "move" dialog.
  move: {
    // The action on a block (its menu), next to "דחייה" and "נעילה".
    move: 'הזזה',
    moveLabel: (name: string) => `הזזה: ${name}`,
    moved: (time: string) => `הוזז ל-${time} וננעל`,
    undone: 'ההזזה בוטלה',
    // MoveDialog: the times on the 15-minute grid the block can move to (GET /blocks/{id}/slots).
    dialogTitle: (name: string) => `הזזה של ${name}`,
    dialogLead: 'בחרו שעה פנויה באותו יום. הבלוק יינעל בשעה החדשה.',
    // Before the block's current time range (shown left to right).
    current: 'השעה עכשיו: ',
    slotsLabel: 'שעות פנויות',
    loading: 'מחפשים שעות פנויות…',
    loadFailed: 'לא הצלחנו לטעון את השעות הפנויות.',
    empty: 'אין שעה פנויה אחרת ביום הזה.',
    confirm: 'הזזה',
    // The view switch above today's blocks.
    viewLabel: 'תצוגת הבלוקים',
    list: 'רשימה',
    timeline: 'ציר',
    // DayTimeline: the day from waking to sleep; an upcoming block has a drag handle.
    timelineLabel: 'ציר היום',
    handleLabel: (name: string) => `הזזת ${name}`,
    instructions:
      'גוררים את הידית למעלה או למטה. במקלדת: Enter או רווח מתחילים הזזה, חץ למעלה או למטה זז רבע שעה, PageUp או PageDown זזים שעה, Enter מאשר ו-Escape מבטל.',
    // The live region while moving: "14:30–15:30, פנוי".
    candidate: (range: string, free: boolean) => `${range}${he.move.candidateJoiner}${he.move.candidateState(free)}`,
    // The parts alone, for the ghost on the timeline, which draws the range left to right itself.
    candidateJoiner: ', ',
    candidateState: (free: boolean) => (free ? 'פנוי' : 'תפוס'),
    // Between the details of a block on the timeline: "14:00–15:00. עכשיו. נעול".
    detailsJoiner: '. ',
    cancelled: 'ההזזה בוטלה, הבלוק נשאר במקומו.',
    // The live region after a release on a time the block cannot take (the toast says why).
    refused: 'הבלוק חזר למקומו.',
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
    empty: 'אין משימות בשבוע הזה',
    total: (duration: string) => `סך הכול ${duration}`,
    stale: 'לא הצלחנו לרענן את הלוח, וייתכן שהוא לא מעודכן. ננסה שוב בעוד דקה.',
  },
  // S15: the exams list and the exam screen (Task 6); analysis and materials (Task 7).
  exam: {
    // The h1 of the exam screen until the exam itself is known (loading, failed, not found).
    title: 'מבחן',
    // The exams list (/exams).
    list: {
      title: 'מבחנים',
      listTitle: 'המבחנים שלכם',
      count: (count: number) => (count === 1 ? 'מבחן אחד' : `${String(count)} מבחנים`),
      empty: 'עוד אין מבחנים',
      emptyHint: 'מוסיפים את המבחן הקרוב ביותר, ובונים לו תוכנית.',
      newExam: 'מבחן חדש',
      formTitle: 'מבחן חדש',
      create: 'הוספת מבחן',
    },
    // 0 = today, 1 = tomorrow; a negative count is an exam that already took place.
    inDays: (days: number) => {
      if (days < 0) return 'המבחן עבר'
      if (days === 0) return 'היום'
      if (days === 1) return 'מחר'
      return `בעוד ${String(days)} ימים`
    },
    notFound: 'לא מצאנו את המבחן הזה',
    notFoundHint: 'אולי הוא נמחק.',
    backToList: 'לכל המבחנים',
    header: {
      edit: 'עריכה',
      editLabel: 'עריכת פרטי המבחן',
      // "23 בנובמבר 2026, בעוד 6 ימים. קושי: קשה": the parts around the days left, which are emphasised.
      dateThen: (date: string) => `${date}, `,
      thenDifficulty: (difficulty: string) => `. ${difficulty}`,
      saved: 'פרטי המבחן נשמרו',
      replanReason: 'פרטי המבחן השתנו, ולכן כדאי לתכנן מחדש את הלוח.',
    },
    timeline: {
      title: 'עד המבחן',
      listLabel: 'הימים עד המבחן',
      // '18.11' (dayMonth) after the Hebrew weekday ("יום ג׳").
      day: (weekday: string, dayMonth: string) => `${weekday} ${dayMonth}`,
      planned: (minutes: number) => (minutes === 0 ? 'אין לימוד מתוכנן' : `${String(minutes)} דקות מתוכננות`),
      done: (minutes: number) => `${String(minutes)} דקות בוצעו`,
      today: 'היום',
      restDay: 'יום מנוחה',
      examDay: 'יום המבחן',
      legendPlanned: 'מתוכנן',
      legendDone: 'בוצע',
      legendRest: 'מנוחה',
      legendExam: 'מבחן',
      farNote: 'המבחן רחוק: הציר מראה את 62 הימים הקרובים.',
      noDays: 'המבחן כבר עבר, ואין ימים להציג.',
    },
    topics: {
      title: 'נושאים ומשימות',
      empty: 'עוד אין משימות למבחן הזה',
      emptyHint: 'אפשר להוסיף משימה, או לבנות תוכנית מהחומרים.',
      noTopic: 'בלי נושא',
      weight: (weight: number) => `חשיבות ${String(weight)} מתוך 5`,
      weightLabel: 'חשיבות הנושא',
      evidence: 'על מה זה מבוסס?',
      editNamed: (name: string) => `עריכה: ${isolate(name)}`,
      name: 'שם הנושא',
      nameRequired: 'צריך לכתוב שם לנושא.',
      saved: 'הנושא נשמר',
      gapsTitle: 'נושאים בלי חומר',
      gap: (topic: string, note: string) => `${topic}: ${note}`,
    },
    tasks: {
      kinds: {
        learn: 'לימוד',
        practice: 'תרגול',
        review: 'חזרה',
        simulation: 'סימולציה',
        simulation_review: 'בדיקת סימולציה',
        custom: 'אחר',
      },
      // The badge of a skipped task. A done task is the filled check and the struck-through title.
      skipped: 'דולגה',
      minutes: (minutes: number) => `${String(minutes)} דקות`,
      focus: (focus: number) => `ריכוז ${String(focus)}/10`,
      next: (when: string) => `בלוח: ${when}`,
      notOnBoard: 'עוד לא בלוח',
      // The subtitle of a row: "לימוד, 60 דקות. ריכוז 3/10".
      details: (kind: string, minutes: string, focus: string) => `${kind}, ${minutes}. ${focus}`,
      reason: 'למה המשימה הזו?',
      hideReason: 'הסתרת ההסבר',
      skip: 'דילוג',
      backToTodo: 'החזרה לביצוע',
      edit: 'עריכה',
      delete: 'מחיקה',
      // The two controls of a row name the task, so a screen reader user knows which row they act
      // on: the check button (pressed = done) and the menu with the rest of the actions.
      markDoneNamed: (title: string) => `בוצעה: ${isolate(title)}`,
      actionsNamed: (title: string) => `פעולות: ${isolate(title)}`,
      formLabel: (title: string) => `עריכת המשימה ${isolate(title)}`,
      title: 'שם המשימה',
      titleRequired: 'צריך לכתוב שם למשימה.',
      minutesLabel: 'משך בדקות',
      minutesRange: 'משך בין 5 ל-600 דקות.',
      kind: 'סוג',
      focusLabel: 'ריכוז נדרש (1–10)',
      focusRange: 'ריכוז בין 1 ל-10.',
      topic: 'נושא',
      saved: 'נשמר',
      placed: 'נשמר, והמשימה שובצה מחדש בלוח',
      notPlaced: (reason: string) => `השינוי נשמר, אבל המשימה לא נכנסה ללוח: ${reason}`,
      notPlacedNoReason: 'השינוי נשמר, אבל המשימה לא נכנסה ללוח.',
      deleted: 'המשימה נמחקה',
      restored: 'המשימה חזרה',
      undone: 'השינוי בוטל',
      add: 'הוספת משימה',
      addTitle: 'משימה חדשה',
      added: 'המשימה נוספה',
      addedPlaced: 'המשימה נוספה ושובצה בלוח',
    },
    // The analysis part of the exam screen (Task 7): build the plan, reanalyze, the draft's preview.
    analysis: {
      title: 'ניתוח החומרים',
      buildTitle: 'תוכנית למבחן',
      buildIntro: 'עוד אין למבחן הזה משימות מהחומרים. נבנה אותן מהקבצים שהעליתם ונשבץ אותן בלוח.',
      build: 'בניית תוכנית למבחן',
      reanalyze: 'ניתוח חוזר',
      reanalyzeIntro:
        'ניתוח חוזר בונה משימות חדשות מהחומרים במקום אלה שעוד לא התחלתם. מה שסיימתם, התחלתם או הוספתם בעצמכם נשאר. קודם תראו מה ישתנה, ורק אז תאשרו. עד 3 ניתוחים ביום.',
      starting: 'מתחילים…',
      // The summary at the end of the section's heading row, while something in it needs attention.
      summaryRunning: 'רץ עכשיו',
      summaryFailed: 'לא הצליח',
      summaryDraft: 'מחכה לאישור',
      failedTitle: 'הניתוח לא הצליח',
      built: 'התוכנית למבחן מוכנה, והמשימות שובצו בלוח.',
      draftWaiting: 'ניתוח חדש מחכה לאישור',
      draftHint: 'אפשר לראות מה ישתנה לפני שמאשרים.',
      showDraft: 'הצגת השינוי',
      draftGone: 'הניתוח הזה כבר לא עדכני: הוא אושר, הוחלף בניתוח חדש יותר או בוטל.',
      replanReason: 'למבחן הזה כבר יש משימות. אפשר לשבץ מחדש את הלוח.',
      replan: 'תכנון מחדש של הלוח',
      // The preview dialog.
      previewTitle: 'הניתוח החדש',
      previewLoading: 'מחשבים מה ישתנה…',
      replaced: (count: number) => (count === 1 ? 'משימה אחת תוחלף' : `${String(count)} משימות יוחלפו`),
      kept: (count: number) =>
        count === 0 ? 'אף משימה קיימת לא נשארת' : count === 1 ? 'משימה אחת נשארת כמו שהיא' : `${String(count)} משימות נשארות כמו שהן`,
      added: (count: number) => (count === 1 ? 'משימה חדשה אחת' : `${String(count)} משימות חדשות`),
      addedListLabel: 'המשימות החדשות',
      replacedListLabel: 'המשימות שיוחלפו',
      taskMeta: (kind: string, minutes: string) => `${kind}, ${minutes}`,
      boardTitle: 'בלוח',
      noBoardChange: 'הבלוקים בלוח לא משתנים.',
      applied: 'הניתוח החדש נכנס לתוכנית.',
      undone: 'חזרנו לתוכנית הקודמת.',
    },
    // The materials part of the exam screen (Task 7): the S13 list and upload, and the kind of each file.
    materials: {
      title: 'חומרים',
      kindLabel: (name: string) => `סוג הקובץ ${isolate(name)}`,
      kindSaved: 'סוג הקובץ נשמר',
      // S28: the summary of the collapsed section.
      count: (count: number) => (count === 0 ? 'אין קבצים' : count === 1 ? 'קובץ אחד' : `${String(count)} קבצים`),
      reanalyzeHint: 'החומרים השתנו. ניתוח חוזר ישתמש בהם בבניית המשימות.',
    },
  },
  // S15: settings, export, account deletion and the goodbye page (Task 8).
  settings: {
    title: 'הגדרות',
    // A length of time: the start delay, the hobby, and a daily study time that is not a whole hour.
    duration: (minutes: number) => {
      const named: Record<number, string> = { 15: 'רבע שעה', 30: 'חצי שעה', 60: 'שעה', 90: 'שעה וחצי', 120: 'שעתיים' }
      return named[minutes] ?? `${String(minutes)} דקות`
    },
    preferences: {
      title: 'העדפות לימוד',
      intro: 'לפי ההעדפות האלה נשבץ את הלימוד. אחרי השמירה נציע לעדכן את התוכנית.',
      // The four groups of the form, each an h3.
      groups: {
        amount: 'כמה ומתי',
        routine: 'שגרת היום',
        hobby: 'זמן לעצמי',
        rest: 'לפני מבחן',
      },
      hoursQuestion: 'כמה שעות ביום אפשר ללמוד?',
      windowsQuestion: 'מתי נוח לכם ללמוד?',
      windowsHint: 'אפשר לבחור כמה.',
      windowsRequired: 'צריך לבחור לפחות זמן אחד ביום.',
      wakeTime: 'שעת קימה',
      sleepTime: 'שעת שינה',
      sameTimes: 'שעת השינה צריכה להיות שונה משעת הקימה.',
      afterMidnight: 'שעת השינה מוקדמת משעת הקימה, כלומר אחרי חצות.',
      nightShiftRest: 'כשיש ימי מנוחה לפני מבחן, יום הלימוד האחרון נגמר בשעת השינה שלכם.',
      delayQuestion: 'כמה זמן אחרי הקימה אפשר להתחיל ללמוד?',
      delayNow: 'מיד',
      hobbyLabel: 'זמן לעצמי כל יום',
      hobbyHint: 'זמן קבוע ביום שבו לא נשבץ לימוד.',
      hobbyStart: 'מתי הוא מתחיל',
      hobbyMinutes: 'כמה זמן',
      restQuestion: 'כמה ימי מנוחה לפני מבחן?',
      restDays: (days: number) =>
        days === 0 ? 'בלי' : days === 1 ? 'יום אחד' : days === 2 ? 'יומיים' : `${String(days)} ימים`,
      save: 'שמירה',
      saved: 'נשמר',
      replanReason: 'ההעדפות השתנו. לעדכן את התוכנית לפיהן?',
      invalidField: 'הערך הזה לא תקין.',
    },
    export: {
      title: 'ייצוא הנתונים',
      description:
        'קובץ JSON עם הפרופיל, המבחנים, המשימות, הלוח, הנושאים, פרטי החומרים (בלי הקבצים עצמם), הניתוחים ורישום השימוש ב-AI.',
      button: 'הורדת הקובץ',
    },
    danger: {
      title: 'מחיקת החשבון',
      description: 'מוחקת את החשבון ואת כל הנתונים שלכם, בלי אפשרות לשחזר.',
      link: 'למחיקת החשבון',
    },
    deleteAccount: {
      title: 'מחיקת החשבון',
      intro: 'המחיקה מיידית וסופית. אין דרך לבטל אותה, ואין תקופה שבה אפשר להתחרט.',
      whatTitle: 'מה נמחק',
      what: [
        'הפרופיל וההעדפות',
        'המבחנים, המשימות והתוכנית',
        'הנושאים והניתוחים',
        'הקבצים שהעליתם',
        'רישום השימוש',
        'חשבון הכניסה',
      ],
      exportFirst: 'רוצים לשמור עותק? כדאי להוריד קודם את הנתונים.',
      exportLink: 'לייצוא הנתונים',
      confirmWord: 'מחיקה',
      confirmLabel: 'כדי לאשר, הקלידו את המילה "מחיקה"',
      submit: 'מחיקת החשבון לצמיתות',
      back: 'חזרה להגדרות',
    },
    goodbye: {
      title: 'החשבון נמחק',
      body: 'כל הנתונים שלכם נמחקו.',
      login: 'לדף הכניסה',
    },
  },
  // S16: push reminders (web/src/notifications).
  notifications: {
    title: 'תזכורות',
    intro: 'תזכורת לפני כל בלוק לימוד, גם כשהאפליקציה סגורה.',
    deviceTitle: 'תזכורות במכשיר הזה',
    notConfigured: 'התזכורות עוד לא זמינות באתר הזה.',
    unsupported: 'הדפדפן הזה לא תומך בתזכורות. אפשר לפתוח את האתר ב-Chrome, ‏Edge, ‏Firefox או Safari בגרסה עדכנית.',
    iosTitle: 'באייפון ובאייפד, תזכורות עובדות רק כשפותחים את האפליקציה ממסך הבית.',
    iosSteps: [
      'בספארי, לוחצים על כפתור השיתוף (ריבוע עם חץ למעלה).',
      'בוחרים "הוסף למסך הבית" ולוחצים "הוסף".',
      `פותחים את ${isolate(PRODUCT_NAME)} מהאייקון שעל מסך הבית.`,
      'חוזרים למסך הזה ומפעילים תזכורות.',
    ],
    blockedTitle: 'ההתראות חסומות בדפדפן הזה.',
    blockedBrowser: 'בדפדפן: לוחצים על סמל המנעול או ההגדרות שליד הכתובת, מאפשרים "התראות", וטוענים את הדף מחדש.',
    blockedApp: `באפליקציה שמותקנת בטלפון: הגדרות הטלפון, ואז ${isolate(PRODUCT_NAME)}, ואז "התראות".`,
    checking: 'בודקים את מצב התזכורות…',
    off: 'התזכורות כבויות במכשיר הזה.',
    on: 'התזכורות פעילות במכשיר הזה.',
    enable: 'הפעלת תזכורות',
    disable: 'כיבוי',
    enabled: 'התזכורות הופעלו במכשיר הזה.',
    disabled: 'התזכורות כובו במכשיר הזה.',
    notAllowed: 'לא אישרתם התראות, ולכן התזכורות לא הופעלו.',
    enableFailed: 'לא הצלחנו להפעיל את התזכורות. נסו שוב.',
    disableFailed: 'לא הצלחנו לכבות את התזכורות. נסו שוב.',
    leadLabel: 'מתי להזכיר',
    leadHint: 'חל על כל המכשירים שבהם התזכורות פעילות.',
    lead0: 'בתחילת הבלוק',
    lead5: '5 דקות לפני',
    lead10: '10 דקות לפני',
    lead15: '15 דקות לפני',
    leadSaved: 'זמן התזכורת נשמר.',
    installTitle: 'רוצים תזכורת לפני כל בלוק?',
    installText: 'באייפון, תזכורות עובדות רק אחרי שמוסיפים את האפליקציה למסך הבית.',
    installHow: 'איך מוסיפים',
    installDismiss: 'הבנתי',
  },
  // S16: the service worker's texts live in hePwa.ts, so sw.js does not bundle this file.
  pwa: hePwa,
  // S19: the progress board (web/src/progress). Filled by Task 4.
  progress: {
    title: 'התקדמות',
    // Numbers are formatted by the caller (progress/format.ts), so 10000 reads "10,000".
    level: {
      title: 'רמה',
      level: (level: number) => `רמה ${String(level)}`,
      totalXp: (xp: string) => `${xp} XP בסך הכול`,
      barLabel: (next: number) => `ההתקדמות לרמה ${String(next)}`,
      barValue: (done: string, total: string) => `${done} מתוך ${total} XP`,
      max: 'זו הרמה הגבוהה ביותר.',
      blocksDone: (count: number) =>
        count === 0 ? 'עוד לא הושלמו בלוקים' : count === 1 ? 'בלוק אחד הושלם' : `${String(count)} בלוקים הושלמו`,
    },
    streak: {
      title: 'רצף ימי לימוד',
      current: 'הרצף הנוכחי',
      longest: 'הרצף הארוך ביותר',
      days: (n: number) => (n === 1 ? 'יום אחד' : n === 2 ? 'יומיים' : `${String(n)} ימים`),
      start: 'היום הוא יום טוב להתחיל.',
      studiedToday: 'למדתם היום.',
      keepGoing: 'בלוק אחד היום ממשיך את הרצף.',
    },
    days: {
      summary: (studied: number, total: number) =>
        studied === 0
          ? `עוד אין ימי לימוד ב-${String(total)} הימים האחרונים.`
          : studied === 1
            ? `יום לימוד אחד מתוך ${String(total)} הימים האחרונים.`
            : `${String(studied)} ימי לימוד מתוך ${String(total)} הימים האחרונים.`,
      // Sunday first, as Date.getUTCDay() counts.
      weekdayLetters: ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'],
    },
    badges: {
      title: 'תגים',
      summary: (earned: number, total: number) => `${String(earned)} מתוך ${String(total)} הושגו`,
      earnedOn: (date: string) => `הושג ב-${date}`,
      // An earned badge whose date is missing.
      earned: 'הושג',
      notEarned: 'עוד לא הושג',
      // The line under the name of a badge: "רצף של 7 ימי לימוד. הושג ב-13 בנובמבר 2026".
      details: (parts: string[]) => parts.filter((part) => part !== '').join('. '),
      towards: (current: string, threshold: string) => `${current} מתוך ${threshold}`,
      groups: {
        first: 'התחלה',
        blocks: 'בלוקים שהושלמו',
        streak: 'רצף ימי לימוד',
        level: 'רמות',
        xp: 'נקודות XP',
      },
      // By badge key (api/app/domain/gamification): a name and a short line on what earns it.
      items: {
        first_task: { name: 'צעד ראשון', description: 'הבלוק הראשון שהושלם' },
        task_master_10: { name: '10 בלוקים', description: '10 בלוקי לימוד שהושלמו' },
        task_master_20: { name: '20 בלוקים', description: '20 בלוקי לימוד שהושלמו' },
        task_master_50: { name: '50 בלוקים', description: '50 בלוקי לימוד שהושלמו' },
        task_master_100: { name: '100 בלוקים', description: '100 בלוקי לימוד שהושלמו' },
        iron_will_7: { name: 'שבוע ברצף', description: 'רצף של 7 ימי לימוד' },
        iron_will_10: { name: '10 ימים ברצף', description: 'רצף של 10 ימי לימוד' },
        iron_will_14: { name: 'שבועיים ברצף', description: 'רצף של 14 ימי לימוד' },
        iron_will_30: { name: '30 ימים ברצף', description: 'רצף של 30 ימי לימוד' },
        iron_will_100: { name: '100 ימים ברצף', description: 'רצף של 100 ימי לימוד' },
        knowledge_seeker_5: { name: 'רמה 5', description: 'הגעה לרמה 5' },
        knowledge_seeker_10: { name: 'רמה 10', description: 'הגעה לרמה 10' },
        knowledge_seeker_20: { name: 'רמה 20', description: 'הגעה לרמה 20' },
        knowledge_seeker_25: { name: 'רמה 25', description: 'הגעה לרמה 25' },
        knowledge_seeker_50: { name: 'רמה 50', description: 'הגעה לרמה הגבוהה ביותר' },
        xp_1000: { name: '1,000 XP', description: '1,000 נקודות XP בסך הכול' },
        xp_5000: { name: '5,000 XP', description: '5,000 נקודות XP בסך הכול' },
        xp_10000: { name: '10,000 XP', description: '10,000 נקודות XP בסך הכול' },
      },
      // A key the web does not know yet (a newer API): shown by its threshold.
      unknown: { name: 'תג', description: '' },
    },
  },
} as const
