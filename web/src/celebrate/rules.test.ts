import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block } from '../board/types'
import { makeBadges } from '../progress/testFixtures'
import { makeBlock } from '../test/boardFixtures'
import { CELEBRATION_TTL_MS, pickCelebration, type DoneEvent } from './rules'
import type { Celebrated } from './seen'

const NOW = Date.parse('2026-11-16T18:00:00Z')
const TODAY = '2026-11-16'
const ORDER = makeBadges().map((b) => b.key)
const SEEN: Celebrated = { day: null, level: 2, badges: [] }

const done = (id: string, overrides: Partial<Block> = {}) => makeBlock({ id, status: 'done', state: 'done', ...overrides })

// Today's blocks: b1 just marked done, b2 done earlier, b3 skipped (not counted).
const DAY_DONE = [done('b1'), done('b2'), makeBlock({ id: 'b3', status: 'skipped', state: 'skipped' })]

function event(overrides: Partial<DoneEvent> = {}): DoneEvent {
  return { blockId: 'b1', xp: 50, level: 2, levelUp: false, badgesEarned: [], at: NOW - 1000, ...overrides }
}

function pick(events: DoneEvent[], { todayBlocks = DAY_DONE, seen = SEEN }: { todayBlocks?: Block[]; seen?: Celebrated } = {}) {
  return pickCelebration({ events, now: NOW, today: TODAY, todayBlocks, seen, badgeOrder: ORDER })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('pickCelebration', () => {
  it('nothing happened: no celebration, seen as it is', () => {
    const result = pick([])
    expect(result.celebration).toBeNull()
    expect(result.seen).toBe(SEEN)
  })

  it('a Done that closes the day celebrates the day', () => {
    const result = pick([event()])
    expect(result.celebration).toEqual({ lead: 'day', level: null, stageBefore: null, stageAfter: null, badges: [], day: TODAY })
    expect(result.seen).toEqual({ day: TODAY, level: 2, badges: [] })
  })

  it('a day already celebrated is not celebrated again', () => {
    const seen = { ...SEEN, day: TODAY }
    const result = pick([event()], { seen })
    expect(result.celebration).toBeNull()
    expect(result.seen).toEqual(seen)
  })

  it('a day with a block still to do is not done', () => {
    const blocks = [done('b1'), makeBlock({ id: 'b2', status: 'planned', state: 'upcoming' })]
    expect(pick([event()], { todayBlocks: blocks }).celebration).toBeNull()
  })

  it('marking a block of yesterday does not celebrate the day', () => {
    const blocks = [done('old', { study_date: '2026-11-15' }), done('b2')]
    expect(pick([event({ blockId: 'old' })], { todayBlocks: blocks }).celebration).toBeNull()
  })

  it('a day with nothing counted is not a day done', () => {
    const blocks = [makeBlock({ id: 'b1', status: 'skipped', state: 'skipped' })]
    expect(pick([event()], { todayBlocks: blocks }).celebration).toBeNull()
  })

  it('a level that opens a new stage leads with the stage', () => {
    const result = pick([event({ level: 3, levelUp: true })], { todayBlocks: [] })
    expect(result.celebration).toEqual({
      lead: 'stage',
      level: 3,
      stageBefore: 'seed',
      stageAfter: 'sprout',
      badges: [],
      day: null,
    })
    expect(result.seen).toEqual({ day: null, level: 3, badges: [] })
  })

  it('a level inside the same stage leads with the level', () => {
    const result = pick([event({ level: 4, levelUp: true })], { todayBlocks: [], seen: { ...SEEN, level: 3 } })
    expect(result.celebration).toMatchObject({ lead: 'level', level: 4, stageBefore: 'sprout', stageAfter: 'sprout' })
  })

  it('a level already celebrated is not celebrated again', () => {
    const seen = { ...SEEN, level: 4 }
    const result = pick([event({ level: 4, levelUp: true })], { todayBlocks: [], seen })
    expect(result.celebration).toBeNull()
    expect(result.seen).toEqual(seen)
  })

  it('takes the highest level of the events', () => {
    const result = pick([event({ level: 4, levelUp: true }), event({ level: 5, levelUp: true })], { todayBlocks: [], seen: { ...SEEN, level: 3 } })
    expect(result.celebration?.level).toBe(5)
  })

  it('the stage before is the level before the rise, not an old seen level', () => {
    // Storage was cleared (seen.level is the default 1), and the user goes from level 11 to 12.
    const result = pick([event({ level: 12, levelUp: true })], { todayBlocks: [], seen: { day: null, level: 1, badges: [] } })
    expect(result.celebration).toMatchObject({ lead: 'level', level: 12, stageBefore: 'young', stageAfter: 'young' })
  })

  it('a badge already seen is not celebrated, a new one is', () => {
    const seen = { ...SEEN, badges: ['first_task'] }
    expect(pick([event({ badgesEarned: ['first_task'] })], { todayBlocks: [], seen }).celebration).toBeNull()
    const result = pick([event({ badgesEarned: ['first_task', 'task_master_10'] })], { todayBlocks: [], seen })
    expect(result.celebration).toMatchObject({ lead: 'badge', badges: ['task_master_10'] })
    expect(result.seen.badges).toEqual(['first_task', 'task_master_10'])
  })

  it('a 0 XP event can still bring a badge', () => {
    const result = pick([event({ xp: 0, badgesEarned: ['task_master_10'] })], { todayBlocks: [] })
    expect(result.celebration?.badges).toEqual(['task_master_10'])
  })

  it('level, badges and day together: the level leads and the rest are filled', () => {
    const result = pick(
      [
        event({ blockId: 'b2', badgesEarned: ['xp_1000'], at: NOW - 60_000 }),
        event({ level: 4, levelUp: true, badgesEarned: ['iron_will_7', 'xp_1000'] }),
      ],
      { seen: { ...SEEN, level: 3 } },
    )
    expect(result.celebration).toEqual({
      lead: 'level',
      level: 4,
      stageBefore: 'sprout',
      stageAfter: 'sprout',
      badges: ['iron_will_7', 'xp_1000'],
      day: TODAY,
    })
    expect(result.seen).toEqual({ day: TODAY, level: 4, badges: ['iron_will_7', 'xp_1000'] })
  })

  it('drops an event older than 15 minutes', () => {
    expect(CELEBRATION_TTL_MS).toBe(15 * 60_000)
    const old = event({ level: 3, levelUp: true, badgesEarned: ['first_task'], at: NOW - 16 * 60_000 })
    const result = pick([old])
    expect(result.celebration).toBeNull()
    expect(result.seen).toBe(SEEN)
  })

  it('keeps an event of exactly 15 minutes', () => {
    expect(pick([event({ at: NOW - CELEBRATION_TTL_MS })]).celebration?.lead).toBe('day')
  })
})
