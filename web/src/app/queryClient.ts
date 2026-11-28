import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '../api/client'

const MAX_RETRIES = 2

// A 4xx will not change by asking again. A 5xx or a missing response (status 0) may.
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
  return failureCount < MAX_RETRIES
}

// One client for the life of the app (main.tsx).
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry },
      // 'always': a mutation without a network fails now. The default pauses it and it resumes by itself
      // when the network returns, which is a write queue, and we decided against one (18.11).
      mutations: { networkMode: 'always' },
    },
  })
}
