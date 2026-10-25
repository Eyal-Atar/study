import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { useApi } from './ApiContext'
import type { ApiError } from './client'

export interface Me {
  id: string
  email: string | null
}

// The signed-in user as the API sees them. The user id is in the key, so a different user never sees a cached answer.
export function useMe(): UseQueryResult<Me, ApiError> {
  const auth = useAuth()
  const api = useApi()
  const userId = auth.status === 'signed_in' ? auth.session.user.id : null
  return useQuery<Me, ApiError>({
    queryKey: ['me', userId],
    queryFn: ({ signal }) => api.get<Me>('/me', { signal }),
    enabled: userId !== null,
  })
}
