import { describe, expect, it } from 'vitest'
import { he } from '../i18n/he'
import { makeBlock } from '../test/boardFixtures'
import {
  addDays,
  blockMinutes,
  dateIn,
  dayLabel,
  durationText,
  formatDay,
  formatRange,
  formatTime,
  pickTimezone,
  weekStart,
} from './time'

describe('formatTime and formatRange', () => {
  it('shows the time in the timezone given, not the browser one', () => {
    const block = makeBlock({ starts_at: '2026-11-16T14:00:00Z', ends_at: '2026-11-16T15:30:00Z' })
    expect(formatRange(block, 'Asia/Jerusalem')).toBe('16:00–17:30')
    expect(formatRange(block, 'America/New_York')).toBe('09:00–10:30')
    expect(formatRange(block, 'UTC')).toBe('14:00–15:30')
  })

  it('uses a 24-hour clock with midnight as 00', () => {
    expect(formatTime('2026-11-16T22:05:00Z', 'Asia/Jerusalem')).toBe('00:05')
  })

  it('a block across the switch to winter time shows the wall clock and lasts two hours', () => {
    // Israel leaves summer time at 02:00 on 2026-10-25 (23:00Z), so 01:00–02:00 happens twice.
    const block = makeBlock({ starts_at: '2026-10-24T21:30:00Z', ends_at: '2026-10-24T23:30:00Z' })
    expect(formatRange(block, 'Asia/Jerusalem')).toBe('00:30–01:30')
    expect(blockMinutes(block)).toBe(120)
    expect(durationText(blockMinutes(block))).toBe(he.board.twoHours)
  })
})

describe('dates', () => {
  it('weekStart is the Sunday of the week', () => {
    expect(weekStart('2026-11-19')).toBe('2026-11-15')
    expect(weekStart('2026-11-15')).toBe('2026-11-15')
    expect(weekStart('2026-11-21')).toBe('2026-11-15')
    expect(weekStart('2026-11-03')).toBe('2026-11-01')
  })

  it('addDays crosses months and years', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('addDays is not moved by a clock change', () => {
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25')
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26')
  })

  it('formatDay gives the Hebrew weekday and day.month from the date itself', () => {
    expect(formatDay('2026-11-15')).toBe(he.board.day('ראשון', 15, 11))
    expect(formatDay('2026-11-21')).toBe(he.board.day('שבת', 21, 11))
    expect(formatDay('2026-10-25')).toBe(he.board.day('ראשון', 25, 10))
  })

  it('dayLabel says today, tomorrow and yesterday, else the day', () => {
    expect(dayLabel('2026-11-16', '2026-11-16')).toBe(he.board.today)
    expect(dayLabel('2026-11-17', '2026-11-16')).toBe(he.board.tomorrow)
    expect(dayLabel('2026-11-15', '2026-11-16')).toBe(he.board.yesterday)
    expect(dayLabel('2026-11-19', '2026-11-16')).toBe(formatDay('2026-11-19'))
    expect(dayLabel('2026-12-01', '2026-11-30')).toBe(he.board.tomorrow)
  })

  it('dateIn is the calendar day in the timezone', () => {
    const at = new Date('2026-11-16T23:30:00Z')
    expect(dateIn('Asia/Jerusalem', at)).toBe('2026-11-17')
    expect(dateIn('America/New_York', at)).toBe('2026-11-16')
  })
})

describe('durationText', () => {
  it.each([
    [1, he.board.minute],
    [45, he.board.minutes(45)],
    [60, he.board.hour],
    [75, he.board.hoursAndMinutes(he.board.hour, 15)],
    [90, he.board.hourAndHalf],
    [120, he.board.twoHours],
    [150, he.board.hours(2.5)],
    [180, he.board.hours(3)],
    [200, he.board.hoursAndMinutes(he.board.hours(3), 20)],
    [300, he.board.hours(5)],
  ])('%i minutes', (minutes, text) => {
    expect(durationText(minutes)).toBe(text)
  })

  it('reads as Hebrew', () => {
    expect(durationText(45)).toBe('45 דקות')
    expect(durationText(90)).toBe('שעה וחצי')
    expect(durationText(150)).toBe('2.5 שעות')
  })
})

describe('pickTimezone', () => {
  it('takes the profile timezone from the GET /me answer', () => {
    expect(pickTimezone({ id: 'u', email: null, timezone: 'America/New_York' }, 'Asia/Jerusalem')).toBe('America/New_York')
  })

  it('falls back when the answer has none, or an unknown one', () => {
    expect(pickTimezone(undefined, 'Asia/Jerusalem')).toBe('Asia/Jerusalem')
    expect(pickTimezone({ id: 'u', email: null }, 'Asia/Jerusalem')).toBe('Asia/Jerusalem')
    expect(pickTimezone({ timezone: 5 }, 'Asia/Jerusalem')).toBe('Asia/Jerusalem')
    expect(pickTimezone({ timezone: 'Not/AZone' }, 'Asia/Jerusalem')).toBe('Asia/Jerusalem')
  })
})
