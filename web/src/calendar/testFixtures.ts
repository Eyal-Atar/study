import { QueryClient } from '@tanstack/react-query'
import { vi } from 'vitest'
import type { Me } from '../api/me'
import type { BusyItem } from '../availability/types'
import { addDays, blockMinutes } from '../board/time'
import type { Block, Plan } from '../board/types'
import type { Exam } from '../onboarding/types'
import { makeProgress } from '../progress/testFixtures'
import { EXAM_ID, makeMe as makeBoardMe, makePlan, makePreview, makeToday, USER_ID } from '../test/boardFixtures'
import { createFakeApi, type ApiCall } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'
import type { SplitOffer } from './splitOffers'

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

// The offer of 7.7 on the tests' week: one 90-minute block on Tue 24 Nov (16:00 in Jerusalem), split into
// three bites of 30 minutes.
export function makeSplitOffer(overrides: Partial<SplitOffer> = {}): SplitOffer {
  return {
    task_id: 'task-1',
    exam_id: EXAM_ID,
    // Hebrew (sample user content) as escapes: sourceGuards allows no Hebrew letter in this file.
    // It reads: "Practice: malloc and free", with a Hebrew title.
    task_title: '\u05EA\u05E8\u05D2\u05D5\u05DC: malloc \u05D5-free',
    task_kind: 'practice',
    deferrals: 3,
    block: { id: 'block-1', starts_at: '2026-11-24T14:00:00Z', ends_at: '2026-11-24T15:30:00Z', minutes: 90 },
    bite_minutes: 30,
    split_minutes: 90,
    parts: [
      { starts_at: '2026-11-24T14:00:00Z', ends_at: '2026-11-24T14:30:00Z', minutes: 30 },
      { starts_at: '2026-11-25T07:00:00Z', ends_at: '2026-11-25T07:30:00Z', minutes: 30 },
      { starts_at: '2026-11-26T07:00:00Z', ends_at: '2026-11-26T07:30:00Z', minutes: 30 },
    ],
    basis: 'basis-1',
    ...overrides,
  }
}

// The calendar screen through the real routes (S32 Task 13): a fake server whose answers follow
// `state`, a clock, and the media the screen asks for. Every test that uses it restores the globals.

export const CAL_TZ = 'Asia/Jerusalem'
// Tuesday, in the week of 22–28 November 2026.
export const CAL_TODAY = '2026-11-24'
// 11:25 in Jerusalem (UTC+2).
export const CAL_NOW = '2026-11-24T09:25:00Z'

export function stubMedia({ desktop = false, reducedMotion = false }: { desktop?: boolean; reducedMotion?: boolean } = {}): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: (query === '(min-width: 1024px)' && desktop) || (query === '(prefers-reduced-motion: reduce)' && reducedMotion),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
}

export interface CalendarServer {
  // The server's today (a test that moves it also moves the clock).
  date: string
  blocks: Block[]
  busy: BusyItem[]
  review: Block[]
  unplaced: Plan['unplaced']
  // An error (or a promise that never settles) in place of the answer.
  today: Error | Promise<never> | null
  plan: Error | Promise<never> | null
  // Old answers from before S35: no `busy` at all.
  legacy: boolean
}

export function openCalendar(path: string, init: Partial<CalendarServer> = {}) {
  // jsdom has no Element.scrollTo, which the grid's box scrolls with on a computer.
  if (!('scrollTo' in Element.prototype)) {
    Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, writable: true, value: () => undefined })
  }
  const state: CalendarServer = { date: CAL_TODAY, blocks: [], busy: [], review: [], unplaced: [], today: null, plan: null, legacy: false, ...init }
  const withBusy = <T extends { busy: BusyItem[] }>(answer: T): T => {
    const copy: Partial<T> = { ...answer, busy: state.busy }
    if (state.legacy) Reflect.deleteProperty(copy, 'busy')
    return copy as T
  }
  const fake = createFakeApi()
    .on('GET /me', makeBoardMe(CAL_TZ))
    .on('GET /today', () => {
      if (state.today !== null) return state.today
      const blocks = state.blocks.filter((b) => b.study_date === state.date)
      const today = makeToday(blocks, {
        date: state.date,
        planned_minutes: blocks.filter((b) => b.status === 'planned').reduce((sum, b) => sum + blockMinutes(b), 0),
        done_minutes: blocks.filter((b) => b.status === 'done').reduce((sum, b) => sum + blockMinutes(b), 0),
        day_starts_at: `${state.date}T06:00:00Z`,
        day_ends_at: `${state.date}T21:00:00Z`,
      })
      return withBusy(today)
    })
    .on({ method: 'GET', path: /^\/plan/ }, (call: ApiCall) => {
      if (state.plan !== null) return state.plan
      const params = new URLSearchParams(call.path.slice(call.path.indexOf('?') + 1))
      // With no range, the server's seven days from today.
      const from = params.get('from') ?? state.date
      const to = params.get('to') ?? addDays(from, 6)
      const plan = makePlan(
        state.blocks.filter((b) => b.study_date >= from && b.study_date <= to),
        { from, to, unplaced: state.unplaced },
      )
      return withBusy(plan)
    })
    .on('GET /progress', makeProgress())
    .on('GET /exams', [makeExam()])
    .on({ method: 'GET', path: /^\/exams\/[^/]+\/tasks$/ }, [])
    .on('GET /review', () => ({ blocks: state.review }))
    .on('POST /plan/replan', makePreview())
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rendered = renderRoute(path, { auth: createFakeAuth(fakeSession({ id: USER_ID })), api: fake.api, queryClient })
  return { fake, state, queryClient, ...rendered }
}
