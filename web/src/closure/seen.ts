import type { ClosureItem } from './types'

// Which closure sheets this device already opened by itself (decision 2): once per exam and sitting.
// Stored as a JSON array of "<examId>:<sitting>" under archi.closure.<userId>, the newest last, up to
// 50. When storage throws, the copy in this module wins until the page reloads (as focusSession.ts).

type Item = Pick<ClosureItem, 'exam_id' | 'sitting'>

const MAX_SEEN = 50

export function seenKey(item: Item): string {
  return `${item.exam_id}:${String(item.sitting)}`
}

function storageKey(userId: string): string {
  return `archi.closure.${userId}`
}

const memory = new Map<string, string[]>()

function readStored(userId: string): string[] {
  try {
    const raw = window.localStorage.getItem(storageKey(userId))
    if (raw === null) return []
    const value: unknown = JSON.parse(raw)
    if (Array.isArray(value) && value.every((entry): entry is string => typeof entry === 'string')) return value
    return []
  } catch {
    return []
  }
}

function read(userId: string): string[] {
  return memory.get(userId) ?? readStored(userId)
}

export function wasShown(userId: string, item: Item): boolean {
  return read(userId).includes(seenKey(item))
}

export function markShown(userId: string, item: Item): void {
  const key = seenKey(item)
  const current = read(userId)
  if (current.includes(key)) return
  const next = [...current, key].slice(-MAX_SEEN)
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(next))
    memory.delete(userId)
  } catch {
    memory.set(userId, next)
  }
}
