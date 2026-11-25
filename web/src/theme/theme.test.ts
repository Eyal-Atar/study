// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DAY_STARTS_MIN,
  DUSK_STARTS_MIN,
  THEME_CHOICES,
  THEME_COLOR,
  THEME_STORAGE_KEY,
  clockOf,
  isThemeChoice,
  nextSwitchAt,
  readChoice,
  resolveTheme,
  writeChoice,
} from './theme'

// Local time, built field by field, so the result does not depend on process.env.TZ.
function at(h: number, mi: number, s = 0): Date {
  return new Date(2026, 10, 25, h, mi, s)
}

describe('resolveTheme', () => {
  it.each([
    [5, 59, 'dusk'],
    [6, 0, 'day'],
    [18, 59, 'day'],
    [19, 0, 'dusk'],
    [0, 30, 'dusk'],
    [12, 0, 'day'],
    [23, 59, 'dusk'],
    [0, 0, 'dusk'],
  ] as const)('auto at %i:%i is %s', (h, mi, theme) => {
    expect(resolveTheme('auto', at(h, mi))).toBe(theme)
  })

  it('day and dusk are themselves at every hour', () => {
    for (let h = 0; h < 24; h++) {
      expect(resolveTheme('day', at(h, 0))).toBe('day')
      expect(resolveTheme('dusk', at(h, 0))).toBe('dusk')
    }
  })

  it('has the hours of the plan', () => {
    expect(DUSK_STARTS_MIN).toBe(1140)
    expect(DAY_STARTS_MIN).toBe(360)
    expect(THEME_STORAGE_KEY).toBe('archi.theme')
    expect(THEME_CHOICES).toEqual(['auto', 'day', 'dusk'])
  })
})

describe('nextSwitchAt', () => {
  it('from 12:00 is 19:00 of the same day', () => {
    expect(nextSwitchAt(at(12, 0))).toEqual(at(19, 0))
  })

  it('from 19:00 exactly is 06:00 of the next day', () => {
    expect(nextSwitchAt(at(19, 0))).toEqual(new Date(2026, 10, 26, 6, 0))
  })

  it('from 02:00 is 06:00 of the same day', () => {
    expect(nextSwitchAt(at(2, 0))).toEqual(at(6, 0))
  })

  it('from 05:59:59 is 06:00 of the same day', () => {
    expect(nextSwitchAt(at(5, 59, 59))).toEqual(at(6, 0))
  })

  it('crosses the end of a month', () => {
    expect(nextSwitchAt(new Date(2026, 10, 30, 20, 0))).toEqual(new Date(2026, 11, 1, 6, 0))
  })
})

describe('clockOf', () => {
  it('writes minutes after midnight as a 24-hour clock', () => {
    expect(clockOf(1140)).toBe('19:00')
    expect(clockOf(360)).toBe('06:00')
    expect(clockOf(0)).toBe('00:00')
  })
})

describe('the choice on the device', () => {
  const storing = (value: string | null) => ({ getItem: (key: string) => (key === THEME_STORAGE_KEY ? value : null) })

  it('reads a known choice', () => {
    expect(readChoice(storing('dusk'))).toBe('dusk')
    expect(readChoice(storing('day'))).toBe('day')
  })

  it('falls back to auto for nothing, an unknown value, a throw, or no storage', () => {
    expect(readChoice(storing(null))).toBe('auto')
    expect(readChoice(storing('night'))).toBe('auto')
    expect(
      readChoice({
        getItem: () => {
          throw new Error('SecurityError')
        },
      }),
    ).toBe('auto')
    expect(readChoice(null)).toBe('auto')
  })

  it('writes under the key, and answers false (without throwing) when storage throws or is missing', () => {
    const written: [string, string][] = []
    expect(writeChoice({ setItem: (k, v) => written.push([k, v]) }, 'dusk')).toBe(true)
    expect(written).toEqual([[THEME_STORAGE_KEY, 'dusk']])
    const throwing = {
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(writeChoice(throwing, 'day')).toBe(false)
    expect(writeChoice(null, 'day')).toBe(false)
  })

  it('isThemeChoice accepts exactly the three choices', () => {
    for (const choice of THEME_CHOICES) expect(isThemeChoice(choice)).toBe(true)
    for (const other of ['night', '', 'Dusk', ' dusk', null, undefined, 1, {}]) expect(isThemeChoice(other)).toBe(false)
  })
})

// Read from disk: Vitest does not load CSS content into tests.
const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const duskBlock = /:root\[data-theme='dusk'\]\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''

function hex(source: string, name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(source)
  if (match?.[1] === undefined) throw new Error(`--color-${name} is not defined as #rrggbb`)
  return match[1].toLowerCase()
}

describe('THEME_COLOR', () => {
  // The browser bar cannot read CSS variables, so the hex values are repeated; this keeps them in step.
  it('repeats the day brand and the dusk canvas', () => {
    expect(THEME_COLOR.day.toLowerCase()).toBe(hex(css, 'brand'))
    expect(THEME_COLOR.dusk.toLowerCase()).toBe(hex(duskBlock, 'canvas'))
  })
})
