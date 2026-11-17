// The crash screen's texts. A module with no imports, so vite.config.ts can read it too: it writes
// them into the boot fallback in index.html (src/pwa/bootTexts.ts). he.ts re-exports them as he.crash.
export const heCrash = {
  title: 'משהו השתבש',
  body: 'האפליקציה נתקלה בשגיאה ולא הצליחה להיטען. רענון בדרך כלל פותר את זה.',
  reload: 'רענון',
  details: 'פרטים לתמיכה',
} as const
