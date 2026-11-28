import { durationText } from '../board/time'
import { longDate, todayIn } from '../exam/dates'
import { en } from '../i18n/en'
import type { Badge, BadgeGroup, Progress } from '../progress/types'

// The garden of the progress screen as data (S33, plan decisions 4, 5, 19 and Global Constraints).
// Pure: the scene only draws what this says, and the celebration sheet draws "before" and "after"
// from the same functions.

export type Stage = 'seed' | 'sprout' | 'sapling' | 'young' | 'bonsai' | 'garden'
export type PlantGrowth = 'seed' | 'sprout' | 'stem' | 'bud' | 'bloom'
export type ExamPlantState = 'active' | 'pending' | 'waiting_moed_b' | 'done'

// A live exam as the garden needs it: GET /exams with examState(), and its percent from useExamProgress.
export interface GardenExam {
  id: string
  name: string
  colorIndex: number
  examDate: string
  state: ExamPlantState
  percent: number
}

export interface GardenPlant {
  id: string
  name: string
  colorIndex: number
  growth: PlantGrowth
  state: ExamPlantState
  percent: number
  // The local day the exam was closed (a bloom with closed_at); null otherwise.
  closedOn: string | null
  studiedMinutes: number
}

export interface GardenStone {
  key: string
  group: BadgeGroup
  // 1-based, within the group in the server's order.
  tier: number
  tiers: number
  // The local day the badge was earned, or null when the server has no instant.
  earnedAt: string | null
}

export interface GardenModel {
  stage: Stage
  level: number
  // progress.max_level.
  maxLevel: number
  // The top: level >= max_level, or the server has no next level. The leaves are all there and the
  // tree's sentence says it is the top level.
  atTop: boolean
  leaves: number
  rings: number
  plants: GardenPlant[]
  stones: GardenStone[]
  flowers: number
  branches: number
  buds: number
  streakCurrent: number
}

// The first level of each stage (Global Constraints): seed 1–2, sprout 3–5, sapling 6–10,
// young 11–20, bonsai 21–35, garden 36–50.
const STAGE_FROM: [Stage, number][] = [
  ['garden', 36],
  ['bonsai', 21],
  ['young', 11],
  ['sapling', 6],
  ['sprout', 3],
]

const XP_PER_LEAF = 100
const MAX_LEAVES = 9
const MAX_RINGS = 8
const STREAK_WEEK = 7
const MAX_BRANCHES = 4
const MAX_BUDS = 6
const MAX_PLANTS = 8
// Decision 5: 0 is a seed, 1–33 a sprout, 34–66 a stem, 67–100 a bud.
const STEM_FROM = 34
const BUD_FROM = 67

export function stageFor(level: number): Stage {
  for (const [stage, from] of STAGE_FROM) if (level >= from) return stage
  return 'seed'
}

function growthFor(percent: number): PlantGrowth {
  if (percent <= 0) return 'seed'
  if (percent < STEM_FROM) return 'sprout'
  if (percent < BUD_FROM) return 'stem'
  return 'bud'
}

export function badgeTier(badges: Badge[], key: string): { group: BadgeGroup; tier: number; tiers: number } {
  const badge = badges.find((b) => b.key === key)
  if (badge === undefined) throw new Error(`Unknown badge: ${key}`)
  const group = badges.filter((b) => b.group === badge.group)
  return { group: badge.group, tier: group.indexOf(badge) + 1, tiers: group.length }
}

// Decision 19: from the end of the 14 days, skip the days without XP, then count the days in a row
// with XP, up to six.
function budsOf(days: Progress['days']): number {
  let count = 0
  for (let i = days.length - 1; i >= 0; i--) {
    const studied = (days[i]?.xp ?? 0) > 0
    if (studied) count++
    else if (count > 0) break
  }
  return Math.min(count, MAX_BUDS)
}

const localDay = (instant: string | null, timeZone: string) =>
  instant === null ? null : todayIn(timeZone, new Date(instant))

export function gardenModel(input: { progress: Progress; exams: GardenExam[]; timeZone: string }): GardenModel {
  const { progress, exams, timeZone } = input
  const atTop = progress.level >= progress.max_level || progress.next_level_xp === null
  const leaves = atTop
    ? MAX_LEAVES
    : Math.min(Math.max(Math.floor((progress.total_xp - progress.level_start_xp) / XP_PER_LEAF), 0), MAX_LEAVES)

  // The archive is the truth for a bloom: an exam there is a flower even when GET /exams still has it.
  const archived = new Set(progress.archive.map((a) => a.exam_id))
  const live: GardenPlant[] = exams
    .filter((e) => e.state !== 'done' && !archived.has(e.id))
    .sort((a, b) => a.examDate.localeCompare(b.examDate) || a.id.localeCompare(b.id))
    .map((e) => ({
      id: e.id,
      name: e.name,
      colorIndex: e.colorIndex,
      growth: growthFor(e.percent),
      state: e.state,
      percent: e.percent,
      closedOn: null,
      studiedMinutes: 0,
    }))
  const blooms: GardenPlant[] = progress.archive.map((a) => ({
    id: a.exam_id,
    name: a.name,
    colorIndex: a.color_index,
    growth: 'bloom',
    state: 'done',
    percent: a.completion_percent,
    closedOn: localDay(a.closed_at, timeZone),
    studiedMinutes: a.studied_minutes,
  }))

  const stones: GardenStone[] = progress.badges
    .filter((b) => b.earned)
    .map((b) => ({ key: b.key, ...badgeTier(progress.badges, b.key), earnedAt: localDay(b.earned_at, timeZone) }))

  const current = progress.streak.current
  return {
    stage: stageFor(progress.level),
    level: progress.level,
    maxLevel: progress.max_level,
    atTop,
    leaves,
    rings: Math.min(Math.max(progress.level - 1, 0), MAX_RINGS),
    plants: [...live, ...blooms].slice(0, MAX_PLANTS),
    stones,
    flowers: current > 0 ? current % STREAK_WEEK : 0,
    branches: current > 0 ? Math.min(Math.floor(current / STREAK_WEEK), MAX_BRANCHES) : 0,
    buds: current === 0 ? budsOf(progress.days) : 0,
    streakCurrent: current,
  }
}

export type GardenItem = { kind: 'tree' } | { kind: 'plant'; id: string } | { kind: 'stone'; key: string } | { kind: 'flowers' }

const text = en.garden

function plantStory(plant: GardenPlant): string {
  switch (plant.state) {
    case 'done':
      return text.story.bloom(
        plant.name,
        plant.closedOn === null ? null : longDate(plant.closedOn),
        plant.studiedMinutes > 0 ? durationText(plant.studiedMinutes) : '',
      )
    case 'pending':
      return text.story.plantPending(plant.name)
    case 'waiting_moed_b':
      return text.story.plantWaiting(plant.name, plant.percent)
    case 'active':
      return text.story.plant(plant.name, plant.percent)
  }
}

// The caption for a selected thing; something no longer in the garden falls back to the summary.
export function storyOf(model: GardenModel, item: GardenItem, badgeName: (key: string) => string): string {
  switch (item.kind) {
    case 'tree':
      return text.story.tree(text.scene.stage[model.stage], model.level, model.leaves, model.atTop)
    case 'plant': {
      const plant = model.plants.find((p) => p.id === item.id)
      return plant === undefined ? summaryOf(model) : plantStory(plant)
    }
    case 'stone': {
      const stone = model.stones.find((s) => s.key === item.key)
      if (stone === undefined) return summaryOf(model)
      return text.story.stone(badgeName(stone.key), stone.earnedAt === null ? null : longDate(stone.earnedAt))
    }
    case 'flowers':
      if (model.streakCurrent > 0) return text.story.flowers(model.streakCurrent)
      return model.buds > 0 ? text.story.buds : summaryOf(model)
  }
}

// The caption with nothing selected, and the accessible name of the scene.
export function summaryOf(model: GardenModel): string {
  const blooms = model.plants.filter((p) => p.growth === 'bloom').length
  return text.scene.summary(text.scene.stage[model.stage], model.plants.length, blooms, model.stones.length)
}
