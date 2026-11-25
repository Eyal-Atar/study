import type { Block } from '../board/types'
import { stageFor, type Stage } from '../garden/model'
import type { Celebrated } from './seen'

// Which celebration a set of Done events earns (plan S33, decisions 3, 13, 14 and 15). Pure: the
// inbox holds the events, the calendar calls this when no sheet is open, and stores the new `seen`.

// One Done of this session, as board/xpEvents emits it (decision 2); `at` is Date.now() of the emit.
export interface DoneEvent {
  blockId: string
  xp: number
  level: number
  levelUp: boolean
  badgesEarned: string[]
  at: number
}

export type CelebrationLead = 'stage' | 'level' | 'badge' | 'day'

export interface Celebration {
  lead: CelebrationLead
  // The level reached, when a new one was; the stages before and after it then.
  level: number | null
  stageBefore: Stage | null
  stageAfter: Stage | null
  // New badges, not celebrated before, in the server's badge order.
  badges: string[]
  // The study day completed, when it was.
  day: string | null
}

// An event older than this is dropped (decision 15).
export const CELEBRATION_TTL_MS = 15 * 60_000

const counted = (b: Block) => b.state !== 'missed' && b.state !== 'skipped'

function newBadges(events: DoneEvent[], seen: string[], order: string[]): string[] {
  const earned = new Set(events.flatMap((e) => e.badgesEarned).filter((key) => !seen.includes(key)))
  const known = order.filter((key) => earned.has(key))
  // A key the order does not know still counts, after the known ones.
  const rest = [...earned].filter((key) => !order.includes(key))
  return [...known, ...rest]
}

export function pickCelebration(input: {
  events: DoneEvent[]
  now: number
  today: string
  todayBlocks: Block[]
  seen: Celebrated
  badgeOrder: string[]
}): { celebration: Celebration | null; seen: Celebrated } {
  const { now, today, todayBlocks, seen } = input
  const events = input.events.filter((e) => now - e.at <= CELEBRATION_TTL_MS)
  if (events.length === 0) return { celebration: null, seen }

  // The level: the highest one an event rose to, if this device has not celebrated it yet.
  const rises = events.filter((e) => e.levelUp && e.level > seen.level).map((e) => e.level)
  const level = rises.length > 0 ? Math.max(...rises) : null
  // The level before is the one just under the lowest rise, never below what was seen: a cleared
  // storage (seen.level 1) must not draw a seed as "before" a rise from 11 to 12.
  const levelBefore = level === null ? null : Math.max(seen.level, Math.min(...rises) - 1)
  const stageBefore = levelBefore === null ? null : stageFor(levelBefore)
  const stageAfter = level === null ? null : stageFor(level)

  const badges = newBadges(events, seen.badges, input.badgeOrder)

  // The day: an event marked a block of today, and every counted block of today is done (decision 13).
  const todays = todayBlocks.filter((b) => b.study_date === today)
  const touchedToday = events.some((e) => todays.some((b) => b.id === e.blockId))
  const countedToday = todays.filter(counted)
  const dayDone =
    seen.day !== today && touchedToday && countedToday.length > 0 && countedToday.every((b) => b.state === 'done')
  const day = dayDone ? today : null

  // Decision 3: a new stage, then a level, then a badge, then the day.
  let lead: CelebrationLead | null = null
  if (level !== null) lead = stageBefore !== stageAfter ? 'stage' : 'level'
  else if (badges.length > 0) lead = 'badge'
  else if (day !== null) lead = 'day'
  if (lead === null) return { celebration: null, seen }

  return {
    celebration: { lead, level, stageBefore, stageAfter, badges, day },
    seen: {
      day: day ?? seen.day,
      level: Math.max(seen.level, level ?? seen.level),
      badges: [...seen.badges, ...badges],
    },
  }
}
