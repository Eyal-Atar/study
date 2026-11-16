// The service worker's texts. A module of their own, so src/sw.ts bundles these few strings and
// not the whole he.ts dictionary; he.ts re-exports them as he.pwa, so every text still sits in i18n.
export const hePwa = {
  // When a push arrives without a readable reminder.
  pushFallbackBody: 'יש לך תזכורת חדשה בלוח.',
} as const
