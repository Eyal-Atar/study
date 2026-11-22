import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import type { Block, BlockState } from '../board/types'
import { archiLine, archiMayInterrupt, archiMoment, breakRun, MOMENT_MOOD, needsBreak } from './archi'

function block(state: BlockState, start: string, end: string, id = start): Block {
  return {
    id,
    task_id: 't',
    exam_id: 'e',
    task_title: 'Task',
    task_kind: 'learn',
    exam_name: 'Exam',
    exam_color_index: 0,
    starts_at: start,
    ends_at: end,
    study_date: '2026-11-24',
    part_index: 1,
    part_count: 1,
    pinned: false,
    status: state === 'done' || state === 'missed' || state === 'skipped' ? state : 'planned',
    state,
  }
}

const base = {
  reviewCount: 0,
  unplacedCount: 0,
  todayIsRest: false,
  todayBlocks: [] as Block[],
  hour: 14,
}
const at = (hhmm: string) => `2026-11-24T${hhmm}:00Z`

describe('archiMoment', () => {
  it('orders the priorities', () => {
    const all = {
      ...base,
      reviewCount: 1,
      unplacedCount: 1,
      todayIsRest: true,
    }
    expect(archiMoment(all)).toBe('review')
    expect(archiMoment({ ...all, reviewCount: 0 })).toBe('report')
    expect(archiMoment({ ...all, reviewCount: 0, unplacedCount: 0 })).toBe('restDay')
  })
  it('dayDone when every counted block is done', () => {
    const done = [block('done', at('08:00'), at('09:00')), block('done', at('10:00'), at('11:00'))]
    expect(archiMoment({ ...base, todayBlocks: done })).toBe('dayDone')
    expect(
      archiMoment({
        ...base,
        todayBlocks: [...done, block('missed', at('12:00'), at('13:00'))],
      }),
    ).toBe('dayDone')
    expect(
      archiMoment({
        ...base,
        todayBlocks: [...done, block('upcoming', at('15:00'), at('16:00'))],
      }),
    ).toBe('day')
  })
  it('only a skipped block is not dayDone: nothing is left to count, so the day is open', () => {
    expect(
      archiMoment({
        ...base,
        todayBlocks: [block('skipped', at('08:00'), at('09:00'))],
      }),
    ).toBe('openDay')
  })
  it('openDay for a day with no block that is not a rest day, at any hour', () => {
    expect(archiMoment({ ...base, hour: 9 })).toBe('openDay')
    expect(archiMoment({ ...base, hour: 15 })).toBe('openDay')
    expect(archiMoment({ ...base, todayBlocks: [block('missed', at('08:00'), at('09:00'))] })).toBe('openDay')
    // A rest day, a review and a report still come first.
    expect(archiMoment({ ...base, todayIsRest: true })).toBe('restDay')
    expect(archiMoment({ ...base, reviewCount: 1 })).toBe('review')
    expect(archiMoment({ ...base, unplacedCount: 1 })).toBe('report')
  })
  it('deepWork needs an in-progress block of 60 minutes', () => {
    expect(
      archiMoment({
        ...base,
        todayBlocks: [block('in_progress', at('08:00'), at('09:00'))],
      }),
    ).toBe('deepWork')
    expect(
      archiMoment({
        ...base,
        todayBlocks: [block('in_progress', at('08:00'), at('08:45'))],
      }),
    ).toBe('day')
  })
  it('morning before 12, day from 12', () => {
    const todayBlocks = [block('upcoming', at('15:00'), at('16:00'))]
    expect(archiMoment({ ...base, todayBlocks, hour: 11 })).toBe('morning')
    expect(archiMoment({ ...base, todayBlocks, hour: 12 })).toBe('day')
  })
})

describe('MOMENT_MOOD', () => {
  it('maps each moment', () => {
    expect(MOMENT_MOOD).toEqual({
      review: 'intentions',
      report: 'flow',
      restDay: 'rest',
      openDay: 'joy',
      dayDone: 'eureka',
      deepWork: 'wisdom',
      morning: 'intentions',
      day: 'joy',
    })
  })
})

describe('archiLine', () => {
  const summary = { total: 4, done: 1, next: '12:00' }
  it('is stable for a date and differs between dates', () => {
    const a = archiLine('restDay', '2026-11-24', summary)
    expect(archiLine('restDay', '2026-11-24', summary)).toBe(a)
    expect(a).not.toBe(archiLine('restDay', '2026-11-25', summary))
    expect(en.calendar.archi.restDay).toContain(a)
  })
  it('never counts zero blocks: a summary of nothing is the line of an open day', () => {
    const none = { total: 0, done: 0, next: null }
    for (const moment of ['morning', 'day'] as const) {
      for (const date of ['2026-11-24', '2026-11-25', '2026-11-26']) {
        const line = archiLine(moment, date, none)
        expect(line).not.toMatch(/\b0\b/)
        expect(line).toBe(archiLine('openDay', date, none))
        expect(en.calendar.archi.openDay).toContain(line)
      }
    }
  })
  it('uses the summary for morning and day', () => {
    expect(archiLine('morning', '2026-11-24', summary)).toBe(en.calendar.archi.summary(4, 1, '12:00'))
    expect(archiLine('day', '2026-11-24', summary)).toBe(en.calendar.archi.summary(4, 1, '12:00'))
  })
})

describe('archiMayInterrupt', () => {
  function store() {
    const m = new Map<string, string>()
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    }
  }
  it('allows once per 20 minutes', () => {
    const s = store()
    const t = 10_000_000
    expect(archiMayInterrupt(t, s)).toBe(true)
    expect(s.getItem('archi.lastInterrupt')).toBe(String(t))
    expect(archiMayInterrupt(t + 5 * 60_000, s)).toBe(false)
    expect(archiMayInterrupt(t + 21 * 60_000, s)).toBe(true)
  })
  it('a throwing storage allows without saving', () => {
    const bad = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(archiMayInterrupt(1, bad)).toBe(true)
  })
})

describe('needsBreak', () => {
  const now = Date.parse(at('11:10'))
  it('true for 60 + 30 back to back that ended 10 minutes ago', () => {
    const ok = [block('done', at('09:30'), at('10:30')), block('done', at('10:30'), at('11:00'))]
    expect(needsBreak(ok, now)).toBe(true)
  })
  it('false with a 30 minute gap', () => {
    const gap = [block('done', at('09:00'), at('10:00')), block('done', at('10:30'), at('11:00'))]
    expect(needsBreak(gap, now)).toBe(false)
  })
  it('false when the run ended an hour ago', () => {
    const old = [block('done', at('08:00'), at('09:00')), block('done', at('09:00'), at('09:30'))]
    expect(needsBreak(old, now)).toBe(false)
  })
})

// S32 final review, M11: a run is named by its first block, so a further Done in it is the same run.
describe('breakRun', () => {
  it('names the run by its first block, and a block that joins it keeps the name', () => {
    const run = [block('done', at('09:30'), at('10:30')), block('done', at('10:30'), at('11:00'))]
    expect(breakRun(run, Date.parse(at('11:10')))).toBe(at('09:30'))
    const longer = [...run, block('done', at('11:00'), at('11:20'))]
    expect(breakRun(longer, Date.parse(at('11:25')))).toBe(at('09:30'))
  })
  it('is null with no run', () => {
    expect(breakRun([block('done', at('09:00'), at('09:30'))], Date.parse(at('09:40')))).toBeNull()
  })
})
