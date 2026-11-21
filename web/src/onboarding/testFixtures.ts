import type { Me } from '../api/me'
import type { Exam, ExamGeneration, GenerateResult, Job, ReplanPreview } from './types'

// Shared test data for the S13 screens (only tests import this file).

// The browser's own zone, so TimezoneSync sends no PATCH unless a test wants one.
export const BROWSER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

export function meFixture(overrides: Partial<Me> = {}): Me {
  return {
    id: 'user-a',
    email: 'a@example.com',
    display_name: null,
    timezone: BROWSER_ZONE,
    wake_time: '08:00',
    sleep_time: '23:00',
    daily_study_minutes: 240,
    study_windows: ['morning', 'afternoon'],
    rest_days_before_exam: 1,
    notify_lead_minutes: 10,
    study_start_delay_minutes: 60,
    hobby_start: null,
    hobby_minutes: null,
    onboarding_completed_at: null,
    ...overrides,
  }
}

export const COMPLETED_AT = '2026-11-16T10:00:00Z'

export function examFixture(overrides: Partial<Exam> = {}): Exam {
  return { id: 'e1', name: '\u05D7\u05D3\u05D5"\u05D0' /* Hebrew sample name, escaped: this file is not a test file */, exam_date: '2027-01-20', difficulty: 3, created_at: '2026-11-16T08:00:00Z', color_index: 0, ...overrides }
}

export function jobFixture(overrides: Partial<Job<GenerateResult>> = {}): Job<GenerateResult> {
  return {
    id: 'j1',
    kind: 'generate_plan',
    status: 'running',
    stage: null,
    percent: null,
    error: null,
    result: null,
    created_at: '2026-11-16T08:00:00Z',
    started_at: '2026-11-16T08:00:01Z',
    finished_at: null,
    ...overrides,
  }
}

export function examResult(overrides: Partial<ExamGeneration> = {}): ExamGeneration {
  return {
    exam_id: 'e1',
    status: 'analyzed',
    topics: 4,
    tasks: 12,
    gaps: [],
    warnings: [],
    dropped: [],
    total_minutes: 600,
    budget_minutes: 900,
    ...overrides,
  }
}

export function resultFixture(overrides: Partial<GenerateResult['plan']> = {}, exams: ExamGeneration[] = [examResult()]): GenerateResult {
  return {
    exams,
    plan: {
      version_id: 'v1',
      blocks: 20,
      unscheduled: [],
      unscheduled_count: 0,
      shortfalls: [],
      warnings: [],
      ...overrides,
    },
  }
}

export function previewFixture(overrides: Partial<ReplanPreview> = {}): ReplanPreview {
  return {
    basis: 'b1',
    changed: true,
    version_id: null,
    added: [],
    removed: [],
    unscheduled: [],
    shortfalls: [],
    warnings: [],
    ...overrides,
  }
}
