import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../app/AppProviders'
import type { TimetableApply, TimetableProposal } from '../availability/types'
import { codeText, resetTime } from '../i18n/codes'
import { en } from '../i18n/en'
import { createFakeApi, problem, type FakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { createFakeStorage, type FakeStorage } from '../test/fakeStorage'
import { downscaleImage, MAX_TIMETABLE_IMAGE_BYTES } from './downscale'
import { MAX_TIMETABLE_PDF_BYTES } from './timetableUpload'
import { TimetableImport } from './TimetableImport'

// downscaleImage stays the real one; the spy only tells whether a file went through it.
vi.mock('./downscale', async (original) => {
  const actual = await original<typeof import('./downscale')>()
  return { ...actual, downscaleImage: vi.fn(actual.downscaleImage) }
})

// The dialog of Task 6 is tested on its own; here it is a stand-in that hands back one draft: the
// lecture moved to 10:15 and to Thursday too.
vi.mock('./CommitmentDialog', () => ({
  CommitmentDialog: ({
    isOpen,
    group,
    mode,
    onDraft,
    onOpenChange,
  }: {
    isOpen: boolean
    group: { title: string } | null
    mode?: string
    onDraft?: (draft: unknown) => void
    onOpenChange: (open: boolean) => void
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={group?.title ?? ''} data-mode={mode}>
        <button
          type="button"
          onClick={() => {
            onDraft?.({
              title: 'הרצאה: אלגוריתמים',
              kind: 'class',
              weekday: 3,
              weekdays: [3, 4],
              start_time: '10:15',
              end_time: '12:00',
              valid_from: '',
              valid_until: null,
            })
            onOpenChange(false)
          }}
        >
          Save draft
        </button>
      </div>
    ) : null,
}))

const t = en.commitments.timetable
const day = en.commitments.weekdayShort

const PROPOSALS: TimetableProposal[] = [
  { title: 'הרצאה: אלגוריתמים', kind: 'class', weekday: 3, start: '10:00', end: '12:00' },
  { title: 'תרגול: הסתברות', kind: 'class', weekday: 4, start: '16:00', end: '18:00' },
  { title: 'עבודה', kind: 'work', weekday: 1, start: '14:00', end: '17:00' },
]

const LECTURE_WHEN = `${day[3]}, 10:00–12:00`
const PRACTICE_WHEN = `${day[4]}, 16:00–18:00`
const WORK_WHEN = `${day[1]}, 14:00–17:00`

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

function setup({
  fake,
  storage = createFakeStorage(),
  applyAccept = true,
  buttonVariant,
}: {
  fake: FakeApi
  storage?: FakeStorage
  applyAccept?: boolean
  buttonVariant?: 'onboarding' | 'row'
}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const auth = createFakeAuth(fakeSession({ id: 'user-a' }))
  const onApplied = vi.fn()
  render(
    <StrictMode>
      <AppProviders auth={auth.client} api={fake.api} storage={storage.client} queryClient={queryClient}>
        <TimetableImport onApplied={onApplied} {...(buttonVariant ? { buttonVariant } : {})} />
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

function png(size: number): File {
  return new File([new Uint8Array(size)], 'צילום מסך.png', { type: 'image/png' })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TimetableImport', () => {
  it('offers the upload for a photo or a PDF', () => {
    setup({ fake: server() })

    expect(screen.getByRole('button', { name: t.upload })).toBeInTheDocument()
    expect(fileInput()).toHaveAttribute('accept', expect.stringContaining('image/jpeg') as string)
    expect(fileInput().getAttribute('accept')).toContain('application/pdf')
  })

  it('in a settings row, offers to update from a photo', () => {
    setup({ fake: server(), buttonVariant: 'row' })

    const row = screen.getByRole('button', { name: t.uploadRow })
    expect(row.className).toContain('text-brand-strong')
    expect(row.className).toContain('min-h-touch')
  })

  it('uploads, reads, and applies only the approved proposals', async () => {
    const fake = server()
    const { user, storage, onApplied } = setup({ fake })

    const file = pdf()
    await user.upload(fileInput(), file)

    expect(await screen.findByText(t.found(3))).toBeInTheDocument()
    const [path, body, options] = storage.upload.mock.calls[0] ?? []
    expect(path).toMatch(/^user-a\/timetables\/[0-9a-f-]{36}$/)
    // A PDF goes up as it is: never redrawn.
    expect(body).toBe(file)
    expect(vi.mocked(downscaleImage)).not.toHaveBeenCalled()
    expect(options).toEqual({ contentType: 'application/pdf', upsert: false })
    expect(fake.calls('POST', '/timetables')[0]?.body).toEqual({ id: String(path).split('/')[2], mime: 'application/pdf', size_bytes: 2000 })

    // Each proposal: its title, day and hours, approved from the start.
    expect(screen.getByText('תרגול: הסתברות')).toHaveAttribute('dir', 'auto')
    expect(screen.getByText(LECTURE_WHEN)).toBeInTheDocument()
    const practice = screen.getByRole('button', { name: t.approve('תרגול: הסתברות', PRACTICE_WHEN) })
    expect(practice).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: t.edit('עבודה', WORK_WHEN) })).toHaveTextContent(t.editLabel)
    expect(screen.getByRole('group', { name: en.commitments.dialog.validUntil })).toBeInTheDocument()

    await user.click(practice)
    expect(practice).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByRole('button', { name: t.addThem }))

    await waitFor(() => {
      expect(onApplied).toHaveBeenCalledOnce()
    })
    const sent = fake.calls('POST', '/timetables/j1/apply')[0]?.body as TimetableApply
    expect(sent.items).toEqual([
      { title: 'הרצאה: אלגוריתמים', kind: 'class', weekday: 3, start_time: '10:00', end_time: '12:00' },
      { title: 'עבודה', kind: 'work', weekday: 1, start_time: '14:00', end_time: '17:00' },
    ])
    expect(sent).not.toHaveProperty('valid_until')
    expect(onApplied.mock.calls[0]?.[0]).toMatchObject({ plan_affected: true })
    // Back to the button, for a later photo.
    expect(screen.getByRole('button', { name: t.upload })).toBeInTheDocument()
  })

  it('shows one row for a proposal that repeats on several days', async () => {
    const fake = server(
      job({
        result: {
          commitments: [
            { title: 'עבודה', kind: 'work', weekday: 0, start: '14:00', end: '17:00' },
            { title: 'עבודה', kind: 'work', weekday: 2, start: '14:00', end: '17:00' },
          ],
          model: 'claude',
        },
      }),
    )
    const { user } = setup({ fake })
    await user.upload(fileInput(), pdf())

    expect(await screen.findByText(t.found(1))).toBeInTheDocument()
    expect(t.found(1)).toBe('I found 1 busy time in your photo. Should I add it?')
    expect(screen.getByText(`${day[0]}, ${day[2]}, 14:00–17:00`)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t.addIt }))

    await waitFor(() => {
      expect(fake.calls('POST', '/timetables/j1/apply')).toHaveLength(1)
    })
    const sent = fake.calls('POST', '/timetables/j1/apply')[0]?.body as TimetableApply
    expect(sent.items.map((item) => item.weekday)).toEqual([0, 2])
  })

  it('sends the date the busy times end, when one is given', async () => {
    const fake = server()
    const { user } = setup({ fake })
    await user.upload(fileInput(), pdf())
    await screen.findByText(t.found(3))

    const field = screen.getByRole('group', { name: en.commitments.dialog.validUntil })
    const [dayPart] = field.querySelectorAll<HTMLElement>('[role="spinbutton"]')
    if (dayPart === undefined) throw new Error('no date segments')
    await user.click(dayPart)
    await user.keyboard('31012027')
    await user.click(screen.getByRole('button', { name: t.addThem }))

    await waitFor(() => {
      expect(fake.calls('POST', '/timetables/j1/apply')).toHaveLength(1)
    })
    expect(fake.calls('POST', '/timetables/j1/apply')[0]?.body).toMatchObject({ valid_until: '2027-01-31' })
  })

  it('shows Archie reading while the job runs', async () => {
    const { user } = setup({ fake: server(job({ status: 'running', result: null })) })

    await user.upload(fileInput(), pdf())

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(t.reading)
    })
    expect(screen.queryByRole('button', { name: t.upload })).not.toBeInTheDocument()
  })

  it('says it is preparing the photo while it uploads', async () => {
    const storage = createFakeStorage()
    storage.upload.mockImplementation(() => new Promise(() => undefined))
    const { user } = setup({ fake: server(), storage })

    await user.upload(fileInput(), pdf())

    expect(await screen.findByRole('status')).toHaveTextContent(t.preparing)
  })

  it('edits a proposal in the dialog, without saving it there', async () => {
    const fake = server()
    const { user } = setup({ fake })
    await user.upload(fileInput(), pdf())

    await user.click(await screen.findByRole('button', { name: t.edit('הרצאה: אלגוריתמים', LECTURE_WHEN) }))
    expect(screen.getByRole('dialog')).toHaveAttribute('data-mode', 'draft')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    // Still three busy times: the lecture is now one row on two days.
    expect(screen.getByText(t.found(3))).toBeInTheDocument()
    expect(screen.getByText(`${day[3]}, ${day[4]}, 10:15–12:00`)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t.addThem }))

    await waitFor(() => {
      expect(fake.calls('POST', '/timetables/j1/apply')).toHaveLength(1)
    })
    const sent = fake.calls('POST', '/timetables/j1/apply')[0]?.body as TimetableApply
    expect(sent.items.filter((item) => item.title === 'הרצאה: אלגוריתמים')).toEqual([
      { title: 'הרצאה: אלגוריתמים', kind: 'class', weekday: 3, start_time: '10:15', end_time: '12:00' },
      { title: 'הרצאה: אלגוריתמים', kind: 'class', weekday: 4, start_time: '10:15', end_time: '12:00' },
    ])
    expect(sent.items).toHaveLength(4)
    expect(fake.calls('POST', '/commitments')).toEqual([])
  })

  it('does not apply when nothing is approved', async () => {
    const fake = server(job({ result: { commitments: PROPOSALS.slice(0, 1), model: 'claude' } }))
    const { user } = setup({ fake })
    await user.upload(fileInput(), pdf())

    await user.click(await screen.findByRole('button', { name: t.approve('הרצאה: אלגוריתמים', LECTURE_WHEN) }))
    await user.click(screen.getByRole('button', { name: t.addIt }))

    expect(await screen.findByText(t.noneChosen)).toBeInTheDocument()
    expect(fake.calls('POST', '/timetables/j1/apply')).toEqual([])
  })

  it('goes back to the button on Not now, without a request', async () => {
    const fake = server()
    const { user } = setup({ fake })
    await user.upload(fileInput(), pdf())

    await user.click(await screen.findByRole('button', { name: t.notNow }))

    expect(screen.getByRole('button', { name: t.upload })).toBeInTheDocument()
    expect(fake.calls('POST', '/timetables/j1/apply')).toEqual([])
  })

  it('explains a failed job by its code and points to marking by hand', async () => {
    const { user } = setup({ fake: server(job({ status: 'failed', error: 'timetable_unreadable', result: null })) })

    await user.upload(fileInput(), pdf())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(codeText('timetable_unreadable'))
    expect(alert).toHaveTextContent(t.manual)
    // Another photo can be tried at once.
    expect(screen.getByRole('button', { name: t.upload })).toBeInTheDocument()
  })

  it('treats a done job without proposals as nothing found', async () => {
    const { user } = setup({ fake: server(job({ result: { commitments: [], model: 'claude' } })) })

    await user.upload(fileInput(), pdf())

    expect(await screen.findByText(t.empty)).toBeInTheDocument()
    expect(screen.getByText(t.manual)).toBeInTheDocument()
  })

  it('shows the daily quota of photos on a 429', async () => {
    const details = { limit: 5, resets_at: '2099-01-01T22:00:00Z' }
    const fake = server().on('POST /timetables', problem(429, 'ai_quota_exceeded', details))
    const { user } = setup({ fake })

    await user.upload(fileInput(), pdf())

    expect(await screen.findByText(t.quota(5, resetTime(details, new Date())))).toBeInTheDocument()
    expect(t.quota(5, null)).toContain('5 timetable photos')
    expect(screen.getByText(t.manual)).toBeInTheDocument()
  })

  it('refuses a HEIC photo with a clear message and no request', async () => {
    const fake = server()
    const { user, storage } = setup({ fake, applyAccept: false })

    await user.upload(fileInput(), new File([new Uint8Array(10)], 'IMG_0001.heic', { type: 'image/heic' }))

    expect(await screen.findByText(codeText('unsupported_file'))).toBeInTheDocument()
    expect(screen.getByText(t.manual)).toBeInTheDocument()
    expect(storage.upload).not.toHaveBeenCalled()
    expect(fake.calls()).toEqual([])
  })

  it('refuses a PDF over 20 MB with no request', async () => {
    const fake = server()
    const { user, storage } = setup({ fake })

    await user.upload(fileInput(), pdf(MAX_TIMETABLE_PDF_BYTES + 1))

    expect(await screen.findByText(/20 MB/)).toBeInTheDocument()
    expect(storage.upload).not.toHaveBeenCalled()
    expect(fake.calls()).toEqual([])
  })

  it('refuses a photo that stays too large even made smaller, with no request', async () => {
    // A browser that cannot draw the photo: it goes as it is only within the limit.
    vi.stubGlobal('createImageBitmap', undefined)
    const fake = server()
    const { user, storage } = setup({ fake })

    await user.upload(fileInput(), png(MAX_TIMETABLE_IMAGE_BYTES + 1))

    expect(await screen.findByText(t.photoTooLarge)).toBeInTheDocument()
    expect(screen.getByText(t.manual)).toBeInTheDocument()
    expect(storage.upload).not.toHaveBeenCalled()
    expect(fake.calls()).toEqual([])
  })

  it('refuses a photo the browser cannot open, with no request', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.reject(new Error('broken'))))
    const fake = server()
    const { user, storage } = setup({ fake })

    await user.upload(fileInput(), png(1000))

    expect(await screen.findByText(t.photoUnreadable)).toBeInTheDocument()
    expect(storage.upload).not.toHaveBeenCalled()
    expect(fake.calls()).toEqual([])
  })

  it('shows an apply that was already made, keeps the proposals, and does not send it again', async () => {
    const fake = server().on('POST /timetables/j1/apply', problem(409, 'already_applied'))
    const { user, onApplied } = setup({ fake })
    await user.upload(fileInput(), pdf())

    await user.click(await screen.findByRole('button', { name: t.addThem }))

    expect(await screen.findByText(codeText('already_applied'))).toBeInTheDocument()
    expect(screen.getByText(t.found(3))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t.addThem }))
    expect(fake.calls('POST', '/timetables/j1/apply')).toHaveLength(1)
    expect(onApplied).not.toHaveBeenCalled()
  })

  it('appears only inside motion-safe, so reduced motion has no animation', async () => {
    const { user } = setup({ fake: server() })
    await user.upload(fileInput(), pdf())
    await screen.findByText(t.found(3))

    const animated = [...document.body.querySelectorAll('[data-timetable-motion]')]
    expect(animated.length).toBeGreaterThan(0)
    for (const element of animated) {
      const motion = [...element.classList].filter((c) => /transition|duration|ease|starting|animate/.test(c))
      expect(motion.length).toBeGreaterThan(0)
      for (const c of motion) expect(c.startsWith('motion-safe:')).toBe(true)
    }
  })
})
