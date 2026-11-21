import type { Me } from '../api/me'
import type { BusyItem } from '../availability/types'
import type { Exam } from '../onboarding/types'

// Sample data for the calendar's tests. English names only: a test that needs user text in Hebrew
// passes it in.

export function makeBusy(overrides: Partial<BusyItem> = {}): BusyItem {
  return {
    source: 'commitment',
    id: 'busy-1',
    title: 'Work',
    kind: 'work',
    starts_at: '2026-11-16T07:00:00Z',
    ends_at: '2026-11-16T09:00:00Z',
    ...overrides,
  }
}

export function makeExam(overrides: Partial<Exam> = {}): Exam {
  return {
    id: 'exam-1',
    name: 'Algorithms',
    exam_date: '2026-12-20',
    difficulty: 3,
    created_at: '2026-11-01T08:00:00Z',
    color_index: 0,
    ...overrides,
  }
}

export function makeMe(overrides: Partial<Me> = {}): Me {
  return {
    id: 'user-a',
    email: 'a@example.com',
    display_name: null,
    timezone: 'Asia/Jerusalem',
    wake_time: '08:00',
    sleep_time: '23:00',
    daily_study_minutes: 180,
    study_windows: ['morning', 'afternoon'],
    rest_days_before_exam: 1,
    notify_lead_minutes: 10,
    study_start_delay_minutes: 60,
    hobby_start: null,
    hobby_minutes: null,
    onboarding_completed_at: '2026-11-10T08:00:00Z',
    ...overrides,
  }
}
