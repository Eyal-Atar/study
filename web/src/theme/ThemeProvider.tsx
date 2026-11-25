import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { prefersReducedMotion } from '../ui/reducedMotion'
import {
  THEME_COLOR,
  THEME_STORAGE_KEY,
  deviceStorage,
  nextSwitchAt,
  readChoice,
  resolveTheme,
  writeChoice,
  type Theme,
  type ThemeChoice,
} from './theme'

// Dusk mode (S43) while the app is open. The <head> script (themeBoot.ts) has already put the right
// data-theme on <html> before the first paint; this keeps it right afterwards: at 19:00 and 06:00
// under Auto, when the student picks another choice, and when another tab does.

// How long <html> carries data-theme-switching, so the colours fade. Equal to --duration-theme in
// index.css.
export const THEME_SWITCH_MS = 400
// The clock wakes a second after the boundary, so a timer that fires a hair early still lands on
// the new side of it.
const AFTER_BOUNDARY_MS = 1000

export interface ThemeState {
  choice: ThemeChoice
  theme: Theme
  setChoice(choice: ThemeChoice): void
}

const ThemeContext = createContext<ThemeState | null>(null)

export function ThemeProvider({
  children,
  now = () => new Date(),
  storage: storageProp,
}: {
  children: ReactNode
  now?: () => Date
  storage?: Storage | null
}) {
  // Read once: undefined means the device's own storage, null means none.
  const [storage] = useState(() => (storageProp === undefined ? deviceStorage() : storageProp))
  // The clock is read through a ref, so a new `now` on each render does not re-arm the timer.
  const nowRef = useRef(now)
  useLayoutEffect(() => {
    nowRef.current = now
  })

  const [choice, setChoiceState] = useState<ThemeChoice>(() => readChoice(storage))
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(choice, now()))

  const apply = useCallback((next: ThemeChoice) => {
    setChoiceState(next)
    setTheme(resolveTheme(next, nowRef.current()))
  }, [])

  const setChoice = useCallback(
    (next: ThemeChoice) => {
      // A choice that cannot be kept (private browsing) still applies to this visit.
      writeChoice(storage, next)
      apply(next)
    },
    [storage, apply],
  )

  // Another tab changed the choice.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) apply(readChoice(storage))
    }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
    }
  }, [storage, apply])

  // The clock, only under Auto: one timeout to the next boundary, armed again each time it fires.
  // A timer in a background tab or a sleeping computer runs late, so coming back (visible, focus)
  // works the theme out at once and arms the clock again from the real time.
  useEffect(() => {
    if (choice !== 'auto') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const sync = () => {
      clearTimeout(timer)
      const at = nowRef.current()
      setTheme(resolveTheme('auto', at))
      timer = setTimeout(sync, nextSwitchAt(at).getTime() - at.getTime() + AFTER_BOUNDARY_MS)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') sync()
    }
    sync()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', sync)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', sync)
    }
  }, [choice])

  // Put the theme on the document. The first time (the boot script's theme) without a fade; after
  // that a change fades for THEME_SWITCH_MS, unless the student asked for reduced motion.
  const appliedRef = useRef<Theme | null>(null)
  const fadeRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useLayoutEffect(() => {
    const root = document.documentElement
    const previous = appliedRef.current
    appliedRef.current = theme
    root.dataset.theme = theme
    document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
    if (previous === null || previous === theme || prefersReducedMotion()) return
    clearTimeout(fadeRef.current)
    root.setAttribute('data-theme-switching', '')
    fadeRef.current = setTimeout(() => {
      fadeRef.current = undefined
      root.removeAttribute('data-theme-switching')
    }, THEME_SWITCH_MS)
  }, [theme])

  // On unmount the fade stops; data-theme stays, so the page is never left without a theme.
  useEffect(
    () => () => {
      clearTimeout(fadeRef.current)
      fadeRef.current = undefined
      document.documentElement.removeAttribute('data-theme-switching')
    },
    [],
  )

  const value = useMemo<ThemeState>(() => ({ choice, theme, setChoice }), [choice, theme, setChoice])
  return <ThemeContext value={value}>{children}</ThemeContext>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeState {
  const state = useContext(ThemeContext)
  if (state === null) throw new Error('useTheme must be used inside ThemeProvider')
  return state
}
