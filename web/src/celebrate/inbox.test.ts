import { act, renderHook } from '@testing-library/react'
import { createElement, StrictMode, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emitCompleted, type CompletedEvent } from '../board/xpEvents'
import { clearInbox, takeEvents, useCelebrationInbox, useInboxSize } from './inbox'

const NOW = Date.parse('2026-11-25T10:00:00Z')

function done(blockId: string, overrides: Partial<CompletedEvent> = {}): CompletedEvent {
  return { blockId, xp: 20, level: 3, levelUp: false, badgesEarned: [], ...overrides }
}

function strict({ children }: { children: ReactNode }) {
  return createElement(StrictMode, null, children)
}

describe('the celebration inbox', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    takeEvents()
  })

  afterEach(() => {
    takeEvents()
    vi.useRealTimers()
  })

  it('keeps a Done with the time it came, and takeEvents hands it over and empties', () => {
    const { unmount } = renderHook(() => { useCelebrationInbox() })
    emitCompleted(done('block-1', { level: 4, levelUp: true, badgesEarned: ['first_task'] }))

    expect(takeEvents()).toEqual([{ blockId: 'block-1', xp: 20, level: 4, levelUp: true, badgesEarned: ['first_task'], at: NOW }])
    expect(takeEvents()).toEqual([])
    unmount()
  })

  it('keeps its own copy of the badges: a change to the array sent does not reach it', () => {
    const { unmount } = renderHook(() => { useCelebrationInbox() })
    const badges = ['first_task']
    emitCompleted(done('block-1', { badgesEarned: badges }))
    badges.push('task_master_10')
    expect(takeEvents()[0]?.badgesEarned).toEqual(['first_task'])
    unmount()
  })

  it('clearInbox empties it and tells whoever watches the size', () => {
    const inbox = renderHook(() => { useCelebrationInbox() })
    const size = renderHook(() => useInboxSize())
    act(() => {
      emitCompleted(done('block-1'))
    })
    expect(size.result.current).toBe(1)
    act(() => {
      clearInbox()
    })
    expect(size.result.current).toBe(0)
    expect(takeEvents()).toEqual([])
    size.unmount()
    inbox.unmount()
  })

  it('under StrictMode one Done is one event', () => {
    const { unmount } = renderHook(() => { useCelebrationInbox() }, { wrapper: strict })
    emitCompleted(done('block-1'))
    expect(takeEvents()).toHaveLength(1)
    unmount()
  })

  it('two screens that mount the inbox at once still keep one event', () => {
    const first = renderHook(() => { useCelebrationInbox() })
    const second = renderHook(() => { useCelebrationInbox() })
    emitCompleted(done('block-1'))
    expect(takeEvents()).toHaveLength(1)
    first.unmount()
    emitCompleted(done('block-2'))
    expect(takeEvents()).toHaveLength(1)
    second.unmount()
  })

  it('after unmount nothing comes in', () => {
    const { unmount } = renderHook(() => { useCelebrationInbox() })
    unmount()
    emitCompleted(done('block-1'))
    expect(takeEvents()).toEqual([])
  })

  it('holds 20 events at most, and the oldest goes out', () => {
    const { unmount } = renderHook(() => { useCelebrationInbox() })
    for (let i = 1; i <= 21; i += 1) emitCompleted(done(`block-${String(i)}`))
    const events = takeEvents()
    expect(events).toHaveLength(20)
    expect(events[0]?.blockId).toBe('block-2')
    expect(events[19]?.blockId).toBe('block-21')
    unmount()
  })

  it('useInboxSize follows what comes in and what is taken', () => {
    const inbox = renderHook(() => { useCelebrationInbox() })
    const size = renderHook(() => useInboxSize())
    expect(size.result.current).toBe(0)
    act(() => {
      emitCompleted(done('block-1'))
      emitCompleted(done('block-2'))
    })
    expect(size.result.current).toBe(2)
    act(() => {
      takeEvents()
    })
    expect(size.result.current).toBe(0)
    size.unmount()
    inbox.unmount()
  })
})
