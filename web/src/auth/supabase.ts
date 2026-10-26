import { createClient, type AuthChangeEvent, type Session } from '@supabase/supabase-js'
import type { WebEnv } from '../config/env'

// The web talks to Supabase only through supabase.auth (design doc 7.2): everything else goes through the API.
// The return type is the SupabaseClient that createClient infers without table types. Spelling it as plain
// SupabaseClient fails no-unsafe-return, because createClient infers `any` for one of its type parameters.
export function createSupabase(env: WebEnv): ReturnType<typeof createClient> {
  // PKCE instead of the implicit default: the URL that comes back carries a one-time code that is
  // worthless without the verifier in this browser, not the token itself. detectSessionInUrl,
  // persistSession and autoRefreshToken keep their defaults.
  return createClient(env.supabaseUrl, env.supabasePublishableKey, { auth: { flowType: 'pkce' } })
}

// The part of supabase.auth the app uses, in the narrow types it needs. SupabaseClient['auth']
// satisfies it without a cast, and tests pass a fake.
export interface AuthClient {
  getSession(): Promise<{ data: { session: Session | null }; error: Error | null }>
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
