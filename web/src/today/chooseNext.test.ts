import { describe, expect, it } from 'vitest'
import { makeBlock } from '../test/boardFixtures'
import { nextLater, nextToday } from './chooseNext'

describe('nextToday', () => {
  it('takes the block in progress before an earlier upcoming one', () => {
    const upcoming = makeBlock({ id: 'b-up', starts_at: '2026-11-16T08:00:00Z', ends_at: '2026-11-16T09:00:00Z' })
    const now = makeBlock({ id: 'b-now', state: 'in_progress', starts_at: '2026-11-16T10:00:00Z', ends_at: '2026-11-16T11:00:00Z' })
    expect(nextToday([upcoming, now])?.id).toBe('b-now')
  })

  it('takes the earliest upcoming block, whatever the order it came in', () => {
    const late = makeBlock({ id: 'b-late', starts_at: '2026-11-16T15:00:00Z', ends_at: '2026-11-16T16:00:00Z' })
    const early = makeBlock({ id: 'b-early', starts_at: '2026-11-16T09:00:00Z', ends_at: '2026-11-16T10:00:00Z' })
    expect(nextToday([late, early])?.id).toBe('b-early')
  })

  it('never takes an overdue, done, missed or skipped block', () => {
    const blocks = [
      makeBlock({ id: 'a', state: 'overdue' }),
      makeBlock({ id: 'b', status: 'done', state: 'done' }),
      makeBlock({ id: 'c', status: 'missed', state: 'missed' }),
      makeBlock({ id: 'd', status: 'skipped', state: 'skipped' }),
    ]
    expect(nextToday(blocks)).toBeUndefined()
  })
})

describe('nextLater', () => {
  it('takes the first upcoming block after today, not today and not before', () => {
    const blocks = [
      makeBlock({ id: 'today', study_date: '2026-11-16' }),
      makeBlock({ id: 'after', study_date: '2026-11-18', starts_at: '2026-11-18T07:00:00Z', ends_at: '2026-11-18T08:00:00Z' }),
      makeBlock({ id: 'tomorrow', study_date: '2026-11-17', starts_at: '2026-11-17T07:00:00Z', ends_at: '2026-11-17T08:00:00Z' }),
      makeBlock({ id: 'done', study_date: '2026-11-17', status: 'done', state: 'done', starts_at: '2026-11-17T05:00:00Z' }),
    ]
    expect(nextLater(blocks, '2026-11-16')?.id).toBe('tomorrow')
  })

  it('has nothing when the plan has no later upcoming block', () => {
    expect(nextLater([makeBlock()], '2026-11-16')).toBeUndefined()
  })
})
