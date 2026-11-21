import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import { useApi } from '../api/ApiContext'
import type { ApiError } from '../api/client'
import { boardKey, useBoardUserId } from '../board/api'
import type { DeferResult, Slots } from '../board/types'
import type {
  BusyEvent,
  BusyEventInput,
  BusyEventPatch,
  BusyEventWriteResponse,
  Commitment,
  CommitmentDeleteResponse,
  CommitmentInput,
  CommitmentPatch,
  CommitmentWriteResponse,
  DeferRequest,
  FreeTimeResponse,
  TimetableApply,
  TimetableApplyResponse,
  TimetableRegister,
  TimetableRegisterResponse,
} from './types'

// The calls of S35 for the screens of S32 (calendar) and S34 (onboarding, settings). Everything
// lives under the board key, so a change refreshes "today" and the calendar with it.
export function commitmentsKey(userId: string | null) {
  return [...boardKey(userId), 'commitments'] as const
}
export function busyEventsKey(userId: string | null, from?: string, to?: string) {
  return [...boardKey(userId), 'busy-events', from ?? null, to ?? null] as const
}

function useRefreshBoard(): () => Promise<void> {
  const queryClient = useQueryClient()
  const userId = useBoardUserId()
  return () => queryClient.invalidateQueries({ queryKey: boardKey(userId) })
}

const id = (value: string) => encodeURIComponent(value)

export function useCommitments(): UseQueryResult<Commitment[], ApiError> {
  const api = useApi()
  const userId = useBoardUserId()
  return useQuery<Commitment[], ApiError>({
    queryKey: commitmentsKey(userId),
    queryFn: async ({ signal }) =>
      (await api.get<{ commitments: Commitment[] }>('/commitments', { signal })).commitments,
    enabled: userId !== null,
  })
}

// After a write with plan_affected, offer POST /plan/replan (preview, then apply with basis).
export function useCreateCommitment(): UseMutationResult<CommitmentWriteResponse, ApiError, CommitmentInput> {
  const api = useApi()
  const refresh = useRefreshBoard()
  return useMutation<CommitmentWriteResponse, ApiError, CommitmentInput>({
    mutationFn: (body) => api.post<CommitmentWriteResponse>('/commitments', body),
    onSuccess: refresh,
  })
}

export function useUpdateCommitment(): UseMutationResult<
  CommitmentWriteResponse,
  ApiError,
  { id: string; patch: CommitmentPatch }
> {
  const api = useApi()
  const refresh = useRefreshBoard()
  return useMutation<CommitmentWriteResponse, ApiError, { id: string; patch: CommitmentPatch }>({
    mutationFn: ({ id: commitmentId, patch }) =>
      api.patch<CommitmentWriteResponse>(`/commitments/${id(commitmentId)}`, patch),
    onSuccess: refresh,
  })
}

export function useDeleteCommitment(): UseMutationResult<CommitmentDeleteResponse, ApiError, string> {
  const api = useApi()
  const refresh = useRefreshBoard()
  return useMutation<CommitmentDeleteResponse, ApiError, string>({
    mutationFn: (commitmentId) => api.delete<CommitmentDeleteResponse>(`/commitments/${id(commitmentId)}`),
    onSuccess: refresh,
  })
}

// Local dates; without them, today and the next six days. The calendar itself gets busy time from
// GET /plan (`busy`), so this list is for managing events.
export function useBusyEvents(from?: string, to?: string): UseQueryResult<BusyEvent[], ApiError> {
  const api = useApi()
  const userId = useBoardUserId()
  return useQuery<BusyEvent[], ApiError>({
    queryKey: busyEventsKey(userId, from, to),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams()
      if (from !== undefined) params.set('from', from)
      if (to !== undefined) params.set('to', to)
      const query = params.toString()
      const path = query === '' ? '/busy-events' : `/busy-events?${query}`
      return (await api.get<{ events: BusyEvent[] }>(path, { signal })).events
    },
    enabled: userId !== null,
  })
}

// The answer's version_id is the "Undo" of the toast (POST /plan/undo).
export function useCreateBusyEvent(): UseMutationResult<BusyEventWriteResponse, ApiError, BusyEventInput> {
  const api = useApi()
  const refresh = useRefreshBoard()
  return useMutation<BusyEventWriteResponse, ApiError, BusyEventInput>({
    mutationFn: (body) => api.post<BusyEventWriteResponse>('/busy-events', body),
    onSuccess: refresh,
  })
}

export function useUpdateBusyEvent(): UseMutationResult<
  BusyEventWriteResponse,
  ApiError,
  { id: string; patch: BusyEventPatch }
> {
  const api = useApi()
  const refresh = useRefreshBoard()
  return useMutation<BusyEventWriteResponse, ApiError, { id: string; patch: BusyEventPatch }>({
    mutationFn: ({ id: eventId, patch }) =>
      api.patch<BusyEventWriteResponse>(`/busy-events/${id(eventId)}`, patch),
    onSuccess: refresh,
  })
}

// Deleting an event moves nothing: the time is simply free for the next plan.
export function useDeleteBusyEvent(): UseMutationResult<undefined, ApiError, string> {
  const api = useApi()
  const refresh = useRefreshBoard()
  return useMutation<undefined, ApiError, string>({
    mutationFn: (eventId) => api.delete(`/busy-events/${id(eventId)}`),
    onSuccess: refresh,
  })
}

// "I have time now".
export function useFreeTime(): UseMutationResult<FreeTimeResponse, ApiError, number> {
  const api = useApi()
  const refresh = useRefreshBoard()
  return useMutation<FreeTimeResponse, ApiError, number>({
    mutationFn: (minutes) => api.post<FreeTimeResponse>('/plan/free-time', { minutes }),
    onSuccess: refresh,
  })
}

// "Pick a time": the free starts of one study day for the block (any day from today to the exam's
// last study day; a date outside → 422 with loc ["query","date"]).
export function deferSlotsKey(userId: string | null, blockId: string, date: string) {
  return [...boardKey(userId), 'defer-slots', blockId, date] as const
}

export function useDeferSlots(blockId: string, date: string): UseQueryResult<Slots, ApiError> {
  const api = useApi()
  const userId = useBoardUserId()
  return useQuery<Slots, ApiError>({
    queryKey: deferSlotsKey(userId, blockId, date),
    queryFn: ({ signal }) =>
      api.get<Slots>(`/blocks/${id(blockId)}/slots?date=${encodeURIComponent(date)}`, { signal }),
    enabled: userId !== null,
  })
}

// The three defer choices; failures: placement_failed, outside_day, slot_taken, slot_busy.
export function useDeferChoice(): UseMutationResult<DeferResult, ApiError, { blockId: string; body: DeferRequest }> {
  const api = useApi()
  const refresh = useRefreshBoard()
  return useMutation<DeferResult, ApiError, { blockId: string; body: DeferRequest }>({
    mutationFn: ({ blockId, body }) => api.post<DeferResult>(`/blocks/${id(blockId)}/defer`, body),
    onSuccess: refresh,
  })
}

export function useRegisterTimetable(): UseMutationResult<TimetableRegisterResponse, ApiError, TimetableRegister> {
  const api = useApi()
  return useMutation<TimetableRegisterResponse, ApiError, TimetableRegister>({
    mutationFn: (body) => api.post<TimetableRegisterResponse>('/timetables', body),
  })
}

export function useApplyTimetable(): UseMutationResult<
  TimetableApplyResponse,
  ApiError,
  { jobId: string; body: TimetableApply }
> {
  const api = useApi()
  const refresh = useRefreshBoard()
  return useMutation<TimetableApplyResponse, ApiError, { jobId: string; body: TimetableApply }>({
    mutationFn: ({ jobId, body }) => api.post<TimetableApplyResponse>(`/timetables/${id(jobId)}/apply`, body),
    onSuccess: refresh,
  })
}
