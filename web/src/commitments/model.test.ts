import { describe, expect, it } from 'vitest'
import type { Commitment, Weekday } from '../availability/types'
import { en } from '../i18n/en'
import { cellsOf, groupCommitments, groupSubtitle, groupWrites, meTimeText, paintedRanges, weekdaysText, ME_TIME_TITLES, type CommitmentGroup } from './model'

let next = 0
function commitment(overrides: Partial<Commitment> = {}): Commitment {
  next += 1
  return {
    id: `c${String(next)}`,
    title: 'עבודה',
    kind: 'work',
    weekday: 1,
    start_time: '14:00',
    end_time: '17:00',
    valid_from: '2026-11-01',
    valid_until: null,
    source_job_id: null,
    created_at: '2026-11-01T10:00:00Z',
    ...overrides,
  }
}

const ALL_DAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6]

describe('groupCommitments', () => {
  it('groups the seven Hebrew-titled Me time rows of the migration into one row for every day', () => {
    // Out of order, as the server may list them.
    const list = [3, 0, 6, 1, 5, 2, 4].map((weekday) =>
      commitment({ id: `h${String(weekday)}`, title: 'זמן לעצמי', kind: 'other', weekday: weekday as Weekday, start_time: '18:00', end_time: '19:00' }),
    )
    const groups = groupCommitments(list)
    expect(groups).toHaveLength(1)
    const [group] = groups as [CommitmentGroup]
    expect(group.weekdays).toEqual(ALL_DAYS)
    expect(group.ids).toEqual(['h0', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
    expect(weekdaysText(group.weekdays)).toBe(en.commitments.everyDay)
    expect(weekdaysText(group.weekdays)).toBe('Every day')
    expect(group.isMeTime).toBe(true)
    expect(groupSubtitle(group)).toBe('Every day, 18:00–19:00')
  })

  it('keeps commitments with a different title, kind, time or validity apart', () => {
    const groups = groupCommitments([
      commitment({ weekday: 1 }),
      commitment({ weekday: 3 }),
      commitment({ weekday: 2, title: 'הרצאה' }),
      commitment({ weekday: 4, kind: 'other' }),
      commitment({ weekday: 5, end_time: '18:00' }),
      commitment({ weekday: 0, valid_until: '2027-01-10' }),
    ])
    expect(groups).toHaveLength(5)
    expect(groups.map((g) => g.weekdays)).toEqual([[0], [1, 3], [2], [4], [5]])
  })

  it('sorts by the first day, then by the start time', () => {
    const groups = groupCommitments([
      commitment({ title: 'ב', weekday: 2, start_time: '08:00', end_time: '09:00' }),
      commitment({ title: 'א', weekday: 1, start_time: '16:00', end_time: '17:00' }),
      commitment({ title: 'ג', weekday: 1, start_time: '09:00', end_time: '10:00' }),
    ])
    expect(groups.map((g) => g.title)).toEqual(['ג', 'א', 'ב'])
  })

  it('puts a second row on the same day into a group of its own', () => {
    const groups = groupCommitments([commitment({ id: 'a', weekday: 1 }), commitment({ id: 'b', weekday: 1 })])
    expect(groups.map((g) => g.ids)).toEqual([['a'], ['b']])
    expect(new Set(groups.map((g) => g.key)).size).toBe(2)
  })
})

describe('weekdaysText and groupSubtitle', () => {
  it('names the days', () => {
    expect(weekdaysText([1, 3])).toBe('Mon, Wed')
    expect(weekdaysText([0, 1, 2, 3, 4])).toBe('Sun to Thu')
    expect(weekdaysText([1, 2, 3, 4, 5, 6])).toBe('Mon to Sat')
    expect(weekdaysText([0, 1, 2, 4])).toBe('Sun, Mon, Tue, Thu')
    expect(weekdaysText([4])).toBe('Thu')
  })

  it('adds the end date', () => {
    const [group] = groupCommitments([
      commitment({ weekday: 1, valid_until: '2027-01-10' }),
      commitment({ weekday: 3, valid_until: '2027-01-10' }),
    ]) as [CommitmentGroup]
    expect(groupSubtitle(group)).toBe('Mon, Wed, 14:00–17:00, until 10 January')
  })
})

describe('paintedRanges', () => {
  it('turns a run of hours on one day into one range', () => {
    expect(paintedRanges(new Set(['0-10', '0-11']), 8)).toEqual([{ weekday: 0, start_time: '10:00', end_time: '12:00' }])
  })

  it('ends a run at 23 at midnight', () => {
    expect(paintedRanges(new Set(['2-22', '2-23']), 8)).toEqual([{ weekday: 2, start_time: '22:00', end_time: '00:00' }])
  })

  it('splits a gap and keeps the days apart, in order', () => {
    expect(paintedRanges(new Set(['3-16', '1-9', '1-10', '1-14']), 8)).toEqual([
      { weekday: 1, start_time: '09:00', end_time: '11:00' },
      { weekday: 1, start_time: '14:00', end_time: '15:00' },
      { weekday: 3, start_time: '16:00', end_time: '17:00' },
    ])
  })

  it('carries a run past midnight when the day ends after it', () => {
    // A day from 08:00 to 02:00: hours 0 and 1 come after 23.
    expect(paintedRanges(new Set(['4-23', '4-0', '4-1']), 8)).toEqual([{ weekday: 4, start_time: '23:00', end_time: '02:00' }])
  })

  it('gives a run that starts after midnight to the next day', () => {
    // Thursday's column, 00:00–02:00: the night between Thursday and Friday.
    expect(paintedRanges(new Set(['4-0', '4-1']), 8)).toEqual([{ weekday: 5, start_time: '00:00', end_time: '02:00' }])
    expect(paintedRanges(new Set(['6-0']), 8)).toEqual([{ weekday: 0, start_time: '00:00', end_time: '01:00' }])
  })
})

describe('cellsOf', () => {
  it('covers every hour a commitment touches, also in part', () => {
    const cells = cellsOf([commitment({ weekday: 1, start_time: '10:15', end_time: '12:00' })], 8, 23)
    expect([...cells].sort()).toEqual(['1-10', '1-11'])
  })

  it('covers the part after midnight on the next column, and the hours before the grid not at all', () => {
    const cells = cellsOf([commitment({ weekday: 6, start_time: '22:00', end_time: '09:00' })], 8, 23)
    expect([...cells].sort()).toEqual(['0-8', '6-22'])
  })

  it('shows the hours after midnight of a late day under the evening they belong to', () => {
    const cells = cellsOf([commitment({ weekday: 2, start_time: '00:30', end_time: '01:00' })], 8, 26)
    // Tuesday 00:30 is the night of Monday's column.
    expect([...cells]).toEqual(['1-0'])
  })
})

describe('groupWrites', () => {
  const before: CommitmentGroup = {
    key: 'k',
    title: 'עבודה',
    kind: 'work',
    weekdays: [1, 3],
    start_time: '14:00',
    end_time: '17:00',
    valid_from: '2026-11-01',
    valid_until: null,
    ids: ['mon', 'wed'],
    isMeTime: false,
  }

  it('creates every day of a new group', () => {
    const writes = groupWrites(null, {
      title: 'הרצאה',
      kind: 'class',
      weekday: 0,
      weekdays: [0, 2],
      start_time: '10:00',
      end_time: '12:00',
    })
    expect(writes).toEqual({
      create: [
        { title: 'הרצאה', kind: 'class', weekday: 0, start_time: '10:00', end_time: '12:00' },
        { title: 'הרצאה', kind: 'class', weekday: 2, start_time: '10:00', end_time: '12:00' },
      ],
      update: [],
      remove: [],
    })
  })

  it('adds a day, removes a day and changes the time of the rest', () => {
    const writes = groupWrites(before, {
      title: 'עבודה',
      kind: 'work',
      weekday: 3,
      weekdays: [3, 4],
      start_time: '15:00',
      end_time: '17:00',
      valid_from: '2026-11-01',
      valid_until: null,
    })
    expect(writes).toEqual({
      create: [{ title: 'עבודה', kind: 'work', weekday: 4, start_time: '15:00', end_time: '17:00', valid_from: '2026-11-01' }],
      update: [{ id: 'wed', patch: { start_time: '15:00' } }],
      remove: ['mon'],
    })
  })

  it('sends nothing when nothing changed, and only the changed fields otherwise', () => {
    const same = { title: 'עבודה', kind: 'work' as const, weekday: 1 as Weekday, weekdays: [1, 3] as Weekday[], start_time: '14:00', end_time: '17:00' }
    expect(groupWrites(before, same)).toEqual({ create: [], update: [], remove: [] })
    expect(groupWrites(before, { ...same, title: 'משמרת', valid_until: '2027-01-10' }).update).toEqual([
      { id: 'mon', patch: { title: 'משמרת', valid_until: '2027-01-10' } },
      { id: 'wed', patch: { title: 'משמרת', valid_until: '2027-01-10' } },
    ])
  })

  it('clears the end date with null', () => {
    const ending = { ...before, valid_until: '2027-01-10' }
    const writes = groupWrites(ending, {
      title: 'עבודה',
      kind: 'work',
      weekday: 1,
      weekdays: [1, 3],
      start_time: '14:00',
      end_time: '17:00',
      valid_until: null,
    })
    expect(writes.update).toEqual([
      { id: 'mon', patch: { valid_until: null } },
      { id: 'wed', patch: { valid_until: null } },
    ])
  })
})

const meTimeRows = (title: string, extra: Partial<Commitment> = {}) =>
  ALL_DAYS.map((weekday) =>
    commitment({ title, kind: 'other', weekday, start_time: '20:00', end_time: '21:00', ...extra }),
  )

describe('Me time', () => {
  it('names both titles the server recognises', () => {
    expect(ME_TIME_TITLES).toEqual(['Me time', '\u05d6\u05de\u05df \u05dc\u05e2\u05e6\u05de\u05d9'])
  })

  it('recognises seven rows titled Me time as one group', () => {
    const groups = groupCommitments(meTimeRows('Me time'))
    expect(groups).toHaveLength(1)
    expect(groups[0]?.isMeTime).toBe(true)
    expect(weekdaysText(groups[0]?.weekdays ?? [])).toBe('Every day')
  })

  it('marks only the oldest of two Me time groups', () => {
    const newer = meTimeRows('Me time', { start_time: '18:00', end_time: '19:00', created_at: '2026-11-10T10:00:00Z' })
    const older = meTimeRows('Me time', { created_at: '2026-11-02T10:00:00Z' })
    const groups = groupCommitments([...newer, ...older])
    expect(groups.map((g) => [g.start_time, g.isMeTime])).toEqual([
      ['18:00', false],
      ['20:00', true],
    ])
  })

  it('is not Me time with an end date, with a different kind, with fewer days or at a length outside 15 to 240 minutes', () => {
    expect(groupCommitments(meTimeRows('Me time', { valid_until: '2027-01-10' }))[0]?.isMeTime).toBe(false)
    expect(groupCommitments(meTimeRows('Me time', { kind: 'work' }))[0]?.isMeTime).toBe(false)
    expect(groupCommitments(meTimeRows('Me time').slice(1))[0]?.isMeTime).toBe(false)
    expect(groupCommitments(meTimeRows('Me time', { end_time: '20:10' }))[0]?.isMeTime).toBe(false)
    expect(groupCommitments(meTimeRows('Me time', { end_time: '00:30' }))[0]?.isMeTime).toBe(false)
    expect(groupCommitments(meTimeRows('Me time', { end_time: '00:00' }))[0]?.isMeTime).toBe(true)
  })

  it('writes the start and the length', () => {
    expect(meTimeText('20:00', 60)).toBe('20:00, 1 hour')
    expect(meTimeText('18:30', 45)).toBe('18:30, 45 minutes')
  })
})

describe('more cases', () => {
  it('paints the hours of one day', () => {
    expect(paintedRanges(new Set(['0-10', '0-11']), 8)).toEqual([{ weekday: 0, start_time: '10:00', end_time: '12:00' }])
    expect(paintedRanges(new Set(['0-22', '0-23']), 8)).toEqual([{ weekday: 0, start_time: '22:00', end_time: '00:00' }])
  })

  it('writes a group that gains a day, loses a day and moves in time', () => {
    const before: CommitmentGroup = {
      key: 'k', title: 'Work', kind: 'work', weekdays: [1, 2], start_time: '09:00', end_time: '10:00',
      valid_from: '2026-11-01', valid_until: null, ids: ['m', 't'], isMeTime: false,
    }
    const writes = groupWrites(before, { title: 'Work', kind: 'work', weekday: 2, weekdays: [2, 5], start_time: '10:00', end_time: '11:00' })
    expect(writes.remove).toEqual(['m'])
    expect(writes.update).toEqual([{ id: 't', patch: { start_time: '10:00', end_time: '11:00' } }])
    expect(writes.create).toEqual([{ title: 'Work', kind: 'work', weekday: 5, start_time: '10:00', end_time: '11:00' }])
  })
})
