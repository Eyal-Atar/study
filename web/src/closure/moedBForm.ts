import { en } from '../i18n/en'
import { dateError, isoOf } from '../exam/examForm'
import type { DateValue } from '../ui/DatePicker'
import type { MoedBBody } from './types'

// The Moed B form's checks, in the browser, with the limits of MoedBRequest on the server.
const NOTES_MAX = 1000
const GRADE_PATTERN = /^\d{1,3}$/

export interface MoedBDraft {
  date: DateValue | null
  grade: string
  topicIds: string[]
  notes: string
}

export interface MoedBErrors {
  date?: string
  grade?: string
  notes?: string
}

export function validateMoedB(draft: MoedBDraft, today: string): { errors: MoedBErrors; body: MoedBBody | null } {
  const errors: MoedBErrors = {}
  const iso = isoOf(draft.date)
  if (iso === null) errors.date = en.onboardingExams.dateRequired
  else {
    const error = dateError(iso, today)
    if (error !== undefined) errors.date = error
  }

  const gradeText = draft.grade.trim()
  let grade: number | undefined
  if (gradeText !== '') {
    grade = GRADE_PATTERN.test(gradeText) ? Number(gradeText) : Number.NaN
    if (Number.isNaN(grade) || grade > 100) errors.grade = en.closure.moedB.gradeError
  }

  if (draft.notes.length > NOTES_MAX) errors.notes = en.closure.moedB.notesTooLong
  const notes = draft.notes.trim()

  if (iso === null || Object.keys(errors).length > 0) return { errors, body: null }
  const body: MoedBBody = { exam_date: iso }
  if (grade !== undefined) body.grade = grade
  if (draft.topicIds.length > 0) body.hard_topic_ids = draft.topicIds
  if (notes !== '') body.hard_notes = notes
  return { errors, body }
}
