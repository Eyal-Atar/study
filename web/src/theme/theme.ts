/// <reference lib="dom" />
// Dusk mode (S43): which theme applies at a given moment, and the student's choice on this device.
// The hours, the storage key and the browser-bar colours are written only here: themeBoot.ts builds
// the <head> script from them, and the app reads them from here. No React, no DOM beyond Storage.
// (The lib reference lets vite.config.ts, type-checked without the DOM lib, import this file.)

export type ThemeChoice = 'auto' | 'day' | 'dusk'
export type Theme = 'day' | 'dusk'

export const THEME_CHOICES: readonly ThemeChoice[] = ['auto', 'day', 'dusk']
export const THEME_STORAGE_KEY = 'archi.theme'
// Minutes after local midnight: Auto is Dusk from 19:00 until 06:00, by the device's own clock.
export const DUSK_STARTS_MIN = 1140
export const DAY_STARTS_MIN = 360

// The colour of the browser's bar: index.html's meta theme-color. Day repeats --color-brand (as
// index.html and the manifest do), dusk repeats the dusk --color-canvas.
export const THEME_COLOR: Readonly<Record<Theme, string>> = { day: '#4f7a3a', dusk: '#1b1612' }

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (THEME_CHOICES as readonly string[]).includes(value)
}

export function resolveTheme(choice: ThemeChoice, now: Date): Theme {
  if (choice !== 'auto') return choice
  const m = now.getHours() * 60 + now.getMinutes()
  return m >= DUSK_STARTS_MIN || m < DAY_STARTS_MIN ? 'dusk' : 'day'
}

// The next 06:00 or 19:00, local, strictly after now. Built with the local Date constructor, so a
// day that changes its clock (summer time) still switches at the clock hour.
export function nextSwitchAt(now: Date): Date {
  const y = now.getFullYear()
  const mo = now.getMonth()
  const d = now.getDate()
  const candidates = [d, d + 1].flatMap((day) =>
    [DAY_STARTS_MIN, DUSK_STARTS_MIN].map(
      (min) => new Date(y, mo, day, Math.floor(min / 60), min % 60, 0, 0),
    ),
  )
  const next = candidates.find((at) => at.getTime() > now.getTime())
  // Tomorrow's 19:00 is always after now, so find never misses.
  return next ?? (candidates[candidates.length - 1] as Date)
}

// Anything but a known choice, a missing storage, or a throwing one (private browsing) is 'auto'.
export function readChoice(storage: Pick<Storage, 'getItem'> | null): ThemeChoice {
  if (storage === null) return 'auto'
  try {
    const value = storage.getItem(THEME_STORAGE_KEY)
    return isThemeChoice(value) ? value : 'auto'
  } catch {
    return 'auto'
  }
}

// False when the choice could not be kept (no storage, or it throws); never throws itself.
export function writeChoice(storage: Pick<Storage, 'setItem'> | null, choice: ThemeChoice): boolean {
  if (storage === null) return false
  try {
    storage.setItem(THEME_STORAGE_KEY, choice)
    return true
  } catch {
    return false
  }
}

export function deviceStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

// 1140 → '19:00', 360 → '06:00': the 24-hour clock of en-IL.
export function clockOf(minutes: number): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}
