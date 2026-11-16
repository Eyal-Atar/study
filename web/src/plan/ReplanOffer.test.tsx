import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { StrictMode, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../app/AppProviders'
import { codeText, shortfallText, unscheduledText } from '../i18n/codes'
import { he } from '../i18n/he'
import { examFixture, previewFixture } from '../onboarding/testFixtures'
import type { Block, ReplanPreview } from '../onboarding/types'
import { createFakeApi, problem, type ApiCall, type FakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { createFakeStorage } from '../test/fakeStorage'
import { ToastRegion } from '../ui/toast'
import { ReplanOffer, ReplanOfferProvider } from './ReplanOffer'
import { useReplanOffer } from './replanOfferContext'

function wrap(fake: FakeApi, children: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <StrictMode>
      <AppProviders auth={createFakeAuth(fakeSession()).client} api={fake.api} storage={createFakeStorage().client} queryClient={queryClient}>
        {children}
        <ToastRegion />
      </AppProviders>
    </StrictMode>,
  )
}

const added = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    task_id: `t${String(i)}`,
    starts_at: '2026-11-17T08:00:00Z',
    ends_at: '2026-11-17T09:00:00Z',
    part_index: 0,
    part_count: 1,
  }))

const preview: ReplanPreview = previewFixture({
  added: added(2),
  removed: [{ id: 'b9' } as Block],
  unscheduled: [
    { task_id: 't7', minutes: 60, reason: 'not_enough_time', blocked_by: null },
    { task_id: 't8', minutes: 30, reason: 'not_enough_time', blocked_by: null },
    { task_id: 't9', minutes: 30, reason: 'dependency_cycle', blocked_by: null },
  ],
  shortfalls: [{ exam_id: 'e1', minutes: 240, daily_minutes: 300 }],
  warnings: ['under_budget'],
})

function server(previews: ReplanPreview[] = [preview]) {
  let n = 0
  return createFakeApi()
    .on('GET /exams', [examFixture()])
    .on('POST /plan/replan', (call: ApiCall) => {
      const body = call.body as { preview: boolean }
      if (body.preview) return previews[Math.min(n++, previews.length - 1)]
      return { ...preview, version_id: 'v2' }
    })
}

function previewCalls(fake: FakeApi) {
  return fake.calls('POST', '/plan/replan').filter((c) => (c.body as { preview: boolean }).preview)
}

describe('ReplanOffer', () => {
  it('previews once on open and summarizes what would change', async () => {
    const fake = server()
    wrap(fake, <ReplanOffer isOpen onClose={vi.fn()} reasonText="סיבה" />)

    const dialog = await screen.findByRole('dialog', { name: he.replan.title })
    expect(within(dialog).getByText('סיבה')).toBeInTheDocument()
    expect(await within(dialog).findByText(he.replan.added(2))).toBeInTheDocument()
    expect(within(dialog).getByText(he.replan.removed(1))).toBeInTheDocument()
    expect(within(dialog).getByText(he.replan.unscheduledGroup(2, unscheduledText('not_enough_time')))).toBeInTheDocument()
    expect(within(dialog).getByText(he.replan.unscheduledGroup(1, unscheduledText('dependency_cycle')))).toBeInTheDocument()
    expect(await within(dialog).findByText(shortfallText('חדו"א', 240, 300))).toBeInTheDocument()
    expect(within(dialog).getByText(codeText('under_budget'))).toBeInTheDocument()
    // StrictMode runs the effect twice; the preview is sent once.
    expect(previewCalls(fake)).toHaveLength(1)
  })

  it('says so when nothing would change', async () => {
    const fake = server([previewFixture({ changed: false })])
    wrap(fake, <ReplanOffer isOpen onClose={vi.fn()} />)
    expect(await screen.findByText(he.replan.noChange)).toBeInTheDocument()
  })

  it('"אישור" applies with the basis of the preview, then closes', async () => {
    const user = userEvent.setup()
    const fake = server()
    const onClose = vi.fn()
    const onApplied = vi.fn()
    wrap(fake, <ReplanOffer isOpen onClose={onClose} onApplied={onApplied} />)

    await screen.findByText(he.replan.added(2))
    await user.click(screen.getByRole('button', { name: he.replan.confirm }))

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
    expect(onApplied).toHaveBeenCalledOnce()
    expect(fake.calls('POST', '/plan/replan').at(-1)?.body).toEqual({ preview: false, basis: 'b1' })
    expect(await screen.findByText(he.replan.applied)).toBeInTheDocument()
  })

  it('stale_plan runs a new preview, and the next "אישור" sends its basis', async () => {
    const user = userEvent.setup()
    const fake = server([preview, { ...preview, basis: 'b2' }])
    let applies = 0
    fake.on('POST /plan/replan', (call: ApiCall) => {
      const body = call.body as { preview: boolean }
      if (body.preview) return previewCalls(fake).length === 1 ? preview : { ...preview, basis: 'b2' }
      applies += 1
      return applies === 1 ? problem(409, 'stale_plan') : { ...preview, version_id: 'v2' }
    })
    const onClose = vi.fn()
    wrap(fake, <ReplanOffer isOpen onClose={onClose} />)

    await screen.findByText(he.replan.added(2))
    await user.click(screen.getByRole('button', { name: he.replan.confirm }))
    expect(await screen.findByText(codeText('stale_plan'))).toBeInTheDocument()
    await waitFor(() => {
      expect(previewCalls(fake)).toHaveLength(2)
    })
    expect(onClose).not.toHaveBeenCalled()

    await user.click(await screen.findByRole('button', { name: he.replan.confirm }))
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
    expect(fake.calls('POST', '/plan/replan').at(-1)?.body).toEqual({ preview: false, basis: 'b2' })
  })

  it('"לא עכשיו" closes without applying', async () => {
    const user = userEvent.setup()
    const fake = server()
    const onClose = vi.fn()
    wrap(fake, <ReplanOffer isOpen onClose={onClose} />)

    await screen.findByText(he.replan.added(2))
    await user.click(screen.getByRole('button', { name: he.replan.notNow }))
    expect(onClose).toHaveBeenCalled()
    expect(fake.calls('POST', '/plan/replan')).toHaveLength(1)
  })

  it('a failed preview shows the error and can be retried', async () => {
    const user = userEvent.setup()
    let fail = true
    const fake = server()
    fake.on('POST /plan/replan', () => (fail ? problem(503, 'database_unavailable') : preview))
    wrap(fake, <ReplanOffer isOpen onClose={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(codeText('database_unavailable'))
    expect(screen.getByRole('button', { name: he.replan.confirm })).toBeDisabled()
    fail = false
    await user.click(screen.getByRole('button', { name: he.common.retry }))
    expect(await screen.findByText(he.replan.added(2))).toBeInTheDocument()
  })
})

function Opener() {
  const { offer } = useReplanOffer()
  return (
    <button
      type="button"
      onClick={() => {
        offer('סיבה מהמסך')
      }}
    >
      open
    </button>
  )
}

describe('ReplanOfferProvider', () => {
  it('useReplanOffer().offer(reason) opens the dialog with the reason, and closing ends it', async () => {
    const user = userEvent.setup()
    const fake = server()
    wrap(
      fake,
      <ReplanOfferProvider>
        <Opener />
      </ReplanOfferProvider>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'open' }))
    const dialog = await screen.findByRole('dialog', { name: he.replan.title })
    expect(within(dialog).getByText('סיבה מהמסך')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: he.replan.notNow }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
