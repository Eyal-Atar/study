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
  onboarding: {},
  onboardingExams: {},
  onboardingMaterials: {},
  onboardingSchedule: {},
  building: {},
  replan: {},
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
