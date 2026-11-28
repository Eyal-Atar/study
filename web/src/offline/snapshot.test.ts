import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearSnapshot,
  MAX_AGE_MS,
  MAX_SNAPSHOT_CHARS,
  readSnapshotOwner,
  restoreSnapshot,
  SNAPSHOT_KEY,
  startSnapshot,
  WRITE_DELAY_MS,
} from './snapshot'

function read(): { version: number; userId: string; state: { queries: { queryKey: unknown[]; state: { dataUpdatedAt: number } }[] } } | null {
  const raw = localStorage.getItem(SNAPSHOT_KEY)
  return raw === null ? null : (JSON.parse(raw) as never)
}

describe('snapshot', () => {
  let client: QueryClient
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-28T10:00:00Z'))
    client = new QueryClient()
  })
  afterEach(() => {
    client.clear()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('writes once after WRITE_DELAY_MS with the owner and the saved queries', () => {
    const stop = startSnapshot(client, () => 'u1')
    client.setQueryData(['board', 'u1', 'today'], { a: 1 })
    client.setQueryData(['me', 'u1'], { b: 2 })
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    vi.advanceTimersByTime(WRITE_DELAY_MS - 1)
    expect(localStorage.getItem(SNAPSHOT_KEY)).toBeNull()
    vi.advanceTimersByTime(1)
    expect(setItem).toHaveBeenCalledTimes(1)
    const saved = read()
    expect(saved?.version).toBe(1)
    expect(saved?.userId).toBe('u1')
    expect(saved?.state.queries.map((q) => q.queryKey)).toEqual(expect.arrayContaining([['board', 'u1', 'today'], ['me', 'u1']]))
    expect(saved?.state.queries).toHaveLength(2)
    stop()
  })

  it('does not save queries outside the list or of another user', () => {
    startSnapshot(client, () => 'u1')
    client.setQueryData(['me', 'u1'], 1)
    client.setQueryData(['exams', 'u1'], 1)
    client.setQueryData(['board', 'u1', 'progress'], 1)
    client.setQueryData(['board', 'u1', 'exams'], 1)
    client.setQueryData(['board', 'u1', 'closures'], 1)
    client.setQueryData(['board', 'u1', 'report'], 1)
    client.setQueryData(['board', 'u1', 'review'], 1)
    client.setQueryData(['board', 'u1', 'plan', null, null, 'waiting'], 1)
    client.setQueryData(['board', 'u2', 'today'], 1)
    client.setQueryData(['me', 'u2'], 1)
    vi.advanceTimersByTime(WRITE_DELAY_MS)
    const keys = read()?.state.queries.map((q) => JSON.stringify(q.queryKey)).sort()
    expect(keys).toEqual(
      [['board', 'u1', 'exams'], ['board', 'u1', 'progress'], ['exams', 'u1'], ['me', 'u1']].map((k) => JSON.stringify(k)).sort(),
    )
  })

  it('does not save a query that is not in success state', async () => {
    startSnapshot(client, () => 'u1')
    client.setQueryData(['me', 'u1'], 1)
    await client.query({ queryKey: ['exams', 'u1'], queryFn: () => Promise.reject(new Error('x')), retry: false }).catch(() => undefined)
    vi.advanceTimersByTime(WRITE_DELAY_MS)
    expect(read()?.state.queries.map((q) => q.queryKey)).toEqual([['me', 'u1']])
  })

  it('keeps only the 4 newest plan ranges, null range included', () => {
    startSnapshot(client, () => 'u1')
    for (let i = 0; i < 5; i++) {
      client.setQueryData(['board', 'u1', 'plan', `from-${String(i)}`, `to-${String(i)}`], i, { updatedAt: 1000 + i * 10 })
    }
    client.setQueryData(['board', 'u1', 'plan', null, null], 'x', { updatedAt: 1000 + 50 })
    vi.advanceTimersByTime(WRITE_DELAY_MS)
    const plans = read()?.state.queries.filter((q) => q.queryKey[2] === 'plan') ?? []
    expect(plans).toHaveLength(4)
    expect(plans.map((q) => q.state.dataUpdatedAt).sort()).toEqual([1020, 1030, 1040, 1050])
  })

  it('writes nothing when there is no owner', () => {
    startSnapshot(client, () => null)
    client.setQueryData(['me', 'u1'], 1)
    vi.advanceTimersByTime(WRITE_DELAY_MS)
    expect(localStorage.getItem(SNAPSHOT_KEY)).toBeNull()
  })

  it('does not write a snapshot larger than MAX_SNAPSHOT_CHARS and keeps the previous one', () => {
    startSnapshot(client, () => 'u1')
    client.setQueryData(['me', 'u1'], 1)
    vi.advanceTimersByTime(WRITE_DELAY_MS)
    const before = localStorage.getItem(SNAPSHOT_KEY)
    expect(before).not.toBeNull()
    client.setQueryData(['exams', 'u1'], 'x'.repeat(MAX_SNAPSHOT_CHARS + 1))
    vi.advanceTimersByTime(WRITE_DELAY_MS)
    expect(localStorage.getItem(SNAPSHOT_KEY)).toBe(before)
  })

  it('does not write on queryClient.clear()', () => {
    startSnapshot(client, () => 'u1')
    client.setQueryData(['me', 'u1'], 1)
    vi.advanceTimersByTime(WRITE_DELAY_MS)
    const before = localStorage.getItem(SNAPSHOT_KEY)
    client.clear()
    vi.advanceTimersByTime(WRITE_DELAY_MS * 2)
    expect(localStorage.getItem(SNAPSHOT_KEY)).toBe(before)
  })

  it('unsubscribe stops writing', () => {
    const stop = startSnapshot(client, () => 'u1')
    stop()
    client.setQueryData(['me', 'u1'], 1)
    vi.advanceTimersByTime(WRITE_DELAY_MS)
    expect(localStorage.getItem(SNAPSHOT_KEY)).toBeNull()
  })

  it('restores queries into a new client with the same dataUpdatedAt and returns the owner', () => {
    startSnapshot(client, () => 'u1')
    client.setQueryData(['board', 'u1', 'today'], { a: 1 })
    vi.advanceTimersByTime(WRITE_DELAY_MS)
    const savedAt = client.getQueryState(['board', 'u1', 'today'])?.dataUpdatedAt
    const fresh = new QueryClient()
    expect(restoreSnapshot(fresh)).toBe('u1')
    expect(fresh.getQueryData(['board', 'u1', 'today'])).toEqual({ a: 1 })
    expect(fresh.getQueryState(['board', 'u1', 'today'])?.dataUpdatedAt).toBe(savedAt)
    expect(readSnapshotOwner()).toBe('u1')
    fresh.clear()
  })

  it('keeps restored queries that nothing observes for longer than the default 5 minutes', () => {
    startSnapshot(client, () => 'u1')
    client.setQueryData(['board', 'u1', 'plan', 'a', 'b'], 'p')
    vi.advanceTimersByTime(WRITE_DELAY_MS)
    const fresh = new QueryClient()
    restoreSnapshot(fresh)
    vi.advanceTimersByTime(10 * 60 * 1000)
    expect(fresh.getQueryData(['board', 'u1', 'plan', 'a', 'b'])).toBe('p')
    fresh.clear()
  })

  it('keeps a restored query after an observer with the default gcTime came and went', () => {
    startSnapshot(client, () => 'u1')
    client.setQueryData(['board', 'u1', 'plan', 'a', 'b'], 'p')
    vi.advanceTimersByTime(WRITE_DELAY_MS)
    const fresh = new QueryClient()
    restoreSnapshot(fresh)
    const observer = new QueryObserver(fresh, { queryKey: ['board', 'u1', 'plan', 'a', 'b'], queryFn: () => 'p', staleTime: Infinity })
    observer.subscribe(() => undefined)()
    vi.advanceTimersByTime(10 * 60 * 1000)
    expect(fresh.getQueryData(['board', 'u1', 'plan', 'a', 'b'])).toBe('p')
    fresh.clear()
  })

  it('does not load a snapshot older than MAX_AGE_MS, and deletes it', () => {
    startSnapshot(client, () => 'u1')
    client.setQueryData(['me', 'u1'], 1)
    vi.advanceTimersByTime(WRITE_DELAY_MS)
    const fresh = new QueryClient()
    expect(restoreSnapshot(fresh, Date.now() + MAX_AGE_MS + 1)).toBeNull()
    expect(fresh.getQueryData(['me', 'u1'])).toBeUndefined()
    expect(localStorage.getItem(SNAPSHOT_KEY)).toBeNull()
    fresh.clear()
  })

  it('does not load a wrong version or broken JSON, and deletes the key', () => {
    const fresh = new QueryClient()
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ version: 2, userId: 'u1', state: { mutations: [], queries: [] } }))
    expect(restoreSnapshot(fresh)).toBeNull()
    expect(localStorage.getItem(SNAPSHOT_KEY)).toBeNull()
    localStorage.setItem(SNAPSHOT_KEY, '{not json')
    expect(restoreSnapshot(fresh)).toBeNull()
    expect(localStorage.getItem(SNAPSHOT_KEY)).toBeNull()
    expect(readSnapshotOwner()).toBeNull()
    fresh.clear()
  })

  it('does not throw when localStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    startSnapshot(client, () => 'u1')
    client.setQueryData(['me', 'u1'], 1)
    expect(() => vi.advanceTimersByTime(WRITE_DELAY_MS)).not.toThrow()
  })

  it('clearSnapshot removes the key and the owner reads as null', () => {
    startSnapshot(client, () => 'u1')
    client.setQueryData(['me', 'u1'], 1)
    vi.advanceTimersByTime(WRITE_DELAY_MS)
    expect(readSnapshotOwner()).toBe('u1')
    clearSnapshot()
    expect(localStorage.getItem(SNAPSHOT_KEY)).toBeNull()
    expect(readSnapshotOwner()).toBeNull()
  })
})
