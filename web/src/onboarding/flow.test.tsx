import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { he } from '../i18n/he'
import { createFakeApi, type ApiCall } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'
import { COMPLETED_AT, examResult, jobFixture, meFixture, resultFixture } from './testFixtures'
import type { MePatch } from '../api/me'
import type { Exam, ExamCreate } from './types'

// A server that behaves like the API across the whole onboarding: exams are kept, PATCH /me changes
// the profile, and the job ends the onboarding when it is done (S13 decision 1).
function server() {
  const state = { exams: [] as Exam[], me: meFixture(), jobReads: 0 }
  const fake = createFakeApi()
    .on('GET /me', () => state.me)
    .on('PATCH /me', (call: ApiCall) => {
      state.me = { ...state.me, ...(call.body as MePatch) }
      return { ...state.me, plan_affected: false }
    })
    .on('GET /exams', () => state.exams)
    .on('POST /exams', (call: ApiCall) => {
      const exam: Exam = { id: 'e1', ...(call.body as ExamCreate), created_at: '2026-11-16T08:00:00Z' }
      state.exams = [...state.exams, exam]
      return { exam, plan_affected: false }
    })
    .on('GET /exams/e1/materials', [])
    .on('POST /plans/generate', { job_id: 'j1', created: true })
    .on('GET /jobs/j1', () => {
      state.jobReads += 1
      if (state.jobReads === 1) return jobFixture({ stage: 'analyzing', percent: 30 })
      state.me = { ...state.me, onboarding_completed_at: COMPLETED_AT }
      return jobFixture({ status: 'done', percent: 100, result: resultFixture({}, [examResult({ tasks: 8 })]) })
    })
  return { fake, state }
}

function daysFromToday(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return { iso: `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, typed: pad(d.getDate()) + pad(d.getMonth() + 1) + String(d.getFullYear()) }
}

describe('the onboarding, end to end', () => {
  it('/ → exams → skip materials → the two questions → building → done → /today', async () => {
    const user = userEvent.setup()
    const { fake } = server()
    const { router } = renderRoute('/', { auth: createFakeAuth(fakeSession()), api: fake.api })

    // The gate: no plan yet, so the first step.
    expect(await screen.findByRole('heading', { level: 1, name: he.onboardingExams.title })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/onboarding/exams')

    // Step 1: one exam.
    await user.type(screen.getByRole('textbox', { name: he.onboardingExams.name }), 'חדו"א')
    const date = daysFromToday(30)
    const [firstSegment] = within(screen.getByRole('group', { name: he.onboardingExams.date })).getAllByRole('spinbutton')
    if (firstSegment === undefined) throw new Error('no date segments')
    await user.click(firstSegment)
    await user.keyboard(date.typed)
    await user.click(screen.getByRole('button', { name: he.onboardingExams.add }))
    expect(await screen.findByRole('list', { name: he.onboardingExams.listTitle })).toHaveTextContent('חדו"א')
    expect(fake.calls('POST', '/exams').at(0)?.body).toEqual({ name: 'חדו"א', exam_date: date.iso, difficulty: 3 })
    await user.click(screen.getByRole('button', { name: he.common.next }))

    // Step 2: no materials.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/onboarding/materials')
    })
    await user.click(await screen.findByRole('button', { name: he.common.skip }))

    // Step 3: the defaults, then build.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/onboarding/schedule')
    })
    await user.click(await screen.findByRole('button', { name: he.onboardingSchedule.build }))

    // Step 4: the job runs, then is done.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/onboarding/building')
    })
    expect(fake.calls('PATCH', '/me').at(-1)?.body).toEqual({ daily_study_minutes: 240, study_windows: ['morning', 'afternoon'] })
    expect(await screen.findByText(he.building.stages.analyzing)).toBeInTheDocument()
    expect(router.state.location.search).toBe('?job=j1')
    expect(await screen.findByRole('heading', { name: he.building.doneTitle }, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.getByText(he.building.examTasks(8))).toBeInTheDocument()
    // The summary stays although the onboarding is now over on the server.
    expect(router.state.location.pathname).toBe('/onboarding/building')

    await user.click(screen.getByRole('button', { name: he.building.toToday }))
    expect(await screen.findByRole('heading', { name: he.today.title })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/today')
    expect(fake.calls('POST', '/plans/generate')).toHaveLength(1)
  })
})
