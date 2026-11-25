import type { ArchivedExam } from '../progress/types'
import type { GardenExam } from './model'

// Test data for the garden (only tests import this file). Exam names here are ASCII; a test that
// needs a Hebrew name passes it as an override.

export function makeGardenExam(overrides: Partial<GardenExam> = {}): GardenExam {
  return {
    id: 'exam-1',
    name: 'Algorithms',
    colorIndex: 0,
    examDate: '2026-12-20',
    state: 'active',
    percent: 40,
    ...overrides,
  }
}

export function makeArchived(overrides: Partial<ArchivedExam> = {}): ArchivedExam {
  return {
    exam_id: 'exam-closed',
    name: 'Calculus',
    color_index: 3,
    exam_date: '2026-11-10',
    first_exam_date: null,
    sitting: 1,
    closed_at: '2026-11-12T15:00:00Z',
    studied_minutes: 600,
    tasks_done: 12,
    tasks_total: 12,
    completion_percent: 100,
    ...overrides,
  }
}
