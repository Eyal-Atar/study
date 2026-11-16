import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, dayMonth, studyDateIn, todayIn, weekdayShort } from './dates'

describe('exam dates', () => {
  it('todayIn reads the calendar day in the given zone, not the browser zone', () => {
    // 23:30 UTC is already the next day in Jerusalem (UTC+2 in November).
    const at = new Date('2026-11-16T23:30:00Z')
    expect(todayIn('UTC', at)).toBe('2026-11-16')
    expect(todayIn('Asia/Jerusalem', at)).toBe('2026-11-17')
  })

  it('studyDateIn is the day before until the wake time, in the given zone', () => {
    // 23:00Z on 20.11 is 01:00 on 21.11 in Jerusalem; 07:00Z on 21.11 is 09:00 there.
    expect(studyDateIn('Asia/Jerusalem', '08:00', new Date('2026-11-20T23:00:00Z'))).toBe('2026-11-20')
    expect(studyDateIn('Asia/Jerusalem', '08:00', new Date('2026-11-21T07:00:00Z'))).toBe('2026-11-21')
    // Exactly at the wake time the new day has begun.
    expect(studyDateIn('Asia/Jerusalem', '08:00', new Date('2026-11-21T06:00:00Z'))).toBe('2026-11-21')
    // A sleep time after midnight: 01:30 still belongs to the day before.
    expect(studyDateIn('Asia/Jerusalem', '10:00', new Date('2026-11-20T23:30:00Z'))).toBe('2026-11-20')
  })

  it('addDays crosses months and years', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-11-16', -1)).toBe('2026-11-15')
  })

  it('daysBetween counts calendar days', () => {
    expect(daysBetween('2026-11-16', '2026-11-16')).toBe(0)
    expect(daysBetween('2026-11-16', '2027-01-20')).toBe(65)
    expect(daysBetween('2026-11-16', '2026-11-15')).toBe(-1)
  })

  it('formats a day as weekday and day.month', () => {
    // 2026-11-17 is a Tuesday.
    expect(dayMonth('2026-11-17')).toBe('17.11')
    expect(weekdayShort('2026-11-17')).toMatch(/ג/)
  })
})
