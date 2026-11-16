import type { AuthChangeEvent, Session } from '@supabase/auth-js'
import { vi, type Mock } from 'vitest'
import type { AuthClient } from '../auth/supabase'

type Listener = (event: AuthChangeEvent, session: Session | null) => void

export interface FakeAuth {
  client: AuthClient
  // Sends an auth event to every subscriber, as supabase-js does after a sign-in, refresh or sign-out.
  emit: (event: AuthChangeEvent, session: Session | null) => void
  listenerCount: () => number
  signInWithOAuth: Mock<AuthClient['signInWithOAuth']>
  signOut: Mock<AuthClient['signOut']>
}

// An AuthClient without network or Google, that behaves like supabase-js where the app depends on it.
export function createFakeAuth(initial: Session | null = null): FakeAuth {
  let session = initial
  const listeners = new Map<symbol, Listener>()

  function emit(event: AuthChangeEvent, next: Session | null) {
    session = next
    for (const listener of [...listeners.values()]) listener(event, next)
  }

  const signInWithOAuth = vi.fn<AuthClient['signInWithOAuth']>(() => Promise.resolve({ error: null }))
  // Like supabase-js, signOut removes the session and emits SIGNED_OUT before it resolves.
  const signOut = vi.fn<AuthClient['signOut']>(() => {
    emit('SIGNED_OUT', null)
    return Promise.resolve({ error: null })
  })

  const client: AuthClient = {
    getSession: () => Promise.resolve({ data: { session }, error: null }),
    refreshSession: () => Promise.resolve({ data: { session }, error: null }),
    onAuthStateChange: (callback) => {
      const id = Symbol('subscription')
      listeners.set(id, callback)
      // Like supabase-js: INITIAL_SESSION arrives after initialization, never synchronously,
      // and not to a subscriber that unsubscribed in the meantime.
      queueMicrotask(() => {
        if (listeners.get(id) === callback) callback('INITIAL_SESSION', session)
      })
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              listeners.delete(id)
            },
          },
        },
      }
    },
    signInWithOAuth,
    signOut,
  }

  return { client, emit, listenerCount: () => listeners.size, signInWithOAuth, signOut }
}

export function fakeSession({ id = 'user-a', email = 'a@example.com' }: { id?: string; email?: string } = {}): Session {
  return {
    access_token: `access-token-${id}`,
    refresh_token: `refresh-token-${id}`,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: {
      id,
      email,
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: {},
      created_at: '2026-10-25T00:00:00Z',
    },
  }
}
