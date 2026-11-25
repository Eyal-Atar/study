import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { THEME_STORAGE_KEY, type ThemeChoice } from '../theme/theme'
import { ThemeProvider } from '../theme/ThemeProvider'
import { AppearanceSection } from './AppearanceSection'

const t = en.settingsScreen.appearance

// 25 Nov 2026, local time, at the hour a test asks for.
function at(hours: number, minutes = 0): Date {
  return new Date(2026, 10, 25, hours, minutes)
}

// The device storage behind getItem / setItem, as the provider uses it.
function memoryStorage(initial?: ThemeChoice) {
  const map = new Map<string, string>()
  if (initial !== undefined) map.set(THEME_STORAGE_KEY, initial)
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
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

function open({ hour = 12, minute = 0, initial }: { hour?: number; minute?: number; initial?: ThemeChoice } = {}) {
  const { storage, map } = memoryStorage(initial)
  render(
    <ThemeProvider storage={storage} now={() => at(hour, minute)}>
      <AppearanceSection />
    </ThemeProvider>,
  )
  return { map }
}

const card = () => screen.getByRole('region', { name: t.title })
const group = () => within(card()).getByRole('radiogroup', { name: t.label })
const radio = (name: string) => within(group()).getByRole('radio', { name })
const theme = () => document.documentElement.dataset.theme

afterEach(() => {
  delete document.documentElement.dataset.theme
})

describe('AppearanceSection', () => {
  it('is the Appearance card: Archi’s intro, then Auto, Day and Dusk, with Auto chosen and its hours', () => {
    open()
    expect(within(card()).getByRole('heading', { level: 2, name: t.title })).toBeInTheDocument()
    expect(within(card()).getByText(t.intro)).toBeInTheDocument()
    const radios = within(group()).getAllByRole('radio')
    expect(radios.map((r) => r.textContent)).toEqual([t.auto, t.day, t.dusk])
    expect(radio(t.auto)).toHaveAttribute('aria-checked', 'true')
    expect(within(card()).getByText(t.autoNote('19:00', '06:00'))).toBeInTheDocument()
    expect(t.autoNote('19:00', '06:00')).toBe('I switch to Dusk at 19:00 and back to Day at 06:00.')
  })

  it('every option is a 44px target', () => {
    open()
    for (const name of [t.auto, t.day, t.dusk]) expect(radio(name)).toHaveClass('min-h-touch')
  })

  it('Dusk applies at once, is kept on the device, and says it stays on', async () => {
    const user = userEvent.setup()
    const { map } = open({ hour: 12 })
    expect(theme()).toBe('day')
    await user.click(radio(t.dusk))
    expect(theme()).toBe('dusk')
    expect(map.get(THEME_STORAGE_KEY)).toBe('dusk')
    expect(radio(t.dusk)).toHaveAttribute('aria-checked', 'true')
    expect(within(card()).getByText(t.duskNote)).toBeInTheDocument()
    expect(within(card()).queryByText(t.autoNote('19:00', '06:00'))).not.toBeInTheDocument()
  })

  it('Day at 21:30 turns the evening back to day, and says it stays on', async () => {
    const user = userEvent.setup()
    const { map } = open({ hour: 21, minute: 30 })
    expect(theme()).toBe('dusk')
    await user.click(radio(t.day))
    expect(theme()).toBe('day')
    expect(map.get(THEME_STORAGE_KEY)).toBe('day')
    expect(within(card()).getByText(t.dayNote)).toBeInTheDocument()
    expect(t.dayNote).toBe('I’ll keep Day on, whatever the hour.')
  })

  it('a kept choice is shown as chosen', () => {
    open({ initial: 'dusk' })
    expect(radio(t.dusk)).toHaveAttribute('aria-checked', 'true')
    expect(within(card()).getByText(t.duskNote)).toBeInTheDocument()
  })

  // SegmentedControl's own keyboard (ui/SegmentedControl.test.tsx): the arrows move the focus, and
  // Space chooses. The arrow alone changes nothing, so a student passing over Dusk is not thrown
  // into it.
  it('keyboard: Tab reaches the group on Auto, the right arrow moves to Day, and Space applies it', async () => {
    const user = userEvent.setup()
    const { map } = open({ hour: 21, minute: 30 })
    await user.tab()
    expect(radio(t.auto)).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(radio(t.day)).toHaveFocus()
    expect(theme()).toBe('dusk')
    await user.keyboard(' ')
    expect(radio(t.day)).toHaveAttribute('aria-checked', 'true')
    expect(radio(t.auto)).toHaveAttribute('aria-checked', 'false')
    expect(theme()).toBe('day')
    expect(map.get(THEME_STORAGE_KEY)).toBe('day')
  })

  it.each<ThemeChoice>(['auto', 'day', 'dusk'])('says the choice stays on this device, under %s', (initial) => {
    open({ initial })
    expect(within(card()).getByText(t.device)).toBeInTheDocument()
  })
})
