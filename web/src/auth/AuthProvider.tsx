import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AUTH_CALLBACK_PATH, AuthContext, type AuthState, type AuthValue } from './AuthContext'
import type { AuthClient } from './supabase'

// Holds the one auth state of the app. supabase-js does the PKCE exchange and the token refresh;
// this only listens to it.
export function AuthProvider({ auth, children }: { auth: AuthClient; children: ReactNode }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  useEffect(() => {
    // The user whose data the query cache may hold.
    let userId: string | null = null
    // INITIAL_SESSION arrives once supabase-js has read storage and handled a ?code= in the URL.
    // Only set state in here: awaiting another supabase call inside this callback deadlocks supabase-js.
    const { data } = auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user.id ?? null
      if (nextUserId !== userId) {
        // Signed out, or another user: no screen may show the previous user's data.
        // A token refresh of the same user keeps the cache.
        userId = nextUserId
        queryClient.clear()
      }
      setState(session === null ? { status: 'signed_out' } : { status: 'signed_in', session })
    })
    return () => {
      data.subscription.unsubscribe()
    }
  }, [auth, queryClient])

  const value = useMemo<AuthValue>(
    () => ({
      ...state,
      signInWithGoogle: async () => {
        const { error } = await auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: `${window.location.origin}${AUTH_CALLBACK_PATH}` },
        })
        if (error !== null) throw error
      },
      signOut: async () => {
        // With scope 'local', supabase-js removes the session in this browser and emits SIGNED_OUT
        // even when the call to Supabase fails, so the user is signed out either way.
        await auth.signOut({ scope: 'local' })
      },
    }),
    [auth, state],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
