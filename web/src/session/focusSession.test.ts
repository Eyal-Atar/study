import { act, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block } from '../board/types'
import { useBoardUserId } from '../board/api'
import { silentApi } from '../test/fakeApi'
import { makeBlock, renderBoard } from '../test/boardFixtures'
import {
  FIVE_MINUTES_MS,
  SESSION_MAX_AGE_MS,
  breakAfterFocus,
  canFocus,
  canStartFive,
  clearSession,
  focusClock,
  focusPath,
  focusStorageKey,
  isLive,
  minutesLeft,
  newSession,
  readSession,
  useFocusSession,
  useStartFocus,
  writeSession,
  type FocusSession,
} from './focusSession'

const MIN = 60_000
const t = (hhmm: string) => Date.parse(`2026-11-25T${hhmm}:00Z`)
const at = (hhmm: string) => `2026-11-25T${hhmm}:00Z`

function blk(start: string, end: string, overrides: Partial<Block> = {}): Block {
  return makeBlock({
    starts_at: at(start),
    ends_at: at(end),
    study_date: '2026-11-25',
    ...overrides,
  })
}

function fakeStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
}

const session = (over: Partial<FocusSession> = {}): FocusSession => ({
  v: 1,
  blockId: 'block-1',
  startedAt: t('10:00'),
  endsAt: t('11:00'),
  fiveEndsAt: null,
  ...over,
})

describe('paths and constants', () => {
  it('builds the path', () => {
    expect(focusPath('a b/c')).toBe('/focus/a%20b%2Fc')
    expect(FIVE_MINUTES_MS).toBe(300_000)
    expect(SESSION_MAX_AGE_MS).toBe(43_200_000)
    expect(focusStorageKey('user-a')).toBe('archi.focus.user-a')
  })
})

describe('canFocus', () => {
  const now = t('12:20')
  it('planned block of today: not started, or running', () => {
    expect(canFocus(blk('14:00', '15:00'), '2026-11-25', now)).toBe(true)
    expect(canFocus(blk('12:00', '13:30'), '2026-11-25', now)).toBe(true)
  })
  it('false for ended, done, and another day; decided by the times, not by state', () => {
    expect(canFocus(blk('11:00', '12:00'), '2026-11-25', now)).toBe(false)
    expect(canFocus(blk('11:00', '12:20'), '2026-11-25', now)).toBe(false)
    expect(canFocus(blk('14:00', '15:00', { status: 'done', state: 'done' }), '2026-11-25', now)).toBe(false)
    expect(canFocus(blk('14:00', '15:00', { study_date: '2026-11-26' }), '2026-11-25', now)).toBe(false)
    expect(canFocus(blk('11:00', '12:00', { state: 'upcoming' }), '2026-11-25', now)).toBe(false)
  })
})

describe('newSession', () => {
  it('a running block ends with the block', () => {
    const s = newSession(blk('12:00', '13:30'), 'full', t('12:20'))
    expect(s).toEqual({
      v: 1,
      blockId: 'block-1',
      startedAt: t('12:20'),
      endsAt: t('13:30'),
      fiveEndsAt: null,
    })
  })
  it('a block that has not started lasts its length from now', () => {
    expect(newSession(blk('14:00', '15:00'), 'full', t('09:25')).endsAt).toBe(t('10:25'))
  })
  it('five ends 5 minutes from now, or with the session when less is left', () => {
    const now = t('12:20')
    expect(newSession(blk('12:00', '13:30'), 'five', now).fiveEndsAt).toBe(now + 300_000)
    const s = newSession(blk('12:00', '12:23'), 'five', now)
    expect(s.fiveEndsAt).toBe(s.endsAt)
  })
})

describe('canStartFive', () => {
  const b = blk('12:00', '13:00')
  it('needs more than 5 minutes left', () => {
    expect(canStartFive(b, t('12:54'))).toBe(true)
    expect(canStartFive(b, t('12:55'))).toBe(false)
    expect(canStartFive(b, t('12:57'))).toBe(false)
  })
})

describe('focusClock', () => {
  const s = newSession(blk('10:00', '11:00'), 'five', t('10:00'))
  it('five phase', () => {
    const c = focusClock(s, t('10:00'))
    expect(c.phase).toBe('five')
    expect(c.phaseLeftMs).toBe(300_000)
    expect(minutesLeft(c.phaseLeftMs)).toBe(5)
    expect(c.nextChangeAt).toBe(s.startedAt + 60_000)
    expect(c.totalMs).toBe(60 * MIN)
    expect(focusClock(s, s.startedAt + 4.5 * MIN).nextChangeAt).toBe(s.fiveEndsAt)
  })
  it('switches to full with a continuous elapsed', () => {
    const c = focusClock(s, s.fiveEndsAt as number)
    expect(c.phase).toBe('full')
    expect(c.phaseLeftMs).toBe(55 * MIN)
    expect(c.elapsedMs).toBe(300_000)
  })
  it('over at endsAt', () => {
    const c = focusClock(s, s.endsAt)
    expect(c.phase).toBe('over')
    expect(c.nextChangeAt).toBeNull()
    expect(c.phaseLeftMs).toBe(0)
    expect(c.elapsedMs).toBe(c.totalMs)
  })
  it('clips elapsed to 0 before the start', () => {
    expect(focusClock(s, s.startedAt - 1000).elapsedMs).toBe(0)
  })
  it('full phase: next change when the minute drops', () => {
    const f = session()
    expect(focusClock(f, t('10:00')).nextChangeAt).toBe(t('10:01'))
    expect(focusClock(f, t('10:59') + 30_000).nextChangeAt).toBe(t('11:00'))
  })
})

describe('minutesLeft', () => {
  it('rounds up', () => {
    expect([0, 1, 60_000, 60_001, -5].map(minutesLeft)).toEqual([0, 1, 1, 2, 0])
  })
})

describe('isLive', () => {
  it('same block and not over', () => {
    const s = session()
    expect(isLive(s, 'block-1', t('10:30'))).toBe(true)
    expect(isLive(s, 'block-1', t('11:00'))).toBe(false)
    expect(isLive(s, 'other', t('10:30'))).toBe(false)
    expect(isLive(null, 'block-1', t('10:30'))).toBe(false)
  })
})

describe('breakAfterFocus', () => {
  const done = (s: string, e: string, id: string) => blk(s, e, { id, status: 'done', state: 'done' })
  const now = t('11:30')
  it('true with two done blocks and a 30 minute session ending now', () => {
    // two done blocks of 45 minutes that ended 5 minutes ago, then a 30 minute session
    const todays = [done('09:25', '10:10', 'd1'), done('10:10', '10:55', 'd2'), blk('11:00', '12:00')]
    const ses = session({ startedAt: t('11:00'), endsAt: t('12:00') })
    expect(breakAfterFocus(todays, todays[2] as Block, ses, now)).toBe(true)
  })
  it('false without the done blocks', () => {
    const b = blk('11:00', '12:00')
    expect(breakAfterFocus([b], b, session({ startedAt: t('11:00'), endsAt: t('12:00') }), now)).toBe(false)
  })
  it('a block planned for 14:00 whose session ran 10:00-11:30 counts', () => {
    const b = blk('14:00', '15:00')
    expect(breakAfterFocus([b], b, session({ startedAt: t('10:00'), endsAt: t('15:00') }), now)).toBe(true)
  })
  it('a session that ended 40 minutes ago counts to its end, not to the Done: no break', () => {
    const todays = [done('09:25', '10:10', 'd1'), done('10:10', '10:55', 'd2'), blk('11:00', '12:00')]
    const ses = session({ startedAt: t('11:00'), endsAt: t('11:30') })
    expect(breakAfterFocus(todays, todays[2] as Block, ses, t('12:10'))).toBe(false)
  })
  it('adds the block when it is not in the list', () => {
    const b = blk('14:00', '15:00')
    expect(breakAfterFocus([], b, session({ startedAt: t('10:00'), endsAt: t('15:00') }), now)).toBe(true)
  })
})

describe('storage', () => {
  const key = 'archi.focus.user-a'
  it('round trips', () => {
    const st = fakeStore()
    const s = session()
    writeSession('user-a', s, st)
    expect(st.data.has(key)).toBe(true)
    expect(readSession('user-a', t('10:30'), st)).toEqual(s)
    clearSession('user-a', st)
    expect(st.data.has(key)).toBe(false)
  })
  it.each([
    ['broken json', '{nope'],
    ['v 2', JSON.stringify({ ...session(), v: 2 })],
    ['missing field', JSON.stringify({ v: 1, blockId: 'x', startedAt: 1, endsAt: 2 })],
    ['wrong type', JSON.stringify({ ...session(), startedAt: '1' })],
    ['ended 13 hours ago', JSON.stringify(session({ endsAt: t('11:00') }))],
  ])('%s: null and the key is removed', (_n, raw) => {
    const st = fakeStore({ [key]: raw })
    expect(readSession('user-a', t('11:00') + 13 * 60 * MIN, st)).toBeNull()
    expect(st.data.has(key)).toBe(false)
  })
  // Read in the middle of the session, so only the shape can turn them down.
  it.each([
    ['an infinite end', JSON.stringify(session()).replace(/"endsAt":\d+/, '"endsAt":1e999')],
    ['ends before it starts', JSON.stringify(session({ startedAt: t('11:00'), endsAt: t('10:00') }))],
    ['ends as it starts', JSON.stringify(session({ startedAt: t('10:00'), endsAt: t('10:00') }))],
    ['five ends after the session', JSON.stringify(session({ fiveEndsAt: t('11:05') }))],
    ['five ends at the start', JSON.stringify(session({ fiveEndsAt: t('10:00') }))],
  ])('%s: null and the key is removed', (_n, raw) => {
    const st = fakeStore({ [key]: raw })
    expect(readSession('user-a', t('10:30'), st)).toBeNull()
    expect(st.data.has(key)).toBe(false)
  })
  it('a session that ended exactly the maximum age ago is still read', () => {
    const st = fakeStore({ [key]: JSON.stringify(session()) })
    expect(readSession('user-a', t('11:00') + SESSION_MAX_AGE_MS, st)).toEqual(session())
  })
  it('a five that ends with the session is a valid session', () => {
    const s = session({ fiveEndsAt: t('11:00') })
    const st = fakeStore({ [key]: JSON.stringify(s) })
    expect(readSession('user-a', t('10:30'), st)).toEqual(s)
  })
  it('a throwing getItem is no session', () => {
    const st = {
      getItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {},
    }
    expect(readSession('user-a', t('10:30'), st)).toBeNull()
  })
  it('a throwing setItem or removeItem does not throw', () => {
    const boom = () => {
      throw new Error('blocked')
    }
    expect(() => {
      writeSession('user-a', session(), { setItem: boom })
    }).not.toThrow()
    expect(() => {
      clearSession('user-a', { removeItem: boom })
    }).not.toThrow()
  })
})

describe('hooks', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(t('10:30'))
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
    window.localStorage.clear()
  })

  async function renderHooks() {
    const holder: {
      current: {
        s: FocusSession | null
        start: ReturnType<typeof useStartFocus>
      } | null
    } = { current: null }
    const userIds: (string | null)[] = []
    const seen: (FocusSession | null)[] = []
    function Probe() {
      const s = useFocusSession()
      const start = useStartFocus()
      userIds.push(useBoardUserId())
      holder.current = { s, start }
      seen.push(s)
      return null
    }
    const r = renderBoard(createElement(Probe), { api: silentApi() })
    await waitFor(() => {
      expect(userIds.at(-1)).toBe('user-a')
    })
    return { ...r, holder, seen }
  }

  it('writeSession updates the hook, and a rerender returns the same object', async () => {
    const { holder } = await renderHooks()
    expect(holder.current?.s).toBeNull()
    act(() => {
      writeSession('user-a', session())
    })
    const first = holder.current?.s
    expect(first).toEqual(session())
    act(() => void window.dispatchEvent(new StorageEvent('storage', { key: 'archi.focus.user-a' })))
    expect(holder.current?.s).toBe(first)
    act(() => {
      clearSession('user-a')
    })
    expect(holder.current?.s).toBeNull()
  })

  it('a storage event for the key updates; another user key does not', async () => {
    const { holder } = await renderHooks()
    act(() => {
      window.localStorage.setItem('archi.focus.user-a', JSON.stringify(session()))
      window.dispatchEvent(new StorageEvent('storage', { key: 'archi.focus.user-a' }))
    })
    expect(holder.current?.s).toEqual(session())
    act(() => {
      window.localStorage.setItem('archi.focus.user-a', JSON.stringify(session({ blockId: 'zzz' })))
      window.dispatchEvent(new StorageEvent('storage', { key: 'archi.focus.user-b' }))
    })
    expect(holder.current?.s?.blockId).toBe('block-1')
  })

  it('a storage event with no key (storage cleared elsewhere) updates', async () => {
    const { holder } = await renderHooks()
    act(() => {
      writeSession('user-a', session())
    })
    expect(holder.current?.s).toEqual(session())
    act(() => {
      window.localStorage.clear()
      window.dispatchEvent(new StorageEvent('storage', { key: null }))
    })
    expect(holder.current?.s).toBeNull()
  })

  it('a full storage: the new session wins over the old one still stored', async () => {
    const { holder } = await renderHooks()
    act(() => {
      writeSession('user-a', session())
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    act(() => {
      writeSession('user-a', session({ blockId: 'block-2' }))
    })
    expect(holder.current?.s?.blockId).toBe('block-2')
    set.mockRestore()
  })

  it('a full storage that cannot even remove the old session: memory still comes first', async () => {
    const { holder } = await renderHooks()
    act(() => {
      writeSession('user-a', session())
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    act(() => {
      writeSession('user-a', session({ blockId: 'block-3' }))
    })
    expect(holder.current?.s?.blockId).toBe('block-3')
    set.mockRestore()
    remove.mockRestore()
    act(() => {
      clearSession('user-a')
    })
  })

  it('useStartFocus: a block that has already ended only navigates, with no session', async () => {
    const { holder, router } = await renderHooks()
    act(() => holder.current?.start(blk('09:00', '10:30'), 'full'))
    expect(router.state.location.pathname).toBe('/focus/block-1')
    expect(holder.current?.s).toBeNull()
    expect(window.localStorage.getItem('archi.focus.user-a')).toBeNull()
  })

  it('keeps the session in memory when storage throws', async () => {
    const { holder } = await renderHooks()
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    act(() => {
      writeSession('user-a', session())
    })
    expect(holder.current?.s).toEqual(session())
    act(() => {
      clearSession('user-a')
    })
    expect(holder.current?.s).toBeNull()
    spy.mockRestore()
    get.mockRestore()
  })

  it('useStartFocus: a live session for the same block with full only navigates', async () => {
    const { holder, router } = await renderHooks()
    const b = blk('10:00', '11:00')
    act(() => holder.current?.start(b, 'full'))
    const started = holder.current?.s
    expect(started?.startedAt).toBe(t('10:30'))
    expect(router.state.location.pathname).toBe('/focus/block-1')
    vi.setSystemTime(t('10:40'))
    act(() => holder.current?.start(b, 'full'))
    expect(holder.current?.s?.startedAt).toBe(t('10:30'))
  })

  it('useStartFocus: no session writes, another block replaces', async () => {
    const { holder } = await renderHooks()
    act(() => holder.current?.start(blk('10:00', '11:00'), 'five'))
    expect(holder.current?.s?.fiveEndsAt).toBe(t('10:35'))
    act(() => holder.current?.start(blk('10:00', '11:30', { id: 'block-2' }), 'full'))
    expect(holder.current?.s?.blockId).toBe('block-2')
    const stored = JSON.parse(window.localStorage.getItem('archi.focus.user-a') ?? '{}') as Partial<FocusSession>
    expect(stored.blockId).toBe('block-2')
  })
})
