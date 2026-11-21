import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../app/AppProviders'
import type { TimetableApply, TimetableProposal } from '../availability/types'
import { he } from '../i18n/he'
import { createFakeApi, problem, type FakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { createFakeStorage, type FakeStorage } from '../test/fakeStorage'
import { TimetableImport } from './TimetableImport'

// The dialog of Task 3 is tested on its own; here it is a stand-in that hands back one draft: the
// lecture moved to 10:15 and to Thursday too.
vi.mock('./CommitmentDialog', () => ({
  CommitmentDialog: ({
    isOpen,
    group,
    onDraft,
    onOpenChange,
  }: {
    isOpen: boolean
    group: { title: string } | null
    onDraft?: (draft: unknown) => void
    onOpenChange: (open: boolean) => void
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={group?.title ?? ''}>
        <button
          type="button"
          onClick={() => {
            onDraft?.({ title: 'הרצאה: אלגוריתמים', kind: 'class', weekdays: [3, 4], start_time: '10:15', end_time: '12:00' })
            onOpenChange(false)
          }}
        >
          שמירת הטיוטה
        </button>
      </div>
    ) : null,
}))

const t = he.timetable

const PROPOSALS: TimetableProposal[] = [
  { title: 'הרצאה: אלגוריתמים', kind: 'class', weekday: 3, start: '10:00', end: '12:00' },
  { title: 'תרגול: הסתברות', kind: 'class', weekday: 4, start: '16:00', end: '18:00' },
  { title: 'עבודה', kind: 'work', weekday: 1, start: '14:00', end: '17:00' },
]

function job(overrides: Record<string, unknown>) {
  return {
    id: 'j1',
    kind: 'parse_timetable',
    status: 'done',
    stage: null,
    percent: null,
    error: null,
    result: { commitments: PROPOSALS, model: 'claude' },
    created_at: '2026-11-18T08:00:00Z',
    started_at: null,
    finished_at: null,
    ...overrides,
  }
}

function server(jobAnswer: unknown = job({})) {
  return createFakeApi()
    .on('POST /timetables', { job_id: 'j1' })
    .on('GET /jobs/j1', jobAnswer)
    .on('POST /timetables/j1/apply', (call: { body: unknown }) => ({
      commitments: (call.body as TimetableApply).items.map((item, i) => ({
        ...item,
        id: `c${String(i)}`,
        valid_from: '2026-11-18',
        valid_until: null,
        source_job_id: 'j1',
        created_at: '2026-11-18T08:00:00Z',
      })),
      plan_affected: true,
    }))
}

function setup({ fake, storage = createFakeStorage(), applyAccept = true }: { fake: FakeApi; storage?: FakeStorage; applyAccept?: boolean }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const auth = createFakeAuth(fakeSession({ id: 'user-a' }))
  const onApplied = vi.fn()
  render(
    <StrictMode>
      <AppProviders auth={auth.client} api={fake.api} storage={storage.client} queryClient={queryClient}>
        <TimetableImport onApplied={onApplied} />
      </AppProviders>
    </StrictMode>,
  )
  const user = userEvent.setup({ applyAccept })
  return { user, storage, onApplied }
}

function fileInput(): HTMLInputElement {
  const input = document.body.querySelector<HTMLInputElement>('input[type="file"]')
  if (input === null) throw new Error('no file input')
  return input
}

function pdf(size = 2000): File {
  return new File([new Uint8Array(size)], 'מערכת.pdf', { type: 'application/pdf' })
}

describe('TimetableImport', () => {
  it('offers the upload for a photo or a PDF', () => {
    setup({ fake: server() })

    expect(screen.getByRole('button', { name: t.upload })).toBeInTheDocument()
    expect(fileInput()).toHaveAttribute('accept', expect.stringContaining('image/jpeg') as string)
    expect(fileInput().getAttribute('accept')).toContain('application/pdf')
  })

  it('uploads, reads, and applies only the approved proposals', async () => {
    const fake = server()
    const { user, storage, onApplied } = setup({ fake })

    await user.upload(fileInput(), pdf())

    expect(await screen.findByText(t.found(3))).toBeInTheDocument()
    const [path, , options] = storage.upload.mock.calls[0] ?? []
    expect(path).toMatch(/^user-a\/timetables\/[0-9a-f-]{36}$/)
    expect(options).toEqual({ contentType: 'application/pdf', upsert: false })
    expect(fake.calls('POST', '/timetables')[0]?.body).toEqual({ id: String(path).split('/')[2], mime: 'application/pdf', size_bytes: 2000 })

    // Each proposal: its title, day and hours, approved from the start.
    expect(screen.getByText('רביעי, ⁦10:00–12:00⁩')).toBeInTheDocument()
    const practice = screen.getByRole('button', { name: t.approve('תרגול: הסתברות') })
    expect(practice).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: t.edit('עבודה') })).toBeInTheDocument()

    await user.click(practice)
    expect(practice).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByRole('button', { name: t.apply }))

    await waitFor(() => {
      expect(onApplied).toHaveBeenCalledOnce()
    })
    const body = fake.calls('POST', '/timetables/j1/apply')[0]?.body as TimetableApply
    expect(body.items).toEqual([
      { title: 'הרצאה: אלגוריתמים', kind: 'class', weekday: 3, start_time: '10:00', end_time: '12:00' },
      { title: 'עבודה', kind: 'work', weekday: 1, start_time: '14:00', end_time: '17:00' },
    ])
    expect(body).not.toHaveProperty('valid_until')
    expect(onApplied.mock.calls[0]?.[0]).toMatchObject({ plan_affected: true })
    // Back to the button, for a later photo.
    expect(screen.getByRole('button', { name: t.upload })).toBeInTheDocument()
  })

  it('shows Archie reading while the job runs', async () => {
    const { user } = setup({ fake: server(job({ status: 'running', result: null })) })

    await user.upload(fileInput(), pdf())

    expect(await screen.findByRole('status')).toHaveTextContent(t.reading)
  })

  it('applies an edited proposal as one item per day of the draft', async () => {
    const fake = server()
    const { user } = setup({ fake })
    await user.upload(fileInput(), pdf())

    await user.click(await screen.findByRole('button', { name: t.edit('הרצאה: אלגוריתמים') }))
    await user.click(screen.getByRole('button', { name: 'שמירת הטיוטה' }))

    expect(screen.getByText(t.found(4))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t.apply }))

    await waitFor(() => {
      expect(fake.calls('POST', '/timetables/j1/apply')).toHaveLength(1)
    })
    const body = fake.calls('POST', '/timetables/j1/apply')[0]?.body as TimetableApply
    expect(body.items.filter((item) => item.title === 'הרצאה: אלגוריתמים')).toEqual([
      { title: 'הרצאה: אלגוריתמים', kind: 'class', weekday: 3, start_time: '10:15', end_time: '12:00' },
      { title: 'הרצאה: אלגוריתמים', kind: 'class', weekday: 4, start_time: '10:15', end_time: '12:00' },
    ])
    expect(body.items).toHaveLength(4)
  })

  it('does not apply when nothing is approved', async () => {
    const fake = server(job({ result: { commitments: PROPOSALS.slice(0, 1), model: 'claude' } }))
    const { user } = setup({ fake })
    await user.upload(fileInput(), pdf())

    await user.click(await screen.findByRole('button', { name: t.approve('הרצאה: אלגוריתמים') }))
    await user.click(screen.getByRole('button', { name: t.apply }))

    expect(await screen.findByText(t.noneChosen)).toBeInTheDocument()
    expect(fake.calls('POST', '/timetables/j1/apply')).toEqual([])
  })

  it('cancels back to the button without a request', async () => {
    const fake = server()
    const { user } = setup({ fake })
    await user.upload(fileInput(), pdf())

    await user.click(await screen.findByRole('button', { name: t.cancel }))

    expect(screen.getByRole('button', { name: t.upload })).toBeInTheDocument()
    expect(fake.calls('POST', '/timetables/j1/apply')).toEqual([])
  })

  it('explains a failed job by its code and points to marking by hand', async () => {
    const { user } = setup({ fake: server(job({ status: 'failed', error: 'timetable_unreadable', result: null })) })

    await user.upload(fileInput(), pdf())

    expect(await screen.findByText(t.errors.timetable_unreadable)).toBeInTheDocument()
    expect(screen.getByText(t.manual)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.again })).toBeInTheDocument()
  })

  it('treats a done job without proposals as nothing found', async () => {
    const { user } = setup({ fake: server(job({ result: { commitments: [], model: 'claude' } })) })

    await user.upload(fileInput(), pdf())

    expect(await screen.findByText(t.errors.empty)).toBeInTheDocument()
    expect(screen.getByText(t.manual)).toBeInTheDocument()
  })

  it('shows the daily quota of photos on a 429', async () => {
    const fake = server().on(
      'POST /timetables',
      problem(429, 'ai_quota_exceeded', { limit: 5, resets_at: '2099-01-01T22:00:00Z' }),
    )
    const { user } = setup({ fake })

    await user.upload(fileInput(), pdf())

    expect(await screen.findByText(/5 צילומים/)).toBeInTheDocument()
    expect(screen.getByText(t.manual)).toBeInTheDocument()
  })

  it('refuses a HEIC photo with a clear message and no request', async () => {
    const fake = server()
    const { user, storage } = setup({ fake, applyAccept: false })

    await user.upload(fileInput(), new File([new Uint8Array(10)], 'IMG_0001.heic', { type: 'image/heic' }))

    expect(await screen.findByText(t.errors.unsupported_file)).toBeInTheDocument()
    expect(screen.getByText(t.manual)).toBeInTheDocument()
    expect(storage.upload).not.toHaveBeenCalled()
    expect(fake.calls()).toEqual([])
  })

  it('refuses a PDF over 20 MB with no request', async () => {
    const fake = server()
    const { user, storage } = setup({ fake })

    await user.upload(fileInput(), pdf(20 * 1024 * 1024 + 1))

    expect(await screen.findByText(/20 MB/)).toBeInTheDocument()
    expect(storage.upload).not.toHaveBeenCalled()
    expect(fake.calls()).toEqual([])
  })

  it('shows an apply failure and keeps the proposals', async () => {
    const fake = server().on('POST /timetables/j1/apply', problem(409, 'already_applied'))
    const { user, onApplied } = setup({ fake })
    await user.upload(fileInput(), pdf())

    await user.click(await screen.findByRole('button', { name: t.apply }))

    expect(await screen.findByText(t.errors.already_applied)).toBeInTheDocument()
    expect(screen.getByText(t.found(3))).toBeInTheDocument()
    expect(onApplied).not.toHaveBeenCalled()
  })
})
