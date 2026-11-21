import { en } from './en'
import { LOCALE } from './locale'

type Codes = typeof en.codes
export type Code = keyof Codes

// The extra fields of a problem (limit, resets_at, limit_bytes, ...), as the API sent them.
export type CodeParams = Readonly<Record<string, unknown>>

// The local time the AI quota starts again is shown in the quota's own timezone (spec 7.5).
const QUOTA_TIMEZONE = 'Asia/Jerusalem'

export function isKnownCode(code: string): code is Code {
  return Object.hasOwn(en.codes, code)
}

function numberParam(params: CodeParams, key: string): number | null {
  const value = params[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

// "HH:MM" in Jerusalem (24-hour, h23: never 24:30), with the date ("00:00 (17 Nov)") when it is not today there.
// Exported for a quota with a text of its own (the timetable photos of TimetableImport).
export function resetTime(params: CodeParams, now: Date): string | null {
  const raw = params.resets_at
  if (typeof raw !== 'string') return null
  const at = new Date(raw)
  if (Number.isNaN(at.getTime())) return null
  const time = new Intl.DateTimeFormat(LOCALE, { timeZone: QUOTA_TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)
  const day = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: QUOTA_TIMEZONE }).format(date)
  if (day(at) === day(now)) return time
  const date = new Intl.DateTimeFormat(LOCALE, { timeZone: QUOTA_TIMEZONE, day: 'numeric', month: 'short' }).format(at)
  return `${time} (${date})`
}

// The text of a code. An unknown code gets the generic message, never the raw code.
export function codeText(code: string, params: CodeParams = {}, now: Date = new Date()): string {
  if (!isKnownCode(code)) return en.errors.generic
  switch (code) {
    case 'file_too_large': {
      const bytes = numberParam(params, 'limit_bytes')
      return en.codes.file_too_large(bytes === null ? null : Math.floor(bytes / (1024 * 1024)))
    }
    case 'too_many_materials':
      return en.codes.too_many_materials(numberParam(params, 'limit'))
    case 'ai_quota_exceeded':
      return en.codes.ai_quota_exceeded(resetTime(params, now))
    default:
      return en.codes[code]
  }
}

// Why one task did not fit on the board (planner reason codes).
export function unscheduledText(reason: string): string {
  return reason === 'dependency_cycle' ? en.report.cycle : codeText(reason)
}

// ExamShortfall: `minutes` still missing before the exam, and the daily minutes that would fit them
// (null when no amount of daily time would: an exam without study days, or a simulation longer
// than every window).
export function shortfallText(examName: string, minutes: number, dailyMinutes: number | null): string {
  return en.report.shortfall(
    examName,
    en.report.hours(minutes),
    dailyMinutes === null ? null : en.report.hours(dailyMinutes),
  )
}
