import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useApi } from '../api/ApiContext'
import type { ApiError } from '../api/client'
import { boardKey, useBoardUserId } from '../board/api'
import type { Progress } from './types'

// A child of the board key: every block action (S14) already invalidates ['board', userId], and
// TanStack Query refreshes the children with it, so XP and the streak follow "done" with no change
// to board/.
export function progressKey(userId: string | null) {
  return [...boardKey(userId), 'progress'] as const
}

export function useProgress(): UseQueryResult<Progress, ApiError> {
  const api = useApi()
  const userId = useBoardUserId()
  return useQuery<Progress, ApiError>({
    queryKey: progressKey(userId),
    queryFn: ({ signal }) => api.get<Progress>('/progress', { signal }),
    enabled: userId !== null,
  })
}
