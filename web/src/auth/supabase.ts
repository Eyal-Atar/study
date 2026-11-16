import { GoTrueClient, type AuthChangeEvent, type Session } from '@supabase/auth-js'
import { StorageClient } from '@supabase/storage-js'
import type { WebEnv } from '../config/env'
import { createTimeoutFetch } from './timeoutFetch'

// Every Supabase request, Auth and Storage, gets a timeout (timeoutFetch.ts).
export const SUPABASE_TIMEOUT_MS = 15000
export const SUPABASE_UPLOAD_TIMEOUT_MS = 120000
// auth-js retries a failed refresh for up to 30 seconds (AUTO_REFRESH_TICK_DURATION_MS).
export const AUTH_TIMEOUT_COOLDOWN_MS = 30000

export interface Supabase {
  auth: GoTrueClient
  storage: StorageClient
}

// The web talks to Supabase only through Auth and one Storage upload (design doc 7.2): everything
// else goes through the API. So it builds the two clients itself instead of supabase-js's
// createClient, which also bundles PostgREST, Realtime and Functions (~55 kB gzip). The setup
// below is what createClient 2.119 does for these two clients.
export function createSupabase(env: WebEnv): Supabase {
  const key = env.supabasePublishableKey
  // https://<project-ref>.supabase.co -> <project-ref>, as createClient derives it.
  const projectRef = new URL(env.supabaseUrl).hostname.split('.')[0] ?? ''
  // One instance for Auth and Storage, as createClient shares global.fetch: an Auth timeout starts
  // the cooldown for every Auth request, whoever sent it.
  const timeoutFetch = createTimeoutFetch({
    timeoutMs: SUPABASE_TIMEOUT_MS,
    uploadTimeoutMs: SUPABASE_UPLOAD_TIMEOUT_MS,
    cooldownMs: AUTH_TIMEOUT_COOLDOWN_MS,
  })
  const auth = new GoTrueClient({
    url: `${env.supabaseUrl}/auth/v1`,
    // supabase-js's default key. auth-js's own default is different, so without this every
    // signed-in user would lose the session stored by the supabase-js build.
    storageKey: `sb-${projectRef}-auth-token`,
    // PKCE instead of the implicit default: the URL that comes back carries a one-time code that is
    // worthless without the verifier in this browser, not the token itself. detectSessionInUrl,
    // persistSession and autoRefreshToken are left out, not passed as undefined: auth-js spreads
    // these options over its defaults (all true).
    flowType: 'pkce',
    // The headers createClient gives Auth. They replace auth-js's default headers, as there.
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    fetch: timeoutFetch,
  })
  // Like supabase-js's fetchWithAuth: each Storage request carries the current access token
  // (getSession refreshes an expired one first), or the publishable key without a session.
  // A header the caller set wins.
  const storageFetch: typeof fetch = async (input, init) => {
    const { data } = await auth.getSession()
    const headers = new Headers(init?.headers)
    if (!headers.has('apikey')) headers.set('apikey', key)
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${data.session?.access_token ?? key}`)
    return timeoutFetch(input, { ...init, headers })
  }
  const storage = new StorageClient(`${env.supabaseUrl}/storage/v1`, {}, storageFetch)
  return { auth, storage }
}

// The part of supabase.auth the app uses, in the narrow types it needs. GoTrueClient
// satisfies it without a cast, and tests pass a fake.
export interface AuthClient {
  getSession(): Promise<{ data: { session: Session | null }; error: Error | null }>
  // Asks Auth for a new access token now (after the API answered 401).
  refreshSession(): Promise<{ data: { session: Session | null }; error: Error | null }>
  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void): {
    data: { subscription: { unsubscribe: () => void } }
  }
  signInWithOAuth(credentials: {
    provider: 'google'
    // prompt=select_account makes Google show the account chooser, even when one account is signed in.
    options: { redirectTo: string; queryParams: { prompt: 'select_account' } }
  }): Promise<{ error: Error | null }>
  // Only 'local': the default 'global' would sign the user out on every device.
  signOut(options: { scope: 'local' }): Promise<{ error: Error | null }>
}
