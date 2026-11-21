import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../app/AppProviders'
import { codeText, shortfallText, unscheduledText } from '../i18n/codes'
import { en } from '../i18n/en'
import { COMPLETED_AT, examFixture, jobFixture, meFixture, previewFixture, resultFixture } from '../onboarding/testFixtures'
import { ReplanOfferProvider } from '../plan/ReplanOffer'
import { createFakeApi, problem, type ApiCall, type FakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { createFakeStorage } from '../test/fakeStorage'
import { ToastRegion } from '../ui/toast'
import { AnalysisSection } from './AnalysisSection'
import { applyFixture, reanalyzeJob, reanalyzeResult, taskItem, topicsFixture } from './analysisFixtures'
import type { AnalysisApply } from './analysis'

const t = en.exam.analysis
// The job is polled every 2 seconds, so a test that waits for a second answer waits a little longer.
const POLL = { timeout: 4000 }
const JOB_KEY = 'studyflow:exam-job:user-a:e1'

function server({ aiTasks = false, draft = null }: { aiTasks?: boolean; draft?: string | null } = {}) {
  return createFakeApi()
    .on('GET /me', meFixture({ onboarding_completed_at: COMPLETED_AT }))
    .on('GET /exams', [examFixture()])
    .on('GET /exams/e1/tasks', aiTasks ? [taskItem(), taskItem({ id: 't2', source: 'user', reason: null })] : [taskItem({ source: 'user' })])
    .on('GET /exams/e1/topics', topicsFixture({ draft_analysis_id: draft }))
}

function setup(fake: FakeApi) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const auth = createFakeAuth(fakeSession({ id: 'user-a' }))
  render(
    <StrictMode>
      <AppProviders auth={auth.client} api={fake.api} storage={createFakeStorage().client} queryClient={queryClient}>
        <ReplanOfferProvider>
          <AnalysisSection examId="e1" />
        </ReplanOfferProvider>
        <ToastRegion />
      </AppProviders>
    </StrictMode>,
  )
  const invalidated = () => invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey))
  return { user: userEvent.setup(), invalidated, queryClient }
}

// The heading of the section is its trigger; its name can end with the summary ("רץ עכשיו").
const trigger = (title: string = t.title) => screen.findByRole('button', { name: new RegExp(`^${title}`) })

// An exam that has its plan keeps the section closed: the user opens it to reach "ניתוח חוזר".
async function openSection(user: ReturnType<typeof userEvent.setup>) {
  const button = await trigger()
  expect(button).toHaveAttribute('aria-expanded', 'false')
  await user.click(button)
  expect(button).toHaveAttribute('aria-expanded', 'true')
}

const previewCalls = (fake: FakeApi, id: string) =>
  fake.calls('POST', `/analyses/${id}/apply`).filter((c) => (c.body as { preview: boolean }).preview)
const applyCalls = (fake: FakeApi, id: string) =>
  fake.calls('POST', `/analyses/${id}/apply`).filter((c) => !(c.body as { preview: boolean }).preview)

const fullPreview: AnalysisApply = applyFixture({
  replaced: [
    { id: 't1', title: 'גבולות' },
    { id: 't3', title: 'נגזרות' },
  ],
  kept: 1,
  added: [
    { task_id: 'n1', title: 'תרגול אינטגרלים', kind: 'practice', minutes: 90, reason: 'מופיע בשלושה מבחני עבר' },
    { task_id: 'n2', title: 'סימולציה 2024', kind: 'simulation', minutes: 180, reason: null },
  ],
  added_blocks: [
    { task_id: 'n1', starts_at: '2026-11-17T08:00:00Z', ends_at: '2026-11-17T09:30:00Z', part_index: 0, part_count: 1 },
  ],
  removed_blocks: [],
  unscheduled: [{ task_id: 'n2', minutes: 180, reason: 'no_contiguous_window', blocked_by: null }],
  shortfalls: [{ exam_id: 'e1', minutes: 120, daily_minutes: 300 }],
})

beforeEach(() => {
  sessionStorage.clear()
})

describe('AnalysisSection without AI tasks', () => {
  it('builds the plan: generate, follows the job with its stage, then refreshes the exam and the board', async () => {
    let polls = 0
    const fake = server()
      .on('POST /plans/generate', { job_id: 'j1', created: true })
      .on('GET /jobs/j1', () =>
        polls++ === 0
          ? jobFixture({ stage: 'analyzing', percent: 40 })
          : jobFixture({ status: 'done', percent: 100, result: resultFixture() }),
      )
    const { user, invalidated } = setup(fake)

    // Without a plan the section is open by itself: building it is the action of the screen.
    expect(await screen.findByText(t.buildIntro)).toBeVisible()
    expect(await trigger(t.buildTitle)).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('button', { name: t.reanalyze })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t.build }))

    expect(await screen.findByText(en.building.stages.analyzing)).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: en.building.stages.analyzing })).toHaveAttribute('aria-valuenow', '40')
    expect(fake.calls('POST', '/plans/generate')).toHaveLength(1)
    expect(sessionStorage.getItem(JOB_KEY)).toContain('j1')

    expect(await screen.findByText(t.built, {}, POLL)).toBeInTheDocument()
    const keys = invalidated()
    for (const key of [
      ['tasks', 'user-a', 'e1'],
      ['topics', 'user-a', 'e1'],
      ['plan', 'user-a'],
      ['today', 'user-a'],
      ['exams', 'user-a'],
    ]) {
      expect(keys).toContain(JSON.stringify(key))
    }
    expect(sessionStorage.getItem(JOB_KEY)).toBeNull()
  })

  it('a full daily quota shows the hour it resets', async () => {
    const resetsAt = '2026-11-17T00:00:00+02:00'
    const fake = server().on('POST /plans/generate', problem(429, 'ai_quota_exceeded', { limit: 3, resets_at: resetsAt }))
    const { user } = setup(fake)
    await user.click(await screen.findByRole('button', { name: t.build }))
    expect(await screen.findByText(codeText('ai_quota_exceeded', { resets_at: resetsAt }))).toBeInTheDocument()
  })

  it('nothing to analyze offers a replan of the board', async () => {
    const fake = server()
      .on('POST /plans/generate', problem(409, 'nothing_to_analyze'))
      .on('POST /plan/replan', previewFixture())
    const { user } = setup(fake)
    await user.click(await screen.findByRole('button', { name: t.build }))
    expect(await screen.findByText(codeText('nothing_to_analyze'))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t.replan }))
    expect(await screen.findByRole('dialog', { name: en.replan.title })).toBeInTheDocument()
    expect(screen.getByText(t.replanReason)).toBeInTheDocument()
  })

  it('a failed job shows its code and builds again on retry', async () => {
    const fake = server()
      .on('POST /plans/generate', { job_id: 'j1', created: true })
      .on('GET /jobs/j1', jobFixture({ status: 'failed', error: 'ai_unavailable' }))
    const { user } = setup(fake)
    await user.click(await screen.findByRole('button', { name: t.build }))

    expect(await screen.findByText(codeText('ai_unavailable'))).toBeInTheDocument()
    expect(sessionStorage.getItem(JOB_KEY)).toBeNull()
    await user.click(screen.getByRole('button', { name: en.common.retry }))
    await waitFor(() => {
      expect(fake.calls('POST', '/plans/generate')).toHaveLength(2)
    })
  })

  it('a job remembered for this exam is followed again after a reload, without a new request', async () => {
    sessionStorage.setItem(JOB_KEY, JSON.stringify({ jobId: 'j1', kind: 'generate' }))
    const fake = server().on('GET /jobs/j1', jobFixture({ stage: 'planning', percent: 88 }))
    setup(fake)
    expect(await screen.findByText(en.building.stages.planning)).toBeInTheDocument()
    expect(fake.calls('POST', '/plans/generate')).toHaveLength(0)
  })
})

describe('AnalysisSection with AI tasks', () => {
  function reanalyzeServer(previews: (AnalysisApply | Error)[] = [fullPreview]) {
    let n = 0
    return server({ aiTasks: true })
      .on('POST /exams/e1/reanalyze', { job_id: 'j2', created: true })
      .on('GET /jobs/j2', reanalyzeJob({ status: 'done', result: reanalyzeResult('a2') }))
      .on('POST /analyses/a2/apply', (call: ApiCall) => {
        const body = call.body as { preview: boolean }
        if (body.preview) return previews[Math.min(n++, previews.length - 1)]
        return { ...fullPreview, version_id: 'v9' }
      })
      .on('POST /plan/undo', { restored: 2, deleted: 2, replaced: [], unplaced: [] })
  }

  it('reanalyzes, previews the draft with what is replaced, kept and added, applies it with basis, and undoes', async () => {
    const fake = reanalyzeServer()
    const { user, invalidated } = setup(fake)

    expect(await screen.findByText(t.reanalyzeIntro)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.build })).not.toBeInTheDocument()
    await openSection(user)
    await user.click(screen.getByRole('button', { name: t.reanalyze }))

    const dialog = await screen.findByRole('dialog', { name: t.previewTitle })
    expect(fake.calls('POST', '/exams/e1/reanalyze')).toHaveLength(1)
    expect(await within(dialog).findByText(t.replaced(2))).toBeInTheDocument()
    const replaced = within(dialog).getByRole('list', { name: t.replacedListLabel })
    expect(within(replaced).getByText('גבולות')).toBeInTheDocument()
    expect(within(replaced).getByText('נגזרות')).toBeInTheDocument()
    expect(within(dialog).getByText(t.kept(1))).toBeInTheDocument()
    expect(within(dialog).getByText(t.added(2))).toBeInTheDocument()
    const added = within(dialog).getByRole('list', { name: t.addedListLabel })
    expect(within(added).getByText('תרגול אינטגרלים')).toBeInTheDocument()
    expect(within(added).getByText('מופיע בשלושה מבחני עבר')).toBeInTheDocument()
    expect(
      within(added).getByText(t.taskMeta(en.exam.tasks.kinds.practice, en.exam.tasks.minutes(90))),
    ).toBeInTheDocument()
    expect(within(dialog).getByText(en.replan.added(1))).toBeInTheDocument()
    expect(
      within(dialog).getByText(en.replan.unscheduledGroup(1, unscheduledText('no_contiguous_window'))),
    ).toBeInTheDocument()
    expect(await within(dialog).findByText(shortfallText('חדו"א', 120, 300))).toBeInTheDocument()
    expect(previewCalls(fake, 'a2')).toHaveLength(1)

    await user.click(within(dialog).getByRole('button', { name: en.replan.confirm }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(applyCalls(fake, 'a2').map((c) => c.body)).toEqual([{ preview: false, basis: 'b1' }])
    expect(invalidated()).toContain(JSON.stringify(['tasks', 'user-a', 'e1']))
    expect(invalidated()).toContain(JSON.stringify(['plan', 'user-a']))

    expect(await screen.findByText(t.applied)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: en.common.undo }))
    await waitFor(() => {
      expect(fake.calls('POST', '/plan/undo').map((c) => c.body)).toEqual([{ version_id: 'v9' }])
    })
    expect(await screen.findByText(t.undone)).toBeInTheDocument()
  })

  it('a board that changed before the apply gets a fresh preview, which is shown', async () => {
    const second = applyFixture({
      basis: 'b2',
      added: [{ task_id: 'n9', title: 'חזרה כללית', kind: 'review', minutes: 45, reason: null }],
    })
    const fake = reanalyzeServer([fullPreview, second])
    let applies = 0
    fake.on('POST /analyses/a2/apply', (call: ApiCall) => {
      const body = call.body as { preview: boolean }
      if (body.preview) return previewCalls(fake, 'a2').length === 1 ? fullPreview : second
      return applies++ === 0 ? problem(409, 'stale_plan') : { ...second, version_id: 'v9' }
    })
    const { user } = setup(fake)
    await openSection(user)
    await user.click(screen.getByRole('button', { name: t.reanalyze }))
    const dialog = await screen.findByRole('dialog', { name: t.previewTitle })
    await within(dialog).findByText('תרגול אינטגרלים')

    await user.click(within(dialog).getByRole('button', { name: en.replan.confirm }))
    expect(await within(dialog).findByText('חזרה כללית')).toBeInTheDocument()
    expect(within(dialog).getByText(codeText('stale_plan'))).toBeInTheDocument()
    expect(previewCalls(fake, 'a2')).toHaveLength(2)

    await user.click(within(dialog).getByRole('button', { name: en.replan.confirm }))
    await waitFor(() => {
      expect(applyCalls(fake, 'a2').map((c) => c.body)).toEqual([
        { preview: false, basis: 'b1' },
        { preview: false, basis: 'b2' },
      ])
    })
  })

  it('a draft that is no longer current closes the dialog, says so, and refetches the topics', async () => {
    const fake = reanalyzeServer([problem(409, 'invalid_state')])
    const { user } = setup(fake)
    await openSection(user)
    await user.click(screen.getByRole('button', { name: t.reanalyze }))

    expect(await screen.findByText(t.draftGone)).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(fake.calls('GET', '/exams/e1/topics').length).toBeGreaterThan(1)
    })
  })

  it('a draft waiting from before opens from its banner, and closing it writes nothing', async () => {
    const fake = server({ aiTasks: true, draft: 'a3' }).on('POST /analyses/a3/apply', fullPreview)
    const { user } = setup(fake)

    // A waiting draft opens the section by itself, and its button is the primary one.
    expect(await screen.findByText(t.draftWaiting)).toBeVisible()
    expect(await trigger()).toHaveAttribute('aria-expanded', 'true')
    expect(within(await trigger()).getByText(t.summaryDraft)).toBeVisible()
    const show = screen.getByRole('button', { name: t.showDraft })
    await user.click(show)
    const dialog = await screen.findByRole('dialog', { name: t.previewTitle })
    // "אישור" waits for the preview.
    expect(await within(dialog).findByText(t.replaced(2))).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: en.replan.confirm })).toBeEnabled()
    expect(previewCalls(fake, 'a3')).toHaveLength(1)

    await user.click(within(dialog).getByRole('button', { name: en.replan.notNow }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(applyCalls(fake, 'a3')).toHaveLength(0)
    // The draft stays: the banner can open it again, the focus is back on it, and a second opening
    // previews anew.
    expect(screen.getByRole('button', { name: t.showDraft })).toBeInTheDocument()
    await waitFor(() => {
      expect(show).toHaveFocus()
    })
    await user.click(show)
    await within(await screen.findByRole('dialog', { name: t.previewTitle })).findByText(t.replaced(2))
    expect(previewCalls(fake, 'a3')).toHaveLength(2)
    expect(applyCalls(fake, 'a3')).toHaveLength(0)
  })

  it('a preview that failed to load says so and loads again on retry', async () => {
    let n = 0
    const fake = server({ aiTasks: true, draft: 'a3' }).on('POST /analyses/a3/apply', () =>
      n++ === 0 ? problem(500, 'internal_error') : fullPreview,
    )
    const { user } = setup(fake)
    await user.click(await screen.findByRole('button', { name: t.showDraft }))
    const dialog = await screen.findByRole('dialog', { name: t.previewTitle })
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: en.replan.confirm })).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: en.common.retry }))
    expect(await within(dialog).findByText(t.replaced(2))).toBeInTheDocument()
    expect(previewCalls(fake, 'a3')).toHaveLength(2)
  })

  it('a failed reanalysis shows its code and runs again on retry', async () => {
    const fake = server({ aiTasks: true })
      .on('POST /exams/e1/reanalyze', { job_id: 'j2', created: true })
      .on('GET /jobs/j2', reanalyzeJob({ status: 'failed', error: 'analysis_invalid' }))
    const { user } = setup(fake)
    await openSection(user)
    await user.click(screen.getByRole('button', { name: t.reanalyze }))
    expect(await screen.findByText(codeText('analysis_invalid'))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: en.common.retry }))
    await waitFor(() => {
      expect(fake.calls('POST', '/exams/e1/reanalyze')).toHaveLength(2)
    })
  })
})

// Review Focus 3: a closed section never hides something the user has to act on.
describe('AnalysisSection, closed and open', () => {
  it('an exam that has its plan and nothing pending keeps the section closed, without a summary', async () => {
    const fake = server({ aiTasks: true })
    const { user } = setup(fake)
    const button = await trigger()
    await screen.findByText(t.reanalyzeIntro)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveAccessibleName(t.title)
    expect(screen.queryByRole('button', { name: t.reanalyze })).not.toBeInTheDocument()

    await user.click(button)
    expect(screen.getByRole('button', { name: t.reanalyze })).toBeVisible()
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(fake.calls('POST', '/exams/e1/reanalyze')).toHaveLength(0)
  })

  it('a reanalysis that failed while the user was away opens the section with the failure', async () => {
    sessionStorage.setItem(JOB_KEY, JSON.stringify({ jobId: 'j2', kind: 'reanalyze' }))
    const fake = server({ aiTasks: true }).on('GET /jobs/j2', reanalyzeJob({ status: 'failed', error: 'analysis_invalid' }))
    setup(fake)
    expect(await screen.findByText(codeText('analysis_invalid'))).toBeVisible()
    expect(await trigger()).toHaveAttribute('aria-expanded', 'true')
    expect(within(await trigger()).getByText(t.summaryFailed)).toBeVisible()
    expect(screen.getByRole('alert', { name: t.failedTitle })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.common.retry })).toBeVisible()
  })

  it('a section the user closed while the job ran opens again when the job fails', async () => {
    sessionStorage.setItem(JOB_KEY, JSON.stringify({ jobId: 'j2', kind: 'reanalyze' }))
    let failed = false
    const fake = server({ aiTasks: true }).on('GET /jobs/j2', () =>
      failed ? reanalyzeJob({ status: 'failed', error: 'analysis_invalid' }) : reanalyzeJob({ stage: 'analyzing', percent: 30 }),
    )
    const { user } = setup(fake)
    // A running job opens the section, and the heading says so.
    expect(await screen.findByText(en.building.stages.analyzing)).toBeVisible()
    const button = await trigger()
    expect(within(button).getByText(t.summaryRunning)).toBeVisible()

    // The user's choice wins while nothing new happens.
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')

    failed = true
    await waitFor(() => {
      expect(button).toHaveAttribute('aria-expanded', 'true')
    }, POLL)
    expect(screen.getByText(codeText('analysis_invalid'))).toBeVisible()
  })

  it('a draft that arrives after the user closed the section opens it again', async () => {
    let draft: string | null = null
    const fake = server({ aiTasks: true }).on('GET /exams/e1/topics', () => topicsFixture({ draft_analysis_id: draft }))
    const { user, queryClient } = setup(fake)
    const button = await trigger()
    await screen.findByText(t.reanalyzeIntro)
    await user.click(button)
    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')

    draft = 'a3'
    await queryClient.invalidateQueries({ queryKey: ['topics', 'user-a', 'e1'] })
    await waitFor(() => {
      expect(button).toHaveAttribute('aria-expanded', 'true')
    })
    expect(screen.getByRole('button', { name: t.showDraft })).toBeVisible()
    expect(fake.calls('POST', '/analyses/a3/apply')).toHaveLength(0)
  })

  it('tasks that failed to load open the section with the error and a retry', async () => {
    const fake = server().on('GET /exams/e1/tasks', problem(500, 'internal_error'))
    setup(fake)
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(await trigger(t.buildTitle)).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: en.common.retry })).toBeVisible()
  })
})
