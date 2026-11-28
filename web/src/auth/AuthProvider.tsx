import type { Session } from '@supabase/auth-js'
import { onlineManager, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { clearInbox } from '../celebrate/inbox'
import { clearSnapshot, readSnapshotOwner, startSnapshot } from '../offline/snapshot'
import { AUTH_CALLBACK_PATH, AuthContext, type AuthState, type AuthValue } from './AuthContext'
import type { AuthClient } from './supabase'

// Without a network, the device snapshot's owner is known before supabase-js answers (which can take
// 30 seconds of refresh retries): the first render already shows the last calendar, read only.
function initialState(): AuthState {
  const owner = readSnapshotOwner()
  return onlineManager.isOnline() || owner === null ? { status: 'loading' } : { status: 'offline', userId: owner }
}

// Holds the one auth state of the app, and owns the device snapshot (offline/snapshot.ts): it says
// whose it is, writes it only while signed in, and deletes it whenever the user leaves or changes.
// supabase-js does the PKCE exchange and the token refresh; this only listens to it.
export function AuthProvider({ auth, children }: { auth: AuthClient; children: ReactNode }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<AuthState>(initialState)
  // The latest state, for the auth callback and the snapshot writer, which cannot wait for a render.
  const stateRef = useRef(state)

  useEffect(() => {
    const set = (next: AuthState) => {
      stateRef.current = next
      setState(next)
    }
    // The user whose data the query cache may hold. Not null at first: main.tsx has already loaded the
    // snapshot of its owner into the cache.
    let userId = readSnapshotOwner()
    let active = true
    // Bumped by every auth event: a session read that an event overtook is stale.
    let events = 0
    let initialSeen = false
    let reading = false

    const accept = (session: Session | null) => {
      const nextUserId = session?.user.id ?? null
      if (nextUserId !== userId) {
        // Signed out, or another user: no screen may show the previous user's data.
        // A token refresh of the same user keeps the cache.
        userId = nextUserId
        queryClient.clear()
        // The celebration inbox (S33) holds the previous user's Done events outside the cache.
        clearInbox()
        // And the device snapshot holds the previous user's calendar.
        clearSnapshot()
      }
      set(session === null ? { status: 'signed_out' } : { status: 'signed_in', session })
    }

    // Offline with a network again: asks supabase-js for the session, which refreshes the token now.
    // Never from inside the auth callback (see below), and one read at a time.
    const readSession = () => {
      if (reading || !active) return
      reading = true
      const seen = events
      auth.getSession().then(
        ({ data: { session }, error }) => {
          reading = false
          if (!active || events !== seen || stateRef.current.status !== 'offline') return
          // Auth still unreachable (a retryable failure): stay offline. A token Supabase rejects is
          // removed by supabase-js itself, with SIGNED_OUT.
          if (session === null && error !== null) return
          accept(session)
        },
        () => {
          reading = false
        },
      )
    }

    // INITIAL_SESSION arrives once supabase-js has read storage and handled a ?code= in the URL.
    // Only set state in here: awaiting another supabase call inside this callback deadlocks supabase-js.
    const { data } = auth.onAuthStateChange((event, session) => {
      events += 1
      if (event === 'INITIAL_SESSION') initialSeen = true
      // A null that is not a sign-out: supabase-js could not read the session (an expired token it
      // cannot refresh without a network).
      if (session === null && event !== 'SIGNED_OUT') {
        if (!onlineManager.isOnline() && userId !== null && readSnapshotOwner() === userId) {
          set({ status: 'offline', userId })
          return
        }
        if (stateRef.current.status === 'offline') {
          // The network came back while supabase-js was still initializing: this null may be stale.
          queueMicrotask(readSession)
          return
        }
      }
      accept(session)
    })
    // The network comes back after a null INITIAL_SESSION: read the session now rather than wait for
    // supabase-js's next refresh tick (up to 30 seconds), as long as nothing else answered.
    const stopOnline = onlineManager.subscribe((online) => {
      if (online && initialSeen && stateRef.current.status === 'offline') readSession()
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
      stopOnline()
    }
  }, [auth, queryClient])

  // The snapshot is written only while signed in, under that user's id. The getter also checks the
  // latest state, which the auth callback sets before this effect's cleanup can run.
  const signedInId = state.status === 'signed_in' ? state.session.user.id : null
  useEffect(() => {
    if (signedInId === null) return
    return startSnapshot(queryClient, () => {
      const current = stateRef.current
      return current.status === 'signed_in' && current.session.user.id === signedInId ? signedInId : null
    })
  }, [queryClient, signedInId])

  const value = useMemo<AuthValue>(
    () => ({
      ...state,
      signInWithGoogle: async () => {
        const { error } = await auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: `${window.location.origin}${AUTH_CALLBACK_PATH}`,
            // Always the account chooser: on a shared computer, or with several Google accounts,
            // Google would otherwise sign in with the account it picks by itself.
            queryParams: { prompt: 'select_account' },
          },
        })
        if (error !== null) throw error
      },
      signOut: async () => {
        // First, and whatever supabase-js does next: the snapshot never outlives a sign-out.
        clearSnapshot()
        if (stateRef.current.status === 'offline') {
          // No session for supabase-js to sign out of, so no SIGNED_OUT may come.
          stateRef.current = { status: 'signed_out' }
          setState(stateRef.current)
        }
        // With scope 'local', supabase-js removes the session in this browser and emits SIGNED_OUT
        // even when the call to Supabase fails, so the user is signed out either way.
        await auth.signOut({ scope: 'local' })
      },
    }),
    [auth, state],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
