// The texts of S33: the garden and the celebrations. Part of en as en.garden (en.ts).
// The functions take what is already worked out: a number from formatNumber, a duration from
// durationText, a date from longDate / dayMonth, a badge name from en.progress.badges.items, a stage
// name from scene.stage. Nothing is computed here except the choice of words.
// Every sentence says only what the garden really does (plan, Global Constraints): a leaf for every
// 100 XP (0–9), a ring for every level up to eight (min(level − 1, 8)), a flower for each day of the
// streak (current % 7) and a branch for every 7 days up to four (min(floor(current / 7), 4)).
import { isolate } from './bidi'

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`

// The garden has at most eight raked rings: from level 9 on, a new level adds no ring.
const MAX_RINGS = 8
const ringsFull = (level: number) => level - 1 >= MAX_RINGS
// The streak shows at most four branches: from 28 days on, a new week opens no branch.
const BRANCH_DAYS = 7
const MAX_BRANCHES = 4

// "a", "a and b", "a, b and c": badge names are product text, so nothing is isolated.
const list = (parts: string[]) =>
  parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`

// "A young tree" inside a sentence: "a young tree".
const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

const allBlocks = 'every block for today'

const buds = 'Your last streak ended, so the flowers closed into buds.'
const startAgain = 'One block today starts a new one.'

export const enGarden = {
  // The garden scene of the progress screen and its caption.
  scene: {
    title: 'Your garden',
    // The caption with nothing selected, and the accessible name of the scene. plants: the exam
    // plants shown; blooms: how many of them are in full bloom (closed exams); stones: earned badges.
    summary: (stage: string, plants: number, blooms: number, stones: number) => {
      const plantPart = plants > 0 ? plural(plants, 'exam plant', 'exam plants') : ''
      const parts = [
        stage,
        plantPart && blooms > 0 ? `${plantPart}, ${String(blooms)} in full bloom` : plantPart,
        stones > 0 ? plural(stones, 'stone', 'stones') : '',
      ].filter(Boolean)
      if (parts.length === 3) return `${parts[0] ?? ''}, ${parts[1] ?? ''}, and ${parts[2] ?? ''}.`
      return `${parts.join(' and ')}.`
    },
    // The plant at the centre, by the stage of the level.
    stage: {
      seed: 'A seed',
      sprout: 'A sprout',
      sapling: 'A seedling',
      young: 'A young tree',
      bonsai: 'A bonsai',
      garden: 'A whole zen garden',
    },
    hint: 'Tap anything in the garden for its story.',
  },
  // The caption when a thing in the garden is selected.
  story: {
    // leaves: the new leaves of this level (0–9).
    tree: (stage: string, level: number, leaves: number) => {
      const rings = ringsFull(level)
        ? 'I’ve raked all eight rings around it.'
        : 'I rake a ring around it at every level.'
      const grown = leaves > 0 ? ` ${plural(leaves, 'new leaf', 'new leaves')} so far.` : ''
      return `${stage} at level ${String(level)}. It grows a leaf for every 100 XP of a level, up to nine, and ${rings}${grown}`
    },
    plant: (name: string, percent: number) =>
      `${isolate(name)}: ${String(percent)}% of the plan done. It grows as you finish its tasks.`,
    plantWaiting: (name: string, percent: number) =>
      `${isolate(name)} is waiting for its retake, with ${String(percent)}% of the plan done.`,
    // The closure row is the first row of the calendar banner (S45).
    plantPending: (name: string) => `${isolate(name)} is ready to close. You’ll find it at the top of your calendar.`,
    // date: closed_at as longDate, or null when the archive has none; studied: durationText of
    // studied_minutes, or '' when it is 0.
    bloom: (name: string, date: string | null, studied: string) => {
      const closed = date === null ? 'when you closed it.' : `when you closed it on ${date}.`
      return `${isolate(name)} bloomed ${closed}${studied ? ` You studied ${studied} for it.` : ''}`
    },
    // date: earned_at as longDate, or null when it is missing.
    stone: (badge: string, date: string | null) =>
      date === null ? `${badge}. You earned this stone.` : `${badge}. You earned this stone on ${date}.`,
    flowers: (current: number) =>
      current >= BRANCH_DAYS * MAX_BRANCHES
        ? `A ${String(current)}-day streak. All four branches are in bloom, with a flower for each day since the last full week.`
        : `A ${String(current)}-day streak, a flower for each day. Every 7 days they open into a branch.`,
    buds: `${buds} ${startAgain}`,
  },
  // The streak card of the progress screen.
  streak: {
    // Said next to Archi when current is 0 and longest is not. No word on buds: the card shows
    // none, and the garden may have none (the last run can be older than 14 days).
    paused: `Your last streak ended. ${startAgain}`,
    // days: en.progress.streak.days ("15 days").
    longest: (days: string) => `Longest: ${days}`,
  },
  days: {
    title: 'Last 14 days',
  },
  // The celebration sheet: one sheet for one moment, the biggest moment leads (plan decision 3).
  celebrate: {
    close: 'Close',
    dayTitle: `That’s ${allBlocks}`,
    // duration: durationText of the day's blocks.
    dayBody: (blocks: number, duration: string) => `${plural(blocks, 'block', 'blocks')}, ${duration}.`,
    // time: the start of tomorrow's first block ("09:00").
    tomorrow: (time: string) => `Tomorrow starts at ${time}.`,
    levelTitle: (level: number) => `Level ${String(level)}`,
    // level: the new level. Up to level 9 it adds a ring; after that the rings are full and only
    // the leaves start again.
    levelBody: (level: number) =>
      level - 1 > MAX_RINGS
        ? 'Your tree already has all eight rings, so its leaves start over.'
        : 'I’ve raked one more ring around your tree.',
    // stage: a name of scene.stage.
    stageTitle: (stage: string) => `Your garden is ${lower(stage)} now`,
    stageBody: (level: number) => `Level ${String(level)}. Here it is before and after.`,
    before: 'Before',
    after: 'After',
    badgeTitle: (badge: string) => badge,
    badgeBody: 'I’ve set its stone in your garden.',
    // The lines of what happened together with the leading moment.
    alsoLevel: (level: number) => `You reached level ${String(level)}.`,
    alsoBadges: (names: string[]) => `${names.length === 1 ? 'New badge' : 'New badges'}: ${list(names)}.`,
    alsoDay: `And that’s ${allBlocks}.`,
    // The chips. xp: formatNumber of today's XP.
    xpToday: (xp: string) => `+${xp} XP today`,
    streak: (days: number) => `${String(days)}-day streak`,
  },
  // The badge stones of the progress screen.
  badge: {
    towards: (current: string, threshold: string) => `${current} of ${threshold}`,
    // date: dayMonth ("13 Nov").
    earnedOn: (date: string) => `Earned ${date}`,
  },
} as const
