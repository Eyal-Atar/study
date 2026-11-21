// The service worker's texts. A module of their own, so src/sw.ts bundles these few strings and
// not the whole en.ts dictionary; en.ts re-exports them as en.pwa, so every text still sits in i18n.
export const enPwa = {
  // When a push arrives without a readable reminder.
  pushFallbackBody: 'You have a new reminder in your calendar.',
} as const
