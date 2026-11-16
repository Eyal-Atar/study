import { he } from './he'

type Codes = typeof he.codes
export type Code = keyof Codes

// The extra fields of a problem (limit, resets_at, limit_bytes, ...), as the API sent them.
export type CodeParams = Readonly<Record<string, unknown>>

// The local time the AI quota starts again is shown in the quota's own timezone (spec 7.5).
const QUOTA_TIMEZONE = 'Asia/Jerusalem'

export function isKnownCode(code: string): code is Code {
  return Object.hasOwn(he.codes, code)
}

function numberParam(params: CodeParams, key: string): number | null {
  const value = params[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

// "HH:MM" in Jerusalem, with the date when it is not today there.
function resetTime(params: CodeParams, now: Date): string | null {
  const raw = params.resets_at
  if (typeof raw !== 'string') return null
  const at = new Date(raw)
  if (Number.isNaN(at.getTime())) return null
  const time = new Intl.DateTimeFormat('he-IL', { timeZone: QUOTA_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(at)
  const day = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: QUOTA_TIMEZONE }).format(date)
  if (day(at) === day(now)) return time
  const date = new Intl.DateTimeFormat('he-IL', { timeZone: QUOTA_TIMEZONE, day: 'numeric', month: 'numeric' }).format(at)
  return `${time} (${date})`
}

// The Hebrew text of a code. An unknown code gets the generic message, never the raw code.
export function codeText(code: string, params: CodeParams = {}, now: Date = new Date()): string {
  if (!isKnownCode(code)) return he.errors.generic
  switch (code) {
    case 'file_too_large': {
      const bytes = numberParam(params, 'limit_bytes')
      return he.codes.file_too_large(bytes === null ? null : Math.floor(bytes / (1024 * 1024)))
    }
    case 'too_many_materials':
      return he.codes.too_many_materials(numberParam(params, 'limit'))
    case 'ai_quota_exceeded':
      return he.codes.ai_quota_exceeded(resetTime(params, now))
    default:
      return he.codes[code]
  }
}

// Why one task did not fit on the board (planner reason codes).
export function unscheduledText(reason: string): string {
  return reason === 'dependency_cycle' ? he.report.cycle : codeText(reason)
}

// ExamShortfall: `minutes` still missing before the exam, and the daily minutes that would fit them
// (null when no amount of daily time would: an exam without study days, or a simulation longer
// than every window).
export function shortfallText(examName: string, minutes: number, dailyMinutes: number | null): string {
  return he.report.shortfall(
    examName,
    he.report.hours(minutes),
    dailyMinutes === null ? null : he.report.hours(dailyMinutes),
  )
}
