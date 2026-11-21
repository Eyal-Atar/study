import { describe, expect, it } from 'vitest'
import { formatEarnedDate, formatNumber, weekdayOf } from './format'

describe('the numbers and dates of the progress board', () => {
  it('formatNumber groups thousands with a comma (en-IL)', () => {
    expect(formatNumber(10000)).toBe('10,000')
    expect(formatNumber(1234567)).toBe('1,234,567')
  })

  it('formatEarnedDate is day, long month and year, on the calendar day of the timezone', () => {
    expect(formatEarnedDate('2026-11-12T10:00:00Z', 'Asia/Jerusalem')).toBe('12 November 2026')
    // 22:30 UTC on the 12th is the 13th in Jerusalem.
    expect(formatEarnedDate('2026-11-12T22:30:00Z', 'Asia/Jerusalem')).toBe('13 November 2026')
    expect(formatEarnedDate('2026-11-12T22:30:00Z', 'UTC')).toBe('12 November 2026')
  })

  it('weekdayOf counts from Sunday = 0', () => {
    expect(weekdayOf('2026-11-22')).toBe(0)
    expect(weekdayOf('2026-11-23')).toBe(1)
    expect(weekdayOf('2026-11-28')).toBe(6)
  })
})
