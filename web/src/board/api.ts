import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import { useApi } from '../api/ApiContext'
import { errorMessage, type ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../ui/useToast'
import type { ExamSummary, Plan, ReplanPreview, Today } from './types'

// Every board query lives under ['board', userId], so one action refreshes "today" and "week" together,
// and another user never sees a cached answer.
export function boardKey(userId: string | null) {
  return ['board', userId] as const
}
export function todayKey(userId: string | null) {
  return [...boardKey(userId), 'today'] as const
}
export function planKey(userId: string | null, from?: string, to?: string) {
  return [...boardKey(userId), 'plan', from ?? null, to ?? null] as const
}
export function examsKey(userId: string | null) {
  return [...boardKey(userId), 'exams'] as const
}
export function reportKey(userId: string | null) {
  return [...boardKey(userId), 'report'] as const
}

// The block state (upcoming, in_progress, overdue) is derived on the server from `now`, so an open
// screen asks again every minute, and when the window regains focus (TanStack's default).
const REFRESH_MS = 60_000

export function useBoardUserId(): string | null {
  const auth = useAuth()
  return auth.status === 'signed_in' ? auth.session.user.id : null
}

export function useToday(): UseQueryResult<Today, ApiError> {
  const api = useApi()
  const userId = useBoardUserId()
  return useQuery<Today, ApiError>({
    queryKey: todayKey(userId),
    queryFn: ({ signal }) => api.get<Today>('/today', { signal }),
    enabled: userId !== null,
    refetchInterval: REFRESH_MS,
  })
}

// Without a range the server shows seven days from today.
export function usePlan(from?: string, to?: string): UseQueryResult<Plan, ApiError> {
  const api = useApi()
  const userId = useBoardUserId()
  return useQuery<Plan, ApiError>({
    queryKey: planKey(userId, from, to),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams()
      if (from !== undefined) params.set('from', from)
      if (to !== undefined) params.set('to', to)
      const query = params.toString()
      return api.get<Plan>(query === '' ? '/plan' : `/plan?${query}`, { signal })
    },
    enabled: userId !== null,
    refetchInterval: REFRESH_MS,
  })
}

export function useBoardExams(): UseQueryResult<ExamSummary[], ApiError> {
  const api = useApi()
  const userId = useBoardUserId()
  return useQuery<ExamSummary[], ApiError>({
    queryKey: examsKey(userId),
    queryFn: ({ signal }) => api.get<ExamSummary[]>('/exams', { signal }),
    enabled: userId !== null,
  })
}

// Why tasks did not fit: only the replan preview runs the planner (GET /plan does not), and the
// preview writes nothing. Run it only when there is something to explain.
export function useReport(enabled: boolean): UseQueryResult<ReplanPreview, ApiError> {
  const api = useApi()
  const userId = useBoardUserId()
  return useQuery<ReplanPreview, ApiError>({
    queryKey: reportKey(userId),
    queryFn: ({ signal }) => api.post<ReplanPreview>('/plan/replan', { preview: true }, { signal }),
    enabled: enabled && userId !== null,
  })
}

// PATCH /me {daily_study_minutes}. The board does not change by itself: a change of hours is global
// and goes through a replan preview (spec 7.6 step 8), which the caller offers.
export function useRaiseDailyMinutes(): UseMutationResult<unknown, ApiError, number> {
  const api = useApi()
  const userId = useBoardUserId()
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation<unknown, ApiError, number>({
    mutationFn: (minutes) => api.patch('/me', { daily_study_minutes: minutes }),
    onError: (error) => {
      toast.show({ text: errorMessage(error), tone: 'error' })
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: boardKey(userId) }),
        queryClient.invalidateQueries({ queryKey: ['me', userId] }),
      ]),
  })
}
