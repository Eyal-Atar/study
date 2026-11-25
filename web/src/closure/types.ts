import type { Shortfall } from '../board/types'

// The server's side of closing an exam (S45), word for word from api/app/schemas/closures.py and the
// contract of spec 7.13. The browser never computes when a closure opens: `pending` is what the server says.

export type ExamState = 'active' | 'pending' | 'waiting_moed_b' | 'done'
export type Outcome = 'done' | 'moed_b'

export interface TopicRef {
  id: string
  name: string
}

// One exam waiting for a decision (GET /closures, in `pending`) or waiting for Moed B (in `waiting`).
export interface ClosureItem {
  exam_id: string
  exam_name: string
  exam_date: string
  color_index: number
  sitting: number
  state: ExamState
  options: Outcome[]
  opens_at: string
  studied_minutes: number
  tasks_done: number
  tasks_total: number
  completion_percent: number
  topics: TopicRef[]
}

export interface Closures {
  pending: ClosureItem[]
  waiting: ClosureItem[]
}

// The garden's full bloom: shown once, when an exam closes done. It gives no XP.
export interface BloomEvent {
  kind: 'course_bloomed'
  exam_id: string
  exam_name: string
  color_index: number
}

export interface ClosedExam {
  id: string
  name: string
  exam_date: string
  difficulty: number
  color_index: number
  sitting: number
  state: ExamState
  closed_at: string | null
}

// What a plan change touched; the board is refetched, so the items stay opaque here.
export interface ReplanSummary {
  added: unknown[]
  removed: unknown[]
  unscheduled: unknown[]
  shortfalls: Shortfall[]
}

// POST /exams/{id}/close
export interface CloseResult {
  exam: ClosedExam
  // POST /plan/undo with this puts the closure and the board back.
  version_id: string
  event: BloomEvent | null
  replan: ReplanSummary
}

// POST /exams/{id}/moed-b: only the fields that were filled are sent.
export interface MoedBBody {
  exam_date: string
  grade?: number
  hard_topic_ids?: string[]
  hard_notes?: string
}

export interface MoedBExam {
  id: string
  name: string
  exam_date: string
  first_exam_date: string | null
  first_grade: number | null
  sitting: number
  state: ExamState
  color_index: number
}

export interface MoedBResult {
  exam: MoedBExam
  version_id: string
  tasks_created: number
  weak_topics: TopicRef[]
  trimmed: number
  // Of the whole board: the replan behind Moed B covers every exam.
  unscheduled: unknown[]
  shortfalls: Shortfall[]
}

// The server always sends `state` (S45); it is optional on Exam so that data from before S45 works.
export function examState(exam: { state?: ExamState | undefined }): ExamState {
  return exam.state ?? 'active'
}
