import { describe, expect, it } from 'vitest'
import { makeBlock } from '../test/boardFixtures'
import { canMoveTo, moveProblem, snapToGrid } from './move'

const at = (iso: string) => Date.parse(iso)

describe('snapToGrid', () => {
  it('rounds to the nearest local quarter hour', () => {
    // Jerusalem is UTC+2 in November: 14:07 local → 14:00, 14:08 → 14:15.
    expect(snapToGrid(at('2026-11-16T12:07:00Z'), 'Asia/Jerusalem')).toBe(at('2026-11-16T12:00:00Z'))
    expect(snapToGrid(at('2026-11-16T12:08:00Z'), 'Asia/Jerusalem')).toBe(at('2026-11-16T12:15:00Z'))
    expect(snapToGrid(at('2026-11-16T12:45:00Z'), 'Asia/Jerusalem')).toBe(at('2026-11-16T12:45:00Z'))
  })

  it('drops seconds', () => {
    expect(snapToGrid(at('2026-11-16T12:15:29Z'), 'Asia/Jerusalem')).toBe(at('2026-11-16T12:15:00Z'))
  })

  it('follows the local clock in a +05:45 zone', () => {
    // Kathmandu: 10:00Z is 15:45 local, a grid point; 10:10Z is 15:55 → 16:00 local = 10:15Z.
    expect(snapToGrid(at('2026-11-16T10:00:00Z'), 'Asia/Kathmandu')).toBe(at('2026-11-16T10:00:00Z'))
    expect(snapToGrid(at('2026-11-16T10:10:00Z'), 'Asia/Kathmandu')).toBe(at('2026-11-16T10:15:00Z'))
  })

  it('follows the local clock in a +05:30 zone', () => {
    // Kolkata: 10:20Z is 15:50 local → 15:45 = 10:15Z.
    expect(snapToGrid(at('2026-11-16T10:20:00Z'), 'Asia/Kolkata')).toBe(at('2026-11-16T10:15:00Z'))
  })

  it('stays on the grid across a change of clock (Jerusalem, end of summer time)', () => {
    // 2026-10-25: 02:00 local (+03:00) goes back to 01:00 (+02:00) at 23:00Z.
    expect(snapToGrid(at('2026-10-24T22:54:00Z'), 'Asia/Jerusalem')).toBe(at('2026-10-24T23:00:00Z'))
    expect(snapToGrid(at('2026-10-24T23:07:00Z'), 'Asia/Jerusalem')).toBe(at('2026-10-24T23:00:00Z'))
    expect(snapToGrid(at('2026-10-24T23:38:00Z'), 'Asia/Jerusalem')).toBe(at('2026-10-24T23:45:00Z'))
  })
})

describe('canMoveTo', () => {
  // 14:00–15:00 local, today 07:00–23:00 local, now 09:00 local.
  const block = makeBlock({ id: 'me', starts_at: '2026-11-16T12:00:00Z', ends_at: '2026-11-16T13:00:00Z' })
  const other = makeBlock({ id: 'other', task_id: 't-2', starts_at: '2026-11-16T10:00:00Z', ends_at: '2026-11-16T11:00:00Z' })
  const day = {
    dayStart: at('2026-11-16T05:00:00Z'),
    dayEnd: at('2026-11-16T21:00:00Z'),
    blocks: [block, other],
    now: at('2026-11-16T07:00:00Z'),
  }

  it('allows free time in the day', () => {
    expect(canMoveTo(block, at('2026-11-16T15:00:00Z'), day)).toBe(true)
  })

  it('ignores the block itself', () => {
    expect(canMoveTo(block, at('2026-11-16T12:30:00Z'), day)).toBe(true)
  })

  it('refuses an overlap with another planned or done block', () => {
    expect(moveProblem(block, at('2026-11-16T10:30:00Z'), day)).toBe('slot_taken')
    const done = { ...other, status: 'done' as const, state: 'done' as const }
    expect(canMoveTo(block, at('2026-11-16T09:30:00Z'), { ...day, blocks: [block, done] })).toBe(false)
  })

  it('allows touching a neighbour on either side', () => {
    expect(canMoveTo(block, at('2026-11-16T09:00:00Z'), day)).toBe(true)
    expect(canMoveTo(block, at('2026-11-16T11:00:00Z'), day)).toBe(true)
  })

  it('ignores missed and skipped blocks', () => {
    const missed = { ...other, status: 'missed' as const, state: 'missed' as const }
    const skipped = { ...other, id: 'skipped', status: 'skipped' as const, state: 'skipped' as const }
    expect(canMoveTo(block, at('2026-11-16T10:30:00Z'), { ...day, blocks: [block, missed, skipped] })).toBe(true)
  })

  it('keeps the whole block inside the waking hours', () => {
    expect(canMoveTo(block, at('2026-11-16T05:00:00Z'), { ...day, now: at('2026-11-16T04:00:00Z') })).toBe(true)
    expect(moveProblem(block, at('2026-11-16T04:45:00Z'), { ...day, now: at('2026-11-16T04:00:00Z') })).toBe('outside_day')
    expect(canMoveTo(block, at('2026-11-16T20:00:00Z'), day)).toBe(true)
    expect(moveProblem(block, at('2026-11-16T20:15:00Z'), day)).toBe('outside_day')
  })

  it('refuses a start before now, or off the whole minute', () => {
    expect(moveProblem(block, at('2026-11-16T06:45:00Z'), day)).toBe('outside_day')
    expect(canMoveTo(block, at('2026-11-16T07:00:00Z'), day)).toBe(true)
    expect(canMoveTo(block, at('2026-11-16T15:00:30Z'), day)).toBe(false)
  })

  it('refuses a block that already started or is not planned', () => {
    const started = { ...block, starts_at: '2026-11-16T06:30:00Z', ends_at: '2026-11-16T07:30:00Z' }
    expect(moveProblem(started, at('2026-11-16T15:00:00Z'), { ...day, blocks: [started] })).toBe('invalid_state')
    const done = { ...block, status: 'done' as const, state: 'done' as const }
    expect(canMoveTo(done, at('2026-11-16T15:00:00Z'), { ...day, blocks: [done] })).toBe(false)
  })

  it('without day bounds, nothing is allowed', () => {
    expect(moveProblem(block, at('2026-11-16T15:00:00Z'), { ...day, dayStart: null, dayEnd: null })).toBe('outside_day')
  })

  // Busy time (S35): 16:00–17:00 local = 14:00–15:00Z.
  const busy = [{ starts_at: '2026-11-16T14:00:00Z', ends_at: '2026-11-16T15:00:00Z' }]

  it('refuses an overlap with busy time', () => {
    expect(moveProblem(block, at('2026-11-16T14:30:00Z'), { ...day, busy })).toBe('slot_busy')
    expect(moveProblem(block, at('2026-11-16T13:15:00Z'), { ...day, busy })).toBe('slot_busy')
  })

  it('allows touching busy time on either side', () => {
    expect(moveProblem(block, at('2026-11-16T13:00:00Z'), { ...day, busy })).toBeNull()
    expect(moveProblem(block, at('2026-11-16T15:00:00Z'), { ...day, busy })).toBeNull()
  })

  it('an overlap with a block and with busy time is slot_taken, as the server checks blocks first', () => {
    const busyOnOther = [{ starts_at: '2026-11-16T10:30:00Z', ends_at: '2026-11-16T11:30:00Z' }]
    expect(moveProblem(block, at('2026-11-16T10:30:00Z'), { ...day, busy: busyOnOther })).toBe('slot_taken')
  })

  it('a day without busy is as before', () => {
    expect(moveProblem(block, at('2026-11-16T14:30:00Z'), day)).toBeNull()
  })
})
