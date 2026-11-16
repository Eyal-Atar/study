import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import { useApi } from '../api/ApiContext'
import type { ApiError } from '../api/client'
import { meKey, useUserId, type Me, type MePatch, type MePatchResponse } from '../api/me'
import { boardKey } from '../board/api'
import type {
  Exam,
  ExamCreate,
  ExamDeleteResponse,
  ExamResponse,
  GenerateResponse,
  GenerateResult,
  Job,
  Material,
  ReplanPreview,
  UndoResponse,
} from './types'

export * from './types'

// Materials and jobs are polled every 2 seconds until their status is final (S13 Global Constraints).
export const POLL_INTERVAL_MS = 2000

// Query keys. Each starts with the resource and the user id, so invalidating ['materials', userId]
// covers every exam, and a different user never sees a cached answer. S14 keys its plan and today
// queries under planKey / todayKey, so the mutations here refresh them.
export const examsKey = (userId: string | null) => ['exams', userId] as const
export const materialsKey = (userId: string | null, examId?: string) =>
  (examId === undefined ? ['materials', userId] : ['materials', userId, examId]) as readonly unknown[]
export const jobKey = (userId: string | null, jobId: string | null) => ['job', userId, jobId] as const
export const planKey = (userId: string | null) => ['plan', userId] as const
export const todayKey = (userId: string | null) => ['today', userId] as const

// What a change to the plan makes stale: the plan views, and the exams list (an undo can bring an exam back).
function invalidatePlan(queryClient: ReturnType<typeof useQueryClient>, userId: string | null) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: planKey(userId) }),
    queryClient.invalidateQueries({ queryKey: todayKey(userId) }),
    // The today and week screens (S14) keep the board under one key.
    queryClient.invalidateQueries({ queryKey: boardKey(userId) }),
  ])
}

export function useExams(): UseQueryResult<Exam[], ApiError> {
  const api = useApi()
  const userId = useUserId()
  return useQuery<Exam[], ApiError>({
    queryKey: examsKey(userId),
    queryFn: ({ signal }) => api.get<Exam[]>('/exams', { signal }),
    enabled: userId !== null,
  })
}

export function useCreateExam(): UseMutationResult<ExamResponse, ApiError, ExamCreate> {
  const api = useApi()
  const userId = useUserId()
  const queryClient = useQueryClient()
  return useMutation<ExamResponse, ApiError, ExamCreate>({
    mutationFn: (body) => api.post<ExamResponse>('/exams', body),
    onSuccess: () =>
      Promise.all([queryClient.invalidateQueries({ queryKey: examsKey(userId) }), invalidatePlan(queryClient, userId)]),
  })
}

// The answer's version_id is what useUndo takes back (the "בטל" of the toast).
export function useDeleteExam(): UseMutationResult<ExamDeleteResponse, ApiError, string> {
  const api = useApi()
  const userId = useUserId()
  const queryClient = useQueryClient()
  return useMutation<ExamDeleteResponse, ApiError, string>({
    mutationFn: (examId) => api.delete<ExamDeleteResponse>(`/exams/${examId}`),
    onSuccess: (_answer, examId) => {
      // The exam's materials go with it: no polling of a list that is gone.
      queryClient.removeQueries({ queryKey: materialsKey(userId, examId) })
      return Promise.all([queryClient.invalidateQueries({ queryKey: examsKey(userId) }), invalidatePlan(queryClient, userId)])
    },
  })
}

// POST /plan/undo with the version_id of the change to take back.
export function useUndo(): UseMutationResult<UndoResponse, ApiError, string> {
  const api = useApi()
  const userId = useUserId()
  const queryClient = useQueryClient()
  return useMutation<UndoResponse, ApiError, string>({
    mutationFn: (versionId) => api.post<UndoResponse>('/plan/undo', { version_id: versionId }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: examsKey(userId) }),
        queryClient.invalidateQueries({ queryKey: materialsKey(userId) }),
        invalidatePlan(queryClient, userId),
      ]),
  })
}

// The profile part of a PATCH /me answer, without plan_affected.
function toMe(answer: MePatchResponse): Me {
  return {
    id: answer.id,
    email: answer.email,
    display_name: answer.display_name,
    timezone: answer.timezone,
    wake_time: answer.wake_time,
    sleep_time: answer.sleep_time,
    daily_study_minutes: answer.daily_study_minutes,
    study_windows: answer.study_windows,
    rest_days_before_exam: answer.rest_days_before_exam,
    notify_lead_minutes: answer.notify_lead_minutes,
    study_start_delay_minutes: answer.study_start_delay_minutes,
    hobby_start: answer.hobby_start,
    hobby_minutes: answer.hobby_minutes,
    onboarding_completed_at: answer.onboarding_completed_at,
  }
}

// PATCH /me. The answer is the whole profile, so it replaces the me cache without another GET.
// plan_affected says the caller should offer a replan (ReplanOffer).
export function useUpdateMe(): UseMutationResult<MePatchResponse, ApiError, MePatch> {
  const api = useApi()
  const userId = useUserId()
  const queryClient = useQueryClient()
  return useMutation<MePatchResponse, ApiError, MePatch>({
    mutationFn: (body) => api.patch<MePatchResponse>('/me', body),
    onSuccess: (answer) => {
      queryClient.setQueryData<Me>(meKey(userId), toMe(answer))
    },
  })
}

function ingesting(materials: Material[] | undefined): boolean {
  return materials?.some((m) => m.ingest_status === 'queued' || m.ingest_status === 'processing') ?? false
}

// GET /exams/{id}/materials, polled while any material is still being read.
export function useMaterials(examId: string | null): UseQueryResult<Material[], ApiError> {
  const api = useApi()
  const userId = useUserId()
  return useQuery<Material[], ApiError>({
    queryKey: materialsKey(userId, examId ?? undefined),
    queryFn: ({ signal }) => api.get<Material[]>(`/exams/${String(examId)}/materials`, { signal }),
    enabled: userId !== null && examId !== null,
    refetchInterval: (query) => (ingesting(query.state.data) ? POLL_INTERVAL_MS : false),
  })
}

// DELETE /materials/{id}: a hard delete, so the screen delays it behind the toast's "בטל" (S13, 10 seconds).
export function useDeleteMaterial(): UseMutationResult<undefined, ApiError, string> {
  const api = useApi()
  const userId = useUserId()
  const queryClient = useQueryClient()
  return useMutation<undefined, ApiError, string>({
    mutationFn: (materialId) => api.delete(`/materials/${materialId}`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: materialsKey(userId) }),
  })
}

// POST /plans/generate. Returns the active job (created: false) when there is one, so a second press or a
// refresh never starts a second job.
// The return type is inferred: its variables are void, so mutate() takes no argument.
export function useGenerate() {
  const api = useApi()
  return useMutation<GenerateResponse, ApiError>({
    mutationFn: () => api.post<GenerateResponse>('/plans/generate'),
  })
}

// GET /jobs/{id}, polled until the job is done or failed (or the request fails). R is the result's shape
// for the job's kind; generate_plan's is GenerateResult.
export function useJob<R = GenerateResult>(jobId: string | null): UseQueryResult<Job<R>, ApiError> {
  const api = useApi()
  const userId = useUserId()
  return useQuery<Job<R>, ApiError>({
    queryKey: jobKey(userId, jobId),
    queryFn: ({ signal }) => api.get<Job<R>>(`/jobs/${String(jobId)}`, { signal }),
    enabled: userId !== null && jobId !== null,
    refetchInterval: (query) => {
      if (query.state.status === 'error') return false
      const status = query.state.data?.status
      return status === 'done' || status === 'failed' ? false : POLL_INTERVAL_MS
    },
  })
}

// POST /plan/replan {preview: true}: what a replan would change, and the basis an apply sends back.
export function useReplanPreview() {
  const api = useApi()
  return useMutation<ReplanPreview, ApiError>({
    mutationFn: () => api.post<ReplanPreview>('/plan/replan', { preview: true }),
  })
}

// POST /plan/replan {preview: false, basis}. stale_plan means the board changed since the preview.
// Applying writes the plan, and the first plan also ends the onboarding, so me is refetched too.
// onApplied runs here, before me is invalidated, and not in mutate's callbacks: a fresh me can end the
// onboarding, the gate then navigates away, and mutate's callbacks never run once the screen unmounts.
export function useReplanApply({
  onApplied,
}: { onApplied?: (answer: ReplanPreview) => void } = {}): UseMutationResult<ReplanPreview, ApiError, string> {
  const api = useApi()
  const userId = useUserId()
  const queryClient = useQueryClient()
  return useMutation<ReplanPreview, ApiError, string>({
    mutationFn: (basis) => api.post<ReplanPreview>('/plan/replan', { preview: false, basis }),
    onSuccess: (answer) => {
      onApplied?.(answer)
      return Promise.all([queryClient.invalidateQueries({ queryKey: meKey(userId) }), invalidatePlan(queryClient, userId)])
    },
  })
}
