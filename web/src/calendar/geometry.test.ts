import { describe, expect, it } from 'vitest'
import { makeBlock } from '../test/boardFixtures'
import { busyColumn, gridSpan, HOUR_PX, localMinutes, titleLines, toPx } from './geometry'
import { ghostOf } from './ghost'
import { makeBusy } from './testFixtures'

const TZ = 'Asia/Jerusalem'
const DAYS = ['2026-11-15', '2026-11-16', '2026-11-17']
const none = { days: DAYS, blocks: [], busy: [], wake: '08:00', sleep: '23:00', tz: TZ }

describe('localMinutes', () => {
  it('is more than 1440 just after midnight of the next day', () => {
    expect(localMinutes('2026-11-16T22:30:00Z', '2026-11-16', TZ)).toBe(1470)
  })
  it('is the wall clock on the day the clocks go back', () => {
    expect(localMinutes('2026-10-25T08:00:00Z', '2026-10-25', TZ)).toBe(600)
  })
})

describe('gridSpan', () => {
  it('rounds wake and sleep to whole hours', () => {
    expect(gridSpan(none)).toEqual({ startMin: 480, endMin: 1380 })
    expect(gridSpan({ ...none, wake: '07:30', sleep: '22:10' })).toEqual({ startMin: 420, endMin: 1380 })
  })
  it('is 08:00–22:00 without /me and without items', () => {
    expect(gridSpan({ ...none, wake: null, sleep: null })).toEqual({ startMin: 480, endMin: 1320 })
  })
  it('stretches to a block that ends at 00:30 of the next date, by its study_date', () => {
    const block = makeBlock({ study_date: '2026-11-16', starts_at: '2026-11-16T21:00:00Z', ends_at: '2026-11-16T22:30:00Z' })
    expect(gridSpan({ ...none, blocks: [block] }).endMin).toBe(1500)
  })
  it('stretches to an item that ends at 03:00 and stops at 26:00', () => {
    const busy = makeBusy({ starts_at: '2026-11-16T20:00:00Z', ends_at: '2026-11-17T01:00:00Z' })
    expect(gridSpan({ ...none, busy: [busy] }).endMin).toBe(1560)
    const late = makeBusy({ starts_at: '2026-11-16T20:00:00Z', ends_at: '2026-11-17T04:00:00Z' })
    expect(gridSpan({ ...none, busy: [late] }).endMin).toBe(1560)
  })
  it('starts at the hour of an item earlier than waking', () => {
    const busy = makeBusy({ starts_at: '2026-11-16T04:30:00Z', ends_at: '2026-11-16T06:00:00Z' })
    expect(gridSpan({ ...none, busy: [busy] }).startMin).toBe(360)
  })
  it('treats a sleep time before waking as after midnight', () => {
    expect(gridSpan({ ...none, sleep: '01:00' }).endMin).toBe(1500)
  })
  it('ignores a block outside the days', () => {
    const block = makeBlock({ study_date: '2026-11-30', starts_at: '2026-11-30T21:00:00Z', ends_at: '2026-11-30T22:30:00Z' })
    expect(gridSpan({ ...none, blocks: [block] }).endMin).toBe(1380)
  })
})

describe('busyColumn', () => {
  const span = { startMin: 480, endMin: 1380 }
  it('puts a 22:00–06:00 shift in the column it starts in, cut at the span end', () => {
    const shift = makeBusy({ starts_at: '2026-11-16T20:00:00Z', ends_at: '2026-11-17T04:00:00Z' })
    expect(busyColumn(shift, DAYS, span, TZ)).toEqual({ date: '2026-11-16', startMin: 1320, endMin: 1380 })
  })
  it('puts the tail of that shift in the column before when the span reaches past midnight', () => {
    const wide = { startMin: 480, endMin: 1560 }
    const tail = makeBusy({ starts_at: '2026-11-16T22:00:00Z', ends_at: '2026-11-17T04:00:00Z' })
    expect(busyColumn(tail, DAYS, wide, TZ)).toEqual({ date: '2026-11-16', startMin: 1440, endMin: 1560 })
  })
  it('is null outside the days or the span', () => {
    expect(busyColumn(makeBusy({ starts_at: '2026-12-01T08:00:00Z', ends_at: '2026-12-01T09:00:00Z' }), DAYS, span, TZ)).toBeNull()
    expect(busyColumn(makeBusy({ starts_at: '2026-11-16T01:00:00Z', ends_at: '2026-11-16T02:00:00Z' }), DAYS, span, TZ)).toBeNull()
  })
})

describe('toPx and titleLines', () => {
  it('measures from the start of the span', () => {
    expect(toPx(600, { startMin: 480, endMin: 1380 }, HOUR_PX.desktop)).toBe(96)
    expect(HOUR_PX).toEqual({ desktop: 48, phone: 60 })
  })
  it('fits the title to the height (decision 5)', () => {
    expect(titleLines(45, 'week')).toEqual({ lines: 2, meta: false })
    expect(titleLines(69, 'week')).toEqual({ lines: 2, meta: true })
    expect(titleLines(30, 'week')).toEqual({ lines: 1, meta: false })
    expect(titleLines(38, 'week')).toEqual({ lines: 2, meta: false })
    expect(titleLines(58, 'week')).toEqual({ lines: 2, meta: true })
    expect(titleLines(45, 'day')).toEqual({ lines: 1, meta: true })
    expect(titleLines(30, 'day')).toEqual({ lines: 1, meta: false })
  })
})

describe('ghostOf', () => {
  it('takes the id and colour of the block and the minutes of the new times', () => {
    const block = makeBlock({ id: 'b9', exam_color_index: 3, task_kind: 'practice' })
    const ghost = ghostOf(block, '2026-11-16T08:00:00Z', '2026-11-16T09:30:00Z', '2026-11-16', TZ, 'target', 'Here')
    expect(ghost).toMatchObject({ id: 'b9', date: '2026-11-16', startMin: 600, endMin: 690, colorIndex: 3, kind: 'practice', tone: 'target', label: 'Here' })
  })
})
