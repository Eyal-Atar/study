import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { en } from '../i18n/en'
import { DayStrip } from './DayStrip'

describe('DayStrip', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-24T10:00:00Z') })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes each day by its weekday letter, Sunday first', () => {
    // Sunday 22 November to Saturday 28 November.
    const days = ['22', '23', '24', '25', '26', '27', '28'].map((d) => ({ date: `2026-11-${d}`, xp: 0 }))
    const { container } = render(<DayStrip days={days} today="2026-11-28" />)
    const letters = [...container.querySelectorAll('li')].map((item) => item.textContent)
    expect(en.progress.days.weekdayLetters).toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S'])
    expect(letters).toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S'])
  })

  it('a strip that starts on a Wednesday starts with W', () => {
    const days = ['25', '26', '27'].map((d) => ({ date: `2026-11-${d}`, xp: 0 }))
    const { container } = render(<DayStrip days={days} today="2026-11-27" />)
    expect([...container.querySelectorAll('li')].map((item) => item.textContent)).toEqual(['W', 'T', 'F'])
  })

  it('marks the days with XP as studied and today with its own mark, one leaf per day', () => {
    const days = ['22', '23', '24'].map((d, i) => ({ date: `2026-11-${d}`, xp: i === 1 ? 50 : 0 }))
    const { container } = render(<DayStrip days={days} today="2026-11-24" />)
    const items = [...container.querySelectorAll('li')]
    expect(items.map((item) => item.dataset.day)).toEqual(['open', 'studied', 'open'])
    expect(items.map((item) => item.hasAttribute('data-today'))).toEqual([false, false, true])
    expect(items.every((item) => item.querySelector('svg') !== null)).toBe(true)
  })

  it('is its own section: the title and the sentence, with no card around it', () => {
    const days = ['22', '23'].map((d) => ({ date: `2026-11-${d}`, xp: d === '22' ? 10 : 0 }))
    render(<DayStrip days={days} today="2026-11-23" />)
    expect(screen.getByRole('heading', { level: 2, name: en.garden.days.title })).toBeInTheDocument()
    expect(screen.getByText(en.progress.days.summary(1, 2))).toBeInTheDocument()
  })
})
