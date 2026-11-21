import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { DayStrip } from './DayStrip'

describe('DayStrip', () => {
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
})
