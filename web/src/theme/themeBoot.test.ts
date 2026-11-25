// The theme boot script runs in <head>, before the app's bundle, so it cannot import theme.ts. Here it
// runs in jsdom as the browser would, and every result is compared with resolveTheme().
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEME_COLOR, THEME_STORAGE_KEY, readChoice, resolveTheme } from './theme'
import { THEME_BOOT_SCRIPT, fillThemeBoot } from './themeBoot'

function runBoot(): void {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function(THEME_BOOT_SCRIPT) as () => void
  run()
}

function store(value: string | null): void {
  if (value === null) localStorage.removeItem(THEME_STORAGE_KEY)
  else localStorage.setItem(THEME_STORAGE_KEY, value)
}

describe('THEME_BOOT_SCRIPT', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    document.documentElement.removeAttribute('data-theme')
    document.head.replaceChildren()
    localStorage.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
    document.head.replaceChildren()
    document.documentElement.removeAttribute('data-theme')
  })

  // Every minute of the day, so the boundary minutes (05:59, 06:00, 18:59, 19:00) are covered, and
  // stored values an older or corrupted write could leave behind.
  it('agrees with resolveTheme at every minute of the day, for every stored value', () => {
    const stored = ['auto', 'day', 'dusk', null, 'garbage', '', 'Dusk', ' dusk', '"dusk"', 'toString']
    let checked = 0
    for (let minute = 0; minute < 24 * 60; minute++) {
      vi.setSystemTime(new Date(2026, 10, 25, Math.floor(minute / 60), minute % 60, 30))
      for (const value of stored) {
        store(value)
        document.documentElement.removeAttribute('data-theme')
        runBoot()
        expect(document.documentElement.dataset.theme, `${String(value)} at minute ${String(minute)}`).toBe(
          resolveTheme(readChoice(localStorage), new Date()),
        )
        checked++
      }
    }
    expect(checked).toBe(1440 * stored.length)
  })

  it('sets dusk at 23:00 with auto, and day at noon', () => {
    vi.setSystemTime(new Date(2026, 10, 25, 23, 0))
    runBoot()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dusk')
    vi.setSystemTime(new Date(2026, 10, 25, 12, 0))
    runBoot()
    expect(document.documentElement.getAttribute('data-theme')).toBe('day')
  })

  it('falls back to auto, without throwing, when localStorage.getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    store('day')
    vi.setSystemTime(new Date(2026, 10, 25, 21, 30))
    expect(runBoot).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('dusk')
    vi.setSystemTime(new Date(2026, 10, 25, 9, 0))
    expect(runBoot).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('day')
  })

  it('writes the theme colour into meta theme-color, and runs without one', () => {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    meta.content = THEME_COLOR.day
    document.head.append(meta)
    vi.setSystemTime(new Date(2026, 10, 25, 22, 0))
    runBoot()
    expect(meta.content).toBe(THEME_COLOR.dusk)
    vi.setSystemTime(new Date(2026, 10, 25, 10, 0))
    runBoot()
    expect(meta.content).toBe(THEME_COLOR.day)
    meta.remove()
    expect(runBoot).not.toThrow()
  })

  it('is ES5: no arrow, const, let or template literal', () => {
    expect(THEME_BOOT_SCRIPT).not.toContain('=>')
    expect(THEME_BOOT_SCRIPT).not.toContain('const ')
    expect(THEME_BOOT_SCRIPT).not.toContain('let ')
    expect(THEME_BOOT_SCRIPT).not.toContain('`')
    // Nothing in it may close the inline <script>.
    expect(THEME_BOOT_SCRIPT).not.toContain('</')
  })
})

describe('fillThemeBoot', () => {
  it('replaces the one placeholder with the script', () => {
    expect(fillThemeBoot('<script>%THEME_BOOT%</script>')).toBe(`<script>${THEME_BOOT_SCRIPT}</script>`)
  })

  it('throws without a placeholder, and with two', () => {
    expect(() => fillThemeBoot('<head></head>')).toThrow()
    expect(() => fillThemeBoot('%THEME_BOOT% %THEME_BOOT%')).toThrow()
  })
})

describe('web/index.html', () => {
  // Read by path: Vite rewrites new URL('…html', import.meta.url) into an asset URL.
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8')

  it('runs the boot script once, in <head>, after meta theme-color and before any module or stylesheet', () => {
    expect(html.split('%THEME_BOOT%')).toHaveLength(2)
    const at = html.indexOf('<script>%THEME_BOOT%</script>')
    expect(at).toBeGreaterThan(html.indexOf('<head>'))
    expect(at).toBeLessThan(html.indexOf('</head>'))
    expect(at).toBeGreaterThan(html.indexOf('<meta name="theme-color"'))
    expect(html.indexOf('<meta name="theme-color"')).toBeGreaterThan(-1)
    for (const later of ['<script type="module"', '<link rel="stylesheet"']) {
      const first = html.indexOf(later)
      if (first !== -1) expect(at).toBeLessThan(first)
    }
  })
})
