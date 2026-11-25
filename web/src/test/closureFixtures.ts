import type { ClosureItem, CloseResult, MoedBResult } from '../closure/types'
import type { ExamDeleteResponse } from '../onboarding/types'

// Test data for the closure (only tests import this file): the example of 7.13 on the week of the
// calendar tests.

export function makeClosureItem(overrides: Partial<ClosureItem> = {}): ClosureItem {
  return {
    exam_id: 'exam-1',
    exam_name: 'הסתברות',
    exam_date: '2026-11-23',
    color_index: 2,
    sitting: 1,
    state: 'pending',
    options: ['done', 'moed_b'],
    opens_at: '2026-11-23T17:00:00Z',
    studied_minutes: 1260,
    tasks_done: 14,
    tasks_total: 17,
    completion_percent: 86,
    topics: [
      { id: 'topic-1', name: 'התפלגות בינומית' },
      { id: 'topic-2', name: 'תוחלת ושונות' },
    ],
    ...overrides,
  }
}

const NO_REPLAN = { added: [], removed: [], unscheduled: [], shortfalls: [] }

export function makeCloseResult(overrides: Partial<CloseResult> = {}): CloseResult {
  return {
    exam: {
      id: 'exam-1',
      name: 'הסתברות',
      exam_date: '2026-11-23',
      difficulty: 3,
      color_index: 2,
      sitting: 1,
      state: 'done',
      closed_at: '2026-11-23T17:30:00Z',
    },
    version_id: 'version-1',
    event: {
      kind: 'course_bloomed',
      exam_id: 'exam-1',
      exam_name: 'הסתברות',
      color_index: 2,
    },
    replan: NO_REPLAN,
    ...overrides,
  }
}

export function makeMoedBResult(overrides: Partial<MoedBResult> = {}): MoedBResult {
  return {
    exam: {
      id: 'exam-1',
      name: 'הסתברות',
      exam_date: '2026-12-20',
      first_exam_date: '2026-11-23',
      first_grade: 55,
      sitting: 2,
      state: 'active',
      color_index: 2,
    },
    version_id: 'version-2',
    tasks_created: 9,
    weak_topics: [{ id: 'topic-1', name: 'התפלגות בינומית' }],
    trimmed: 0,
    unscheduled: [],
    shortfalls: [],
    ...overrides,
  }
}

// DELETE /exams/{id} (S45b): the server always writes a version.
export function makeDeleteResult(overrides: Partial<ExamDeleteResponse> = {}): ExamDeleteResponse {
  return { version_id: 'v-del', plan_affected: true, ...overrides }
}
