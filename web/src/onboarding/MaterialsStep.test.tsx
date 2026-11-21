import { QueryClient } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../app/AppProviders'
import { en } from '../i18n/en'
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

afterEach(() => {
  vi.useRealTimers()
})

describe('MaterialsStep', () => {
  it('says materials are optional, that past exams help most, and that files go to Anthropic', async () => {
    const { fake } = server()
    setup({ fake })

    expect(await screen.findByRole('heading', { name: 'חדו"א' })).toBeInTheDocument()
    expect(screen.getByText(/optional/)).toBeInTheDocument()
    expect(screen.getByText(/Past exams with solutions/)).toBeInTheDocument()
    expect(screen.getByText(/Anthropic/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.onboardingMaterials.addFilesFor('חדו"א') })).toBeInTheDocument()
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
    expect(within(row).getByText(en.onboardingMaterials.uploading)).toBeInTheDocument()
    // The kind guessed from the name (decision 11).
    expect(within(row).getByText(en.onboardingMaterials.fileLead(en.onboardingMaterials.kinds.solution, 'PDF'))).toBeInTheDocument()

    await act(async () => {
      finishUpload({ error: null })
      await Promise.resolve()
    })
    expect(await screen.findByText(en.onboardingMaterials.processing)).toBeInTheDocument()
    expect(fake.calls('POST', '/exams/e1/materials')).toHaveLength(1)
    expect(fake.calls('POST', '/exams/e1/materials')[0]?.body).toMatchObject({ kind: 'solution', filename: 'פתרון מבחן 2024.pdf' })

    const registered = state.list[0]
    if (registered === undefined) throw new Error('not registered')
    state.list = [{ ...registered, ingest_status: 'ready', page_count: 12 }]
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(await screen.findByText(en.onboardingMaterials.ready(12))).toBeInTheDocument()
    expect(screen.queryByText(en.onboardingMaterials.processing)).not.toBeInTheDocument()
  })

  it('uploads several picked files at once, each with its own guessed kind', async () => {
    const { fake } = server()
    const { container, user } = setup({ fake })
    await screen.findByRole('heading', { name: 'חדו"א' })

    await user.upload(fileInput(container), [pdf('syllabus.pdf'), pdf('מועד א.pdf')])

    await waitFor(() => {
      expect(screen.getAllByText(en.onboardingMaterials.processing)).toHaveLength(2)
    })
    expect(fake.calls('POST', '/exams/e1/materials').map((c) => (c.body as MaterialRegister).kind).sort()).toEqual(['past_exam', 'syllabus'])
    expect(screen.getByRole('button', { name: en.onboarding.continue })).toBeInTheDocument()
  })

  it('shows a failed material with its error in words and a delete button', async () => {
    const { fake } = server([material({ ingest_status: 'failed', ingest_error: 'pdf_unreadable' })])
    setup({ fake })

    expect(await screen.findByText(en.codes.pdf_unreadable)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.onboardingMaterials.deleteNamed('מבחן 2024.pdf') })).toBeInTheDocument()
  })

  it('shows the pages_truncated warning of a ready material', async () => {
    const { fake } = server([material({ ingest_status: 'ready', page_count: 300, warnings: ['pages_truncated'] })])
    setup({ fake })

    expect(await screen.findByText(en.onboardingMaterials.ready(300))).toBeInTheDocument()
    expect(screen.getByText(en.codes.pages_truncated)).toBeInTheDocument()
  })

  it('hides a deleted material at once and sends DELETE only when the undo toast expires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { fake } = server([material({ ingest_status: 'ready', page_count: 4 })])
    const { user } = setup({ fake })

    await user.click(await screen.findByRole('button', { name: en.onboardingMaterials.deleteNamed('מבחן 2024.pdf') }))

    expect(screen.queryByText(en.onboardingMaterials.ready(4))).not.toBeInTheDocument()
    expect(await screen.findByText(en.onboardingMaterials.deleted('מבחן 2024.pdf'))).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(9000))
    expect(fake.calls('DELETE')).toHaveLength(0)

    await act(() => vi.advanceTimersByTimeAsync(1500))
    await waitFor(() => {
      expect(fake.calls('DELETE')).toEqual([{ method: 'DELETE', path: '/materials/m1', body: undefined }])
    })
    expect(screen.queryByText(en.onboardingMaterials.ready(4))).not.toBeInTheDocument()
  })

  it('brings a deleted material back on undo and never sends DELETE', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { fake } = server([material({ ingest_status: 'ready', page_count: 4 })])
    const { user } = setup({ fake })

    await user.click(await screen.findByRole('button', { name: en.onboardingMaterials.deleteNamed('מבחן 2024.pdf') }))
    await user.click(await screen.findByRole('button', { name: en.common.undo }))

    expect(await screen.findByText(en.onboardingMaterials.ready(4))).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(11000))
    expect(fake.calls('DELETE')).toHaveLength(0)
  })

  it('shows a Storage failure in English, and "Try again" uploads the file again', async () => {
    const { fake } = server()
    const storage = createFakeStorage()
    storage.upload.mockResolvedValueOnce({ error: new Error('bucket down') })
    const { container, user } = setup({ fake, storage })
    await screen.findByRole('heading', { name: 'חדו"א' })

    await user.upload(fileInput(container), pdf())

    expect(await screen.findByText(en.codes.storage_unavailable)).toBeInTheDocument()
    expect(screen.queryByText(en.onboardingMaterials.uploading)).not.toBeInTheDocument()
    expect(fake.calls('POST', '/exams/e1/materials')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: en.onboardingMaterials.retryNamed('מבחן 2024.pdf') }))

    expect(await screen.findByText(en.onboardingMaterials.processing)).toBeInTheDocument()
    expect(storage.upload).toHaveBeenCalledTimes(2)
    expect(fake.calls('POST', '/exams/e1/materials')).toHaveLength(1)
    expect(screen.queryByText(/File storage/)).not.toBeInTheDocument()
  })

  it('drops a failed upload with "Remove"', async () => {
    const { fake } = server()
    const storage = createFakeStorage()
    storage.upload.mockResolvedValueOnce({ error: new Error('bucket down') })
    const { container, user } = setup({ fake, storage })
    await screen.findByRole('heading', { name: 'חדו"א' })

    await user.upload(fileInput(container), pdf())
    await user.click(await screen.findByRole('button', { name: en.onboardingMaterials.removeNamed('מבחן 2024.pdf') }))

    expect(screen.queryByText('מבחן 2024')).not.toBeInTheDocument()
    expect(screen.getByText(en.onboardingMaterials.empty)).toBeInTheDocument()
  })

  it('shows too_many_materials with the limit', async () => {
    const { fake } = server()
    fake.on('POST /exams/e1/materials', problem(409, 'too_many_materials', { limit: 15 }))
    const { container, user } = setup({ fake })
    await screen.findByRole('heading', { name: 'חדו"א' })

    await user.upload(fileInput(container), pdf())

    expect(await screen.findByText(en.codes.too_many_materials(15))).toBeInTheDocument()
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
    await user.click(await screen.findByRole('button', { name: en.onboardingMaterials.retryNamed('מבחן 2024.pdf') }))

    expect(await screen.findByText(en.onboardingMaterials.processing)).toBeInTheDocument()
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
    await user.click(await screen.findByRole('button', { name: en.onboardingMaterials.retryNamed('מבחן 2024.pdf') }))

    await waitFor(() => {
      expect(screen.getAllByText('מבחן 2024')).toHaveLength(1)
    })
    expect(await screen.findByText(en.onboardingMaterials.processing)).toBeInTheDocument()
    expect(screen.queryByText(en.codes.already_exists)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Try again/ })).not.toBeInTheDocument()
  })

  it.each([
    ['too_many_materials', problem(422, 'too_many_materials', { limit: 15 })],
    ['not_found', problem(404, 'not_found')],
  ])('offers only "Remove" after %s', async (_code, error) => {
    const { fake } = server()
    fake.on('POST /exams/e1/materials', error)
    const { container, user } = setup({ fake })
    await screen.findByRole('heading', { name: 'חדו"א' })

    await user.upload(fileInput(container), pdf())

    expect(await screen.findByRole('button', { name: en.onboardingMaterials.removeNamed('מבחן 2024.pdf') })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.onboardingMaterials.retryNamed('מבחן 2024.pdf') })).not.toBeInTheDocument()
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
    expect(await screen.findAllByText(en.codes.too_many_materials(15))).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /^Try again/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.onboardingMaterials.removeNamed('ב.pdf') })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.onboardingMaterials.removeNamed('ג.pdf') })).toBeInTheDocument()
  })

  it.each([
    [en.onboardingMaterials.continueWithout, '/onboarding/schedule'],
    [en.common.back, '/onboarding/exams'],
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

    await user.click(await screen.findByRole('button', { name: en.onboardingMaterials.deleteNamed('מבחן 2024.pdf') }))
    await user.click(screen.getByRole('button', { name: button }))

    await waitFor(() => {
      expect(fake.calls('DELETE')).toEqual([{ method: 'DELETE', path: '/materials/m1', body: undefined }])
    })
    // Not before the server took the delete: the next steps would still see the file.
    expect(router.state.location.pathname).toBe('/onboarding/materials')
    expect(screen.queryByText(en.onboardingMaterials.deleted('מבחן 2024.pdf'))).not.toBeInTheDocument()

    await act(async () => {
      finishDelete()
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(target)
    })
  })

  it('sends a waiting delete before "Continue" too', async () => {
    const { fake } = server([material({ ingest_status: 'ready', page_count: 4 }), material({ id: 'm2', filename: 'b.pdf', ingest_status: 'ready' })])
    const { router, user } = setup({ fake })

    await user.click(await screen.findByRole('button', { name: en.onboardingMaterials.deleteNamed('מבחן 2024.pdf') }))
    await user.click(screen.getByRole('button', { name: en.onboarding.continue }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/onboarding/schedule')
    })
    expect(fake.calls('DELETE').map((c) => c.path)).toEqual(['/materials/m1'])
  })

  it('stays on the step, with the file back, when a delete sent on leaving fails', async () => {
    const { fake } = server([material({ ingest_status: 'ready', page_count: 4 })])
    fake.on({ method: 'DELETE', path: /^\/materials\// }, problem(503, 'database_unavailable'))
    const { router, user } = setup({ fake })

    await user.click(await screen.findByRole('button', { name: en.onboardingMaterials.deleteNamed('מבחן 2024.pdf') }))
    // The only file is hidden, so the button says that it goes on without materials.
    await user.click(screen.getByRole('button', { name: en.onboardingMaterials.continueWithout }))

    expect(await screen.findByText(new RegExp(`^${escapeRegExp(en.onboardingMaterials.deleteFailed('מבחן 2024.pdf'))}`))).toBeInTheDocument()
    expect(screen.getByText(en.onboardingMaterials.ready(4))).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/onboarding/materials')
    // The buttons work again.
    expect(screen.getByRole('button', { name: en.onboarding.continue })).toBeEnabled()
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

    await user.click(await screen.findByRole('button', { name: en.onboardingMaterials.deleteNamed('מבחן 2024.pdf') }))
    await user.click(screen.getByRole('button', { name: en.onboardingMaterials.deleteNamed('b.pdf') }))
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
    expect(await screen.findByText(en.onboardingMaterials.ready(4))).toBeInTheDocument()
    expect(await screen.findByText(en.onboardingMaterials.ready(7))).toBeInTheDocument()
    expect(screen.getByText(new RegExp(`^${escapeRegExp(en.onboardingMaterials.deleteFailed('מבחן 2024.pdf'))}`))).toBeInTheDocument()
    expect(screen.getByText(new RegExp(`^${escapeRegExp(en.onboardingMaterials.deleteFailed('b.pdf'))}`))).toBeInTheDocument()
  })

  it('still sends a waiting delete when the step goes away some other way', async () => {
    const { fake } = server([material({ ingest_status: 'ready', page_count: 4 })])
    const { router, user } = setup({ fake })

    await user.click(await screen.findByRole('button', { name: en.onboardingMaterials.deleteNamed('מבחן 2024.pdf') }))
    await act(() => router.navigate('/onboarding/exams'))

    await waitFor(() => {
      expect(fake.calls('DELETE').map((c) => c.path)).toEqual(['/materials/m1'])
    })
  })

  it('without materials the one button says "Continue without materials", and goes to the schedule step', async () => {
    const { fake } = server()
    const { router, user } = setup({ fake })
    await screen.findByRole('heading', { name: 'חדו"א' })

    expect(screen.queryByRole('button', { name: en.onboarding.continue })).not.toBeInTheDocument()
    // The primary button first, then "Back"; there is no third button to skip with.
    const bar = screen.getByRole('button', { name: en.onboardingMaterials.continueWithout }).parentElement
    if (bar === null) throw new Error('no actions bar')
    expect(within(bar).getAllByRole('button').map((button) => button.textContent)).toEqual([en.onboardingMaterials.continueWithout, en.common.back])
    await user.click(screen.getByRole('button', { name: en.onboardingMaterials.continueWithout }))

    expect(router.state.location.pathname).toBe('/onboarding/schedule')
  })

  it('goes on to the schedule step with "Continue" when there are materials', async () => {
    const { fake } = server([material({ ingest_status: 'ready', page_count: 2 })])
    const { router, user } = setup({ fake })

    await user.click(await screen.findByRole('button', { name: en.onboarding.continue }))

    expect(router.state.location.pathname).toBe('/onboarding/schedule')
  })

  it('a failed file is marked by an icon and its reason, not by colour alone', async () => {
    const { fake } = server([material({ ingest_status: 'failed', ingest_error: 'pdf_unreadable' })])
    setup({ fake })

    const reason = await screen.findByText(en.codes.pdf_unreadable)
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
    expect(within(row).getByRole('button', { name: en.onboardingMaterials.deleteNamed(name) })).toHaveClass('size-touch', 'shrink-0')
  })

  it.each([
    ['סילבוס', en.onboardingMaterials.fileLead(en.onboardingMaterials.kinds.syllabus, null)],
    ['.pdf', en.onboardingMaterials.fileLead(en.onboardingMaterials.kinds.past_exam, null)],
  ])('a file named "%s" shows its full name, and no type in the subtitle', async (name, lead) => {
    const { fake } = server([material({ filename: name, kind: name === 'סילבוס' ? 'syllabus' : 'past_exam', ingest_status: 'ready', page_count: 2 })])
    setup({ fake })

    const row = (await screen.findByRole('button', { name: en.onboardingMaterials.deleteNamed(name) })).closest('li')
    if (row === null) throw new Error('no row')
    expect(within(row).getByText(name, { selector: 'bdi[dir="auto"]' })).toBeInTheDocument()
    expect(within(row).getByText(lead)).toBeInTheDocument()
    expect(within(row).getByText(en.onboardingMaterials.ready(2))).toBeInTheDocument()
  })

  it('puts a Hebrew file name and the exam name in elements that decide their own direction', async () => {
    const { fake } = server([material({ filename: 'פרק 3.pdf', ingest_status: 'ready', page_count: 2 })])
    setup({ fake })

    const heading = await screen.findByRole('heading', { name: /חדו"א/ })
    expect((await screen.findByText('פרק 3')).closest('[dir="auto"]')).not.toBeNull()
    expect(heading.querySelector('[dir="auto"]')).not.toBeNull()
  })

  it('a failed load of the exams shows the error with a retry, under the title', async () => {
    const fake = createFakeApi().on('GET /exams', problem(503, 'database_unavailable'))
    const { user } = setup({ fake })

    expect(screen.getByRole('heading', { level: 1, name: en.onboardingMaterials.title })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(en.codes.database_unavailable)
    fake.on('GET /exams', [])
    await user.click(screen.getByRole('button', { name: en.common.retry }))
    expect(await screen.findByText(en.onboardingMaterials.noExams)).toBeInTheDocument()
  })

  it('goes back to the exams step', async () => {
    const { fake } = server()
    const { router, user } = setup({ fake })
    await screen.findByRole('heading', { name: 'חדו"א' })

    await user.click(screen.getByRole('button', { name: en.common.back }))

    expect(router.state.location.pathname).toBe('/onboarding/exams')
  })
})
