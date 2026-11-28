import { dehydrate, defaultShouldDehydrateQuery, hydrate, type DehydratedState, type Query, type QueryClient } from '@tanstack/react-query'

// The last calendar, kept on the device. It knows nothing about auth: whoever starts it says who the
// owner is and when to clear (see AuthProvider).
export const SNAPSHOT_KEY = 'studyflow.offline.v1'
const VERSION = 1
export const WRITE_DELAY_MS = 1000
export const MAX_SNAPSHOT_CHARS = 2_000_000
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const MAX_PLAN_RANGES = 4

type Stored = { version: number; userId: string; state: DehydratedState }

const BOARD_PARTS = new Set(['today', 'progress', 'exams'])

function isPlanKey(key: readonly unknown[]): boolean {
  // ['board', uid, 'plan', from, to]; a longer key (a '...waiting' variant) is not saved.
  return key[0] === 'board' && key[2] === 'plan' && key.length === 5 && key[key.length - 1] !== 'waiting'
}

// The closed list of what is saved, for one owner.
function isSavedKey(key: readonly unknown[], userId: string): boolean {
  if (key[1] !== userId) return false
  if (key[0] === 'me' || key[0] === 'exams') return key.length === 2
  if (key[0] !== 'board') return false
  if (key.length === 3 && typeof key[2] === 'string' && BOARD_PARTS.has(key[2])) return true
  return isPlanKey(key)
}

function buildState(client: QueryClient, userId: string): DehydratedState {
  const state = dehydrate(client, {
    shouldDehydrateQuery: (query: Query) => defaultShouldDehydrateQuery(query) && isSavedKey(query.queryKey, userId),
  })
  const plans = state.queries.filter((q) => isPlanKey(q.queryKey)).sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
  const dropped = new Set(plans.slice(MAX_PLAN_RANGES))
  return { ...state, mutations: [], queries: state.queries.filter((q) => !dropped.has(q)) }
}

function writeNow(client: QueryClient, getOwner: () => string | null): void {
  try {
    const userId = getOwner()
    if (userId === null) return
    const json = JSON.stringify({ version: VERSION, userId, state: buildState(client, userId) } satisfies Stored)
    if (json.length > MAX_SNAPSHOT_CHARS) return
    localStorage.setItem(SNAPSHOT_KEY, json)
  } catch {
    // Private mode or a full quota: no snapshot, nothing else breaks.
  }
}

// Subscribes to the query cache; one write per burst of successful responses. Returns unsubscribe.
export function startSnapshot(client: QueryClient, getOwner: () => string | null): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    // Only a success writes. 'removed' (queryClient.clear() on sign-out) must not: deleting is clearSnapshot()'s job.
    if (event.type !== 'updated' || event.action.type !== 'success' || timer !== null) return
    timer = setTimeout(() => {
      timer = null
      writeNow(client, getOwner)
    }, WRITE_DELAY_MS)
  })
  return () => {
    unsubscribe()
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
}

function parse(raw: string): Stored | null {
  const value: unknown = JSON.parse(raw)
  if (typeof value !== 'object' || value === null) return null
  const stored = value as { version?: unknown; userId?: unknown; state?: { queries?: unknown } | null }
  if (stored.version !== VERSION || typeof stored.userId !== 'string') return null
  if (typeof stored.state !== 'object' || stored.state === null || !Array.isArray(stored.state.queries)) return null
  return stored as Stored
}

// Loads the snapshot into the client, synchronously, so the first render already has the calendar.
// Returns the owner's userId, or null (and deletes the key) when it is missing, broken, of another
// version or older than MAX_AGE_MS (measured from its newest dataUpdatedAt).
export function restoreSnapshot(client: QueryClient, now: number = Date.now()): string | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY)
    if (raw === null) return null
    const stored = parse(raw)
    const newest = stored === null ? 0 : Math.max(0, ...stored.state.queries.map((q) => q.state.dataUpdatedAt))
    if (stored === null || now - newest > MAX_AGE_MS) {
      clearSnapshot()
      return null
    }
    hydrate(client, stored.state)
    return stored.userId
  } catch {
    clearSnapshot()
    return null
  }
}

export function readSnapshotOwner(): string | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY)
    return raw === null ? null : (parse(raw)?.userId ?? null)
  } catch {
    return null
  }
}

export function clearSnapshot(): void {
  try {
    localStorage.removeItem(SNAPSHOT_KEY)
  } catch {
    // Nothing to do.
  }
}
