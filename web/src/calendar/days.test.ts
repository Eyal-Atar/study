import { describe, expect, it } from 'vitest'
import { makeBlock } from '../test/boardFixtures'
import { dayDots, restDays, shortDate, streakDays, wakingSpan, weekdayLong, weekdayShort, weekDays, weekRangeText } from './days'
import { makeMe } from './testFixtures'

describe('weekDays', () => {
  it('runs from Sunday to Saturday', () => {
    expect(weekDays('2026-11-24')).toEqual(['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28'])
  })
})

describe('restDays', () => {
  const days = weekDays('2026-11-24')
  it('marks a day from today with no block, in a week that has blocks', () => {
    const blocks = [makeBlock({ study_date: '2026-11-23' })]
    expect(restDays(days, blocks, '2026-11-24')).toEqual(new Set(['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28']))
  })
  it('is empty for an empty week and skips past days', () => {
    expect(restDays(days, [], '2026-11-22').size).toBe(0)
    expect(restDays(days, [makeBlock({ study_date: '2026-11-28' })], '2026-11-24').has('2026-11-23')).toBe(false)
  })
  it('does not count missed and skipped blocks', () => {
    const blocks = [makeBlock({ study_date: '2026-11-23' }), makeBlock({ id: 'm', study_date: '2026-11-25', status: 'missed', state: 'missed' })]
    expect(restDays(days, blocks, '2026-11-22').has('2026-11-25')).toBe(true)
  })
})

describe('dayDots', () => {
  it('is at most four distinct colours', () => {
    const blocks = [0, 1, 2, 3, 4].map((i) => makeBlock({ id: `b${String(i)}`, exam_color_index: i, starts_at: `2026-11-16T0${String(i + 5)}:00:00Z` }))
    expect(dayDots(blocks, '2026-11-16')).toEqual([0, 1, 2, 3])
  })
  it('keeps the order of start, once per colour, without missed and skipped', () => {
    const blocks = [
      makeBlock({ id: 'a', exam_color_index: 5, starts_at: '2026-11-16T09:00:00Z' }),
      makeBlock({ id: 'b', exam_color_index: 2, starts_at: '2026-11-16T07:00:00Z' }),
      makeBlock({ id: 'c', exam_color_index: 5, starts_at: '2026-11-16T11:00:00Z' }),
      makeBlock({ id: 'd', exam_color_index: 7, starts_at: '2026-11-16T05:00:00Z', status: 'skipped', state: 'skipped' }),
    ]
    expect(dayDots(blocks, '2026-11-16')).toEqual([2, 5])
  })
})

describe('streakDays', () => {
  it('is the days with XP', () => {
    const progress = { days: [{ date: '2026-11-15', xp: 10 }, { date: '2026-11-16', xp: 0 }] } as Parameters<typeof streakDays>[0]
    expect(streakDays(progress)).toEqual(new Set(['2026-11-15']))
    expect(streakDays(undefined).size).toBe(0)
  })
})

describe('wakingSpan', () => {
  it('is the instants of wake and sleep in the profile timezone', () => {
    const span = wakingSpan('2026-11-16', makeMe(), 'Asia/Jerusalem')
    expect(new Date(span.dayStart ?? 0).toISOString()).toBe('2026-11-16T06:00:00.000Z')
    expect(new Date(span.dayEnd ?? 0).toISOString()).toBe('2026-11-16T21:00:00.000Z')
  })
  it('puts a sleep time before waking after midnight, and is null without /me', () => {
    const span = wakingSpan('2026-11-16', makeMe({ sleep_time: '01:00' }), 'Asia/Jerusalem')
    expect(new Date(span.dayEnd ?? 0).toISOString()).toBe('2026-11-16T23:00:00.000Z')
    expect(wakingSpan('2026-11-16', undefined, 'UTC')).toEqual({ dayStart: null, dayEnd: null })
  })
})

describe('texts of dates', () => {
  it('writes the range of a week', () => {
    expect(weekRangeText(weekDays('2026-11-24'))).toBe('22–28 November 2026')
    expect(weekRangeText(weekDays('2026-12-01'))).toBe('29 November–5 December 2026')
    expect(weekRangeText(weekDays('2026-12-30'))).toBe('27 December 2026–2 January 2027')
  })
  it('writes short dates and weekdays', () => {
    expect(shortDate('2026-11-24')).toBe('Tue, 24 Nov')
    expect(weekdayShort('2026-11-24')).toBe('Tue')
    expect(weekdayLong('2026-11-24')).toBe('Tuesday')
  })
})
