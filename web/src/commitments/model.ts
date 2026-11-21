import type { Commitment, CommitmentInput, CommitmentKind, CommitmentPatch, Weekday } from '../availability/types'
import { en } from '../i18n/en'

// The Me time rule mirrors _SETS_SQL of api/app/services/hobby.py: HOBBY_TITLE and the legacy title
// (a Hebrew one, written with escapes because product code holds no Hebrew letters).
export const ME_TIME_TITLES: readonly string[] = ['Me time', '\u05d6\u05de\u05df \u05dc\u05e2\u05e6\u05de\u05d9']
const ME_TIME_MIN_MINUTES = 15
const ME_TIME_MAX_MINUTES = 240

export interface CommitmentGroup {
  key: string
  title: string
  kind: CommitmentKind
  weekdays: Weekday[]
  start_time: string
  end_time: string
  valid_from: string
  valid_until: string | null
  // The commitment ids, in the order of `weekdays`.
  ids: string[]
  // The one group the settings screen shows as Me time instead of as busy time.
  isMeTime: boolean
}

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
const toTime = (minutes: number) => {
  const wrapped = ((minutes % 1440) + 1440) % 1440
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`
}
const lengthOf = (start: string, end: string) => (toMinutes(end) - toMinutes(start) + 1440) % 1440

interface Draft {
  group: CommitmentGroup
  rows: { weekday: Weekday; id: string }[]
  created: string
}

// Rows with the same title, kind, times and validity, on different days, are one group (S34,
// decision 17). A second row on a day the group already has starts a group of its own.
export function groupCommitments(list: Commitment[]): CommitmentGroup[] {
  const drafts: Draft[] = []
  const open = new Map<string, Draft[]>()
  for (const c of list) {
    const bucket = JSON.stringify([c.title, c.kind, c.start_time, c.end_time, c.valid_from, c.valid_until])
    const candidates = open.get(bucket) ?? []
    let draft = candidates.find((d) => !d.rows.some((r) => r.weekday === c.weekday))
    if (!draft) {
      draft = {
        group: {
          key: `${bucket}#${String(candidates.length)}`,
          title: c.title,
          kind: c.kind,
          weekdays: [],
          start_time: c.start_time,
          end_time: c.end_time,
          valid_from: c.valid_from,
          valid_until: c.valid_until,
          ids: [],
          isMeTime: false,
        },
        rows: [],
        created: c.created_at,
      }
      candidates.push(draft)
      open.set(bucket, candidates)
      drafts.push(draft)
    }
    draft.rows.push({ weekday: c.weekday, id: c.id })
    if (c.created_at < draft.created) draft.created = c.created_at
  }
  for (const d of drafts) {
    d.rows.sort((a, b) => a.weekday - b.weekday)
    d.group.weekdays = d.rows.map((r) => r.weekday)
    d.group.ids = d.rows.map((r) => r.id)
  }
  const meTime = drafts
    .filter((d) => isMeTimeShape(d.group))
    .reduce<Draft | null>((oldest, d) => (oldest === null || d.created < oldest.created ? d : oldest), null)
  if (meTime) meTime.group.isMeTime = true
  return drafts
    .map((d) => d.group)
    .sort((a, b) => (a.weekdays[0] ?? 0) - (b.weekdays[0] ?? 0) || a.start_time.localeCompare(b.start_time))
}

function isMeTimeShape(g: CommitmentGroup): boolean {
  const minutes = lengthOf(g.start_time, g.end_time)
  return (
    g.kind === 'other' &&
    ME_TIME_TITLES.includes(g.title) &&
    g.weekdays.length === 7 &&
    g.valid_until === null &&
    minutes >= ME_TIME_MIN_MINUTES &&
    minutes <= ME_TIME_MAX_MINUTES
  )
}

export function weekdaysText(days: Weekday[]): string {
  const short = en.commitments.weekdayShort
  if (days.length === 7) return en.commitments.everyDay
  const consecutive = days.every((d, i) => i === 0 || d === (days[i - 1] ?? 0) + 1)
  if (days.length >= 5 && consecutive) return `${short[days[0] ?? 0]} to ${short[days[days.length - 1] ?? 0]}`
  return days.map((d) => short[d]).join(', ')
}

function dateText(date: string): string {
  const month = en.commitments.months[Number(date.slice(5, 7)) - 1] ?? ''
  return `${String(Number(date.slice(8, 10)))} ${month}`
}

export function groupSubtitle(g: CommitmentGroup): string {
  const base = `${weekdaysText(g.weekdays)}, ${g.start_time}–${g.end_time}`
  return g.valid_until ? `${base}, ${en.commitments.until(dateText(g.valid_until))}` : base
}

export function meTimeText(start: string, minutes: number): string {
  return `${start}, ${en.settings.duration(minutes)}`
}

// A grid cell is `${column}-${clock hour}`. A column is a day from firstHour to the next firstHour:
// the hours before firstHour (after midnight) sit at the bottom of the previous day's column.
const position = (hour: number, firstHour: number) => (hour < firstHour ? hour + 24 : hour)

export function paintedRanges(
  cells: ReadonlySet<string>,
  firstHour: number,
): { weekday: Weekday; start_time: string; end_time: string }[] {
  const byColumn = new Map<number, number[]>()
  for (const cell of cells) {
    const [column, hour] = cell.split('-').map(Number) as [number, number]
    byColumn.set(column, [...(byColumn.get(column) ?? []), position(hour, firstHour)])
  }
  const ranges: { weekday: Weekday; start_time: string; end_time: string }[] = []
  for (const [column, positions] of byColumn) {
    const sorted = [...new Set(positions)].sort((a, b) => a - b)
    let runStart = 0
    for (let i = 0; i < sorted.length; i += 1) {
      const last = i === sorted.length - 1 || (sorted[i + 1] ?? 0) !== (sorted[i] ?? 0) + 1
      if (!last) continue
      const first = sorted[runStart] ?? 0
      const weekday = ((first >= 24 ? column + 1 : column) % 7) as Weekday
      ranges.push({
        weekday,
        start_time: toTime((first % 24) * 60),
        end_time: toTime(((sorted[i] ?? 0) + 1) * 60),
      })
      runStart = i + 1
    }
  }
  return ranges
    .sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time))
}

// The cells a commitment covers, also in part. The grid shows the hours firstHour up to lastHour
// (exclusive); lastHour above 24 adds the hours after midnight.
export function cellsOf(list: Commitment[], firstHour: number, lastHour: number): Set<string> {
  const cells = new Set<string>()
  for (const c of list) {
    const start = toMinutes(c.start_time)
    let end = toMinutes(c.end_time)
    if (end <= start) end += 1440
    for (let k = Math.floor(start / 60); k < Math.ceil(end / 60); k += 1) {
      const day = (c.weekday + Math.floor(k / 24)) % 7
      const hour = k % 24
      const column = hour < firstHour ? (day + 6) % 7 : day
      if (position(hour, firstHour) < lastHour) cells.add(`${String(column)}-${String(hour)}`)
    }
  }
  return cells
}

export interface GroupWrites {
  create: CommitmentInput[]
  update: { id: string; patch: CommitmentPatch }[]
  remove: string[]
}

// What to send so that `before` becomes `after`: new days are created, removed days deleted, and the
// days that stay get a patch of only the fields that changed (a field `after` leaves out is kept).
export function groupWrites(
  before: CommitmentGroup | null,
  after: CommitmentInput & { weekdays: Weekday[] },
): GroupWrites {
  const kept = new Set(before?.weekdays ?? [])
  const create: CommitmentInput[] = after.weekdays
    .filter((weekday) => !kept.has(weekday))
    .map((weekday) => ({
      title: after.title,
      kind: after.kind,
      weekday,
      start_time: after.start_time,
      end_time: after.end_time,
      ...(after.valid_from ? { valid_from: after.valid_from } : {}),
      ...(after.valid_until ? { valid_until: after.valid_until } : {}),
    }))
  if (!before) return { create, update: [], remove: [] }

  const patch: CommitmentPatch = {}
  if (after.title !== before.title) patch.title = after.title
  if (after.kind !== before.kind) patch.kind = after.kind
  if (after.start_time !== before.start_time) patch.start_time = after.start_time
  if (after.end_time !== before.end_time) patch.end_time = after.end_time
  if (after.valid_from !== undefined && after.valid_from !== before.valid_from) patch.valid_from = after.valid_from
  if (after.valid_until !== undefined && after.valid_until !== before.valid_until) patch.valid_until = after.valid_until

  const wanted = new Set(after.weekdays)
  const update: GroupWrites['update'] = []
  const remove: string[] = []
  before.weekdays.forEach((weekday, i) => {
    const id = before.ids[i] ?? ''
    if (!wanted.has(weekday)) remove.push(id)
    else if (Object.keys(patch).length > 0) update.push({ id, patch: { ...patch } })
  })
  return { create, update, remove }
}
