import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { durationText } from '../board/time'
import { en } from '../i18n/en'
import { isolate } from '../i18n/bidi'
import { makeBadges, makeDays, makeProgress } from '../progress/testFixtures'
import { badgeTier, gardenModel, stageFor, storyOf, summaryOf, type GardenExam, type Stage } from './model'
import { makeArchived, makeGardenExam } from './testFixtures'

const TZ = 'Asia/Jerusalem'
const badgeName = (key: string) => `Badge ${key}`

function model(progress = makeProgress(), exams: GardenExam[] = []) {
  return gardenModel({ progress, exams, timeZone: TZ })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-16T10:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('stageFor', () => {
  it.each<[number, Stage]>([
    [1, 'seed'],
    [2, 'seed'],
    [3, 'sprout'],
    [5, 'sprout'],
    [6, 'sapling'],
    [10, 'sapling'],
    [11, 'young'],
    [20, 'young'],
    [21, 'bonsai'],
    [35, 'bonsai'],
    [36, 'garden'],
    [50, 'garden'],
  ])('level %i is %s', (level, stage) => {
    expect(stageFor(level)).toBe(stage)
  })
})

describe('gardenModel: leaves, rings and stage', () => {
  it('counts a leaf per 100 XP of the level and a ring per level', () => {
    const m = model(makeProgress({ total_xp: 3450, level: 4, level_start_xp: 3000, next_level_xp: 4000 }))
    expect(m).toMatchObject({ leaves: 4, rings: 3, stage: 'sprout', level: 4, maxLevel: 50 })
  })

  it('has nine leaves and eight rings at the top level', () => {
    const m = model(makeProgress({ total_xp: 49_000, level: 50, level_start_xp: 49_000, next_level_xp: null }))
    expect(m).toMatchObject({ leaves: 9, rings: 8, stage: 'garden' })
  })

  it('caps the rings at eight from level 9', () => {
    expect(model(makeProgress({ total_xp: 12_000, level: 13, level_start_xp: 12_000, next_level_xp: 13_000 })).rings).toBe(8)
    expect(model(makeProgress({ total_xp: 8_000, level: 9, level_start_xp: 8_000, next_level_xp: 9_000 })).rings).toBe(8)
    expect(model(makeProgress({ total_xp: 7_000, level: 8, level_start_xp: 7_000, next_level_xp: 8_000 })).rings).toBe(7)
  })

  it('a new user has a seed, no leaf and no ring', () => {
    const m = model(makeProgress({ total_xp: 0, level: 1, level_start_xp: 0, next_level_xp: 1000 }))
    expect(m).toMatchObject({ leaves: 0, rings: 0, stage: 'seed' })
  })
})

describe('gardenModel: plants', () => {
  it.each([
    [0, 'seed'],
    [1, 'sprout'],
    [33, 'sprout'],
    [34, 'stem'],
    [66, 'stem'],
    [67, 'bud'],
    [100, 'bud'],
  ])('a live exam at %i%% is a %s', (percent, growth) => {
    const m = model(makeProgress(), [makeGardenExam({ percent })])
    expect(m.plants).toHaveLength(1)
    expect(m.plants[0]).toMatchObject({ id: 'exam-1', growth, percent, closedOn: null, state: 'active' })
  })

  it('pending and waiting for Moed B grow by their percent too', () => {
    const m = model(makeProgress(), [
      makeGardenExam({ id: 'a', percent: 100, state: 'pending' }),
      makeGardenExam({ id: 'b', percent: 50, state: 'waiting_moed_b', examDate: '2026-12-21' }),
    ])
    expect(m.plants.map((p) => [p.id, p.growth, p.state])).toEqual([
      ['a', 'bud', 'pending'],
      ['b', 'stem', 'waiting_moed_b'],
    ])
  })

  it('an archived exam blooms, closed on the local day of closed_at', () => {
    // 22:30 UTC on the 15th is 00:30 on the 16th in Jerusalem.
    const m = model(makeProgress({ archive: [makeArchived({ closed_at: '2026-11-15T22:30:00Z', studied_minutes: 95 })] }))
    expect(m.plants).toEqual([
      {
        id: 'exam-closed',
        name: 'Calculus',
        colorIndex: 3,
        growth: 'bloom',
        state: 'done',
        percent: 100,
        closedOn: '2026-11-16',
        studiedMinutes: 95,
      },
    ])
  })

  it('an archived exam with no closed_at has no closing day', () => {
    const m = model(makeProgress({ archive: [makeArchived({ closed_at: null })] }))
    expect(m.plants[0]?.closedOn).toBeNull()
  })

  it('counts an exam that is both done and archived once, as a bloom', () => {
    const m = model(makeProgress({ archive: [makeArchived({ exam_id: 'exam-1' })] }), [
      makeGardenExam({ id: 'exam-1', state: 'done', percent: 100 }),
    ])
    expect(m.plants.map((p) => [p.id, p.growth])).toEqual([['exam-1', 'bloom']])
  })

  it('drops a done exam that is not in the archive', () => {
    const m = model(makeProgress(), [makeGardenExam({ state: 'done' })])
    expect(m.plants).toEqual([])
  })

  it('keeps eight plants, the live exams first by date and id, then the archive in server order', () => {
    const live = [
      makeGardenExam({ id: 'l3', examDate: '2026-12-30' }),
      makeGardenExam({ id: 'l1b', examDate: '2026-12-01' }),
      makeGardenExam({ id: 'l1a', examDate: '2026-12-01' }),
      makeGardenExam({ id: 'l2', examDate: '2026-12-10' }),
      makeGardenExam({ id: 'gone', state: 'done' }),
    ]
    const archive = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((id) => makeArchived({ exam_id: id }))
    const m = model(makeProgress({ archive }), live)
    expect(m.plants.map((p) => p.id)).toEqual(['l1a', 'l1b', 'l2', 'l3', 'a1', 'a2', 'a3', 'a4'])
  })

  it('ten live exams become eight', () => {
    const live = Array.from({ length: 10 }, (_, i) => makeGardenExam({ id: `e${String(i)}`, examDate: `2026-12-${String(10 + i)}` }))
    const m = model(makeProgress({ archive: [makeArchived()] }), live)
    expect(m.plants).toHaveLength(8)
    expect(m.plants.every((p) => p.growth !== 'bloom')).toBe(true)
  })
})

describe('gardenModel: stones', () => {
  it('lists earned badges only, in the order of the server, with their tier', () => {
    const m = model(
      makeProgress({
        badges: makeBadges({
          iron_will_10: '2026-11-15T22:30:00Z',
          first_task: '2026-11-05T09:00:00Z',
          task_master_50: '2026-11-10T09:00:00Z',
        }),
      }),
    )
    expect(m.stones).toEqual([
      { key: 'first_task', group: 'first', tier: 1, tiers: 1, earnedAt: '2026-11-05' },
      { key: 'task_master_50', group: 'blocks', tier: 3, tiers: 4, earnedAt: '2026-11-10' },
      { key: 'iron_will_10', group: 'streak', tier: 2, tiers: 5, earnedAt: '2026-11-16' },
    ])
  })

  it('badgeTier counts within the group', () => {
    const badges = makeBadges()
    expect(badgeTier(badges, 'xp_10000')).toEqual({ group: 'xp', tier: 3, tiers: 3 })
    expect(badgeTier(badges, 'knowledge_seeker_5')).toEqual({ group: 'level', tier: 1, tiers: 5 })
    expect(() => badgeTier(badges, 'nope')).toThrow()
  })
})

describe('gardenModel: streak flowers and buds', () => {
  const streak = (current: number) => ({ current, longest: Math.max(current, 9), studied_today: true, today: '2026-11-16' })

  it('a 15-day streak has one flower and two branches', () => {
    expect(model(makeProgress({ streak: streak(15) }))).toMatchObject({ flowers: 1, branches: 2, buds: 0, streakCurrent: 15 })
  })

  it('caps the branches at four', () => {
    expect(model(makeProgress({ streak: streak(35) }))).toMatchObject({ flowers: 0, branches: 4, buds: 0 })
  })

  it('a paused streak closes into buds: the last run of days with XP', () => {
    const days = makeDays({
      '2026-11-05': 50,
      '2026-11-11': 40,
      '2026-11-12': 40,
      '2026-11-13': 40,
      '2026-11-14': 40,
    })
    expect(model(makeProgress({ streak: { ...streak(0), studied_today: false }, days }))).toMatchObject({
      flowers: 0,
      branches: 0,
      buds: 4,
    })
  })

  it('caps the buds at six', () => {
    const xp = Object.fromEntries(makeDays().slice(2, 12).map((d) => [d.date, 30]))
    expect(model(makeProgress({ streak: streak(0), days: makeDays(xp) })).buds).toBe(6)
  })

  it('no XP at all means no buds', () => {
    expect(model(makeProgress({ streak: streak(0), days: makeDays() }))).toMatchObject({ flowers: 0, branches: 0, buds: 0 })
  })
})

describe('storyOf and summaryOf', () => {
  const g = en.garden

  it('tells the story of the tree', () => {
    const m = model(makeProgress({ total_xp: 3450, level: 4, level_start_xp: 3000, next_level_xp: 4000 }))
    expect(storyOf(m, { kind: 'tree' }, badgeName)).toBe(g.story.tree(g.scene.stage.sprout, 4, 4, false))
  })

  it('at the top level the tree has all nine leaves and grows no more', () => {
    const top = model(makeProgress({ total_xp: 49_000, level: 50, level_start_xp: 49_000, next_level_xp: null }))
    expect(storyOf(top, { kind: 'tree' }, badgeName)).toBe(
      'A whole zen garden at level 50, the top level. It has all nine leaves, and I’ve raked all eight rings around it.',
    )
    const below = model(makeProgress({ total_xp: 48_950, level: 49, level_start_xp: 48_000, next_level_xp: 49_000 }))
    expect(storyOf(below, { kind: 'tree' }, badgeName)).toBe(
      'A whole zen garden at level 49. It grows a leaf for every 100 XP of a level, up to nine, and I’ve raked all eight rings around it. 9 new leaves so far.',
    )
  })

  // atTop is the one rule of the top (fix wave 14): the level reaching max_level, or the server
  // having no next level, whichever comes first; the leaves and the tree's sentence both read it.
  it('atTop: at max_level, or with no next level below it', () => {
    expect(model(makeProgress({ level: 50, max_level: 50, next_level_xp: null })).atTop).toBe(true)
    expect(model(makeProgress({ level: 50, max_level: 50, next_level_xp: 99_000 })).atTop).toBe(true)
    expect(model(makeProgress({ level: 4, level_start_xp: 3000, next_level_xp: 4000 })).atTop).toBe(false)
    const noNext = model(makeProgress({ total_xp: 30_100, level: 30, max_level: 50, level_start_xp: 30_000, next_level_xp: null }))
    expect(noNext.atTop).toBe(true)
    expect(storyOf(noNext, { kind: 'tree' }, badgeName)).toBe(g.story.tree(g.scene.stage.bonsai, 30, 9, true))
  })

  it('tells the story of each kind of plant, with the Hebrew name isolated', () => {
    const name = 'אלגוריתמים'
    const m = model(makeProgress({ archive: [makeArchived({ exam_id: 'c', name, studied_minutes: 90 })] }), [
      makeGardenExam({ id: 'a', name, percent: 40 }),
      makeGardenExam({ id: 'p', name, percent: 100, state: 'pending' }),
      makeGardenExam({ id: 'w', name, percent: 55, state: 'waiting_moed_b' }),
    ])
    expect(storyOf(m, { kind: 'plant', id: 'a' }, badgeName)).toBe(g.story.plant(name, 40))
    expect(storyOf(m, { kind: 'plant', id: 'p' }, badgeName)).toBe(g.story.plantPending(name))
    expect(storyOf(m, { kind: 'plant', id: 'w' }, badgeName)).toBe(g.story.plantWaiting(name, 55))
    const bloom = storyOf(m, { kind: 'plant', id: 'c' }, badgeName)
    expect(bloom).toBe(g.story.bloom(name, '12 November 2026', durationText(90)))
    for (const id of ['a', 'p', 'w', 'c']) expect(storyOf(m, { kind: 'plant', id }, badgeName)).toContain(isolate(name))
  })

  it('a bloom with no closing day or study time says only what is known', () => {
    const m = model(makeProgress({ archive: [makeArchived({ closed_at: null, studied_minutes: 0 })] }))
    expect(storyOf(m, { kind: 'plant', id: 'exam-closed' }, badgeName)).toBe(g.story.bloom('Calculus', null, ''))
  })

  it('tells the story of a stone', () => {
    const m = model(makeProgress({ badges: makeBadges({ xp_1000: '2026-11-14T10:00:00Z' }) }))
    expect(storyOf(m, { kind: 'stone', key: 'xp_1000' }, badgeName)).toBe(g.story.stone('Badge xp_1000', '14 November 2026'))
  })

  it('tells the story of the flowers, or of the buds when the streak paused', () => {
    expect(storyOf(model(makeProgress()), { kind: 'flowers' }, badgeName)).toBe(g.story.flowers(4))
    const paused = model(
      makeProgress({ streak: { current: 0, longest: 9, studied_today: false, today: '2026-11-16' }, days: makeDays({ '2026-11-14': 10 }) }),
    )
    expect(storyOf(paused, { kind: 'flowers' }, badgeName)).toBe(g.story.buds)
  })

  it('falls back to the summary for something that is not in the garden', () => {
    const m = model()
    expect(storyOf(m, { kind: 'plant', id: 'missing' }, badgeName)).toBe(summaryOf(m))
    expect(storyOf(m, { kind: 'stone', key: 'iron_will_100' }, badgeName)).toBe(summaryOf(m))
    const none = model(makeProgress({ streak: { current: 0, longest: 0, studied_today: false, today: '2026-11-16' }, days: makeDays() }))
    expect(storyOf(none, { kind: 'flowers' }, badgeName)).toBe(summaryOf(none))
  })

  it('sums up the garden', () => {
    const m = model(makeProgress({ archive: [makeArchived()] }), [makeGardenExam()])
    // makeProgress: level 2 and four earned badges.
    expect(summaryOf(m)).toBe(g.scene.summary(g.scene.stage.seed, 2, 1, 4))
    expect(summaryOf(m)).toBe('A seed, 2 exam plants, 1 in full bloom, and 4 stones.')
  })
})
