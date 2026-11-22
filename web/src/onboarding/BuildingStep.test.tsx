import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { todayIn } from '../exam/dates'
import { codeText, shortfallText } from '../i18n/codes'
import { en } from '../i18n/en'
import { progressKey } from '../progress/api'
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
import { clearMarkedCells, markedCells, setMarkedCells } from './markedHours'
import { STEP_PATHS } from './steps'
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

// prefers-reduced-motion as the system answers it; every other query is false.
function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
}

// YYYY-MM-DD of the local day `days` from today.
function dayFromToday(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${String(d.getFullYear())}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

afterEach(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  sessionStorage.clear()
  clearMarkedCells()
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
    // The stage is read aloud once, from the one live region; the list shows it as the current one.
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(en.building.stages.analyzing)
    const stages = screen.getByRole('list', { name: en.onboardingFlow.build.stagesLabel })
    expect(within(stages).getByText(en.building.stages.analyzing).closest('li')).toHaveAttribute('aria-current', 'step')
    expect(within(stages).getByText(en.building.stages.reading_materials).closest('li')).not.toHaveAttribute('aria-current')
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
  ])('%s offers "Back" to the fixed-hours step', async (_name, options, path) => {
    const user = userEvent.setup()
    const { fake } = server(options)
    const { router } = open(fake, path)

    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: en.common.back }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(STEP_PATHS.fixedHours)
    })
  })

  it('429 offers "Back" to the fixed-hours step', async () => {
    const user = userEvent.setup()
    const { fake } = server()
    fake.on('POST /plans/generate', () => problem(429, 'ai_quota_exceeded', { limit: 3, resets_at: new Date(Date.now() + 3600000).toISOString() }))
    const { router } = open(fake)

    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: en.common.back }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(STEP_PATHS.fixedHours)
    })
  })

  describe('as the build and the ready plan (not numbered steps)', () => {
    const doneJob = (extra: Partial<GenerateResult> = {}, plan: Partial<GenerateResult['plan']> = { blocks: 46 }) =>
      jobFixture({ status: 'done', percent: 100, result: { ...resultFixture(plan), ...extra } })

    it('while building: no steps bar and no count, Archi at his scroll, the five stages as a list', async () => {
      const { fake } = server({ jobs: [jobFixture({ stage: 'validating', percent: 55 })] })
      open(fake, '/onboarding/building?job=j1')

      expect(await screen.findByRole('heading', { level: 1, name: en.building.title })).toBeInTheDocument()
      expect(screen.queryByRole('navigation', { name: en.onboarding.stepsLabel })).not.toBeInTheDocument()
      expect(screen.queryByText(/Step \d of/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: en.common.back })).not.toBeInTheDocument()
      expect(screen.getByAltText(en.archie.alt.wisdom)).toBeInTheDocument()
      expect(screen.getByText(en.building.intro)).toBeInTheDocument()
      const stages = screen.getByRole('list', { name: en.onboardingFlow.build.stagesLabel })
      expect(within(stages).getAllByRole('listitem').map((li) => li.textContent)).toEqual(Object.values(en.building.stages))
      await waitFor(() => {
        expect(within(stages).getByText(en.building.stages.validating).closest('li')).toHaveAttribute('aria-current', 'step')
      })
    })

    it('ready: eureka, one h1, no steps bar, the blocks and the days to the nearest exam', async () => {
      const { fake } = server({ jobs: [doneJob()] })
      fake.on('GET /exams', [
        examFixture({ id: 'e1', exam_date: dayFromToday(40) }),
        examFixture({ id: 'e2', name: 'פיזיקה', exam_date: dayFromToday(22), color_index: 1 }),
        examFixture({ id: 'e3', name: 'עבר', exam_date: dayFromToday(-3), color_index: 2 }),
      ])
      open(fake, '/onboarding/building?job=j1')

      expect(await screen.findByRole('heading', { level: 1, name: en.building.doneTitle })).toBeInTheDocument()
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
      expect(screen.getByAltText(en.archie.alt.eureka)).toBeInTheDocument()
      expect(screen.queryByRole('navigation', { name: en.onboarding.stepsLabel })).not.toBeInTheDocument()
      expect(screen.queryByText(/Step \d of/)).not.toBeInTheDocument()
      expect(screen.getByText(en.onboardingFlow.ready.summary(46, 22))).toBeInTheDocument()
    })

    it('says "tomorrow", "today" and a single block correctly, and drops the exam half with no exam ahead', () => {
      const t = en.onboardingFlow.ready
      expect(t.summary(1, 1)).toBe('I placed 1 study block on your calendar. Your first exam is tomorrow.')
      expect(t.summary(46, 0)).toContain('Your first exam is today.')
      expect(t.summary(46, null)).toBe('I placed 46 study blocks on your calendar.')
    })

    it('first_plan_xp 50: the gold chip with its accessible text comes first, then the green one', async () => {
      const { fake } = server({ jobs: [doneJob({ first_plan_xp: 50 })] })
      open(fake, '/onboarding/building?job=j1')

      const gold = await screen.findByText(en.onboardingFlow.ready.xpChip(50), undefined, POLL)
      expect(gold).toHaveAttribute('aria-hidden', 'true')
      const label = screen.getByText(en.onboardingFlow.ready.xpChipLabel(50))
      expect(label).toHaveClass('sr-only')
      const seed = screen.getByText(en.onboardingFlow.ready.seedChip)
      const chips = gold.closest('span.rounded-full')
      expect(chips).toHaveClass('bg-gold-soft', 'text-gold-ink')
      expect(chips?.parentElement).toBe(seed.closest('span.rounded-full')?.parentElement)
      expect(chips?.compareDocumentPosition(seed) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    })

    it('the number on the chip is the number from the job, not a constant', async () => {
      const { fake } = server({ jobs: [doneJob({ first_plan_xp: 75 })] })
      open(fake, '/onboarding/building?job=j1')

      expect(await screen.findByText(en.onboardingFlow.ready.xpChip(75), undefined, POLL)).toBeInTheDocument()
      expect(screen.getByText(en.onboardingFlow.ready.xpChipLabel(75))).toBeInTheDocument()
    })

    it.each([
      ['first_plan_xp 0', { first_plan_xp: 0 }],
      ['no first_plan_xp (a job from before the XP)', {}],
    ])('%s: no gold chip and no "XP" anywhere, the green one stays', async (_name, extra) => {
      const { fake } = server({ jobs: [doneJob(extra)] })
      open(fake, '/onboarding/building?job=j1')

      expect(await screen.findByText(en.onboardingFlow.ready.seedChip, undefined, POLL)).toBeInTheDocument()
      expect(screen.queryByText(/XP/)).not.toBeInTheDocument()
      expect(document.querySelector('.bg-gold-soft')).toBeNull()
    })

    it('with the XP given, the progress of the user is refreshed; with none it is not', async () => {
      const spy = async (extra: Partial<GenerateResult>) => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
        const { fake } = server({ jobs: [doneJob(extra)] })
        const view = renderRoute('/onboarding/building?job=j1', { auth: createFakeAuth(fakeSession()), api: fake.api, queryClient })
        await screen.findByText(en.onboardingFlow.ready.seedChip, undefined, POLL)
        await waitFor(() => {
          expect(invalidate.mock.calls.some(([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(['me', 'user-a']))).toBe(true)
        })
        const refreshed = invalidate.mock.calls.some(([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(progressKey('user-a')))
        view.unmount()
        return refreshed
      }
      expect(await spy({ first_plan_xp: 50 })).toBe(true)
      expect(await spy({ first_plan_xp: 0 })).toBe(false)
      expect(await spy({})).toBe(false)
    })

    it('a plan that is built forgets the hours still marked in step 4; a failed one keeps them', async () => {
      setMarkedCells(new Set(['0-10']))
      const failed = open(server({ jobs: [jobFixture({ status: 'failed', error: 'analysis_invalid' })] }).fake, '/onboarding/building?job=j1')
      expect(await screen.findByText(codeText('analysis_invalid'))).toBeInTheDocument()
      expect(markedCells().size).toBe(1)
      failed.unmount()

      open(server({ jobs: [doneJob()] }).fake, '/onboarding/building?job=j1')
      await screen.findByRole('heading', { level: 1, name: en.building.doneTitle }, POLL)
      await waitFor(() => {
        expect(markedCells().size).toBe(0)
      })
    })

    // The chip reads the job's answer at run time: anything but a positive whole number shows nothing.
    it.each([
      ['absent', {}, false],
      ['null', { first_plan_xp: null }, false],
      ['0', { first_plan_xp: 0 }, false],
      ['the string "50"', { first_plan_xp: '50' }, false],
      ['50', { first_plan_xp: 50 }, true],
    ])('first_plan_xp %s: gold chip %s', async (_name, extra, shown) => {
      const { fake } = server({ jobs: [doneJob(extra as Partial<GenerateResult>)] })
      open(fake, '/onboarding/building?job=j1')
      expect(await screen.findByText(en.onboardingFlow.ready.seedChip, undefined, POLL)).toBeInTheDocument()
      expect(document.querySelector('.bg-gold-soft') !== null).toBe(shown)
      expect(screen.queryAllByText(/XP/).length > 0).toBe(shown)
    })

    it('counts the days to the exam from today in the profile’s zone, not the device’s', async () => {
      // At 21:30 UTC on 30 November it is already 1 December in Tokyo and still 30 November in
      // Honolulu. The profile takes the zone whose day is not the device's, so the device's day would
      // give the wrong count: 10 days from 1 December, 11 from 30 November.
      const now = new Date('2026-11-30T21:30:00Z')
      const deviceDay = todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone, now)
      const [zone, days] = deviceDay === '2026-12-01' ? ['Pacific/Honolulu', 11] : ['Asia/Tokyo', 10]
      vi.useFakeTimers({ now, toFake: ['Date'] })
      try {
        const { fake } = server({ jobs: [doneJob()] })
        fake.on('GET /me', meFixture({ timezone: zone, onboarding_completed_at: COMPLETED_AT }))
        fake.on('GET /exams', [examFixture({ id: 'e1', exam_date: '2026-12-11' }), examFixture({ id: 'e2', name: 'פיזיקה', exam_date: '2027-01-20' })])
        open(fake, '/onboarding/building?job=j1')
        expect(await screen.findByText(en.onboardingFlow.ready.summary(46, days), undefined, POLL)).toBeInTheDocument()
      } finally {
        vi.useRealTimers()
      }
    })

    it('the ready card enters with a small hop, and with reduced motion Archi is simply there', async () => {
      mockReducedMotion(false)
      const { fake } = server({ jobs: [doneJob()] })
      const first = open(fake, '/onboarding/building?job=j1')
      await screen.findByRole('heading', { level: 1, name: en.building.doneTitle })
      const hop = first.container.querySelector('[data-part="hop"]')
      expect(hop).toHaveAttribute('data-entering')
      expect(hop?.className).toContain('motion-safe:starting:')
      first.unmount()

      mockReducedMotion(true)
      const second = open(fake, '/onboarding/building?job=j1')
      await screen.findByRole('heading', { level: 1, name: en.building.doneTitle })
      const still = second.container.querySelector('[data-part="hop"]')
      expect(still).not.toHaveAttribute('data-entering')
      expect(still?.className ?? '').not.toMatch(/starting|transition|animate/)
    })
  })
})
