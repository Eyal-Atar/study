import type { AuthChangeEvent, Session } from '@supabase/auth-js'
import { dehydrate, onlineManager, QueryClient } from '@tanstack/react-query'
import { act, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { silentApi } from '../test/fakeApi'
import { AppProviders } from '../app/AppProviders'
import { createFakeAuth, fakeSession, type FakeAuth } from '../test/fakeAuth'
import { createFakeStorage } from '../test/fakeStorage'
import { emitCompleted } from '../board/xpEvents'
import { takeEvents, useCelebrationInbox } from '../celebrate/inbox'
import { readSnapshotOwner, restoreSnapshot, SNAPSHOT_KEY, WRITE_DELAY_MS } from '../offline/snapshot'
import { useAuth } from './AuthContext'
import type { AuthClient } from './supabase'

function Status() {
  const auth = useAuth()
  const text =
    auth.status === 'signed_in' ? `signed_in ${auth.session.user.id}` : auth.status === 'offline' ? `offline ${auth.userId}` : auth.status
  return <p data-testid="status">{text}</p>
}

function renderProvider(auth: FakeAuth | { client: AuthClient }, queryClient = new QueryClient()) {
  const result = render(
    <AppProviders auth={auth.client} api={silentApi()} storage={createFakeStorage().client} queryClient={queryClient}>
      <Status />
    </AppProviders>,
  )
  return { ...result, queryClient }
}

// Lets the INITIAL_SESSION microtask of the fake run, inside act.
async function initialSession() {
  await act(async () => {})
}

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  onlineManager.setOnline(true)
  vi.useRealTimers()
})

describe('AuthProvider', () => {
  it('is loading until the initial session arrives, then signed in', async () => {
    const session = fakeSession({ id: 'user-a' })
    renderProvider(createFakeAuth(session))
    expect(screen.getByTestId('status')).toHaveTextContent(/^loading$/)

    await initialSession()
    expect(screen.getByTestId('status')).toHaveTextContent(/^signed_in user-a$/)
  })

  it('becomes signed out on SIGNED_OUT', async () => {
    const auth = createFakeAuth(fakeSession())
    renderProvider(auth)
    await initialSession()

    act(() => {
      auth.emit('SIGNED_OUT', null)
    })
    expect(screen.getByTestId('status')).toHaveTextContent(/^signed_out$/)
  })

  it('unsubscribes on unmount', async () => {
    const auth = createFakeAuth(fakeSession())
    const { unmount } = renderProvider(auth)
    await initialSession()
    expect(auth.listenerCount()).toBe(1)

    unmount()
    expect(auth.listenerCount()).toBe(0)
  })

  it.each<[AuthChangeEvent, Session | null]>([
    ['SIGNED_OUT', null],
    ['SIGNED_IN', fakeSession({ id: 'user-b' })],
  ])('clears the query cache when the user signs out or changes (%s)', async (event, session) => {
    const auth = createFakeAuth(fakeSession({ id: 'user-a' }))
    const { queryClient } = renderProvider(auth)
    await initialSession()
    queryClient.setQueryData(['me', 'user-a'], { id: 'user-a', email: 'a@example.com' })

    act(() => {
      auth.emit(event, session)
    })
    expect(queryClient.getQueryCache().getAll()).toEqual([])
  })

  // S33: the inbox lives outside React and AppShell stays mounted when the user changes directly,
  // so it is emptied here, with the cache; the next user never celebrates the last one's level.
  it.each<[AuthChangeEvent, Session | null]>([
    ['SIGNED_OUT', null],
    ['SIGNED_IN', fakeSession({ id: 'user-b' })],
  ])('empties the celebration inbox when the user signs out or changes (%s)', async (event, session) => {
    const auth = createFakeAuth(fakeSession({ id: 'user-a' }))
    renderProvider(auth)
    await initialSession()
    const inbox = renderHook(() => {
      useCelebrationInbox()
    })
    emitCompleted({ blockId: 'block-1', xp: 20, level: 5, levelUp: true, badgesEarned: ['first_task'] })

    act(() => {
      auth.emit(event, session)
    })
    expect(takeEvents()).toEqual([])
    inbox.unmount()
  })

  it('keeps the celebration inbox when the token of the same user is refreshed', async () => {
    const auth = createFakeAuth(fakeSession({ id: 'user-a' }))
    renderProvider(auth)
    await initialSession()
    const inbox = renderHook(() => {
      useCelebrationInbox()
    })
    emitCompleted({ blockId: 'block-1', xp: 20, level: 5, levelUp: true, badgesEarned: [] })

    act(() => {
      auth.emit('TOKEN_REFRESHED', fakeSession({ id: 'user-a' }))
    })
    expect(takeEvents()).toHaveLength(1)
    inbox.unmount()
  })

  it('keeps the query cache when the token of the same user is refreshed', async () => {
    const auth = createFakeAuth(fakeSession({ id: 'user-a' }))
    const { queryClient } = renderProvider(auth)
    await initialSession()
    queryClient.setQueryData(['me', 'user-a'], { id: 'user-a', email: 'a@example.com' })

    act(() => {
      auth.emit('TOKEN_REFRESHED', fakeSession({ id: 'user-a' }))
    })
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1)
    expect(screen.getByTestId('status')).toHaveTextContent(/^signed_in user-a$/)
  })
})

// The device snapshot (S38), written in its documented shape, then loaded into a fresh client as
// main.tsx does before the first render.
function seedSnapshot(userId: string): QueryClient {
  const source = new QueryClient()
  source.setQueryData(['board', userId, 'today'], { day: '2026-11-28' })
  source.setQueryData(['me', userId], { id: userId })
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ version: 1, userId, state: dehydrate(source) }))
  source.clear()
  const queryClient = new QueryClient()
  restoreSnapshot(queryClient)
  return queryClient
}

// A fake whose automatic INITIAL_SESSION never arrives: the test sends it with emit, as supabase-js
// does after its refresh retries (up to 30 seconds without a network). getSession is a spy.
function lateInitialAuth(initial: Session | null = null) {
  const fake = createFakeAuth(initial)
  const getSession = vi.fn(() => fake.client.getSession())
  const client: AuthClient = {
    ...fake.client,
    getSession,
    onAuthStateChange: (callback) => {
      let skipped = false
      return fake.client.onAuthStateChange((event, session) => {
        if (event === 'INITIAL_SESSION' && !skipped) {
          skipped = true
          return
        }
        callback(event, session)
      })
    },
  }
  return { ...fake, client, getSession }
}

describe('AuthProvider without a network (S38)', () => {
  it('starts offline as the snapshot owner, not loading', () => {
    const queryClient = seedSnapshot('u1')
    onlineManager.setOnline(false)
    renderProvider(lateInitialAuth(), queryClient)

    expect(screen.getByTestId('status')).toHaveTextContent(/^offline u1$/)
  })

  it('starts loading with a network, even with a snapshot', () => {
    const queryClient = seedSnapshot('u1')
    renderProvider(lateInitialAuth(), queryClient)

    expect(screen.getByTestId('status')).toHaveTextContent(/^loading$/)
  })

  it('stays offline, with the cache and the snapshot, when INITIAL_SESSION is null', async () => {
    const queryClient = seedSnapshot('u1')
    onlineManager.setOnline(false)
    renderProvider(createFakeAuth(null), queryClient)
    await initialSession()

    expect(screen.getByTestId('status')).toHaveTextContent(/^offline u1$/)
    expect(queryClient.getQueryData(['board', 'u1', 'today'])).toEqual({ day: '2026-11-28' })
    expect(readSnapshotOwner()).toBe('u1')
  })

  it('does not go offline as another user whose snapshot replaced the one in the cache', async () => {
    const queryClient = seedSnapshot('u1')
    onlineManager.setOnline(false)
    const auth = lateInitialAuth(null)
    renderProvider(auth, queryClient)
    expect(screen.getByTestId('status')).toHaveTextContent(/^offline u1$/)
    // Another tab signed in as u2 and wrote its own snapshot over u1's.
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ version: 1, userId: 'u2', state: { mutations: [], queries: [] } }))
    act(() => {
      auth.emit('INITIAL_SESSION', null)
    })
    await initialSession()

    expect(screen.getByTestId('status')).toHaveTextContent(/^signed_out$/)
    expect(queryClient.getQueryCache().getAll()).toEqual([])
  })

  it('becomes signed in and keeps the restored cache when INITIAL_SESSION is of the owner', async () => {
    const queryClient = seedSnapshot('u1')
    onlineManager.setOnline(false)
    renderProvider(createFakeAuth(fakeSession({ id: 'u1' })), queryClient)
    await initialSession()

    expect(screen.getByTestId('status')).toHaveTextContent(/^signed_in u1$/)
    expect(queryClient.getQueryData(['board', 'u1', 'today'])).toEqual({ day: '2026-11-28' })
    expect(readSnapshotOwner()).toBe('u1')
  })

  it('clears the cache and the snapshot when the session is of another user', async () => {
    const queryClient = seedSnapshot('u1')
    renderProvider(createFakeAuth(fakeSession({ id: 'u2' })), queryClient)
    await initialSession()

    expect(screen.getByTestId('status')).toHaveTextContent(/^signed_in u2$/)
    expect(queryClient.getQueryCache().findAll({ predicate: (q) => q.queryKey[1] === 'u1' })).toEqual([])
    expect(readSnapshotOwner()).toBeNull()
  })

  it('is signed out and deletes the snapshot when INITIAL_SESSION is null with a network', async () => {
    const queryClient = seedSnapshot('u1')
    renderProvider(createFakeAuth(null), queryClient)
    await initialSession()

    expect(screen.getByTestId('status')).toHaveTextContent(/^signed_out$/)
    expect(queryClient.getQueryCache().getAll()).toEqual([])
    expect(readSnapshotOwner()).toBeNull()
  })

  it('asks for the session once when the network is back before a null INITIAL_SESSION, and keeps the owner', async () => {
    const queryClient = seedSnapshot('u1')
    onlineManager.setOnline(false)
    const auth = lateInitialAuth(fakeSession({ id: 'u1' }))
    renderProvider(auth, queryClient)
    act(() => {
      onlineManager.setOnline(true)
    })
    expect(screen.getByTestId('status')).toHaveTextContent(/^offline u1$/)

    // The stale null of an initialization that ran without a network; storage still holds u1's session.
    auth.getSession.mockResolvedValueOnce({ data: { session: fakeSession({ id: 'u1' }) }, error: null })
    act(() => {
      auth.emit('INITIAL_SESSION', null)
    })
    await initialSession()

    expect(auth.getSession).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('status')).toHaveTextContent(/^signed_in u1$/)
    expect(queryClient.getQueryData(['board', 'u1', 'today'])).toEqual({ day: '2026-11-28' })
    expect(readSnapshotOwner()).toBe('u1')
  })

  it('is signed out, with the cache and the snapshot cleared, when that session is null too', async () => {
    const queryClient = seedSnapshot('u1')
    onlineManager.setOnline(false)
    const auth = lateInitialAuth(null)
    renderProvider(auth, queryClient)
    act(() => {
      onlineManager.setOnline(true)
    })

    act(() => {
      auth.emit('INITIAL_SESSION', null)
    })
    await initialSession()

    expect(auth.getSession).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('status')).toHaveTextContent(/^signed_out$/)
    expect(queryClient.getQueryCache().getAll()).toEqual([])
    expect(readSnapshotOwner()).toBeNull()
  })

  it('stays offline when that session cannot be read (the network is not really back)', async () => {
    const queryClient = seedSnapshot('u1')
    onlineManager.setOnline(false)
    const auth = lateInitialAuth(null)
    renderProvider(auth, queryClient)
    act(() => {
      onlineManager.setOnline(true)
    })

    auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: new Error('Failed to fetch') })
    act(() => {
      auth.emit('INITIAL_SESSION', null)
    })
    await initialSession()

    expect(screen.getByTestId('status')).toHaveTextContent(/^offline u1$/)
    expect(readSnapshotOwner()).toBe('u1')
  })

  it('asks for the session when the network comes back after a null INITIAL_SESSION', async () => {
    const queryClient = seedSnapshot('u1')
    onlineManager.setOnline(false)
    const auth = lateInitialAuth(null)
    renderProvider(auth, queryClient)
    act(() => {
      auth.emit('INITIAL_SESSION', null)
    })
    expect(screen.getByTestId('status')).toHaveTextContent(/^offline u1$/)
    expect(auth.getSession).not.toHaveBeenCalled()

    auth.getSession.mockResolvedValueOnce({ data: { session: fakeSession({ id: 'u1' }) }, error: null })
    act(() => {
      onlineManager.setOnline(true)
    })
    await initialSession()

    expect(auth.getSession).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('status')).toHaveTextContent(/^signed_in u1$/)
    expect(queryClient.getQueryData(['board', 'u1', 'today'])).toEqual({ day: '2026-11-28' })
  })

  it('ignores a session read that an auth event overtook', async () => {
    const queryClient = seedSnapshot('u1')
    onlineManager.setOnline(false)
    const auth = lateInitialAuth(null)
    renderProvider(auth, queryClient)
    act(() => {
      onlineManager.setOnline(true)
    })
    let resolve: (value: Awaited<ReturnType<AuthClient['getSession']>>) => void = () => {}
    auth.getSession.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r
      }),
    )
    act(() => {
      auth.emit('INITIAL_SESSION', null)
    })
    await initialSession()
    act(() => {
      auth.emit('SIGNED_OUT', null)
    })

    act(() => {
      resolve({ data: { session: fakeSession({ id: 'u1' }) }, error: null })
    })
    await initialSession()
    expect(screen.getByTestId('status')).toHaveTextContent(/^signed_out$/)
  })

  it('becomes signed in without clearing the cache on TOKEN_REFRESHED of the owner', () => {
    const queryClient = seedSnapshot('u1')
    onlineManager.setOnline(false)
    const auth = lateInitialAuth(null)
    renderProvider(auth, queryClient)
    act(() => {
      auth.emit('INITIAL_SESSION', null)
    })

    act(() => {
      auth.emit('TOKEN_REFRESHED', fakeSession({ id: 'u1' }))
    })
    expect(screen.getByTestId('status')).toHaveTextContent(/^signed_in u1$/)
    expect(queryClient.getQueryData(['board', 'u1', 'today'])).toEqual({ day: '2026-11-28' })
  })

  it('signs out offline even when SIGNED_OUT never arrives, and deletes the snapshot', () => {
    const queryClient = seedSnapshot('u1')
    onlineManager.setOnline(false)
    const auth = lateInitialAuth(null)
    auth.signOut.mockImplementation(() => new Promise(() => {}))
    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => (
        <AppProviders auth={auth.client} api={silentApi()} storage={createFakeStorage().client} queryClient={queryClient}>
          {children}
        </AppProviders>
      ),
    })
    expect(result.current.status).toBe('offline')

    act(() => {
      void result.current.signOut()
    })
    expect(result.current.status).toBe('signed_out')
    expect(readSnapshotOwner()).toBeNull()
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('deletes the snapshot on SIGNED_OUT', async () => {
    seedSnapshot('u1')
    const auth = createFakeAuth(fakeSession({ id: 'u1' }))
    renderProvider(auth)
    await initialSession()
    expect(readSnapshotOwner()).toBe('u1')

    act(() => {
      auth.emit('SIGNED_OUT', null)
    })
    expect(readSnapshotOwner()).toBeNull()
  })

  it('writes the snapshot only while signed in', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const auth = createFakeAuth(fakeSession({ id: 'u1' }))
    const { queryClient } = renderProvider(auth)
    await initialSession()

    act(() => {
      queryClient.setQueryData(['board', 'u1', 'today'], { day: '2026-11-28' })
      vi.advanceTimersByTime(WRITE_DELAY_MS)
    })
    expect(readSnapshotOwner()).toBe('u1')

    act(() => {
      auth.emit('SIGNED_OUT', null)
    })
    act(() => {
      queryClient.setQueryData(['board', 'u1', 'today'], { day: '2026-11-29' })
      vi.advanceTimersByTime(WRITE_DELAY_MS)
    })
    expect(localStorage.getItem(SNAPSHOT_KEY)).toBeNull()
  })
})
