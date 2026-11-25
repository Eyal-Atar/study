import type { ArchieMood } from '../archie/Archie'
import type { Block } from '../board/types'
import { en } from '../i18n/en'

// Archi's moments on the calendar: which line and mood he shows, and when he may speak up (S32 Task 6).
export type ArchiMoment = 'review' | 'report' | 'restDay' | 'openDay' | 'dayDone' | 'deepWork' | 'morning' | 'day'

const MINUTE = 60_000
const DEEP_WORK_MINUTES = 60
const INTERRUPT_GAP_MS = 20 * MINUTE
const INTERRUPT_KEY = 'archi.lastInterrupt'
const BREAK_RUN_MINUTES = 90
const BREAK_MAX_GAP_MS = 15 * MINUTE
const BREAK_WINDOW_MS = 30 * MINUTE

const minutesOf = (b: Block) => (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / MINUTE

export function archiMoment(input: {
  reviewCount: number
  unplacedCount: number
  todayIsRest: boolean
  todayBlocks: Block[]
  hour: number
}): ArchiMoment {
  if (input.reviewCount > 0) return 'review'
  if (input.unplacedCount > 0) return 'report'
  if (input.todayIsRest) return 'restDay'
  const counted = input.todayBlocks.filter((b) => b.state !== 'missed' && b.state !== 'skipped')
  // Nothing to count and not a rest day of the plan (a week with no blocks at all, or a day whose
  // blocks were all skipped or missed): the summary would count zero, so the day has its own line.
  if (counted.length === 0) return 'openDay'
  if (counted.every((b) => b.state === 'done')) return 'dayDone'
  if (input.todayBlocks.some((b) => b.state === 'in_progress' && minutesOf(b) >= DEEP_WORK_MINUTES)) {
    return 'deepWork'
  }
  return input.hour < 12 ? 'morning' : 'day'
}

export const MOMENT_MOOD: Record<ArchiMoment, ArchieMood> = {
  review: 'intentions',
  report: 'flow',
  restDay: 'rest',
  openDay: 'joy',
  dayDone: 'eureka',
  deepWork: 'wisdom',
  morning: 'intentions',
  day: 'joy',
}

// 1-based day of the year, from a YYYY-MM-DD string in UTC (independent of the machine's timezone).
function dayOfYear(date: string): number {
  const [y = 1970, m = 1, d = 1] = date.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000) + 1
}

export function archiLine(
  moment: ArchiMoment,
  date: string,
  summary: { total: number; done: number; next: string | null },
): string {
  const pick = (lines: readonly string[]) => lines[dayOfYear(date) % 3] ?? ''
  if (moment === 'morning' || moment === 'day') {
    // Archi never counts zero blocks, whatever moment the caller worked out.
    if (summary.total <= 0) return pick(en.calendar.archi.openDay)
    return en.calendar.archi.summary(summary.total, summary.done, summary.next)
  }
  return pick(en.calendar.archi[moment])
}

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

// Records that Archi spoke up at `now`, without asking: the focus screen's own break is a ritual, not
// an interruption, but BreakNotice must not repeat it for the next 20 minutes (S42).
export function noteArchiInterrupt(now: number, storage: Pick<Storage, 'setItem'> | undefined = defaultStorage()): void {
  try {
    storage?.setItem(INTERRUPT_KEY, String(now))
  } catch {
    // A storage that throws only means the notice may repeat.
  }
}

// At most one interruption every 20 minutes. A missing or throwing storage never blocks Archi.
export function archiMayInterrupt(
  now: number,
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = defaultStorage(),
): boolean {
  if (!storage) return true
  try {
    const last = Number(storage.getItem(INTERRUPT_KEY))
    if (storage.getItem(INTERRUPT_KEY) !== null && Number.isFinite(last) && now - last < INTERRUPT_GAP_MS) {
      return false
    }
    storage.setItem(INTERRUPT_KEY, String(now))
    return true
  } catch {
    return true
  }
}

// A run of done blocks (gaps of at most 15 minutes) of 90 minutes or more that ended in the last 30
// minutes: the id of its first block (the run's name, which a further Done in it does not change),
// or null.
export function breakRun(todayBlocks: Block[], now: number): string | null {
  const done = todayBlocks
    .filter((b) => b.state === 'done')
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
  let runMinutes = 0
  let runEnd = Number.NEGATIVE_INFINITY
  let runStart: string | null = null
  for (const b of done) {
    const start = Date.parse(b.starts_at)
    const end = Date.parse(b.ends_at)
    if (start - runEnd <= BREAK_MAX_GAP_MS) {
      runMinutes += minutesOf(b)
    } else {
      runMinutes = minutesOf(b)
      runStart = b.id
    }
    runEnd = Math.max(runEnd, end)
    const since = now - runEnd
    if (runMinutes >= BREAK_RUN_MINUTES && since >= 0 && since <= BREAK_WINDOW_MS) return runStart
  }
  return null
}

export function needsBreak(todayBlocks: Block[], now: number): boolean {
  return breakRun(todayBlocks, now) !== null
}
