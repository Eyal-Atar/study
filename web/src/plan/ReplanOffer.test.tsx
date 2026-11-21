import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { StrictMode, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../app/AppProviders'
import { codeText, shortfallText, unscheduledText } from '../i18n/codes'
import { en } from '../i18n/en'
import { COMPLETED_AT, examFixture, meFixture, previewFixture } from '../onboarding/testFixtures'
import type { Block, ReplanPreview } from '../onboarding/types'
import { createFakeApi, problem, type ApiCall, type FakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { createFakeStorage } from '../test/fakeStorage'
import { ToastRegion } from '../ui/toast'
import { ReplanOffer, ReplanOfferProvider } from './ReplanOffer'
import { useReplanOffer } from './replanOfferContext'

const auth = createFakeAuth(fakeSession()).client
const storage = createFakeStorage().client

function tree(fake: FakeApi, children: ReactNode, queryClient: QueryClient) {
  return (
    <StrictMode>
      <AppProviders auth={auth} api={fake.api} storage={storage} queryClient={queryClient}>
        {children}
        <ToastRegion />
      </AppProviders>
    </StrictMode>
  )
}

function wrap(fake: FakeApi, children: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(tree(fake, children, queryClient))
  return {
    ...view,
    // Renders other children in the same providers (the same query client).
    show: (next: ReactNode) => {
      view.rerender(tree(fake, next, queryClient))
    },
  }
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

    const dialog = await screen.findByRole('dialog', { name: en.replan.title })
    expect(within(dialog).getByText('סיבה')).toBeInTheDocument()
    expect(dialog).toHaveAccessibleDescription('סיבה')
    expect(await within(dialog).findByText(en.replan.added(2))).toBeInTheDocument()
    expect(within(dialog).getByText(en.replan.removed(1))).toBeInTheDocument()
    expect(within(dialog).getByText(en.replan.unscheduledGroup(2, unscheduledText('not_enough_time')))).toBeInTheDocument()
    expect(within(dialog).getByText(en.replan.unscheduledGroup(1, unscheduledText('dependency_cycle')))).toBeInTheDocument()
    expect(await within(dialog).findByText(shortfallText('חדו"א', 240, 300))).toBeInTheDocument()
    expect(within(dialog).getByText(codeText('under_budget'))).toBeInTheDocument()
    // StrictMode runs the effect twice; the preview is sent once.
    expect(previewCalls(fake)).toHaveLength(1)
  })

  it('says so when nothing would change, and offers only to close', async () => {
    const user = userEvent.setup()
    const fake = server([previewFixture({ changed: false })])
    fake.on('GET /me', meFixture({ onboarding_completed_at: COMPLETED_AT }))
    const onClose = vi.fn()
    wrap(fake, <ReplanOffer isOpen onClose={onClose} />)
    expect(await screen.findByText(en.replan.noChange)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.replan.confirm })).not.toBeInTheDocument()
    // One "סגירה" (the dialog's own); the button under the text has another name.
    await user.click(screen.getByRole('button', { name: en.common.close }))
    expect(onClose).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: en.replan.understood }))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: en.replan.notNow })).not.toBeInTheDocument()
    expect(fake.calls('POST', '/plan/replan')).toHaveLength(1)
  })

  it('during the onboarding, an empty board says there is nothing to schedule yet, without "Confirm"', async () => {
    const fake = server([previewFixture({ changed: false })])
    fake.on('GET /me', meFixture({ onboarding_completed_at: null }))
    wrap(fake, <ReplanOffer isOpen onClose={vi.fn()} />)
    expect(await screen.findByText(en.replan.nothingToSchedule)).toBeInTheDocument()
    expect(screen.queryByText(en.replan.noChange)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.replan.confirm })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.common.close })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.replan.understood })).toBeInTheDocument()
  })

  it('a board with unscheduled tasks still offers "Confirm" although nothing is placed', async () => {
    const fake = server([
      previewFixture({ changed: false, unscheduled: [{ task_id: 't7', minutes: 60, reason: 'not_enough_time', blocked_by: null }] }),
    ])
    wrap(fake, <ReplanOffer isOpen onClose={vi.fn()} />)
    expect(await screen.findByRole('button', { name: en.replan.confirm })).toBeEnabled()
  })

  it('"Confirm" applies with the basis of the preview, then closes', async () => {
    const user = userEvent.setup()
    const fake = server()
    const onClose = vi.fn()
    const onApplied = vi.fn()
    wrap(fake, <ReplanOffer isOpen onClose={onClose} onApplied={onApplied} />)

    await screen.findByText(en.replan.added(2))
    await user.click(screen.getByRole('button', { name: en.replan.confirm }))

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
    expect(onApplied).toHaveBeenCalledOnce()
    expect(fake.calls('POST', '/plan/replan').at(-1)?.body).toEqual({ preview: false, basis: 'b1' })
    expect(await screen.findByText(en.replan.applied)).toBeInTheDocument()
  })

  it('"Calendar updated" shows also when the offer is gone before the apply answers', async () => {
    const user = userEvent.setup()
    const fake = server()
    let answer: (value: unknown) => void = () => undefined
    fake.on('POST /plan/replan', (call: ApiCall) => {
      const body = call.body as { preview: boolean }
      if (body.preview) return preview
      return new Promise((resolve) => {
        answer = resolve
      })
    })
    const onApplied = vi.fn()
    const view = wrap(fake, <ReplanOffer isOpen onClose={vi.fn()} onApplied={onApplied} />)

    await screen.findByText(en.replan.added(2))
    await user.click(screen.getByRole('button', { name: en.replan.confirm }))
    await waitFor(() => {
      expect(fake.calls('POST', '/plan/replan')).toHaveLength(2)
    })
    // The screen behind it navigated away (the gate saw the onboarding end).
    view.show(null)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    answer({ ...preview, version_id: 'v2' })
    expect(await screen.findByText(en.replan.applied)).toBeInTheDocument()
  })

  it('stale_plan runs a new preview, and the next "Confirm" sends its basis', async () => {
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

    await screen.findByText(en.replan.added(2))
    await user.click(screen.getByRole('button', { name: en.replan.confirm }))
    expect(await screen.findByText(codeText('stale_plan'))).toBeInTheDocument()
    await waitFor(() => {
      expect(previewCalls(fake)).toHaveLength(2)
    })
    expect(onClose).not.toHaveBeenCalled()

    await user.click(await screen.findByRole('button', { name: en.replan.confirm }))
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
    expect(fake.calls('POST', '/plan/replan').at(-1)?.body).toEqual({ preview: false, basis: 'b2' })
  })

  it('"Not now" closes without applying', async () => {
    const user = userEvent.setup()
    const fake = server()
    const onClose = vi.fn()
    wrap(fake, <ReplanOffer isOpen onClose={onClose} />)

    await screen.findByText(en.replan.added(2))
    await user.click(screen.getByRole('button', { name: en.replan.notNow }))
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
    expect(screen.getByRole('button', { name: en.replan.confirm })).toBeDisabled()
    fail = false
    await user.click(screen.getByRole('button', { name: en.common.retry }))
    expect(await screen.findByText(en.replan.added(2))).toBeInTheDocument()
  })
})

describe('ReplanOffer as a dialog', () => {
  it('says it is computing while the preview is on its way, with "Confirm" disabled', async () => {
    const fake = server()
    fake.on('POST /plan/replan', () => new Promise(() => undefined))
    wrap(fake, <ReplanOffer isOpen onClose={vi.fn()} />)
    const dialog = within(await screen.findByRole('dialog', { name: en.replan.title }))
    expect(dialog.getByRole('status')).toHaveTextContent(en.replan.loading)
    expect(dialog.getByRole('button', { name: en.replan.confirm })).toBeDisabled()
    expect(dialog.getByRole('button', { name: en.replan.notNow })).toBeEnabled()
  })

  it('"Confirm" shows that it is on its way and is sent once', async () => {
    const user = userEvent.setup()
    const fake = server()
    fake.on('POST /plan/replan', (call: ApiCall) => ((call.body as { preview: boolean }).preview ? preview : new Promise(() => undefined)))
    wrap(fake, <ReplanOffer isOpen onClose={vi.fn()} />)
    await screen.findByText(en.replan.added(2))
    const confirm = screen.getByRole('button', { name: en.replan.confirm })
    await user.click(confirm)
    await waitFor(() => {
      expect(confirm).toHaveAttribute('data-pending')
    })
    await user.click(confirm)
    expect(fake.calls('POST', '/plan/replan')).toHaveLength(2)
  })

  it('a failed apply says why under the summary, and "Confirm" can be pressed again', async () => {
    const user = userEvent.setup()
    const fake = server()
    const failure = problem(503, 'database_unavailable')
    fake.on('POST /plan/replan', (call: ApiCall) => ((call.body as { preview: boolean }).preview ? preview : failure))
    const onClose = vi.fn()
    wrap(fake, <ReplanOffer isOpen onClose={onClose} />)
    await screen.findByText(en.replan.added(2))
    await user.click(screen.getByRole('button', { name: en.replan.confirm }))
    expect(await screen.findByRole('alert')).toHaveTextContent(codeText('database_unavailable'))
    expect(screen.getByText(en.replan.added(2))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.replan.confirm })).toBeEnabled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('the close button and Escape close without applying', async () => {
    const user = userEvent.setup()
    const fake = server()
    const onClose = vi.fn()
    wrap(fake, <ReplanOffer isOpen onClose={onClose} />)
    await screen.findByText(en.replan.added(2))
    await user.click(screen.getByRole('button', { name: en.common.close }))
    expect(onClose).toHaveBeenCalledOnce()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(fake.calls('POST', '/plan/replan')).toHaveLength(1)
  })

  it('each opening previews anew', async () => {
    const fake = server()
    const view = wrap(fake, <ReplanOffer isOpen onClose={vi.fn()} />)
    await screen.findByText(en.replan.added(2))
    view.show(<ReplanOffer isOpen={false} onClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(previewCalls(fake)).toHaveLength(1)
    view.show(<ReplanOffer isOpen onClose={vi.fn()} />)
    expect(await screen.findByText(en.replan.added(2))).toBeInTheDocument()
    expect(previewCalls(fake)).toHaveLength(2)
  })

  it('what did not fit is a note with its title, and the stale-plan remark is a status', async () => {
    const user = userEvent.setup()
    const fake = server()
    let applies = 0
    fake.on('POST /plan/replan', (call: ApiCall) => {
      if ((call.body as { preview: boolean }).preview) return preview
      applies += 1
      return applies === 1 ? problem(409, 'stale_plan') : { ...preview, version_id: 'v2' }
    })
    wrap(fake, <ReplanOffer isOpen onClose={vi.fn()} />)
    await screen.findByText(en.replan.added(2))
    const note = screen.getByText(en.replan.unscheduledTitle).closest('.rounded-control')
    expect(note).toHaveClass('bg-warning-soft')
    expect(note).toHaveTextContent(unscheduledText('dependency_cycle'))
    expect(note?.querySelector('.text-ink-muted')).toBeNull()

    await user.click(screen.getByRole('button', { name: en.replan.confirm }))
    const remark = await screen.findByText(codeText('stale_plan'))
    expect(remark.closest('[role="status"]')).toHaveClass('bg-warning-soft')
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
    const dialog = await screen.findByRole('dialog', { name: en.replan.title })
    expect(within(dialog).getByText('סיבה מהמסך')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: en.replan.notNow }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
