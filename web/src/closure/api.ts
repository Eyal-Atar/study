import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useApi } from '../api/ApiContext'
import type { ApiError } from '../api/client'
import { boardKey, useBoardUserId } from '../board/api'
import type { Closures } from './types'

// GET /closures (7.13): the exams waiting for the student's decision, and those waiting for Moed B.

// Under the board, so every board action and every Undo refreshes the closures.
export function closuresKey(userId: string | null) {
  return [...boardKey(userId), 'closures'] as const
}

// Decision 16: five minutes. When 19:00 passes with the calendar open the sheet should appear without a
// page refresh, and five minutes is an acceptable delay for an evening ritual; a request a minute (like
// GET /today) would run the exam statistics for nothing. The default refetch on window focus stays.
export const CLOSURES_REFRESH_MS = 5 * 60_000

export function useClosures(): UseQueryResult<Closures, ApiError> {
  const api = useApi()
  const userId = useBoardUserId()
  return useQuery<Closures, ApiError>({
    queryKey: closuresKey(userId),
    queryFn: ({ signal }) => api.get<Closures>('/closures', { signal }),
    enabled: userId !== null,
    refetchInterval: CLOSURES_REFRESH_MS,
  })
}
