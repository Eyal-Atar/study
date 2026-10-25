import { QueryClient } from '@tanstack/react-query'

// One client for the life of the app (main.tsx). The retry policy for API errors comes with the API client.
export function createQueryClient(): QueryClient {
  return new QueryClient()
}
