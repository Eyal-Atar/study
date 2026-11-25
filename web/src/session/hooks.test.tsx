import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FIVE_MINUTES_MS, minutesLeft, type FocusSession } from './focusSession'
import { useFocusClock } from './useFocusClock'
import { useWakeLock } from './useWakeLock'

const MINUTE = 60_000
const T0 = Date.parse('2026-11-25T10:00:00Z')

function five(startedAt: number, minutes: number): FocusSession {
  return { v: 1, blockId: 'b1', startedAt, endsAt: startedAt + minutes * MINUTE, fiveEndsAt: startedAt + FIVE_MINUTES_MS }
}

let visibility: DocumentVisibilityState = 'visible'

function setVisibility(state: DocumentVisibilityState) {
  visibility = state
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

// One act per step: React renders the new `now`, and with it sets the next timeout, when act ends.
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

const left = (clock: { phaseLeftMs: number } | null) => minutesLeft(clock?.phaseLeftMs ?? -1)

beforeEach(() => {
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})

afterEach(() => {
  // The own property goes, and the prototype's getter is back.
  delete (document as { visibilityState?: unknown }).visibilityState
})

describe('useFocusClock', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps one timeout for the next change, and walks from the five minutes into the full block', () => {
    const { result } = renderHook(() => useFocusClock(five(T0, 60)))
    expect(result.current.clock?.phase).toBe('five')
    expect(left(result.current.clock)).toBe(5)
    expect(vi.getTimerCount()).toBe(1)

    advance(60_000)
    expect(left(result.current.clock)).toBe(4)
    expect(result.current.now).toBe(T0 + MINUTE)
    expect(vi.getTimerCount()).toBe(1)

    for (let i = 0; i < 4; i++) advance(60_000)
    expect(result.current.clock?.phase).toBe('full')
    expect(left(result.current.clock)).toBe(55)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('a timeout is set for the change itself, not a tick each second', () => {
    const { result } = renderHook(() => useFocusClock(five(T0, 60)))
    advance(59_999)
    expect(result.current.now).toBe(T0)
    advance(1)
    expect(result.current.now).toBe(T0 + MINUTE)
  })

  it('a hidden tab comes back to the right number at once, without any timer running in between', () => {
    const session = five(T0, 60)
    const { result } = renderHook(() => useFocusClock(session))
    setVisibility('hidden')
    // Thirty minutes of a locked phone: the wall clock moves, no timer fires.
    vi.setSystemTime(T0 + 30 * MINUTE)
    expect(left(result.current.clock)).toBe(5)
    setVisibility('visible')
    expect(result.current.clock?.phase).toBe('full')
    expect(left(result.current.clock)).toBe(30)
    expect(result.current.now).toBe(T0 + 30 * MINUTE)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('coming back after the end shows the end, with no timer left', () => {
    const { result } = renderHook(() => useFocusClock(five(T0, 60)))
    vi.setSystemTime(T0 + 61 * MINUTE)
    setVisibility('visible')
    expect(result.current.clock?.phase).toBe('over')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('pageshow (a page back from the back-forward cache) also redraws at once', () => {
    const { result } = renderHook(() => useFocusClock(five(T0, 60)))
    vi.setSystemTime(T0 + 20 * MINUTE)
    act(() => {
      window.dispatchEvent(new Event('pageshow'))
    })
    expect(left(result.current.clock)).toBe(40)
  })

  it('a session that is over has no timer', () => {
    const { result } = renderHook(() => useFocusClock(five(T0 - 2 * 60 * MINUTE, 60)))
    expect(result.current.clock?.phase).toBe('over')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('without a session there is no clock and no timer', () => {
    const { result } = renderHook(() => useFocusClock(null))
    expect(result.current.clock).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a session that arrives after the mount catches up to the time it arrived', () => {
    const { result, rerender } = renderHook(({ s }: { s: FocusSession | null }) => useFocusClock(s), {
      initialProps: { s: null as FocusSession | null },
    })
    vi.setSystemTime(T0 + 10_000)
    rerender({ s: five(T0 + 10_000, 60) })
    advance(0)
    expect(result.current.now).toBe(T0 + 10_000)
    expect(left(result.current.clock)).toBe(5)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('unmounting clears the timer and the listeners', () => {
    const { result, unmount } = renderHook(() => useFocusClock(five(T0, 60)))
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    vi.setSystemTime(T0 + 20 * MINUTE)
    setVisibility('visible')
    act(() => {
      window.dispatchEvent(new Event('pageshow'))
    })
    expect(result.current.now).toBe(T0)
  })
})

interface FakeSentinel {
  released: boolean
  release: ReturnType<typeof vi.fn<() => Promise<void>>>
}

function fakeSentinel(): FakeSentinel {
  const s: FakeSentinel = {
    released: false,
    release: vi.fn(() => {
      s.released = true
      return Promise.resolve()
    }),
  }
  return s
}

function installWakeLock(request: () => Promise<unknown>) {
  const fn = vi.fn(request)
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: fn } })
  return fn
}

// Lets the promise of request() settle.
async function settle() {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('useWakeLock', () => {
  afterEach(() => {
    delete (navigator as { wakeLock?: unknown }).wakeLock
  })

  it('asks for the screen once when active, again when the page comes back with the lock released, and releases on false', async () => {
    const sentinels: FakeSentinel[] = []
    const request = installWakeLock(() => {
      const s = fakeSentinel()
      sentinels.push(s)
      return Promise.resolve(s)
    })
    const { rerender } = renderHook(
      ({ active }) => {
        useWakeLock(active)
      },
      { initialProps: { active: true } },
    )
    await settle()
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('screen')

    // The browser lets the lock go when the page hides.
    setVisibility('hidden')
    const [first] = sentinels
    if (first) first.released = true
    setVisibility('visible')
    await settle()
    expect(request).toHaveBeenCalledTimes(2)

    // Shown again while the lock still holds: no new request.
    setVisibility('visible')
    await settle()
    expect(request).toHaveBeenCalledTimes(2)

    rerender({ active: false })
    expect(sentinels[1]?.release).toHaveBeenCalledTimes(1)
    setVisibility('visible')
    await settle()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('releases on unmount, and stops listening', async () => {
    const s = fakeSentinel()
    const request = installWakeLock(() => Promise.resolve(s))
    const { unmount } = renderHook(() => {
      useWakeLock(true)
    })
    await settle()
    unmount()
    expect(s.release).toHaveBeenCalledTimes(1)
    setVisibility('visible')
    await settle()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does not ask while the page is hidden, and asks when it shows', async () => {
    const request = installWakeLock(() => Promise.resolve(fakeSentinel()))
    visibility = 'hidden'
    renderHook(() => {
      useWakeLock(true)
    })
    await settle()
    expect(request).not.toHaveBeenCalled()
    setVisibility('visible')
    await settle()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does nothing while not active', async () => {
    const request = installWakeLock(() => Promise.resolve(fakeSentinel()))
    renderHook(() => {
      useWakeLock(false)
    })
    await settle()
    expect(request).not.toHaveBeenCalled()
  })

  it('a lock that arrives after it is no longer wanted is released at once', async () => {
    const s = fakeSentinel()
    let resolve: (v: unknown) => void = () => undefined
    installWakeLock(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    const { rerender } = renderHook(
      ({ active }) => {
        useWakeLock(active)
      },
      { initialProps: { active: true } },
    )
    rerender({ active: false })
    resolve(s)
    await settle()
    expect(s.release).toHaveBeenCalledTimes(1)
  })

  it('without the API it does not throw', () => {
    expect('wakeLock' in navigator).toBe(false)
    expect(() =>
      renderHook(() => {
        useWakeLock(true)
      }),
    ).not.toThrow()
  })

  it('a refused request, and a release that fails, leave no unhandled rejection', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      installWakeLock(() => Promise.reject(new DOMException('denied', 'NotAllowedError')))
      const first = renderHook(() => {
        useWakeLock(true)
      })
      await settle()
      first.unmount()

      const s = fakeSentinel()
      s.release.mockImplementation(() => Promise.reject(new Error('gone')))
      installWakeLock(() => Promise.resolve(s))
      const second = renderHook(() => {
        useWakeLock(true)
      })
      await settle()
      second.unmount()
      expect(s.release).toHaveBeenCalledTimes(1)
      await new Promise((r) => setTimeout(r, 0))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
