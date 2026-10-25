import { describe, expect, it, vi } from 'vitest'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { createAppApi } from './createAppApi'

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function stubFetch(response: () => Response) {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response()))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('createAppApi', () => {
  it('sends the access token of the current session', async () => {
    const fetchMock = stubFetch(() => jsonResponse(200, { id: 'user-a', email: null }))
    const api = createAppApi('http://api.test', createFakeAuth(fakeSession({ id: 'user-a' })).client)

    await api.get('/me')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://api.test/me')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-token-user-a')
  })

  it('without a session it signs out locally once', async () => {
    const fetchMock = stubFetch(() => jsonResponse(200, {}))
    const auth = createFakeAuth(null)
    const api = createAppApi('http://api.test', auth.client)

    await expect(api.get('/me')).rejects.toMatchObject({ status: 401, code: 'unauthenticated' })
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a 401 response signs out locally once', async () => {
    stubFetch(() => jsonResponse(401, { type: 'x', title: 't', status: 401, code: 'unauthenticated' }))
    const auth = createFakeAuth(fakeSession())
    const api = createAppApi('http://api.test', auth.client)

    await expect(api.get('/me')).rejects.toMatchObject({ status: 401 })
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' })
  })

  it('a failed token refresh is a network error and keeps the user signed in', async () => {
    const fetchMock = stubFetch(() => jsonResponse(200, {}))
    const auth = createFakeAuth(fakeSession())
    auth.client.getSession = () => Promise.resolve({ data: { session: null }, error: new Error('refresh failed') })
    const api = createAppApi('http://api.test', auth.client)

    await expect(api.get('/me')).rejects.toMatchObject({ status: 0, code: 'network' })
    expect(auth.signOut).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
