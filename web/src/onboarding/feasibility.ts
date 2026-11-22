import type { Me, StudyWindow } from '../api/me'
import type { Weekday } from '../availability/types'

// Archi's live estimate of whether the plan fits (S34 decision 7, audit guideline 9). It mirrors
// the planner's window arithmetic (api/app/domain/planner/availability.py: day_windows,
// last_study_day, _long_enough; capacity.py MIN_PART_MINUTES; budget.py the daily cap) on the
// wall clock, without daylight saving and without one-off busy events: an estimate, which the
// sentence says with "about". Days start tomorrow, so today's leftover hours are never promised.

// Below this many study hours for each exam, up to some exam, the plan is tight. Tunable; about
// the budget of an easy exam with little material. To be checked against real data in S29.
export const TIGHT_HOURS_PER_EXAM = 10

// The planner's STUDY_WINDOW_HOURS, in minutes from midnight. An end before the start is the
// next day (night runs 21:00 to 02:00).
const STUDY_WINDOW_MINUTES: Record<StudyWindow, [number, number]> = {
  morning: [6 * 60, 12 * 60],
  afternoon: [12 * 60, 17 * 60],
  evening: [17 * 60, 21 * 60],
  night: [21 * 60, 2 * 60],
}
const WINDOW_ORDER: StudyWindow[] = ['morning', 'afternoon', 'evening', 'night']

// The planner's MIN_PART_MINUTES: a remnant shorter than a part is not study time.
const MIN_PART_MINUTES = 30
const DAY = 24 * 60
// The furthest study day counted, from tomorrow. A mistyped year would otherwise make the loop
// walk every day up to it. An exam beyond the cap is measured on the capped range only; 400 days
// is far more than any exam needs, so a capped exam still reads roomy whenever it would anyway.
const HORIZON_DAYS = 400

export interface FeasibilityInput {
  // 'YYYY-MM-DD', the profile's local date.
  today: string
  exams: { name: string; exam_date: string }[]
  profile: Pick<
    Me,
    'wake_time' | 'sleep_time' | 'study_start_delay_minutes' | 'daily_study_minutes' | 'study_windows' | 'rest_days_before_exam'
  >
  // Weekly busy time, saved and only painted alike. An end before the start crosses midnight;
  // valid_until (inclusive) ends it, and without it the busy time has no end.
  busy: { weekday: Weekday; start_time: string; end_time: string; valid_until?: string | null }[]
}

export interface FeasibilityEstimate {
  level: 'none' | 'tight' | 'roomy'
  firstExamName: string
  // The study time from tomorrow until the first exam.
  firstExamMinutes: number
  // The first exam, by date, where the time runs short (tight) or out (none), and the minutes for
  // each exam up to it. Filled at both levels, also when it is the first exam.
  tightExamName?: string
  tightExamMinutes?: number
}

type Span = [number, number]

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

// Dates as whole days since the epoch, so adding a day never meets a clock change. NaN for a date
// that is not a whole 'YYYY-MM-DD' (one the student is still typing).
function dayNumber(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN
  return Math.round(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 864e5)
}
// 0 = Sunday, like Weekday. Day 0 of the epoch was a Thursday.
const weekdayOf = (day: number) => (((day + 4) % 7) + 7) % 7

// A span from start to end starting at `offset`; an end not after the start is the next day.
function span(start: number, end: number, offset: number): Span {
  return [offset + start, offset + (end > start ? end : end + DAY)]
}

function merge(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0])
  const out: Span[] = []
  for (const [s, e] of sorted) {
    const last = out[out.length - 1]
    if (last && s <= last[1]) last[1] = Math.max(last[1], e)
    else out.push([s, e])
  }
  return out
}

function subtract(spans: Span[], [cs, ce]: Span): Span[] {
  return spans.flatMap(([s, e]): Span[] => {
    if (ce <= s || e <= cs) return [[s, e]]
    const left: Span[] = s < cs ? [[s, cs]] : []
    const right: Span[] = ce < e ? [[ce, e]] : []
    return [...left, ...right]
  })
}

// The study minutes of one day: the chosen windows inside the waking hours, less the busy time
// that starts on the day before, the day or the day after, in pieces of 30 minutes or more,
// capped at the daily minutes. eveOfExam: the day ends at midnight, because an exam is the next
// day and there are no rest days (the planner's exam_cutoff and the cutoffs of _open_windows).
function dayMinutes(input: FeasibilityInput, day: number, eveOfExam: boolean): number {
  const { profile } = input
  const wake = toMinutes(profile.wake_time)
  const [, awakeEnd] = span(wake, toMinutes(profile.sleep_time), 0)
  const awakeStart = wake + profile.study_start_delay_minutes
  if (awakeStart >= awakeEnd) return 0

  const found: Span[] = []
  for (const window of WINDOW_ORDER) {
    if (!profile.study_windows.includes(window)) continue
    const [begin, finish] = STUDY_WINDOW_MINUTES[window]
    for (const offset of [-1, 0, 1]) {
      const [s, e] = span(begin, finish, offset * DAY)
      const start = Math.max(s, awakeStart)
      const end = Math.min(e, awakeEnd)
      if (start < end) found.push([start, end])
    }
  }
  let windows = merge(found)
  if (eveOfExam) {
    windows = windows.flatMap(([s, e]): Span[] => (s < DAY ? [[s, Math.min(e, DAY)]] : []))
  }

  for (const offset of [-1, 0, 1]) {
    const date = day + offset
    for (const b of input.busy) {
      if (b.weekday !== weekdayOf(date)) continue
      if (b.valid_until != null && dayNumber(b.valid_until) < date) continue
      const start = toMinutes(b.start_time)
      const end = toMinutes(b.end_time)
      if (start === end) continue
      windows = subtract(windows, span(start, end, offset * DAY))
    }
  }

  const free = windows.filter(([s, e]) => e - s >= MIN_PART_MINUTES).reduce((sum, [s, e]) => sum + e - s, 0)
  return Math.min(profile.daily_study_minutes, free)
}

// exam_date -> the study minutes from tomorrow to that exam's last study day (cumulative). The last
// study day is the planner's last_study_day: exam_date - (rest_days_before_exam + 1).
// An exam whose date is not a whole date yet is left out.
export function estimateStudyMinutes(input: FeasibilityInput): Map<string, number> {
  const { rest_days_before_exam: rest } = input.profile
  const tomorrow = dayNumber(input.today) + 1
  const examDays = new Set<number>()
  const lastDays = new Map<string, number>()
  for (const exam of input.exams) {
    const examDay = dayNumber(exam.exam_date)
    if (!Number.isFinite(examDay)) continue
    examDays.add(examDay)
    lastDays.set(exam.exam_date, Math.min(examDay - (rest + 1), tomorrow + HORIZON_DAYS - 1))
  }
  const latest = Math.max(tomorrow - 1, ...lastDays.values())
  // Running totals, so every day is computed once whatever the number of exams. With rest days
  // the planner has no midnight cutoffs: every exam's cutoff is the end of its last study day's
  // waking hours, so even a later exam's study day whose night runs into an earlier exam's day
  // keeps its whole night.
  const upTo = new Map<number, number>()
  let total = 0
  for (let day = tomorrow; day <= latest; day++) {
    total += dayMinutes(input, day, rest === 0 && examDays.has(day + 1))
    upTo.set(day, total)
  }
  const out = new Map<string, number>()
  for (const [date, last] of lastDays) out.set(date, last < tomorrow ? 0 : (upTo.get(last) ?? 0))
  return out
}

// null without exams. none when an exam has no study time; tight when, at some exam in date order,
// the minutes up to it divided by the exams up to it (inclusive, the same date counted together)
// are under TIGHT_HOURS_PER_EXAM hours; roomy otherwise.
// An exam whose date is not a whole date yet is left out, so with none left it is null too.
export function feasibility(input: FeasibilityInput): FeasibilityEstimate | null {
  const exams = input.exams
    .filter((exam) => Number.isFinite(dayNumber(exam.exam_date)))
    .sort((a, b) => a.exam_date.localeCompare(b.exam_date))
  const first = exams[0]
  if (!first) return null
  const minutes = estimateStudyMinutes(input)
  const minutesOf = (date: string) => minutes.get(date) ?? 0
  const base = { firstExamName: first.name, firstExamMinutes: minutesOf(first.exam_date) }

  const empty = exams.find((exam) => minutesOf(exam.exam_date) === 0)
  if (empty) return { level: 'none', ...base, tightExamName: empty.name, tightExamMinutes: 0 }

  for (const exam of exams) {
    const count = exams.filter((other) => other.exam_date <= exam.exam_date).length
    const each = minutesOf(exam.exam_date) / count
    if (each < TIGHT_HOURS_PER_EXAM * 60) {
      return { level: 'tight', ...base, tightExamName: exam.name, tightExamMinutes: Math.floor(each) }
    }
  }
  return { level: 'roomy', ...base }
}
