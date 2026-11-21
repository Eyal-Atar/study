import type { BusyItem } from '../availability/types'
import { addDays, dateIn } from '../board/time'
import type { Block } from '../board/types'
import type { CalendarView } from './calendarUrl'

// Minutes from midnight of the column's day. endMin goes up to 1560 (26:00): a block just after
// midnight belongs to the day it was planned for, and hangs below that column's midnight.
export interface GridSpan {
  startMin: number
  endMin: number
}

export const HOUR_PX = { desktop: 48, phone: 60 } as const

const MAX_END = 1560
const DEFAULT_SPAN: GridSpan = { startMin: 480, endMin: 1320 }

const dateParts = new Map<string, Intl.DateTimeFormat>()

function partsFormat(tz: string): Intl.DateTimeFormat {
  let format = dateParts.get(tz)
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    dateParts.set(tz, format)
  }
  return format
}

function wallClock(at: number, tz: string): { date: string; minutes: number; utcLike: number } {
  const values: Record<string, number> = {}
  for (const part of partsFormat(tz).formatToParts(new Date(at))) {
    if (part.type !== 'literal') values[part.type] = Number(part.value)
  }
  const [y = 0, mo = 1, d = 1, h = 0, mi = 0] = [values.year, values.month, values.day, values.hour, values.minute]
  const date = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return { date, minutes: h * 60 + mi, utcLike: Date.UTC(y, mo - 1, d, h, mi) }
}

function dayNumber(date: string): number {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

// The minutes from midnight of `columnDate` to the wall clock of `iso` in `tz`: just after midnight
// of the next day gives more than 1440. The wall clock, not the elapsed time, so across a clock change
// 10:00 local is 600 whatever the date.
export function localMinutes(iso: string, columnDate: string, tz: string): number {
  const wall = wallClock(Date.parse(iso), tz)
  return (dayNumber(wall.date) - dayNumber(columnDate)) * 1440 + wall.minutes
}

function clockMinutes(time: string): number {
  const [h = 0, m = 0] = time.split(':').map(Number)
  return h * 60 + m
}

export function gridSpan(input: {
  days: string[]
  blocks: Block[]
  busy: BusyItem[]
  wake: string | null
  sleep: string | null
  tz: string
}): GridSpan {
  const { days, blocks, busy, wake, sleep, tz } = input
  const starts: number[] = []
  const ends: number[] = []
  for (const block of blocks) {
    if (!days.includes(block.study_date)) continue
    starts.push(localMinutes(block.starts_at, block.study_date, tz))
    ends.push(localMinutes(block.ends_at, block.study_date, tz))
  }
  for (const item of busy) {
    const date = dateIn(tz, new Date(item.starts_at))
    if (!days.includes(date)) continue
    starts.push(localMinutes(item.starts_at, date, tz))
    ends.push(localMinutes(item.ends_at, date, tz))
  }
  if (wake === null && sleep === null && starts.length === 0) return { ...DEFAULT_SPAN }
  const wakeMin = wake === null ? DEFAULT_SPAN.startMin : clockMinutes(wake)
  let sleepMin = sleep === null ? DEFAULT_SPAN.endMin : clockMinutes(sleep)
  // A sleep time before the wake time is after midnight.
  if (sleepMin <= wakeMin) sleepMin += 1440
  const startMin = Math.floor(Math.min(wakeMin, ...starts) / 60) * 60
  const endMin = Math.min(MAX_END, Math.ceil(Math.max(sleepMin, ...ends) / 60) * 60)
  return { startMin, endMin: Math.max(endMin, startMin + 60) }
}

// The column a busy item is drawn in, clipped to the span; null when it is outside the days or the span.
export function busyColumn(
  item: BusyItem,
  days: string[],
  span: GridSpan,
  tz: string,
): { date: string; startMin: number; endMin: number } | null {
  let date = dateIn(tz, new Date(item.starts_at))
  let startMin = localMinutes(item.starts_at, date, tz)
  let endMin = localMinutes(item.ends_at, date, tz)
  // Early in the morning, when the column before hangs below its midnight up to here, it is that column's.
  if (startMin < span.startMin && span.endMin > 1440 && startMin + 1440 < span.endMin) {
    date = addDays(date, -1)
    startMin += 1440
    endMin += 1440
  }
  if (!days.includes(date)) return null
  const start = Math.max(startMin, span.startMin)
  const end = Math.min(endMin, span.endMin)
  if (end <= start) return null
  return { date, startMin: start, endMin: end }
}

export function toPx(min: number, span: GridSpan, hourPx: number): number {
  return ((min - span.startMin) / 60) * hourPx
}

// How a title fits its block (decision 5): the day has one line and the week two, and the meta line
// (time, kind) only when there is room.
export function titleLines(heightPx: number, view: CalendarView): { lines: 1 | 2; meta: boolean } {
  if (view === 'day') return { lines: 1, meta: heightPx >= 38 }
  if (heightPx < 38) return { lines: 1, meta: false }
  if (heightPx < 58) return { lines: 2, meta: false }
  return { lines: 2, meta: true }
}
