import { parseDate } from '@internationalized/date'
import { he } from '../i18n/he'
import type { DateValue } from '../ui/DatePicker'
import { addDays } from './dates'

const f = he.onboardingExams

// The API's limits (ExamCreate in api/app/schemas): a name of up to 200 characters, a date from
// tomorrow (the profile's day, plan decision 5) up to two years ahead, difficulty 1–5.
export const NAME_MAX = 200
const MAX_DAYS_AHEAD = 730

export const DIFFICULTY_OPTIONS = f.difficultyLevels.map((label, index) => ({ value: String(index + 1), label }))

export interface ExamDraft {
  name: string
  date: DateValue | null
  difficulty: string
}

export interface ExamFieldErrors {
  name?: string | undefined
  date?: string | undefined
}

export function draftOf(exam: { name: string; exam_date: string; difficulty: number }): ExamDraft {
  return { name: exam.name, date: parseDate(exam.exam_date), difficulty: String(exam.difficulty) }
}

export function dateError(iso: string, today: string): string | undefined {
  if (iso < addDays(today, 1)) return f.dateTooEarly
  if (iso > addDays(today, MAX_DAYS_AHEAD)) return f.dateTooLate
  return undefined
}

export function isoOf(date: DateValue | null): string | null {
  return date === null ? null : date.toString().slice(0, 10)
}

// Checks a draft; the clean values when it is valid.
export function validateDraft(
  draft: ExamDraft,
  today: string,
): { errors: ExamFieldErrors; value: { name: string; exam_date: string; difficulty: number } | null } {
  const name = draft.name.trim()
  const iso = isoOf(draft.date)
  const errors: ExamFieldErrors = {}
  if (name === '') errors.name = f.nameRequired
  else if (name.length > NAME_MAX) errors.name = f.nameTooLong
  if (iso === null) errors.date = f.dateRequired
  else errors.date = dateError(iso, today)
  if (errors.name !== undefined || errors.date !== undefined || iso === null) return { errors, value: null }
  return { errors, value: { name, exam_date: iso, difficulty: Number(draft.difficulty) } }
}
