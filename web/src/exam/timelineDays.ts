import type { Block } from '../onboarding/types'
import { addDays, daysBetween } from './dates'

// GET /plan answers at most 62 days (S09), so the timeline shows at most that many.
export const PLAN_DAYS = 62

export interface TimelineRange {
  // The days on screen, today first.
  days: string[]
  // What GET /plan is asked for: today to the day before the exam, capped at 62 days; null when
  // there is no study day left (an exam today or in the past).
  query: { from: string; to: string } | null
  // The exam is past the 62 days, so its own day is not on screen.
  far: boolean
}

export function timelineRange(today: string, examDate: string): TimelineRange {
  const untilExam = daysBetween(today, examDate)
  if (untilExam < 0) return { days: [], query: null, far: false }
  const far = untilExam >= PLAN_DAYS
  const count = far ? PLAN_DAYS : untilExam + 1
  const days = Array.from({ length: count }, (_, i) => addDays(today, i))
  const lastStudy = addDays(today, Math.min(untilExam - 1, PLAN_DAYS - 1))
  return { days, query: untilExam === 0 ? null : { from: today, to: lastStudy }, far }
}

function minutesOf(block: Block): number {
  return Math.round((new Date(block.ends_at).getTime() - new Date(block.starts_at).getTime()) / 60000)
}

export interface DayMinutes {
  planned: number
  done: number
}

// Per study day, the minutes of this exam's blocks on the board (a skipped block is not planned
// time any more) and the part of them marked done.
export function minutesByDay(blocks: readonly Block[], examId: string): Map<string, DayMinutes> {
  const days = new Map<string, DayMinutes>()
  for (const block of blocks) {
    if (block.exam_id !== examId || block.status === 'skipped') continue
    const entry = days.get(block.study_date) ?? { planned: 0, done: 0 }
    const minutes = minutesOf(block)
    entry.planned += minutes
    if (block.status === 'done') entry.done += minutes
    days.set(block.study_date, entry)
  }
  return days
}

// The next block of each task that has not ended yet and is still planned, earliest first.
export function nextBlocks(blocks: readonly Block[], now: Date = new Date()): Map<string, Block> {
  const next = new Map<string, Block>()
  for (const block of blocks) {
    if (block.status !== 'planned' || new Date(block.ends_at) <= now) continue
    const current = next.get(block.task_id)
    if (current === undefined || new Date(block.starts_at) < new Date(current.starts_at)) next.set(block.task_id, block)
  }
  return next
}
