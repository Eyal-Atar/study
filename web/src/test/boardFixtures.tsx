import { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import type { ApiClient } from '../api/client'
import type { Me } from '../api/me'
import { AppProviders } from '../app/AppProviders'
import type { Block, ExamSummary, Plan, ReplanPreview, Today } from '../board/types'
import { ReplanOfferProvider } from '../plan/ReplanOffer'
import { ToastRegion } from '../ui/toast'
import { createFakeStorage } from './fakeStorage'
import { createFakeAuth, fakeSession } from './fakeAuth'

// Sample board data in the shape of the API. Every id is stable, so a test can refer to it.

export const USER_ID = 'user-a'
export const EXAM_ID = 'exam-1'

export function makeBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: 'block-1',
    task_id: 'task-1',
    exam_id: EXAM_ID,
    task_title: 'פרק 3: גרפים',
    task_kind: 'learn',
    exam_name: 'אלגוריתמים',
    starts_at: '2026-11-16T12:00:00Z',
    ends_at: '2026-11-16T13:00:00Z',
    study_date: '2026-11-16',
    part_index: 1,
    part_count: 1,
    pinned: false,
    status: 'planned',
    state: 'upcoming',
    ...overrides,
  }
}

export function makeToday(blocks: Block[] = [makeBlock()], overrides: Partial<Today> = {}): Today {
  return {
    date: '2026-11-16',
    blocks,
    planned_minutes: 60,
    done_minutes: 0,
    // 07:00–23:00 in Jerusalem (UTC+2 in November)
    day_starts_at: '2026-11-16T05:00:00Z',
    day_ends_at: '2026-11-16T21:00:00Z',
    ...overrides,
  }
}

export function makePlan(blocks: Block[] = [makeBlock()], overrides: Partial<Plan> = {}): Plan {
  return { from: '2026-11-16', to: '2026-11-22', blocks, unplaced: [], undo: null, ...overrides }
}

export function makePreview(overrides: Partial<ReplanPreview> = {}): ReplanPreview {
  return {
    basis: 'basis-1',
    changed: false,
    version_id: null,
    added: [],
    removed: [],
    unscheduled: [],
    shortfalls: [],
    warnings: [],
    ...overrides,
  }
}

export const EXAMS: ExamSummary[] = [{ id: EXAM_ID, name: 'אלגוריתמים' }]

// GET /me as the server returns it.
export function makeMe(timezone = 'Asia/Jerusalem'): Me {
  return {
    id: USER_ID,
    email: 'a@example.com',
    display_name: null,
    timezone,
    wake_time: '08:00',
    sleep_time: '23:00',
    daily_study_minutes: 180,
    study_windows: ['morning', 'afternoon'],
    rest_days_before_exam: 1,
    notify_lead_minutes: 10,
    study_start_delay_minutes: 60,
    hobby_start: null,
    hobby_minutes: null,
    // A user past the onboarding: OnboardingGate (S13) lets them into /today and /week.
    onboarding_completed_at: '2026-11-10T08:00:00Z',
  }
}

// Renders `ui` inside the real providers, a memory router, the replan offer (as AppShell has it) and
// the toast region, signed in as USER_ID.
export function renderBoard(ui: ReactNode, { api, queryClient }: { api: ApiClient; queryClient?: QueryClient }) {
  const client = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const auth = createFakeAuth(fakeSession({ id: USER_ID }))
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <ReplanOfferProvider>
            {ui}
            <ToastRegion />
          </ReplanOfferProvider>
        ),
      },
    ],
    { initialEntries: ['/today'] },
  )
  const result = render(
    <StrictMode>
      <AppProviders auth={auth.client} api={api} storage={createFakeStorage().client} queryClient={client}>
        <RouterProvider router={router} />
      </AppProviders>
    </StrictMode>,
  )
  return { ...result, router, queryClient: client }
}
