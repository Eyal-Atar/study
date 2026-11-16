import { QueryClient } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { meKey, useMe, type Me } from '../api/me'
import { AppProviders } from '../app/AppProviders'
import { createFakeApi, type FakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { createFakeStorage } from '../test/fakeStorage'
import {
  examsKey,
  materialsKey,
  useCreateExam,
  useDeleteExam,
  useDeleteMaterial,
  useExams,
  useGenerate,
  useJob,
  useMaterials,
  useReplanApply,
  useReplanPreview,
  useUndo,
  useUpdateMe,
} from './api'
import type { Exam, Job, Material } from './types'
import { useUploadMaterial } from './upload'

const me: Me = {
  id: 'user-a',
  email: 'a@example.com',
  display_name: null,
  timezone: 'Asia/Jerusalem',
  wake_time: '08:00',
  sleep_time: '23:00',
  daily_study_minutes: 240,
  study_windows: ['morning', 'afternoon'],
  rest_days_before_exam: 1,
  notify_lead_minutes: 10,
  onboarding_completed_at: null,
}

const exam: Exam = { id: 'e1', name: 'חדו"א', exam_date: '2027-01-20', difficulty: 3, created_at: '2026-11-16T08:00:00Z' }

function material(id: string, ingest_status: Material['ingest_status']): Material {
  return {
    id,
    exam_id: 'e1',
    filename: `${id}.pdf`,
    kind: 'past_exam',
    mime: 'application/pdf',
    size_bytes: 10,
    page_count: null,
    scanned_pages: null,
    ingest_status,
    ingest_error: null,
    warnings: [],
    created_at: '2026-11-16T08:00:00Z',
    ingested_at: null,
  }
}

function job(status: Job['status']): Job {
  return {
    id: 'j1',
    kind: 'generate_plan',
    status,
    stage: null,
    percent: null,
    error: null,
    result: null,
    created_at: '2026-11-16T08:00:00Z',
    started_at: null,
    finished_at: null,
  }
}

function setup(fake: FakeApi = createFakeApi()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const auth = createFakeAuth(fakeSession({ id: 'user-a' }))
  const storage = createFakeStorage()
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <AppProviders auth={auth.client} api={fake.api} storage={storage.client} queryClient={queryClient}>
        {children}
      </AppProviders>
    )
  }
  return { fake, queryClient, storage, wrapper }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('queries', () => {
  it('useExams reads GET /exams under the user id', async () => {
    const { wrapper, queryClient } = setup(createFakeApi().on('GET /exams', [exam]))
    const { result } = renderHook(() => useExams(), { wrapper })

    await waitFor(() => {
      expect(result.current.data).toEqual([exam])
    })
    expect(queryClient.getQueryData(examsKey('user-a'))).toEqual([exam])
  })

  it('useJob polls every 2 seconds and stops at done', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const answers = [job('queued'), job('running'), job('done')]
    const fake = createFakeApi().on('GET /jobs/j1', () => answers.shift() ?? job('done'))
    const { wrapper } = setup(fake)
    const { result } = renderHook(() => useJob('j1'), { wrapper })

    await waitFor(() => {
      expect(result.current.data?.status).toBe('queued')
    })
    await act(() => vi.advanceTimersByTimeAsync(2000))
    await waitFor(() => {
      expect(result.current.data?.status).toBe('running')
    })
    await act(() => vi.advanceTimersByTimeAsync(2000))
    await waitFor(() => {
      expect(result.current.data?.status).toBe('done')
    })
    const calls = fake.calls('GET', '/jobs/j1').length
    await act(() => vi.advanceTimersByTimeAsync(10000))
    expect(fake.calls('GET', '/jobs/j1')).toHaveLength(calls)
  })

  it('useJob stops at failed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fake = createFakeApi().on('GET /jobs/j1', job('failed'))
    const { wrapper } = setup(fake)
    const { result } = renderHook(() => useJob('j1'), { wrapper })

    await waitFor(() => {
      expect(result.current.data?.status).toBe('failed')
    })
    const calls = fake.calls('GET', '/jobs/j1').length
    await act(() => vi.advanceTimersByTimeAsync(10000))
    expect(fake.calls('GET', '/jobs/j1')).toHaveLength(calls)
  })

  it('useJob(null) asks nothing', async () => {
    const fake = createFakeApi()
    const { wrapper } = setup(fake)
    const { result } = renderHook(() => useJob(null), { wrapper })
    await act(async () => {})
    expect(result.current.fetchStatus).toBe('idle')
    expect(fake.calls()).toEqual([])
  })

  it('useMaterials polls while a material is queued or processing, and stops when all are ready or failed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const answers = [
      [material('m1', 'queued'), material('m2', 'ready')],
      [material('m1', 'processing'), material('m2', 'ready')],
      [material('m1', 'failed'), material('m2', 'ready')],
    ]
    const fake = createFakeApi().on('GET /exams/e1/materials', () => answers.shift() ?? [])
    const { wrapper } = setup(fake)
    const { result } = renderHook(() => useMaterials('e1'), { wrapper })

    await waitFor(() => {
      expect(result.current.data?.[0]?.ingest_status).toBe('queued')
    })
    await act(() => vi.advanceTimersByTimeAsync(2000))
    await waitFor(() => {
      expect(result.current.data?.[0]?.ingest_status).toBe('processing')
    })
    await act(() => vi.advanceTimersByTimeAsync(2000))
    await waitFor(() => {
      expect(result.current.data?.[0]?.ingest_status).toBe('failed')
    })
    const calls = fake.calls('GET', '/exams/e1/materials').length
    await act(() => vi.advanceTimersByTimeAsync(10000))
    expect(fake.calls('GET', '/exams/e1/materials')).toHaveLength(calls)
  })

  it('useMaterials does not poll a list that is already settled', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fake = createFakeApi().on('GET /exams/e1/materials', [material('m1', 'ready')])
    const { wrapper } = setup(fake)
    const { result } = renderHook(() => useMaterials('e1'), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })
    const calls = fake.calls('GET', '/exams/e1/materials').length
    await act(() => vi.advanceTimersByTimeAsync(10000))
    expect(fake.calls('GET', '/exams/e1/materials')).toHaveLength(calls)
  })
})

describe('mutations', () => {
  it('useCreateExam posts the exam and refetches the exams', async () => {
    let exams: Exam[] = []
    const fake = createFakeApi()
      .on('GET /exams', () => exams)
      .on('POST /exams', () => {
        exams = [exam]
        return { exam, plan_affected: false }
      })
    const { wrapper } = setup(fake)
    const { result } = renderHook(() => ({ list: useExams(), create: useCreateExam() }), { wrapper })
    await waitFor(() => {
      expect(result.current.list.data).toEqual([])
    })

    await act(() => result.current.create.mutateAsync({ name: 'חדו"א', exam_date: '2027-01-20', difficulty: 3 }))

    expect(fake.calls('POST', '/exams')[0]?.body).toEqual({ name: 'חדו"א', exam_date: '2027-01-20', difficulty: 3 })
    await waitFor(() => {
      expect(result.current.list.data).toEqual([exam])
    })
  })

  it('useDeleteExam returns the version id, and useUndo sends it back', async () => {
    const fake = createFakeApi()
      .on('DELETE /exams/e1', { version_id: 'v1', plan_affected: true })
      .on('POST /plan/undo', { restored: 1, deleted: 0, replaced: [], unplaced: [] })
    const { wrapper } = setup(fake)
    const { result } = renderHook(() => ({ remove: useDeleteExam(), undo: useUndo() }), { wrapper })

    const deleted = await act(() => result.current.remove.mutateAsync('e1'))
    expect(deleted).toEqual({ version_id: 'v1', plan_affected: true })
    await act(() => result.current.undo.mutateAsync('v1'))
    expect(fake.calls('POST', '/plan/undo')[0]?.body).toEqual({ version_id: 'v1' })
  })

  it('useUpdateMe patches /me and puts the answer in the me cache', async () => {
    const fake = createFakeApi()
      .on('GET /me', me)
      .on('PATCH /me', (call: { body: unknown }) => ({ ...me, ...(call.body as object), plan_affected: false }))
    const { wrapper, queryClient } = setup(fake)
    const { result } = renderHook(() => ({ me: useMe(), update: useUpdateMe() }), { wrapper })
    await waitFor(() => {
      expect(result.current.me.isSuccess).toBe(true)
    })

    const answer = await act(() => result.current.update.mutateAsync({ daily_study_minutes: 180, study_windows: ['evening'] }))

    expect(answer.plan_affected).toBe(false)
    expect(fake.calls('PATCH', '/me')[0]?.body).toEqual({ daily_study_minutes: 180, study_windows: ['evening'] })
    expect(queryClient.getQueryData(meKey('user-a'))).toEqual({ ...me, daily_study_minutes: 180, study_windows: ['evening'] })
    await waitFor(() => {
      expect(result.current.me.data?.daily_study_minutes).toBe(180)
    })
  })

  it('useDeleteMaterial deletes and refetches the materials', async () => {
    let list = [material('m1', 'ready')]
    const fake = createFakeApi()
      .on('GET /exams/e1/materials', () => list)
      .on('DELETE /materials/m1', () => {
        list = []
        return undefined
      })
    const { wrapper, queryClient } = setup(fake)
    const { result } = renderHook(() => ({ list: useMaterials('e1'), remove: useDeleteMaterial() }), { wrapper })
    await waitFor(() => {
      expect(result.current.list.data).toHaveLength(1)
    })

    await act(() => result.current.remove.mutateAsync('m1'))

    expect(fake.calls('DELETE', '/materials/m1')).toHaveLength(1)
    await waitFor(() => {
      expect(queryClient.getQueryData(materialsKey('user-a', 'e1'))).toEqual([])
    })
  })

  it('useUploadMaterial uploads under the signed-in user and refetches the materials', async () => {
    let list: Material[] = []
    const fake = createFakeApi()
      .on('GET /exams/e1/materials', () => list)
      .on('POST /exams/e1/materials', () => {
        list = [material('m1', 'queued')]
        return { material: list[0], job_id: 'j1' }
      })
    const { wrapper, storage } = setup(fake)
    const { result } = renderHook(() => ({ list: useMaterials('e1'), upload: useUploadMaterial('e1') }), { wrapper })
    await waitFor(() => {
      expect(result.current.list.data).toEqual([])
    })

    await act(() => result.current.upload.mutateAsync({ file: new File(['x'], 'a.pdf', { type: 'application/pdf' }), kind: 'past_exam' }))

    expect(storage.upload.mock.calls[0]?.[0]).toMatch(/^user-a\/e1\//)
    await waitFor(() => {
      expect(result.current.list.data).toHaveLength(1)
    })
  })

  it('useGenerate posts /plans/generate', async () => {
    const fake = createFakeApi().on('POST /plans/generate', { job_id: 'j1', created: true })
    const { wrapper } = setup(fake)
    const { result } = renderHook(() => useGenerate(), { wrapper })

    await expect(act(() => result.current.mutateAsync())).resolves.toEqual({ job_id: 'j1', created: true })
    expect(fake.calls('POST', '/plans/generate')).toHaveLength(1)
  })

  it('useReplanPreview asks for a preview, and useReplanApply applies its basis', async () => {
    const preview = { basis: 'b1', changed: true, version_id: null, added: [], removed: [], unscheduled: [], shortfalls: [], warnings: [] }
    const fake = createFakeApi().on('POST /plan/replan', (call: { body: unknown }) =>
      (call.body as { preview: boolean }).preview ? preview : { ...preview, basis: 'b2', version_id: 'v2' },
    )
    const { wrapper } = setup(fake)
    const { result } = renderHook(() => ({ preview: useReplanPreview(), apply: useReplanApply() }), { wrapper })

    const shown = await act(() => result.current.preview.mutateAsync())
    const applied = await act(() => result.current.apply.mutateAsync(shown.basis))

    expect(fake.calls('POST', '/plan/replan').map((c) => c.body)).toEqual([{ preview: true }, { preview: false, basis: 'b1' }])
    expect(applied.version_id).toBe('v2')
  })
})
