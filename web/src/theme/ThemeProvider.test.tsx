import { act, cleanup, render } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEME_STORAGE_KEY, type ThemeChoice } from './theme'
import { THEME_SWITCH_MS, ThemeProvider, useTheme, type ThemeState } from './ThemeProvider'

// The clock is always frozen: 25 Nov 2026, local time, at the hour each test sets.
function at(hours: number, minutes = 0, seconds = 0): Date {
  return new Date(2026, 10, 25, hours, minutes, seconds)
}

// A device storage behind getItem / setItem, as the provider uses it.
function memoryStorage(initial?: ThemeChoice, { throwOnWrite = false } = {}) {
  const map = new Map<string, string>()
  if (initial !== undefined) map.set(THEME_STORAGE_KEY, initial)
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (throwOnWrite) throw new Error('QuotaExceededError')
      map.set(key, value)
    },
    removeItem: (key: string) => map.delete(key),
    clear: () => {
      map.clear()
    },
    key: () => null,
    get length() {
      return map.size
    },
  } as unknown as Storage
  return { storage, map }
}

function setup(storage: Storage | null) {
  const holder: { state?: ThemeState } = {}
  function Grab() {
    holder.state = useTheme()
    return null
  }
  const result = render(
    <StrictMode>
      <ThemeProvider storage={storage}>
        <Grab />
      </ThemeProvider>
    </StrictMode>,
  )
  const state = () => {
    if (holder.state === undefined) throw new Error('no theme state')
    return holder.state
  }
  return { ...result, state }
}

const html = () => document.documentElement
const meta = () => document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
const switching = () => html().hasAttribute('data-theme-switching')

let visibility: DocumentVisibilityState = 'visible'

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' && reduce,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(at(12))
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  const tag = document.createElement('meta')
  tag.name = 'theme-color'
  tag.content = '#4f7a3a'
  document.head.append(tag)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  meta()?.remove()
  html().removeAttribute('data-theme')
  html().removeAttribute('data-theme-switching')
})

describe('ThemeProvider', () => {
  it('at 12:00 with nothing stored the choice is auto and the theme day', () => {
    const { state } = setup(memoryStorage().storage)
    expect(state().choice).toBe('auto')
    expect(state().theme).toBe('day')
    expect(html().dataset.theme).toBe('day')
    expect(meta()?.content).toBe('#4f7a3a')
  })

  it('at 21:30 with auto the theme is dusk, and so is the browser bar, with no switching on load', () => {
    vi.setSystemTime(at(21, 30))
    const { state } = setup(memoryStorage('auto').storage)
    expect(state().theme).toBe('dusk')
    expect(html().dataset.theme).toBe('dusk')
    expect(meta()?.content).toBe('#1b1612')
    expect(switching()).toBe(false)
  })

  it('without a meta theme-color it still sets data-theme', () => {
    meta()?.remove()
    vi.setSystemTime(at(21, 30))
    setup(memoryStorage().storage)
    expect(html().dataset.theme).toBe('dusk')
  })

  it('switches to dusk at 19:00 (a second after the boundary) and fades for 400ms', () => {
    vi.setSystemTime(at(18, 59, 30))
    const { state } = setup(memoryStorage().storage)
    expect(state().theme).toBe('day')
    expect(switching()).toBe(false)

    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(html().dataset.theme).toBe('day')

    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(state().theme).toBe('dusk')
    expect(html().dataset.theme).toBe('dusk')
    expect(meta()?.content).toBe('#1b1612')
    expect(switching()).toBe(true)

    act(() => {
      vi.advanceTimersByTime(THEME_SWITCH_MS - 1)
    })
    expect(switching()).toBe(true)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(switching()).toBe(false)
  })

  it('after 19:00 it arms the next switch, and is day again at 06:00', () => {
    vi.setSystemTime(at(18, 59, 30))
    setup(memoryStorage().storage)
    act(() => {
      vi.advanceTimersByTime(31_000)
    })
    expect(html().dataset.theme).toBe('dusk')
    // 19:00:01 → 06:00:01 tomorrow is 11 hours.
    act(() => {
      vi.advanceTimersByTime(11 * 3600_000 - 1)
    })
    expect(html().dataset.theme).toBe('dusk')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(html().dataset.theme).toBe('day')
  })

  it('with reduced motion the same switch never sets data-theme-switching', () => {
    stubReducedMotion(true)
    vi.setSystemTime(at(18, 59, 30))
    const observed: boolean[] = []
    const observer = new MutationObserver(() => {
      observed.push(switching())
    })
    observer.observe(html(), { attributes: true })
    setup(memoryStorage().storage)
    act(() => {
      vi.advanceTimersByTime(31_000)
    })
    expect(html().dataset.theme).toBe('dusk')
    expect(switching()).toBe(false)
    act(() => {
      vi.advanceTimersByTime(THEME_SWITCH_MS)
    })
    observer.disconnect()
    expect(observed).not.toContain(true)
  })

  it('without reduced motion the stubbed media query lets the fade run', () => {
    stubReducedMotion(false)
    const { state } = setup(memoryStorage().storage)
    act(() => {
      state().setChoice('dusk')
    })
    expect(switching()).toBe(true)
  })

  it('a second switch during the fade restarts its 400ms', () => {
    const { state } = setup(memoryStorage().storage)
    act(() => {
      state().setChoice('dusk')
    })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    act(() => {
      state().setChoice('day')
    })
    expect(html().dataset.theme).toBe('day')
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(switching()).toBe(true)
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(switching()).toBe(false)
  })

  it('setChoice stores the choice and applies it at once', () => {
    const { storage, map } = memoryStorage()
    const { state } = setup(storage)
    act(() => {
      state().setChoice('dusk')
    })
    expect(state().choice).toBe('dusk')
    expect(state().theme).toBe('dusk')
    expect(html().dataset.theme).toBe('dusk')
    expect(map.get(THEME_STORAGE_KEY)).toBe('dusk')

    act(() => {
      state().setChoice('auto')
    })
    expect(state().choice).toBe('auto')
    expect(state().theme).toBe('day')
    expect(map.get(THEME_STORAGE_KEY)).toBe('auto')
  })

  it('choosing day at 12:00, when it is already day, does not fade', () => {
    const { state } = setup(memoryStorage().storage)
    act(() => {
      state().setChoice('day')
    })
    expect(state().choice).toBe('day')
    expect(html().dataset.theme).toBe('day')
    expect(switching()).toBe(false)
  })

  it('with day chosen there is no clock: at 19:00:30 it is still day', () => {
    vi.setSystemTime(at(18, 59, 30))
    setup(memoryStorage('day').storage)
    expect(vi.getTimerCount()).toBe(0)
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(html().dataset.theme).toBe('day')
  })

  it('choosing auto after day arms the clock again', () => {
    vi.setSystemTime(at(18, 59, 30))
    const { state } = setup(memoryStorage('day').storage)
    act(() => {
      state().setChoice('auto')
    })
    act(() => {
      vi.advanceTimersByTime(31_000)
    })
    expect(html().dataset.theme).toBe('dusk')
  })

  it('a choice made in another tab applies here; another key changes nothing', () => {
    const { storage, map } = memoryStorage()
    const { state } = setup(storage)

    map.set('archi.lastInterrupt', 'x')
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'archi.lastInterrupt', newValue: 'x' }))
    })
    expect(html().dataset.theme).toBe('day')

    map.set(THEME_STORAGE_KEY, 'dusk')
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dusk' }))
    })
    expect(state().choice).toBe('dusk')
    expect(html().dataset.theme).toBe('dusk')
  })

  it('a tab hidden across 19:00 is dusk as soon as it is shown again', () => {
    vi.setSystemTime(at(18, 59, 30))
    setup(memoryStorage().storage)
    visibility = 'hidden'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    // The clock jumps past the boundary while the throttled timer has not run.
    vi.setSystemTime(at(20, 15))
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(html().dataset.theme).toBe('day')

    visibility = 'visible'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(html().dataset.theme).toBe('dusk')

    // The clock was armed again from the new time: the next switch is 06:00 tomorrow.
    act(() => {
      vi.advanceTimersByTime(9 * 3600_000 + 45 * 60_000 + 1_000)
    })
    expect(html().dataset.theme).toBe('day')
  })

  it('focus after the computer slept past 06:00 brings day back', () => {
    vi.setSystemTime(at(23))
    setup(memoryStorage().storage)
    expect(html().dataset.theme).toBe('dusk')
    vi.setSystemTime(at(7, 30))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(html().dataset.theme).toBe('day')
  })

  it('when storage throws on write, setChoice still switches the theme', () => {
    const { state } = setup(memoryStorage(undefined, { throwOnWrite: true }).storage)
    expect(() => {
      act(() => {
        state().setChoice('dusk')
      })
    }).not.toThrow()
    expect(state().choice).toBe('dusk')
    expect(html().dataset.theme).toBe('dusk')
  })

  it('works with no storage at all', () => {
    const { state } = setup(null)
    expect(state().choice).toBe('auto')
    act(() => {
      state().setChoice('dusk')
    })
    expect(html().dataset.theme).toBe('dusk')
  })

  it('takes the clock from the now prop', () => {
    const holder: { state?: ThemeState } = {}
    function Grab() {
      holder.state = useTheme()
      return null
    }
    render(
      <ThemeProvider storage={null} now={() => at(22)}>
        <Grab />
      </ThemeProvider>,
    )
    expect(holder.state?.theme).toBe('dusk')
  })

  it('unmount leaves no timer and no listener, and keeps data-theme', () => {
    vi.setSystemTime(at(18, 59, 30))
    const { storage, map } = memoryStorage()
    const { state, unmount } = setup(storage)
    act(() => {
      state().setChoice('dusk')
    })
    act(() => {
      state().setChoice('auto')
    })
    // The auto clock and the fade are both pending.
    expect(vi.getTimerCount()).toBe(2)

    unmount()
    expect(vi.getTimerCount()).toBe(0)
    expect(html().dataset.theme).toBe('day')
    expect(switching()).toBe(false)

    map.set(THEME_STORAGE_KEY, 'dusk')
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dusk' }))
    vi.setSystemTime(at(20))
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    expect(html().dataset.theme).toBe('day')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('useTheme throws outside ThemeProvider', () => {
    function Lost() {
      useTheme()
      return null
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<Lost />)).toThrow()
  })
})
