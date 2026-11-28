import type { Session } from '@supabase/auth-js'
import { createContext, useContext } from 'react'

// Supabase sends the browser back here with ?code=... (or ?error=...). Also listed in the
// Redirect URLs of the Supabase project.
export const AUTH_CALLBACK_PATH = '/auth/callback'

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'signed_in'; session: Session }
  // No network, and the session could not be read (an expired token that cannot be refreshed offline):
  // the snapshot's owner, read only. Never a Session: nothing here can call the API.
  | { status: 'offline'; userId: string }

// Property syntax rather than methods, so `const { signOut } = useAuth()` is not an unbound method.
export type AuthValue = AuthState & {
  // Rejects when Supabase cannot start the sign-in. On success the browser leaves for Google.
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthValue | null>(null)

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (value === null) {
    throw new Error('useAuth() must be used inside <AuthProvider>')
  }
  return value
}
