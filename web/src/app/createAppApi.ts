import { createApiClient, type ApiClient } from '../api/client'
import type { AuthClient } from '../auth/supabase'

// An Auth failure that says nothing about the session: no answer (our timeout, or the browser's
// network error, which auth-js reports as AuthRetryableFetchError).
function isTemporary(error: Error): boolean {
  return error.name === 'AuthRetryableFetchError' || error.name === 'FetchTimeoutError'
}

// Connects the API client to the session: it sends the current access token, refreshes it once when
// the API answers 401, and signs the user out in this browser only when the session is not valid.
export function createAppApi(apiUrl: string, auth: AuthClient): ApiClient {
  return createApiClient({
    baseUrl: apiUrl,
    getAccessToken: async () => {
      const { data, error } = await auth.getSession()
      // supabase-js returns no session plus an error when it cannot refresh an expired token, and keeps
      // the stored session when the cause is temporary (offline, Auth down). Throwing keeps the user signed in.
      if (error !== null) throw error
      return data.session?.access_token ?? null
    },
    refreshAccessToken: async () => {
      const { data, error } = await auth.refreshSession()
      if (error !== null && isTemporary(error)) throw error
      return data.session?.access_token ?? null
    },
    onUnauthenticated: () => {
      void auth.signOut({ scope: 'local' })
    },
  })
}
