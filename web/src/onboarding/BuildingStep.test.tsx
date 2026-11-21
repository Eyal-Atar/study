import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { codeText, shortfallText } from '../i18n/codes'
import { en } from '../i18n/en'
import { createFakeApi, problem, type FakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'
import {
  COMPLETED_AT,
  examFixture,
  examResult,
  jobFixture,
  meFixture,
  previewFixture,
  resultFixture,
} from '../test/onboardingFixtures'
import type { Job, GenerateResult, Material } from './types'

// The poll is every 2 seconds, so a test that waits for a second answer waits a little longer.
const POLL = { timeout: 4000 }

function material(status: Material['ingest_status']): Material {
  return {
    id: 'm1',
    exam_id: 'e1',
    filename: 'a.pdf',
    kind: 'past_exam',
    mime: 'application/pdf',
    size_bytes: 10,
    page_count: 3,
    scanned_pages: 0,
    ingest_status: status,
    ingest_error: null,
    warnings: [],
    created_at: '2026-11-16T08:00:00Z',
    ingested_at: null,
  }
}

// me is not onboarded until `done` is set, like the API after the first plan is written.
function server({ jobs = [jobFixture()] }: { jobs?: Job<GenerateResult>[] } = {}) {
  const state = { done: false, jobCalls: 0 }
  const fake = createFakeApi()
    .on('GET /me', () => meFixture({ onboarding_completed_at: state.done ? COMPLETED_AT : null }))
    .on('GET /exams', [examFixture(), examFixture({ id: 'e2', name: 'פיזיקה' })])
    .on('GET /exams/e1/materials', [])
    .on('GET /exams/e2/materials', [])
    .on('POST /plans/generate', { job_id: 'j1', created: true })
    .on({ method: 'GET', path: /^\/jobs\// }, () => {
      const job = jobs[Math.min(state.jobCalls++, jobs.length - 1)] ?? jobFixture()
      if (job.status === 'done') state.done = true
      return job
    })
  return { fake, state }
}

function open(fake: FakeApi, path = '/onboarding/building') {
  return renderRoute(path, { auth: createFakeAuth(fakeSession()), api: fake.api })
}

const generateCalls = (fake: FakeApi) => fake.calls('POST', '/plans/generate')

const JOB_KEY = 'studyflow:onboarding-job:user-a'

beforeEach(() => {
  sessionStorage.clear()
})

describe('BuildingStep', () => {
  it('waits for materials still being read, then starts the job once and puts it in the URL', async () => {
    const { fake } = server()
    let reads = 0
    fake.on('GET /exams/e1/materials', () => [material(reads++ === 0 ? 'processing' : 'ready')])
    const { router } = open(fake)

    expect(await screen.findByText(en.building.waitingMaterials)).toBeInTheDocument()
    expect(generateCalls(fake)).toHaveLength(0)

    await waitFor(() => {
      expect(router.state.location.search).toBe('?job=j1')
    }, POLL)
    expect(generateCalls(fake)).toHaveLength(1)
    expect(router.state.location.pathname).toBe('/onboarding/building')
  })

  it('with ?job= follows that job without a new POST /plans/generate', async () => {
    const { fake } = server({ jobs: [jobFixture({ stage: 'analyzing', percent: 40 })] })
    open(fake, '/onboarding/building?job=j1')

    const bar = await screen.findByRole('progressbar', { name: en.building.progressLabel })
    await waitFor(() => {
      expect(bar).toHaveAttribute('aria-valuenow', '40')
    })
    expect(screen.getByText(en.building.stages.analyzing)).toHaveAttribute('aria-live', 'polite')
    expect(generateCalls(fake)).toHaveLength(0)
    expect(fake.calls('GET', /\/materials$/)).toHaveLength(0)
  })

  it('an unknown or missing stage shows the generic text', async () => {
    const { fake } = server({ jobs: [jobFixture({ stage: 'mystery', percent: null })] })
    open(fake, '/onboarding/building?job=j1')

    expect(await screen.findByText(en.building.starting)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })

  it('done: a summary with every exam, the failed one with its reason, the shortfalls, and "Go to my calendar"', async () => {
    const user = userEvent.setup()
    const result = resultFixture(
      { unscheduled_count: 3, shortfalls: [{ exam_id: 'e1', minutes: 240, daily_minutes: 300 }], warnings: [] },
      [
        examResult({
          exam_id: 'e1',
          tasks: 12,
          warnings: ['under_budget'],
          gaps: [{ topic: 'אינטגרלים', note: 'אין מבחני עבר' }],
        }),
        examResult({ exam_id: 'e2', status: 'failed', error: 'analysis_invalid', tasks: 0 }),
      ],
    )
    const { fake } = server({ jobs: [jobFixture({ stage: 'planning', percent: 88 }), jobFixture({ status: 'done', percent: 100, result })] })
    const { router } = open(fake, '/onboarding/building?job=j1')

    expect(await screen.findByRole('heading', { name: en.building.doneTitle }, POLL)).toBeInTheDocument()
    // One row per exam (the gaps of an exam are a list of their own inside its row).
    const calculus = screen.getByText('חדו"א').closest('li')
    const physics = screen.getByText('פיזיקה').closest('li')
    expect(screen.getByText('פיזיקה').closest('[dir="auto"]')).not.toBeNull()
    const exams = screen.getByRole('list', { name: en.building.examsTitle })
    expect(exams).toContainElement(calculus)
    expect(exams).toContainElement(physics)
    expect(calculus).toHaveTextContent(en.building.examTasks(12))
    expect(calculus).toHaveTextContent(codeText('under_budget'))
    expect(calculus).toHaveTextContent('אינטגרלים')
    // The note is user content, in a block that takes its own direction.
    expect(screen.getByText('אין מבחני עבר').closest('[dir="auto"]')).not.toBeNull()
    expect(screen.getByText('אינטגרלים').closest('[dir="auto"]')).not.toBeNull()
    expect(physics).toHaveTextContent(codeText('analysis_invalid'))
    // The failed exam is marked by an icon and the words, not only by the red.
    expect(physics).toHaveTextContent(en.building.examFailed)
    expect(physics?.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    // "Go to my calendar" is the only primary button of the summary.
    expect(screen.getAllByRole('button').filter((button) => button.classList.contains('bg-brand'))).toHaveLength(1)
    // A partial failure is not a silent success.
    expect(screen.getByText(en.building.someFailed)).toBeInTheDocument()
    expect(screen.getByText(en.building.unscheduled(3))).toBeInTheDocument()
    expect(screen.getByText(shortfallText('חדו"א', 240, 300))).toBeInTheDocument()

    const meReads = fake.calls('GET', '/me').length
    await user.click(screen.getByRole('button', { name: en.building.toToday }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/calendar')
    })
    expect(fake.calls('GET', '/me').length).toBeGreaterThan(meReads)
    expect(await screen.findByRole('heading', { name: en.today.title })).toBeInTheDocument()
  })

  it('a failure card holds its buttons, the one that goes on first and primary', async () => {
    const { fake } = server({ jobs: [jobFixture({ status: 'failed', error: 'analysis_invalid' })] })
    open(fake, '/onboarding/building?job=j1')

    const alert = await screen.findByRole('alert', { name: en.building.failedTitle })
    const buttons = within(alert).getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual([en.common.retry, en.common.back])
    expect(buttons[0]).toHaveClass('bg-brand')
    expect(buttons[1]).not.toHaveClass('bg-brand')
  })

  it('failed with analysis_invalid: the reason, and "Try again" starts a new job', async () => {
    const user = userEvent.setup()
    const { fake } = server({ jobs: [jobFixture({ status: 'failed', error: 'analysis_invalid' })] })
    fake.on('POST /plans/generate', { job_id: 'j2', created: true })
    const { router } = open(fake, '/onboarding/building?job=j1')

    expect(await screen.findByRole('alert')).toHaveTextContent(codeText('analysis_invalid'))
    await user.click(screen.getByRole('button', { name: en.common.retry }))
    await waitFor(() => {
      expect(router.state.location.search).toBe('?job=j2')
    })
    expect(generateCalls(fake)).toHaveLength(1)
  })

  it('429: the local time the quota resets, without a retry button', async () => {
    const resetsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const { fake } = server()
    fake.on('POST /plans/generate', () => problem(429, 'ai_quota_exceeded', { limit: 3, resets_at: resetsAt }))
    open(fake)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(codeText('ai_quota_exceeded', { resets_at: resetsAt }))
    expect(alert.textContent).toMatch(/\d{2}:\d{2}/)
    expect(screen.queryByRole('button', { name: en.common.retry })).not.toBeInTheDocument()
  })

  it('409 nothing_to_analyze opens ReplanOffer, and applying it goes to the calendar (through /today)', async () => {
    const user = userEvent.setup()
    const { fake, state } = server()
    fake.on('POST /plans/generate', () => problem(409, 'nothing_to_analyze'))
    fake.on('POST /plan/replan', (call: { body: unknown }) => {
      const body = call.body as { preview: boolean }
      if (!body.preview) state.done = true
      return previewFixture({ version_id: body.preview ? null : 'v1' })
    })
    const { router } = open(fake)

    const dialog = await screen.findByRole('dialog', { name: en.replan.title })
    expect(within(dialog).getByText(en.building.replanReason)).toBeInTheDocument()
    expect(screen.getByText(codeText('nothing_to_analyze'))).toBeInTheDocument()

    await user.click(await within(dialog).findByRole('button', { name: en.replan.confirm }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/calendar')
    })
    expect(fake.calls('POST', '/plan/replan').at(-1)?.body).toEqual({ preview: false, basis: 'b1' })
  })

  it('failed with ai_no_credit: the reason, and an offer to schedule what was already analyzed', async () => {
    const user = userEvent.setup()
    const { fake } = server({ jobs: [jobFixture({ status: 'failed', error: 'ai_no_credit' })] })
    fake.on('POST /plan/replan', previewFixture())
    open(fake, '/onboarding/building?job=j1')

    expect(await screen.findByRole('alert')).toHaveTextContent(codeText('ai_no_credit'))
    expect(screen.queryByRole('button', { name: en.common.retry })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: en.building.scheduleAnalyzed }))
    expect(await screen.findByRole('dialog', { name: en.replan.title })).toBeInTheDocument()
    await waitFor(() => {
      expect(fake.calls('POST', '/plan/replan')).toHaveLength(1)
    })
  })

  it('another POST error shows the message and can be retried', async () => {
    const user = userEvent.setup()
    const { fake } = server()
    let fail = true
    fake.on('POST /plans/generate', () => (fail ? problem(503, 'database_unavailable') : { job_id: 'j1', created: true }))
    const { router } = open(fake)

    expect(await screen.findByRole('alert')).toHaveTextContent(codeText('database_unavailable'))
    fail = false
    await user.click(screen.getByRole('button', { name: en.common.retry }))
    await waitFor(() => {
      expect(router.state.location.search).toBe('?job=j1')
    })
  })

  it('remembers the running job for this user, and forgets it when the job is done', async () => {
    const result = resultFixture()
    const { fake } = server({ jobs: [jobFixture({ stage: 'analyzing', percent: 30 }), jobFixture({ status: 'done', percent: 100, result })] })
    open(fake)

    await waitFor(() => {
      expect(sessionStorage.getItem(JOB_KEY)).toBe('j1')
    })
    expect(await screen.findByRole('heading', { name: en.building.doneTitle }, POLL)).toBeInTheDocument()
    expect(sessionStorage.getItem(JOB_KEY)).toBeNull()
  })

  it('forgets a failed job', async () => {
    sessionStorage.setItem(JOB_KEY, 'j1')
    const { fake } = server({ jobs: [jobFixture({ status: 'failed', error: 'analysis_invalid' })] })
    open(fake, '/onboarding/building?job=j1')

    expect(await screen.findByRole('alert')).toHaveTextContent(codeText('analysis_invalid'))
    expect(sessionStorage.getItem(JOB_KEY)).toBeNull()
  })

  it('a ?job= that is not found is dropped, and the normal flow starts a job', async () => {
    sessionStorage.setItem(JOB_KEY, 'gone')
    const { fake } = server()
    fake.on('GET /jobs/gone', () => problem(404, 'not_found'))
    const { router } = open(fake, '/onboarding/building?job=gone')

    await waitFor(() => {
      expect(router.state.location.search).toBe('?job=j1')
    })
    expect(generateCalls(fake)).toHaveLength(1)
    // The router's state changes before React commits the screen whose effect remembers the job.
    await waitFor(() => {
      expect(sessionStorage.getItem(JOB_KEY)).toBe('j1')
    })
  })

  it('409 nothing_to_analyze without any exam goes back to the exams step', async () => {
    const { fake } = server()
    fake.on('GET /exams', [])
    fake.on('POST /plans/generate', () => problem(409, 'nothing_to_analyze'))
    const { router } = open(fake)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/onboarding/exams')
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(fake.calls('POST', '/plan/replan')).toHaveLength(0)
  })

  it('applying the offer after nothing_to_analyze shows "Calendar updated" on the calendar', async () => {
    const user = userEvent.setup()
    const { fake, state } = server()
    fake.on('POST /plans/generate', () => problem(409, 'nothing_to_analyze'))
    fake.on('POST /plan/replan', (call: { body: unknown }) => {
      const body = call.body as { preview: boolean }
      if (!body.preview) state.done = true
      return previewFixture({ added: [{ task_id: 't1', starts_at: '2026-11-17T08:00:00Z', ends_at: '2026-11-17T09:00:00Z', part_index: 0, part_count: 1 }], version_id: body.preview ? null : 'v1' })
    })
    const { router } = open(fake)

    const dialog = await screen.findByRole('dialog', { name: en.replan.title })
    await user.click(await within(dialog).findByRole('button', { name: en.replan.confirm }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/calendar')
    })
    expect(await screen.findByText(en.replan.applied)).toBeInTheDocument()
  })

  it.each([
    ['a failed job', { jobs: [jobFixture({ status: 'failed', error: 'analysis_invalid' })] }, '/onboarding/building?job=j1'],
    ['an account failure', { jobs: [jobFixture({ status: 'failed', error: 'ai_no_credit' })] }, '/onboarding/building?job=j1'],
  ])('%s offers "Back" to the schedule step', async (_name, options, path) => {
    const user = userEvent.setup()
    const { fake } = server(options)
    const { router } = open(fake, path)

    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: en.common.back }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/onboarding/schedule')
    })
  })

  it('429 offers "Back" to the schedule step', async () => {
    const user = userEvent.setup()
    const { fake } = server()
    fake.on('POST /plans/generate', () => problem(429, 'ai_quota_exceeded', { limit: 3, resets_at: new Date(Date.now() + 3600000).toISOString() }))
    const { router } = open(fake)

    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: en.common.back }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/onboarding/schedule')
    })
  })
})
