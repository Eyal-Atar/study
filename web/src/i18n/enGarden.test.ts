// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { en } from './en'
import { enGarden } from './enGarden'

// The texts of S33 (the garden and the celebrations): the binding sentences of the plan, counts,
// user content and Archi's voice.

const FSI = String.fromCodePoint(0x2068)
const PDI = String.fromCodePoint(0x2069)
const EXAM = 'הסתברות'
const iso = (name: string) => `${FSI}${name}${PDI}`
const { scene, story, streak, days, celebrate } = enGarden

describe('enGarden: en.garden', () => {
  it('is part of en', () => {
    expect(en.garden).toBe(enGarden)
  })
})

describe('enGarden: the binding sentences of the plan', () => {
  it.each([
    ['scene.title', scene.title, 'Your garden'],
    ['scene.summary', scene.summary('A young tree', 3, 1, 5), 'A young tree, 3 exam plants, 1 in full bloom, and 5 stones.'],
    ['scene.stage.seed', scene.stage.seed, 'A seed'],
    ['scene.stage.sprout', scene.stage.sprout, 'A sprout'],
    ['scene.stage.sapling', scene.stage.sapling, 'A seedling'],
    ['scene.stage.young', scene.stage.young, 'A young tree'],
    ['scene.stage.bonsai', scene.stage.bonsai, 'A bonsai'],
    ['scene.stage.garden', scene.stage.garden, 'A whole zen garden'],
    ['scene.buds', scene.buds, 'Buds'],
    ['scene.hint', scene.hint, 'Tap a plant, a stone or the flowers for its story.'],
    [
      'story.tree',
      story.tree('A young tree', 12, 0, false),
      'A young tree at level 12. It grows a leaf for every 100 XP of a level, up to nine, and I’ve raked all eight rings around it.',
    ],
    [
      'story.tree',
      story.tree('A sprout', 4, 0, false),
      'A sprout at level 4. It grows a leaf for every 100 XP of a level, up to nine, and I rake a ring around it at every level.',
    ],
    [
      'story.tree',
      story.tree('A seedling', 8, 0, false),
      'A seedling at level 8. It grows a leaf for every 100 XP of a level, up to nine, and I rake a ring around it at every level.',
    ],
    [
      'story.tree',
      story.tree('A seedling', 9, 0, false),
      'A seedling at level 9. It grows a leaf for every 100 XP of a level, up to nine, and I’ve raked all eight rings around it.',
    ],
    [
      'story.tree',
      story.tree('A sprout', 4, 4, false),
      'A sprout at level 4. It grows a leaf for every 100 XP of a level, up to nine, and I rake a ring around it at every level. 4 new leaves so far.',
    ],
    [
      'story.tree',
      story.tree('A seed', 1, 1, false),
      'A seed at level 1. It grows a leaf for every 100 XP of a level, up to nine, and I rake a ring around it at every level. 1 new leaf so far.',
    ],
    [
      'story.tree',
      story.tree('A whole zen garden', 50, 9, true),
      'A whole zen garden at level 50, the top level. It has all nine leaves, and I’ve raked all eight rings around it.',
    ],
    [
      'story.tree',
      story.tree('A whole zen garden', 49, 9, false),
      'A whole zen garden at level 49. It grows a leaf for every 100 XP of a level, up to nine, and I’ve raked all eight rings around it. 9 new leaves so far.',
    ],
    ['story.plant', story.plant(EXAM, 62), `${iso(EXAM)}: 62% of the plan done. It grows as you finish its tasks.`],
    ['story.plantWaiting', story.plantWaiting(EXAM, 62), `${iso(EXAM)} is waiting for its retake, with 62% of the plan done.`],
    ['story.plantPending', story.plantPending(EXAM), `${iso(EXAM)} is ready to close. You’ll find it at the top of your calendar.`],
    [
      'story.bloom',
      story.bloom(EXAM, '16 November 2026', '21 hours'),
      `${iso(EXAM)} bloomed when you closed it on 16 November 2026. You studied 21 hours for it.`,
    ],
    ['story.bloom', story.bloom(EXAM, '16 November 2026', ''), `${iso(EXAM)} bloomed when you closed it on 16 November 2026.`],
    ['story.bloom', story.bloom(EXAM, null, '21 hours'), `${iso(EXAM)} bloomed when you closed it. You studied 21 hours for it.`],
    ['story.stone', story.stone('10 blocks', '13 November 2026'), '10 blocks. You earned this stone on 13 November 2026.'],
    ['story.stone', story.stone('10 blocks', null), '10 blocks. You earned this stone.'],
    ['story.flowers', story.flowers(5), 'A 5-day streak, a flower for each day. Every 7 days they open into a branch.'],
    ['story.flowers', story.flowers(1), 'A 1-day streak, a flower for each day. Every 7 days they open into a branch.'],
    ['story.flowers', story.flowers(27), 'A 27-day streak, a flower for each day. Every 7 days they open into a branch.'],
    [
      'story.flowers',
      story.flowers(30),
      'A 30-day streak. All four branches are in bloom, with a flower for each day since the last full week.',
    ],
    ['story.buds', story.buds, 'Your last streak ended, so the flowers closed into buds. One block today starts a new one.'],
    ['streak.paused', streak.paused, 'Your last streak ended. One block today starts a new one.'],
    ['streak.longest', streak.longest('15 days'), 'Longest: 15 days'],
    ['days.title', days.title, 'Last 14 days'],
    ['celebrate.close', celebrate.close, 'Close'],
    ['celebrate.dayTitle', celebrate.dayTitle, 'That’s every block for today'],
    ['celebrate.dayBody', celebrate.dayBody(4, '4 hours 45 min'), '4 blocks, 4 hours 45 min.'],
    ['celebrate.dayBody', celebrate.dayBody(1, '45 min'), '1 block, 45 min.'],
    ['celebrate.tomorrow', celebrate.tomorrow('09:00'), 'Tomorrow starts at 09:00.'],
    ['celebrate.levelTitle', celebrate.levelTitle(4), 'Level 4'],
    ['celebrate.levelBody', celebrate.levelBody(4), 'I’ve raked one more ring around the plant at the centre.'],
    ['celebrate.levelBody', celebrate.levelBody(9), 'I’ve raked one more ring around the plant at the centre.'],
    ['celebrate.levelBody', celebrate.levelBody(10), 'All eight rings are raked, so the leaves start over.'],
    ['celebrate.stageTitle', celebrate.stageTitle('A young tree'), 'Your garden is a young tree now'],
    ['celebrate.stageBody', celebrate.stageBody(11), 'Level 11. Here it is before and after.'],
    ['celebrate.before', celebrate.before, 'Before'],
    ['celebrate.after', celebrate.after, 'After'],
    ['celebrate.badgeTitle', celebrate.badgeTitle('10 blocks'), '10 blocks'],
    ['celebrate.badgeBody', celebrate.badgeBody, 'I’ve set its stone in your garden.'],
    ['celebrate.alsoLevel', celebrate.alsoLevel(4), 'You reached level 4.'],
    ['celebrate.alsoDay', celebrate.alsoDay, 'And that’s every block for today.'],
    ['celebrate.xpToday', celebrate.xpToday('60'), '+60 XP today'],
    ['celebrate.streak', celebrate.streak(5), '5-day streak'],
  ])('%s = "%s"', (_key, text, expected) => {
    expect(text).toBe(expected)
  })
})

describe('enGarden: the summary of the scene', () => {
  it.each([
    [3, 1, 5, 'A young tree, 3 exam plants, 1 in full bloom, and 5 stones.'],
    [0, 0, 0, 'A young tree.'],
    [0, 0, 5, 'A young tree and 5 stones.'],
    [3, 0, 0, 'A young tree and 3 exam plants.'],
    [3, 2, 0, 'A young tree and 3 exam plants, 2 in full bloom.'],
    [3, 0, 5, 'A young tree, 3 exam plants, and 5 stones.'],
    [1, 0, 1, 'A young tree, 1 exam plant, and 1 stone.'],
    [1, 1, 2, 'A young tree, 1 exam plant, 1 in full bloom, and 2 stones.'],
  ])('%i plants, %i blooms, %i stones', (plants, blooms, stones, expected) => {
    expect(scene.summary('A young tree', plants, blooms, stones)).toBe(expected)
  })
})

describe('enGarden: user content', () => {
  it('a plant wraps the exam name in an isolate, without quotes', () => {
    const text = story.plant(EXAM, 62)
    expect(text.startsWith(iso(EXAM))).toBe(true)
    expect(text.split(FSI)).toHaveLength(2)
    expect(text).not.toMatch(/["“”‘]/)
  })

  it.each([
    ['story.plant', story.plant(EXAM, 62)],
    ['story.plantWaiting', story.plantWaiting(EXAM, 62)],
    ['story.plantPending', story.plantPending(EXAM)],
    ['story.bloom', story.bloom(EXAM, '16 November 2026', '')],
  ])('%s isolates the name exactly once', (_key, text) => {
    expect(text).toContain(iso(EXAM))
    expect(text.split(iso(EXAM)).join('')).not.toContain(EXAM)
    expect(text.split(FSI)).toHaveLength(2)
  })
})

describe('enGarden: the other news of a celebration', () => {
  it.each([
    [['10 blocks'], 'New badge: 10 blocks.'],
    [['10 blocks', 'A week straight'], 'New badges: 10 blocks and A week straight.'],
    [['10 blocks', 'A week straight', 'Level 5'], 'New badges: 10 blocks, A week straight and Level 5.'],
  ])('alsoBadges(%j)', (names, expected) => {
    expect(celebrate.alsoBadges(names)).toBe(expected)
  })
})

// Every value of en.garden, with sample arguments, so the voice checks below read the text a
// student sees.
const TITLES = [
  scene.title,
  days.title,
  celebrate.close,
  celebrate.dayTitle,
  celebrate.levelTitle(4),
  celebrate.stageTitle('A young tree'),
  celebrate.before,
  celebrate.after,
  celebrate.badgeTitle('10 blocks'),
  // Labels and chips: short phrases, not sentences of Archi.
  ...Object.values(scene.stage),
  scene.buds,
  streak.longest('15 days'),
  celebrate.xpToday('60'),
  celebrate.streak(5),
]

const SENTENCES = [
  scene.summary('A young tree', 3, 1, 5),
  scene.summary('A seed', 0, 0, 0),
  scene.hint,
  story.tree('A young tree', 12, 4, false),
  story.tree('A sprout', 4, 0, false),
  story.tree('A whole zen garden', 50, 9, true),
  story.plant(EXAM, 62),
  story.plantWaiting(EXAM, 62),
  story.plantPending(EXAM),
  story.bloom(EXAM, '16 November 2026', '21 hours'),
  story.bloom(EXAM, null, ''),
  story.stone('10 blocks', '13 November 2026'),
  story.stone('10 blocks', null),
  story.flowers(5),
  story.flowers(30),
  story.buds,
  streak.paused,
  celebrate.dayBody(4, '4 hours 45 min'),
  celebrate.tomorrow('09:00'),
  celebrate.levelBody(4),
  celebrate.levelBody(12),
  celebrate.stageBody(11),
  celebrate.badgeBody,
  celebrate.alsoLevel(4),
  celebrate.alsoBadges(['10 blocks', 'A week straight']),
  celebrate.alsoDay,
]

describe('enGarden: Archi’s voice', () => {
  it.each([...TITLES, ...SENTENCES])('"%s" has no exclamation, middle dot or emoji', (text) => {
    expect(text).not.toMatch(/!/)
    expect(text).not.toContain('·')
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  it.each(TITLES)('the title or label "%s" has no full stop', (text) => {
    expect(text).not.toMatch(/\.$/)
  })

  it.each(SENTENCES)('the sentence "%s" ends with a full stop', (text) => {
    expect(text).toMatch(/\.$/)
  })

  it('the file never speaks of Archi in the third person', () => {
    const code = readFileSync(new URL('./enGarden.ts', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/\bArchie?\s+(will|would|can|could|is|was|has|had|does|did|may|might|should|must|shall|[a-z]+s)\b/)
    expect(code).not.toMatch(/\bArchie\b|\bthe (app|system) (will|has|can)\b/)
    expect(code).not.toMatch(/\bArchi\b/)
  })
})
