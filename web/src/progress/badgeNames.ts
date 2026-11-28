import { en } from '../i18n/en'

// The name of a badge from its key, in one place (S33 fix wave 12): the garden, the badge grid, the
// celebration sheet and the toast of Done. A key from a newer server has no name here yet.

const items: Partial<Record<string, { name: string }>> = en.progress.badges.items

/** The badge's name, or null when the web does not know the key. */
export function knownBadgeName(key: string): string | null {
  return Object.hasOwn(items, key) ? (items[key]?.name ?? null) : null
}

/** The badge's name, or the generic name for a key the web does not know. */
export function badgeName(key: string): string {
  return knownBadgeName(key) ?? en.progress.badges.unknown.name
}
