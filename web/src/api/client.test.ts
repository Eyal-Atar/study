import { describe, expect, it, vi } from 'vitest'
import { he } from '../i18n/he'
import { ApiError, createApiClient, errorMessage } from './client'

function problem(status: number, body: unknown, contentType = 'application/problem+json') {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': contentType },
  })
}

function setup(fetchImpl: typeof fetch, token: string | null = 'tok', timeoutMs?: number) {
  const onUnauthenticated = vi.fn()
  const fetchMock = vi.fn(fetchImpl)
  const api = createApiClient({
    baseUrl: 'http://api.test',
    getAccessToken: () => Promise.resolve(token),
    onUnauthenticated,
    fetch: fetchMock,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  })
  return { api, onUnauthenticated, fetchMock }
}

describe('createApiClient', () => {
  it('sends the bearer token and returns the JSON', async () => {
    const { api, fetchMock } = setup(() =>
      Promise.resolve(problem(200, { id: 'u1', email: 'a@b.c' }, 'application/json')),
    )
    await expect(api.get('/me')).resolves.toEqual({ id: 'u1', email: 'a@b.c' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://api.test/me')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer tok')
  })

  it('without a session it fails as unauthenticated and does not call the API', async () => {
    const { api, fetchMock, onUnauthenticated } = setup(() => Promise.resolve(problem(200, {})), null)
    await expect(api.get('/me')).rejects.toMatchObject({ status: 401, code: 'unauthenticated' })
    expect(onUnauthenticated).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a 401 problem signs the user out', async () => {
    const { api, onUnauthenticated } = setup(() =>
      Promise.resolve(
        problem(401, { type: 'x', title: 'צריך להתחבר מחדש.', status: 401, code: 'unauthenticated' }),
      ),
    )
    const error = await api.get('/me').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 401, code: 'unauthenticated', title: 'צריך להתחבר מחדש.' })
    expect(onUnauthenticated).toHaveBeenCalledTimes(1)
  })

  it('a 503 problem keeps the user signed in', async () => {
    const title = 'שירות ההתחברות לא זמין כרגע. נסו שוב בעוד רגע.'
    const { api, onUnauthenticated } = setup(() =>
      Promise.resolve(problem(503, { type: 'x', title, status: 503, code: 'auth_unavailable' })),
    )
    await expect(api.get('/me')).rejects.toMatchObject({ status: 503, code: 'auth_unavailable', title })
    expect(onUnauthenticated).not.toHaveBeenCalled()
  })

  it('a non-JSON error has no code or title', async () => {
    const { api } = setup(() => Promise.resolve(problem(502, '<html>Bad gateway</html>', 'text/html')))
    await expect(api.get('/me')).rejects.toMatchObject({ status: 502, code: null, title: null })
  })

  it('a network failure is status 0', async () => {
    const { api } = setup(() => Promise.reject(new TypeError('Failed to fetch')))
    await expect(api.get('/me')).rejects.toMatchObject({ status: 0, code: 'network' })
  })

  it('a hung request times out', async () => {
    const { api } = setup(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        }),
      'tok',
      10,
    )
    await expect(api.get('/me')).rejects.toMatchObject({ status: 0, code: 'timeout' })
  })

  it('a token lookup that throws is a network error and does not sign out', async () => {
    const onUnauthenticated = vi.fn()
    const fetchMock = vi.fn<typeof fetch>()
    const api = createApiClient({
      baseUrl: 'http://api.test',
      getAccessToken: () => Promise.reject(new Error('refresh failed')),
      onUnauthenticated,
      fetch: fetchMock,
    })
    await expect(api.get('/me')).rejects.toMatchObject({ status: 0, code: 'network' })
    expect(onUnauthenticated).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a body that stalls after the headers times out', async () => {
    const { api } = setup(
      (_url, init) =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                init?.signal?.addEventListener('abort', () => {
                  controller.error(new DOMException('aborted', 'AbortError'))
                })
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
      'tok',
      10,
    )
    await expect(api.get('/me')).rejects.toMatchObject({ status: 0, code: 'timeout' })
  })

  it('a 200 with a body that is not JSON is an ApiError with no code', async () => {
    const { api } = setup(() => Promise.resolve(problem(200, 'not json', 'application/json')))
    const error = await api.get('/me').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 200, code: null, title: null })
  })

  it('a caller abort is not reported as a timeout', async () => {
    const controller = new AbortController()
    const { api } = setup(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        }),
    )
    const pending = api.get('/me', { signal: controller.signal }).catch((e: unknown) => e)
    await Promise.resolve()
    controller.abort()
    expect(await pending).toMatchObject({ status: 0, code: 'network' })
  })
})

describe('errorMessage', () => {
  it('returns the title when there is one', () => {
    expect(errorMessage(new ApiError(503, 'x', 'כותרת'))).toBe('כותרת')
  })

  it('says the server is unreachable when there was no response', () => {
    expect(errorMessage(new ApiError(0, 'network', null))).toBe(he.errors.unreachable)
  })

  it('falls back to the generic message', () => {
    expect(errorMessage(new ApiError(500, null, null))).toBe(he.errors.generic)
    expect(errorMessage(new Error('boom'))).toBe(he.errors.generic)
  })
})
