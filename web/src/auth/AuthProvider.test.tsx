import type { AuthChangeEvent, Session } from '@supabase/auth-js'
import { QueryClient } from '@tanstack/react-query'
import { act, render, renderHook, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { silentApi } from '../test/fakeApi'
import { AppProviders } from '../app/AppProviders'
import { createFakeAuth, fakeSession, type FakeAuth } from '../test/fakeAuth'
import { createFakeStorage } from '../test/fakeStorage'
import { emitCompleted } from '../board/xpEvents'
import { takeEvents, useCelebrationInbox } from '../celebrate/inbox'
import { useAuth } from './AuthContext'

function Status() {
  const auth = useAuth()
  return <p data-testid="status">{auth.status === 'signed_in' ? `signed_in ${auth.session.user.id}` : auth.status}</p>
}

function renderProvider(auth: FakeAuth, queryClient = new QueryClient()) {
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
