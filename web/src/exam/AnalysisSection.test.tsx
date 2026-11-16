import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../app/AppProviders'
import { codeText, shortfallText, unscheduledText } from '../i18n/codes'
import { he } from '../i18n/he'
import { COMPLETED_AT, examFixture, jobFixture, meFixture, previewFixture, resultFixture } from '../onboarding/testFixtures'
import { ReplanOfferProvider } from '../plan/ReplanOffer'
import { createFakeApi, problem, type ApiCall, type FakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { createFakeStorage } from '../test/fakeStorage'
import { ToastRegion } from '../ui/toast'
import { AnalysisSection } from './AnalysisSection'
import { applyFixture, reanalyzeJob, reanalyzeResult, taskItem, topicsFixture } from './analysisFixtures'
import type { AnalysisApply } from './analysis'

const t = he.exam.analysis
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
  return { user: userEvent.setup(), invalidated }
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

    expect(await screen.findByText(t.buildIntro)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.reanalyze })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t.build }))

    expect(await screen.findByText(he.building.stages.analyzing)).toBeInTheDocument()
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
    expect(await screen.findByRole('dialog', { name: he.replan.title })).toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: he.common.retry }))
    await waitFor(() => {
      expect(fake.calls('POST', '/plans/generate')).toHaveLength(2)
    })
  })

  it('a job remembered for this exam is followed again after a reload, without a new request', async () => {
    sessionStorage.setItem(JOB_KEY, JSON.stringify({ jobId: 'j1', kind: 'generate' }))
    const fake = server().on('GET /jobs/j1', jobFixture({ stage: 'planning', percent: 88 }))
    setup(fake)
    expect(await screen.findByText(he.building.stages.planning)).toBeInTheDocument()
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
      within(added).getByText(t.taskMeta(he.exam.tasks.kinds.practice, he.exam.tasks.minutes(90))),
    ).toBeInTheDocument()
    expect(within(dialog).getByText(he.replan.added(1))).toBeInTheDocument()
    expect(
      within(dialog).getByText(he.replan.unscheduledGroup(1, unscheduledText('no_contiguous_window'))),
    ).toBeInTheDocument()
    expect(await within(dialog).findByText(shortfallText('חדו"א', 120, 300))).toBeInTheDocument()
    expect(previewCalls(fake, 'a2')).toHaveLength(1)

    await user.click(within(dialog).getByRole('button', { name: he.replan.confirm }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(applyCalls(fake, 'a2').map((c) => c.body)).toEqual([{ preview: false, basis: 'b1' }])
    expect(invalidated()).toContain(JSON.stringify(['tasks', 'user-a', 'e1']))
    expect(invalidated()).toContain(JSON.stringify(['plan', 'user-a']))

    expect(await screen.findByText(t.applied)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: he.common.undo }))
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
    await user.click(await screen.findByRole('button', { name: t.reanalyze }))
    const dialog = await screen.findByRole('dialog', { name: t.previewTitle })
    await within(dialog).findByText('תרגול אינטגרלים')

    await user.click(within(dialog).getByRole('button', { name: he.replan.confirm }))
    expect(await within(dialog).findByText('חזרה כללית')).toBeInTheDocument()
    expect(within(dialog).getByText(codeText('stale_plan'))).toBeInTheDocument()
    expect(previewCalls(fake, 'a2')).toHaveLength(2)

    await user.click(within(dialog).getByRole('button', { name: he.replan.confirm }))
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
    await user.click(await screen.findByRole('button', { name: t.reanalyze }))

    expect(await screen.findByText(t.draftGone)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(fake.calls('GET', '/exams/e1/topics').length).toBeGreaterThan(1)
    })
  })

  it('a draft waiting from before opens from its banner, and closing it writes nothing', async () => {
    const fake = server({ aiTasks: true, draft: 'a3' }).on('POST /analyses/a3/apply', fullPreview)
    const { user } = setup(fake)

    expect(await screen.findByText(t.draftWaiting)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t.showDraft }))
    const dialog = await screen.findByRole('dialog', { name: t.previewTitle })
    expect(await within(dialog).findByText(t.replaced(2))).toBeInTheDocument()
    expect(previewCalls(fake, 'a3')).toHaveLength(1)

    await user.click(within(dialog).getByRole('button', { name: he.replan.notNow }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(applyCalls(fake, 'a3')).toHaveLength(0)
    // The draft stays: the banner can open it again.
    expect(screen.getByRole('button', { name: t.showDraft })).toBeInTheDocument()
  })

  it('a failed reanalysis shows its code and runs again on retry', async () => {
    const fake = server({ aiTasks: true })
      .on('POST /exams/e1/reanalyze', { job_id: 'j2', created: true })
      .on('GET /jobs/j2', reanalyzeJob({ status: 'failed', error: 'analysis_invalid' }))
    const { user } = setup(fake)
    await user.click(await screen.findByRole('button', { name: t.reanalyze }))
    expect(await screen.findByText(codeText('analysis_invalid'))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: he.common.retry }))
    await waitFor(() => {
      expect(fake.calls('POST', '/exams/e1/reanalyze')).toHaveLength(2)
    })
  })
})
