// The crash screen's texts. A module with no imports, so vite.config.ts can read it too: it writes
// them into the boot fallback in index.html (src/pwa/bootTexts.ts). en.ts re-exports them as en.crash.
export const enCrash = {
  title: 'Something went wrong',
  body: "I ran into an error and couldn't load. Reloading usually fixes it.",
  reload: 'Reload',
  details: 'Details for support',
} as const
