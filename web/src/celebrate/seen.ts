// What this device already celebrated (plan S33, decisions 13 and 14): the study day completed, the
// highest level, and the badges. Stored as JSON under archi.celebrated.<userId>. Unreadable or
// malformed storage reads as the default; when storage throws, the copy in this module wins until
// the page reloads (as closure/seen.ts).

export interface Celebrated {
  day: string | null
  level: number
  badges: string[]
}

const DEFAULT: Celebrated = { day: null, level: 1, badges: [] }

function storageKey(userId: string): string {
  return `archi.celebrated.${userId}`
}

const memory = new Map<string, Celebrated>()

function isCelebrated(value: unknown): value is Celebrated {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    (v.day === null || typeof v.day === 'string') &&
    typeof v.level === 'number' &&
    Number.isFinite(v.level) &&
    Array.isArray(v.badges) &&
    v.badges.every((b) => typeof b === 'string')
  )
}

function readStored(userId: string): Celebrated {
  try {
    const raw = window.localStorage.getItem(storageKey(userId))
    if (raw === null) return DEFAULT
    const value: unknown = JSON.parse(raw)
    if (!isCelebrated(value)) return DEFAULT
    return { day: value.day, level: value.level, badges: [...value.badges] }
  } catch {
    return DEFAULT
  }
}

export function readCelebrated(userId: string): Celebrated {
  const value = memory.get(userId) ?? readStored(userId)
  return { ...value, badges: [...value.badges] }
}

export function writeCelebrated(userId: string, value: Celebrated): void {
  const copy = { day: value.day, level: value.level, badges: [...value.badges] }
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(copy))
    memory.delete(userId)
  } catch {
    memory.set(userId, copy)
  }
}
