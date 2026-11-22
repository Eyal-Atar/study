import type { Me } from '../api/me'
import { en } from '../i18n/en'
import { LOCALE } from '../i18n/locale'
import { addDays, weekStart } from '../board/time'
import type { Block } from '../board/types'
import type { Progress } from '../progress/types'

export function weekDays(date: string): string[] {
  const start = weekStart(date)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

export function streakDays(progress: Progress | undefined): Set<string> {
  return new Set((progress?.days ?? []).filter((d) => d.xp > 0).map((d) => d.date))
}

function counts(block: Block): boolean {
  return block.status !== 'missed' && block.status !== 'skipped'
}

// A free day: today or later, with no block, in a week that has blocks on other days.
export function restDays(days: string[], blocks: Block[], today: string): Set<string> {
  const busyDays = new Set(blocks.filter(counts).map((b) => b.study_date))
  if (!days.some((d) => busyDays.has(d))) return new Set()
  return new Set(days.filter((d) => d >= today && !busyDays.has(d)))
}

// Up to four distinct exam colours of the day, in order of start.
export function dayDots(blocks: Block[], date: string): number[] {
  const sorted = blocks.filter((b) => b.study_date === date && counts(b)).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const seen: number[] = []
  for (const block of sorted) {
    if (!seen.includes(block.exam_color_index)) seen.push(block.exam_color_index)
  }
  return seen.slice(0, 4)
}

function offsetMs(at: number, tz: string): number {
  const values: Record<string, number> = {}
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  for (const part of format.formatToParts(new Date(at))) {
    if (part.type !== 'literal') values[part.type] = Number(part.value)
  }
  const [y = 0, mo = 1, d = 1, h = 0, mi = 0, s = 0] = [values.year, values.month, values.day, values.hour, values.minute, values.second]
  return Date.UTC(y, mo - 1, d, h, mi, s) - Math.floor(at / 1000) * 1000
}

// The instant at which the wall clock of `tz` shows `date` plus `minutes`.
function instantOf(date: string, minutes: number, tz: string): number {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number)
  const wall = Date.UTC(y, m - 1, d, 0, minutes)
  let at = wall - offsetMs(wall, tz)
  at = wall - offsetMs(at, tz)
  return at
}

function clockMinutes(time: string): number {
  const [h = 0, m = 0] = time.split(':').map(Number)
  return h * 60 + m
}

// From wake_time to sleep_time of the study day `date`, in milliseconds; a sleep time before the wake
// time is after midnight. Null without /me.
export function wakingSpan(date: string, me: Me | undefined, tz: string): { dayStart: number | null; dayEnd: number | null } {
  if (me === undefined) return { dayStart: null, dayEnd: null }
  const wake = clockMinutes(me.wake_time)
  let sleep = clockMinutes(me.sleep_time)
  if (sleep <= wake) sleep += 1440
  return { dayStart: instantOf(date, wake, tz), dayEnd: instantOf(date, sleep, tz) }
}

const utcDay = (date: string): Date => {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

const format = (options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: 'UTC' })

const DAY_MONTH = format({ day: 'numeric', month: 'long' })
const DAY_MONTH_YEAR = format({ day: 'numeric', month: 'long', year: 'numeric' })
const DAY_ONLY = format({ day: 'numeric' })
const SHORT_DATE = format({ weekday: 'short', day: 'numeric', month: 'short' })
const WEEKDAY_SHORT = format({ weekday: 'short' })
const WEEKDAY_LONG = format({ weekday: 'long' })
const MONTH_YEAR = format({ year: 'numeric' })

// '22–28 November 2026', '29 November–5 December 2026', '27 December 2026–2 January 2027'.
export function weekRangeText(days: string[]): string {
  const first = days[0]
  const last = days[days.length - 1]
  if (first === undefined || last === undefined) return ''
  const a = utcDay(first)
  const b = utcDay(last)
  const join = en.calendar.page.rangeJoin
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return join(DAY_MONTH_YEAR.format(a), DAY_MONTH_YEAR.format(b))
  const year = MONTH_YEAR.format(b)
  if (a.getUTCMonth() !== b.getUTCMonth()) return `${join(DAY_MONTH.format(a), DAY_MONTH.format(b))} ${year}`
  return `${join(DAY_ONLY.format(a), DAY_ONLY.format(b))} ${DAY_MONTH.format(b).replace(/^\d+ /, '')} ${year}`
}

// 'Tue, 24 Nov'
export function shortDate(date: string): string {
  return SHORT_DATE.format(utcDay(date))
}

export function weekdayShort(date: string): string {
  return WEEKDAY_SHORT.format(utcDay(date))
}

export function weekdayLong(date: string): string {
  return WEEKDAY_LONG.format(utcDay(date))
}
