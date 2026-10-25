import { createApiClient, type ApiClient } from '../api/client'
import type { AuthClient } from '../auth/supabase'

// Connects the API client to the session: it sends the current access token, and signs the user out
// in this browser only when the API client reports there is no valid session.
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
    onUnauthenticated: () => {
      void auth.signOut({ scope: 'local' })
    },
  })
}
