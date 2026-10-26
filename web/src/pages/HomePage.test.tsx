import { QueryClient } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, type ApiClient } from '../api/client'
import { he } from '../i18n/he'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'

// An ApiClient whose GET calls are recorded in `get`.
function fakeApi(answer: () => Promise<unknown>) {
  const get = vi.fn<(path: string, init?: { signal?: AbortSignal }) => Promise<unknown>>(() => answer())
  const api: ApiClient = { get: <T,>(path: string, init?: { signal?: AbortSignal }) => get(path, init) as Promise<T> }
  return { api, get }
}

describe('HomePage', () => {
  it('shows the user from GET /me', async () => {
    const { api, get } = fakeApi(() => Promise.resolve({ id: 'u1', email: 'a@b.c' }))
    renderRoute('/', { auth: createFakeAuth(fakeSession()), api })

    expect(await screen.findByText(he.home.signedInAs('a@b.c'))).toBeInTheDocument()
    expect(screen.getByText(he.home.userId)).toBeInTheDocument()
    expect(screen.getByText('u1')).toBeInTheDocument()
    // StrictMode mounts twice: React Query cancels the first request (it reads the signal) and starts a second.
    expect(get.mock.calls.every(([path, init]) => path === '/me' && init?.signal instanceof AbortSignal)).toBe(true)
    expect(get).toHaveBeenCalled()
  })

  it('announces the loading of /me as a status', async () => {
    const { api } = fakeApi(() => new Promise(() => undefined))
    renderRoute('/', { auth: createFakeAuth(fakeSession()), api })

    // The heading is HomePage's, so the status is not the one RequireAuth shows while auth loads.
    expect(await screen.findByRole('heading', { name: he.appName })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(he.common.loading)
  })

  it('shows noEmail when the account has no email', async () => {
    const { api } = fakeApi(() => Promise.resolve({ id: 'u1', email: null }))
    renderRoute('/', { auth: createFakeAuth(fakeSession()), api })

    expect(await screen.findByText(he.home.noEmail)).toBeInTheDocument()
  })

  it('shows the API error and retries on demand', async () => {
    const user = userEvent.setup()
    const title = 'שירות ההתחברות לא זמין כרגע. נסו שוב בעוד רגע.'
    const { api, get } = fakeApi(() => Promise.reject(new ApiError(503, 'auth_unavailable', title)))
    renderRoute('/', { auth: createFakeAuth(fakeSession()), api })

    expect(await screen.findByRole('alert')).toHaveTextContent(title)
    const before = get.mock.calls.length

    await user.click(screen.getByRole('button', { name: he.common.retry }))
    await waitFor(() => {
      expect(get.mock.calls.length).toBeGreaterThan(before)
    })
  })

  it('sign out returns to login', async () => {
    const user = userEvent.setup()
    const auth = createFakeAuth(fakeSession())
    const { api } = fakeApi(() => Promise.resolve({ id: 'u1', email: 'a@b.c' }))
    const { router } = renderRoute('/', { auth, api })

    await user.click(await screen.findByRole('button', { name: he.home.signOut }))
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
  })

  it('keys /me by user, so another user never sees the first one', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const auth = createFakeAuth(fakeSession({ id: 'user-a' }))
    const { api } = fakeApi(() => Promise.resolve({ id: 'x', email: 'a@b.c' }))
    renderRoute('/', { auth, api, queryClient })

    expect(await screen.findByText(he.home.signedInAs('a@b.c'))).toBeInTheDocument()
    expect(queryClient.getQueryCache().find({ queryKey: ['me', 'user-a'], exact: true })).toBeDefined()
  })

  it('shows the new user after the session changes', async () => {
    let email = 'a@b.c'
    const auth = createFakeAuth(fakeSession({ id: 'user-a' }))
    const { api } = fakeApi(() => Promise.resolve({ id: 'x', email }))
    renderRoute('/', { auth, api })
    expect(await screen.findByText(he.home.signedInAs('a@b.c'))).toBeInTheDocument()

    email = 'b@example.com'
    act(() => {
      auth.emit('SIGNED_IN', fakeSession({ id: 'user-b', email: 'b@example.com' }))
    })
    expect(await screen.findByText(he.home.signedInAs('b@example.com'))).toBeInTheDocument()
    expect(screen.queryByText(he.home.signedInAs('a@b.c'))).not.toBeInTheDocument()
  })
})
