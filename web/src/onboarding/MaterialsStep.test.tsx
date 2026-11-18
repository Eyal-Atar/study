import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../app/AppProviders'
import { he } from '../i18n/he'
import { createFakeApi, problem, type ApiCall, type FakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { createFakeStorage, type FakeStorage } from '../test/fakeStorage'
import { ToastRegion } from '../ui/toast'
import { MaterialsStep } from './MaterialsStep'
import type { Exam, Material, MaterialRegister } from './types'

const exam: Exam = { id: 'e1', name: 'חדו"א', exam_date: '2027-01-20', difficulty: 3, created_at: '2026-11-16T08:00:00Z', color_index: 0 }

function material(overrides: Partial<Material> = {}): Material {
  return {
    id: 'm1',
    exam_id: 'e1',
    filename: 'מבחן 2024.pdf',
    kind: 'past_exam',
    mime: 'application/pdf',
    size_bytes: 1000,
    page_count: null,
    scanned_pages: null,
    ingest_status: 'queued',
    ingest_error: null,
    warnings: [],
    created_at: '2026-11-16T08:00:00Z',
    ingested_at: null,
    ...overrides,
  }
}

function pdf(name = 'מבחן 2024.pdf'): File {
  return new File([new Uint8Array(1000)], name, { type: 'application/pdf' })
}

// A server whose materials list is `list`: a register adds to it, a delete removes from it.
function server(initial: Material[] = []) {
  const state = { list: [...initial] }
  const fake = createFakeApi()
    .on('GET /exams', [exam])
    .on('GET /exams/e1/materials', () => [...state.list])
    .on('POST /exams/e1/materials', (call: ApiCall) => {
      const body = call.body as MaterialRegister
      const created = material({ id: body.id, filename: body.filename, kind: body.kind, size_bytes: body.size_bytes })
      state.list.push(created)
      return { material: created, job_id: 'j1' }
    })
    .on({ method: 'DELETE', path: /^\/materials\// }, (call: ApiCall) => {
      state.list = state.list.filter((m) => `/materials/${m.id}` !== call.path)
      return undefined
    })
  return { fake, state }
}

function setup({ fake, storage = createFakeStorage() }: { fake: FakeApi; storage?: FakeStorage }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const auth = createFakeAuth(fakeSession({ id: 'user-a' }))
  const router = createMemoryRouter(
    [
      { path: '/onboarding/exams', element: <p>שלב המבחנים</p> },
      {
        path: '/onboarding/materials',
        element: (
          <>
            <MaterialsStep />
            <ToastRegion />
          </>
        ),
      },
      { path: '/onboarding/schedule', element: <p>שלב השאלות</p> },
    ],
    { initialEntries: ['/onboarding/materials'] },
  )
  const result = render(
    <StrictMode>
      <AppProviders auth={auth.client} api={fake.api} storage={storage.client} queryClient={queryClient}>
        <RouterProvider router={router} />
      </AppProviders>
    </StrictMode>,
  )
  // With fake timers, user-event's own delays must move the fake clock too.
  const user = userEvent.setup({ advanceTimers: (ms) => (vi.isFakeTimers() ? vi.advanceTimersByTime(ms) : undefined) })
  return { ...result, router, storage, user }
}

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')
  if (input === null) throw new Error('no file input')
  return input
}

afterEach(() => {
  vi.useRealTimers()
})

describe('MaterialsStep', () => {
  it('says materials are optional, that past exams help most, and that files go to Anthropic', async () => {
    const { fake } = server()
    setup({ fake })

    expect(await screen.findByRole('heading', { name: 'חדו"א' })).toBeInTheDocument()
    expect(screen.getByText(/לא חובה/)).toBeInTheDocument()
    expect(screen.getByText(/מבחני עבר עם פתרונות/)).toBeInTheDocument()
    expect(screen.getByText(/Anthropic/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: he.onboardingMaterials.addFilesFor('חדו"א') })).toBeInTheDocument()
    expect(fileInput(document.body)).toHaveAttribute('accept', expect.stringContaining('application/pdf') as string)
    expect(fileInput(document.body)).toHaveAttribute('multiple')
  })

  it('shows an upload as uploading, then processing, then ready with its page count', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { fake, state } = server()
    const storage = createFakeStorage()
    let finishUpload: (value: { error: Error | null }) => void = () => undefined
    storage.upload.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishUpload = resolve
        }),
    )
    const { container, user } = setup({ fake, storage })
    await screen.findByRole('heading', { name: 'חדו"א' })

    await user.upload(fileInput(container), pdf('פתרון מבחן 2024.pdf'))

    // The row shows the name without its extension; the type is in the subtitle, after the kind.
    const row = (await screen.findByText('פתרון מבחן 2024')).closest('li')
    if (row === null) throw new Error('no row')
    expect(within(row).getByText('מעלה…')).toBeInTheDocument()
    // The kind guessed from the name (decision 11).
    expect(within(row).getByText('פתרון, PDF.')).toBeInTheDocument()

    await act(async () => {
      finishUpload({ error: null })
      await Promise.resolve()
    })
    expect(await screen.findByText('קוראים את הקובץ…')).toBeInTheDocument()
    expect(fake.calls('POST', '/exams/e1/materials')).toHaveLength(1)
    expect(fake.calls('POST', '/exams/e1/materials')[0]?.body).toMatchObject({ kind: 'solution', filename: 'פתרון מבחן 2024.pdf' })

    const registered = state.list[0]
    if (registered === undefined) throw new Error('not registered')
    state.list = [{ ...registered, ingest_status: 'ready', page_count: 12 }]
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(await screen.findByText('מוכן, 12 עמודים')).toBeInTheDocument()
    expect(screen.queryByText('קוראים את הקובץ…')).not.toBeInTheDocument()
  })

  it('uploads several picked files at once, each with its own guessed kind', async () => {
    const { fake } = server()
    const { container, user } = setup({ fake })
    await screen.findByRole('heading', { name: 'חדו"א' })

    await user.upload(fileInput(container), [pdf('syllabus.pdf'), pdf('מועד א.pdf')])

    await waitFor(() => {
      expect(screen.getAllByText('קוראים את הקובץ…')).toHaveLength(2)
    })
    expect(fake.calls('POST', '/exams/e1/materials').map((c) => (c.body as MaterialRegister).kind).sort()).toEqual(['past_exam', 'syllabus'])
    expect(screen.getByRole('button', { name: 'המשך' })).toBeInTheDocument()
  })

  it('shows a failed material with its error in Hebrew and a delete button', async () => {
    const { fake } = server([material({ ingest_status: 'failed', ingest_error: 'pdf_unreadable' })])
    setup({ fake })

    expect(await screen.findByText(/לא הצלחנו לקרוא את ה-PDF/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'מחיקה: מבחן 2024.pdf' })).toBeInTheDocument()
  })

  it('shows the pages_truncated warning of a ready material', async () => {
    const { fake } = server([material({ ingest_status: 'ready', page_count: 300, warnings: ['pages_truncated'] })])
    setup({ fake })

    expect(await screen.findByText('מוכן, 300 עמודים')).toBeInTheDocument()
    expect(screen.getByText(/קראנו רק את העמודים הראשונים/)).toBeInTheDocument()
  })

  it('hides a deleted material at once and sends DELETE only when the undo toast expires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { fake } = server([material({ ingest_status: 'ready', page_count: 4 })])
    const { user } = setup({ fake })

    await user.click(await screen.findByRole('button', { name: 'מחיקה: מבחן 2024.pdf' }))

    expect(screen.queryByText('מוכן, 4 עמודים')).not.toBeInTheDocument()
    expect(await screen.findByText('הקובץ "מבחן 2024.pdf" יימחק')).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(9000))
    expect(fake.calls('DELETE')).toHaveLength(0)

    await act(() => vi.advanceTimersByTimeAsync(1500))
    await waitFor(() => {
      expect(fake.calls('DELETE')).toEqual([{ method: 'DELETE', path: '/materials/m1', body: undefined }])
    })
    expect(screen.queryByText('מוכן, 4 עמודים')).not.toBeInTheDocument()
  })

  it('brings a deleted material back on undo and never sends DELETE', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { fake } = server([material({ ingest_status: 'ready', page_count: 4 })])
    const { user } = setup({ fake })

    await user.click(await screen.findByRole('button', { name: 'מחיקה: מבחן 2024.pdf' }))
    await user.click(await screen.findByRole('button', { name: 'בטל' }))

    expect(await screen.findByText('מוכן, 4 עמודים')).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(11000))
    expect(fake.calls('DELETE')).toHaveLength(0)
  })

  it('shows a Storage failure in Hebrew, and "לנסות שוב" uploads the file again', async () => {
    const { fake } = server()
    const storage = createFakeStorage()
    storage.upload.mockResolvedValueOnce({ error: new Error('bucket down') })
    const { container, user } = setup({ fake, storage })
    await screen.findByRole('heading', { name: 'חדו"א' })

    await user.upload(fileInput(container), pdf())

    expect(await screen.findByText('אחסון הקבצים לא זמין כרגע. נסו שוב בעוד רגע.')).toBeInTheDocument()
    expect(screen.queryByText('מעלה…')).not.toBeInTheDocument()
    expect(fake.calls('POST', '/exams/e1/materials')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'לנסות שוב: מבחן 2024.pdf' }))

    expect(await screen.findByText('קוראים את הקובץ…')).toBeInTheDocument()
    expect(storage.upload).toHaveBeenCalledTimes(2)
    expect(fake.calls('POST', '/exams/e1/materials')).toHaveLength(1)
    expect(screen.queryByText(/אחסון הקבצים/)).not.toBeInTheDocument()
  })

  it('drops a failed upload with "הסרה"', async () => {
    const { fake } = server()
    const storage = createFakeStorage()
    storage.upload.mockResolvedValueOnce({ error: new Error('bucket down') })
    const { container, user } = setup({ fake, storage })
    await screen.findByRole('heading', { name: 'חדו"א' })

    await user.upload(fileInput(container), pdf())
    await user.click(await screen.findByRole('button', { name: 'הסרה: מבחן 2024.pdf' }))

    expect(screen.queryByText('מבחן 2024')).not.toBeInTheDocument()
    expect(screen.getByText('עוד לא הוספתם קבצים למבחן הזה.')).toBeInTheDocument()
  })

  it('shows too_many_materials with the limit', async () => {
    const { fake } = server()
    fake.on('POST /exams/e1/materials', problem(409, 'too_many_materials', { limit: 15 }))
    const { container, user } = setup({ fake })
    await screen.findByRole('heading', { name: 'חדו"א' })

    await user.upload(fileInput(container), pdf())

    expect(await screen.findByText(/אפשר עד 15 קבצים למבחן/)).toBeInTheDocument()
  })

  it('retries a failed register with the same id and without a second Storage upload', async () => {
    const { fake, state } = server()
    const storage = createFakeStorage()
    let failOnce = true
    fake.on('POST /exams/e1/materials', (call: ApiCall) => {
      if (failOnce) {
        failOnce = false
        return problem(500, 'database_unavailable')
      }
      const body = call.body as MaterialRegister
      const created = material({ id: body.id, filename: body.filename })
      state.list.push(created)
      return { material: created, job_id: 'j1' }
    })
    const { container, user } = setup({ fake, storage })
    await screen.findByRole('heading', { name: 'חדו"א' })

    await user.upload(fileInput(container), pdf())
    await user.click(await screen.findByRole('button', { name: 'לנסות שוב: מבחן 2024.pdf' }))

    expect(await screen.findByText('קוראים את הקובץ…')).toBeInTheDocument()
    expect(storage.upload).toHaveBeenCalledOnce()
    const ids = fake.calls('POST', '/exams/e1/materials').map((c) => (c.body as MaterialRegister).id)
    expect(ids).toHaveLength(2)
    expect(ids[1]).toBe(ids[0])
    expect(storage.upload.mock.calls[0]?.[0]).toBe(`user-a/e1/${String(ids[0])}`)
  })

  it('counts already_exists on a retry as registered: one row, no error', async () => {
    const { fake, state } = server()
    // The server wrote the material, but its answer was lost.
    let first = true
    fake.on('POST /exams/e1/materials', (call: ApiCall) => {
      const body = call.body as MaterialRegister
      if (first) {
        first = false
        state.list.push(material({ id: body.id, filename: body.filename }))
        return problem(0, 'network')
      }
      return problem(409, 'already_exists')
    })
    const { container, user } = setup({ fake })
    await screen.findByRole('heading', { name: 'חדו"א' })

    await user.upload(fileInput(container), pdf())
    await user.click(await screen.findByRole('button', { name: 'לנסות שוב: מבחן 2024.pdf' }))

    await waitFor(() => {
      expect(screen.getAllByText('מבחן 2024')).toHaveLength(1)
    })
    expect(await screen.findByText('קוראים את הקובץ…')).toBeInTheDocument()
    expect(screen.queryByText('הקובץ הזה כבר נרשם.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /לנסות שוב/ })).not.toBeInTheDocument()
  })

  it.each([
    ['too_many_materials', problem(422, 'too_many_materials', { limit: 15 })],
    ['not_found', problem(404, 'not_found')],
  ])('offers only "הסרה" after %s', async (_code, error) => {
    const { fake } = server()
    fake.on('POST /exams/e1/materials', error)
    const { container, user } = setup({ fake })
    await screen.findByRole('heading', { name: 'חדו"א' })

    await user.upload(fileInput(container), pdf())

    expect(await screen.findByRole('button', { name: 'הסרה: מבחן 2024.pdf' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'לנסות שוב: מבחן 2024.pdf' })).not.toBeInTheDocument()
  })

  it('stops at 15 files per exam before the network when several are picked at once', async () => {
    const existing = Array.from({ length: 13 }, (_, i) => material({ id: `m${String(i)}`, filename: `קובץ ${String(i)}.pdf`, ingest_status: 'ready' }))
    existing.push(material({ id: 'mf', filename: 'נכשל.pdf', ingest_status: 'failed', ingest_error: 'pdf_unreadable' }))
    const { fake } = server(existing)
    const storage = createFakeStorage()
    const { container, user } = setup({ fake, storage })
    await screen.findByText('נכשל')

    await user.upload(fileInput(container), [pdf('א.pdf'), pdf('ב.pdf'), pdf('ג.pdf')])

    await waitFor(() => {
      expect(fake.calls('POST', '/exams/e1/materials')).toHaveLength(1)
    })
    expect(storage.upload).toHaveBeenCalledOnce()
    expect(await screen.findAllByText(/אפשר עד 15 קבצים למבחן/)).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /לנסות שוב/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'הסרה: ב.pdf' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'הסרה: ג.pdf' })).toBeInTheDocument()
  })

  it.each([
    ['המשך בלי חומרים', '/onboarding/schedule'],
    ['חזרה', '/onboarding/exams'],
  ])('sends a waiting delete before "%s" leaves the step', async (button, target) => {
    const { fake, state } = server([material({ ingest_status: 'ready', page_count: 4 })])
    let finishDelete: () => void = () => undefined
    fake.on(
      { method: 'DELETE', path: /^\/materials\// },
      () =>
        new Promise((resolve) => {
          finishDelete = () => {
            state.list = []
            resolve(undefined)
          }
        }),
    )
    const { router, user } = setup({ fake })

    await user.click(await screen.findByRole('button', { name: 'מחיקה: מבחן 2024.pdf' }))
    await user.click(screen.getByRole('button', { name: button }))

    await waitFor(() => {
      expect(fake.calls('DELETE')).toEqual([{ method: 'DELETE', path: '/materials/m1', body: undefined }])
    })
    // Not before the server took the delete: the next steps would still see the file.
    expect(router.state.location.pathname).toBe('/onboarding/materials')
    expect(screen.queryByText('הקובץ "מבחן 2024.pdf" יימחק')).not.toBeInTheDocument()

    await act(async () => {
      finishDelete()
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(target)
    })
  })

  it('sends a waiting delete before "המשך" too', async () => {
    const { fake } = server([material({ ingest_status: 'ready', page_count: 4 }), material({ id: 'm2', filename: 'b.pdf', ingest_status: 'ready' })])
    const { router, user } = setup({ fake })

    await user.click(await screen.findByRole('button', { name: 'מחיקה: מבחן 2024.pdf' }))
    await user.click(screen.getByRole('button', { name: 'המשך' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/onboarding/schedule')
    })
    expect(fake.calls('DELETE').map((c) => c.path)).toEqual(['/materials/m1'])
  })

  it('stays on the step, with the file back, when a delete sent on leaving fails', async () => {
    const { fake } = server([material({ ingest_status: 'ready', page_count: 4 })])
    fake.on({ method: 'DELETE', path: /^\/materials\// }, problem(503, 'database_unavailable'))
    const { router, user } = setup({ fake })

    await user.click(await screen.findByRole('button', { name: 'מחיקה: מבחן 2024.pdf' }))
    // The only file is hidden, so the button says that it goes on without materials.
    await user.click(screen.getByRole('button', { name: 'המשך בלי חומרים' }))

    expect(await screen.findByText(/הקובץ "מבחן 2024.pdf" לא נמחק/)).toBeInTheDocument()
    expect(screen.getByText('מוכן, 4 עמודים')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/onboarding/materials')
    // The buttons work again.
    expect(screen.getByRole('button', { name: 'המשך' })).toBeEnabled()
  })

  it('brings back each file whose delete failed when two expire together', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { fake } = server([
      material({ ingest_status: 'ready', page_count: 4 }),
      material({ id: 'm2', filename: 'b.pdf', ingest_status: 'ready', page_count: 7 }),
    ])
    // Both DELETEs are on their way before either answers.
    const answers: (() => void)[] = []
    fake.on(
      { method: 'DELETE', path: /^\/materials\// },
      () =>
        new Promise((resolve) => {
          answers.push(() => {
            resolve(problem(503, 'database_unavailable'))
          })
        }),
    )
    const { user } = setup({ fake })

    await user.click(await screen.findByRole('button', { name: 'מחיקה: מבחן 2024.pdf' }))
    await user.click(screen.getByRole('button', { name: 'מחיקה: b.pdf' }))
    await act(() => vi.advanceTimersByTimeAsync(10500))

    await waitFor(() => {
      expect(fake.calls('DELETE')).toHaveLength(2)
    })
    await act(async () => {
      answers.forEach((answer) => {
        answer()
      })
      await Promise.resolve()
    })
    expect(await screen.findByText('מוכן, 4 עמודים')).toBeInTheDocument()
    expect(await screen.findByText('מוכן, 7 עמודים')).toBeInTheDocument()
    expect(screen.getByText(/הקובץ "מבחן 2024.pdf" לא נמחק/)).toBeInTheDocument()
    expect(screen.getByText(/הקובץ "b.pdf" לא נמחק/)).toBeInTheDocument()
  })

  it('still sends a waiting delete when the step goes away some other way', async () => {
    const { fake } = server([material({ ingest_status: 'ready', page_count: 4 })])
    const { router, user } = setup({ fake })

    await user.click(await screen.findByRole('button', { name: 'מחיקה: מבחן 2024.pdf' }))
    await act(() => router.navigate('/onboarding/exams'))

    await waitFor(() => {
      expect(fake.calls('DELETE').map((c) => c.path)).toEqual(['/materials/m1'])
    })
  })

  it('without materials the one button says "המשך בלי חומרים", and goes to the schedule step', async () => {
    const { fake } = server()
    const { router, user } = setup({ fake })
    await screen.findByRole('heading', { name: 'חדו"א' })

    expect(screen.queryByRole('button', { name: 'המשך' })).not.toBeInTheDocument()
    // The primary button first, then "חזרה"; there is no third button to skip with.
    const bar = screen.getByRole('button', { name: 'המשך בלי חומרים' }).parentElement
    if (bar === null) throw new Error('no actions bar')
    expect(within(bar).getAllByRole('button').map((button) => button.textContent)).toEqual(['המשך בלי חומרים', 'חזרה'])
    await user.click(screen.getByRole('button', { name: 'המשך בלי חומרים' }))

    expect(router.state.location.pathname).toBe('/onboarding/schedule')
  })

  it('goes on to the schedule step with "המשך" when there are materials', async () => {
    const { fake } = server([material({ ingest_status: 'ready', page_count: 2 })])
    const { router, user } = setup({ fake })

    await user.click(await screen.findByRole('button', { name: 'המשך' }))

    expect(router.state.location.pathname).toBe('/onboarding/schedule')
  })

  it('a failed file is marked by an icon and its reason, not by colour alone', async () => {
    const { fake } = server([material({ ingest_status: 'failed', ingest_error: 'pdf_unreadable' })])
    setup({ fake })

    const reason = await screen.findByText(/לא הצלחנו לקרוא את ה-PDF/)
    expect(reason).toHaveClass('text-danger')
    expect(reason.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
  })

  it('a long file name without spaces wraps inside its row, and the delete button stays beside it', async () => {
    const name = `${'a'.repeat(140)}.pdf`
    const { fake } = server([material({ filename: name, ingest_status: 'ready', page_count: 2 })])
    setup({ fake })

    const title = await screen.findByText('a'.repeat(140))
    expect(title.closest('.break-words')).not.toBeNull()
    expect(title.closest('.min-w-0')).not.toBeNull()
    expect(title.closest('.truncate')).toBeNull()
    const row = title.closest('li')
    if (row === null) throw new Error('no row')
    expect(row.className).not.toMatch(/(^|\s)(w|min-w|basis)-\d/)
    // The accessible name keeps the full file name.
    expect(within(row).getByRole('button', { name: `מחיקה: ${name}` })).toHaveClass('size-touch', 'shrink-0')
  })

  it.each([
    ['סילבוס', 'סילבוס.'],
    ['.pdf', 'מבחן עבר.'],
  ])('a file named "%s" shows its full name, and no type in the subtitle', async (name, lead) => {
    const { fake } = server([material({ filename: name, kind: name === 'סילבוס' ? 'syllabus' : 'past_exam', ingest_status: 'ready', page_count: 2 })])
    setup({ fake })

    const row = (await screen.findByRole('button', { name: `מחיקה: ${name}` })).closest('li')
    if (row === null) throw new Error('no row')
    expect(within(row).getByText(name, { selector: 'bdi' })).toBeInTheDocument()
    expect(within(row).getByText(lead)).toBeInTheDocument()
    expect(within(row).getByText('מוכן, 2 עמודים')).toBeInTheDocument()
  })

  it('a failed load of the exams shows the error with a retry, under the title', async () => {
    const fake = createFakeApi().on('GET /exams', problem(503, 'database_unavailable'))
    const { user } = setup({ fake })

    expect(screen.getByRole('heading', { level: 1, name: he.onboardingMaterials.title })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(he.codes.database_unavailable)
    fake.on('GET /exams', [])
    await user.click(screen.getByRole('button', { name: he.common.retry }))
    expect(await screen.findByText(he.onboardingMaterials.noExams)).toBeInTheDocument()
  })

  it('goes back to the exams step', async () => {
    const { fake } = server()
    const { router, user } = setup({ fake })
    await screen.findByRole('heading', { name: 'חדו"א' })

    await user.click(screen.getByRole('button', { name: 'חזרה' }))

    expect(router.state.location.pathname).toBe('/onboarding/exams')
  })
})
