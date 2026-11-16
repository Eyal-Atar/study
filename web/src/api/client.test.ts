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

describe('createApiClient token lookup', () => {
  it('a token lookup that hangs ends as a timeout and does not call the API', async () => {
    const onUnauthenticated = vi.fn()
    const fetchMock = vi.fn<typeof fetch>()
    const api = createApiClient({
      baseUrl: 'http://api.test',
      // auth-js sleeps between its refresh retries for up to 30 s, even when fetch fails at once.
      getAccessToken: () => new Promise<string | null>(() => undefined),
      onUnauthenticated,
      fetch: fetchMock,
      timeoutMs: 10,
    })
    await expect(api.get('/me')).rejects.toMatchObject({ status: 0, code: 'timeout' })
    expect(onUnauthenticated).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a refresh that hangs ends as a timeout and keeps the user signed in', async () => {
    const onUnauthenticated = vi.fn()
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(problem(401, { code: 'unauthenticated' })))
    const api = createApiClient({
      baseUrl: 'http://api.test',
      getAccessToken: () => Promise.resolve('old'),
      refreshAccessToken: () => new Promise<string | null>(() => undefined),
      onUnauthenticated,
      fetch: fetchMock,
      timeoutMs: 10,
    })
    await expect(api.get('/me')).rejects.toMatchObject({ status: 0, code: 'timeout' })
    expect(onUnauthenticated).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('createApiClient writes', () => {
  it('post, patch and delete send the method, the JSON body and the token', async () => {
    const { api, fetchMock } = setup(() => Promise.resolve(problem(200, { ok: true }, 'application/json')))
    await api.post('/exams', { name: 'א' })
    await api.patch('/me', { timezone: 'Asia/Jerusalem' })
    await api.post('/plans/generate')
    const calls = fetchMock.mock.calls.map(([, init]) => ({
      method: init?.method,
      body: init?.body,
      type: new Headers(init?.headers).get('Content-Type'),
      auth: new Headers(init?.headers).get('Authorization'),
    }))
    expect(calls).toEqual([
      { method: 'POST', body: '{"name":"א"}', type: 'application/json', auth: 'Bearer tok' },
      { method: 'PATCH', body: '{"timezone":"Asia/Jerusalem"}', type: 'application/json', auth: 'Bearer tok' },
      { method: 'POST', body: undefined, type: null, auth: 'Bearer tok' },
    ])
  })

  it('a 204 resolves to undefined', async () => {
    const { api, fetchMock } = setup(() => Promise.resolve(new Response(null, { status: 204 })))
    await expect(api.delete('/materials/m1')).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('DELETE')
  })

  it('keeps the extra fields of a problem in details', async () => {
    const { api } = setup(() =>
      Promise.resolve(
        problem(429, {
          type: 'about:blank',
          title: 't',
          status: 429,
          code: 'ai_quota_exceeded',
          limit: 3,
          resets_at: '2026-11-16T22:00:00Z',
        }),
      ),
    )
    await expect(api.post('/plans/generate')).rejects.toMatchObject({
      status: 429,
      code: 'ai_quota_exceeded',
      details: { limit: 3, resets_at: '2026-11-16T22:00:00Z' },
    })
  })
})

describe('createApiClient on 401', () => {
  function withRefresh(responses: Response[], refresh: () => Promise<string | null>) {
    const onUnauthenticated = vi.fn()
    const refreshAccessToken = vi.fn(refresh)
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(responses.shift() ?? problem(500, {})))
    const api = createApiClient({
      baseUrl: 'http://api.test',
      getAccessToken: () => Promise.resolve('old'),
      refreshAccessToken,
      onUnauthenticated,
      fetch: fetchMock,
    })
    return { api, onUnauthenticated, refreshAccessToken, fetchMock }
  }
  const unauthorized = () => problem(401, { code: 'unauthenticated', title: 't', status: 401 })

  it('refreshes once and sends the request again with the new token', async () => {
    const { api, onUnauthenticated, refreshAccessToken, fetchMock } = withRefresh(
      [unauthorized(), problem(200, { id: 'u1' }, 'application/json')],
      () => Promise.resolve('new'),
    )
    await expect(api.get('/me')).resolves.toEqual({ id: 'u1' })
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe('Bearer new')
    expect(onUnauthenticated).not.toHaveBeenCalled()
  })

  it('a second 401 signs out', async () => {
    const { api, onUnauthenticated, refreshAccessToken } = withRefresh([unauthorized(), unauthorized()], () =>
      Promise.resolve('new'),
    )
    await expect(api.get('/me')).rejects.toMatchObject({ status: 401 })
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(onUnauthenticated).toHaveBeenCalledTimes(1)
  })

  it('a refresh that finds no session signs out without a second request', async () => {
    const { api, onUnauthenticated, fetchMock } = withRefresh([unauthorized()], () => Promise.resolve(null))
    await expect(api.get('/me')).rejects.toMatchObject({ status: 401 })
    expect(onUnauthenticated).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a refresh that cannot reach Auth is a network error and keeps the user signed in', async () => {
    const { api, onUnauthenticated } = withRefresh([unauthorized()], () => Promise.reject(new Error('offline')))
    await expect(api.get('/me')).rejects.toMatchObject({ status: 0, code: 'network' })
    expect(onUnauthenticated).not.toHaveBeenCalled()
  })
})

describe('createApiClient on concurrent 401s', () => {
  function deferred<T>() {
    let resolve: (value: T) => void = () => undefined
    const promise = new Promise<T>((r) => {
      resolve = r
    })
    return { promise, resolve }
  }
  const unauthorized = () => problem(401, { code: 'unauthenticated', title: 't', status: 401 })
  const ok = () => problem(200, { ok: true }, 'application/json')
  const authOf = (init: Parameters<typeof fetch>[1]) => new Headers(init?.headers).get('Authorization')

  it('parallel 401s share one refresh', async () => {
    const refresh = deferred<string | null>()
    const refreshAccessToken = vi.fn(() => refresh.promise)
    const fetchMock = vi.fn<typeof fetch>((_url, init) =>
      Promise.resolve(authOf(init) === 'Bearer new' ? ok() : unauthorized()),
    )
    const api = createApiClient({
      baseUrl: 'http://api.test',
      getAccessToken: () => Promise.resolve('old'),
      refreshAccessToken,
      onUnauthenticated: vi.fn(),
      fetch: fetchMock,
    })
    const pending = Promise.all([api.get('/a'), api.get('/b'), api.get('/c')])
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
    refresh.resolve('new')
    await expect(pending).resolves.toEqual([{ ok: true }, { ok: true }, { ok: true }])
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
  })

  it('a 401 that arrives just after the refresh ended reuses its token', async () => {
    const refreshAccessToken = vi.fn(() => Promise.resolve('new'))
    const late = deferred<Response>()
    let calls = 0
    const fetchMock = vi.fn<typeof fetch>((_url, init) => {
      calls += 1
      if (calls === 2) return late.promise
      return Promise.resolve(authOf(init) === 'Bearer new' ? ok() : unauthorized())
    })
    const api = createApiClient({
      baseUrl: 'http://api.test',
      getAccessToken: () => Promise.resolve('old'),
      refreshAccessToken,
      onUnauthenticated: vi.fn(),
      fetch: fetchMock,
    })
    const first = api.get('/a')
    const second = api.get('/b')
    await expect(first).resolves.toEqual({ ok: true })
    late.resolve(unauthorized())
    await expect(second).resolves.toEqual({ ok: true })
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
  })

  it('after a refresh that failed, the next 401 tries again', async () => {
    const refreshAccessToken = vi
      .fn<() => Promise<string | null>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('new')
    const fetchMock = vi.fn<typeof fetch>((_url, init) =>
      Promise.resolve(authOf(init) === 'Bearer new' ? ok() : unauthorized()),
    )
    const api = createApiClient({
      baseUrl: 'http://api.test',
      getAccessToken: () => Promise.resolve('old'),
      refreshAccessToken,
      onUnauthenticated: vi.fn(),
      fetch: fetchMock,
    })
    await expect(api.get('/a')).rejects.toMatchObject({ status: 0, code: 'network' })
    await expect(api.get('/a')).resolves.toEqual({ ok: true })
    expect(refreshAccessToken).toHaveBeenCalledTimes(2)
  })

  it('the second send gets a fresh timeout, not what is left of the first', async () => {
    // A timeout of 100 ms: the first send takes 60 and the refresh 60, so the first deadline has
    // passed when the second send starts, and that send (30 ms) must still go through.
    const wait = (ms: number, signal: AbortSignal | null | undefined, value: () => Response) =>
      new Promise<Response>((resolve, reject) => {
        if (signal?.aborted === true) {
          reject(new DOMException('aborted', 'AbortError'))
          return
        }
        const timer = setTimeout(() => {
          resolve(value())
        }, ms)
        signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    let calls = 0
    const fetchMock = vi.fn<typeof fetch>((_url, init) => {
      calls += 1
      return calls === 1 ? wait(60, init?.signal, unauthorized) : wait(30, init?.signal, ok)
    })
    const api = createApiClient({
      baseUrl: 'http://api.test',
      getAccessToken: () => Promise.resolve('old'),
      refreshAccessToken: () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve('new')
          }, 60)
        }),
      onUnauthenticated: vi.fn(),
      fetch: fetchMock,
      timeoutMs: 100,
    })
    await expect(api.get('/me')).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('the caller abort still cancels the second send', async () => {
    const controller = new AbortController()
    let calls = 0
    const fetchMock = vi.fn<typeof fetch>((_url, init) => {
      calls += 1
      if (calls === 1) return Promise.resolve(unauthorized())
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    })
    const api = createApiClient({
      baseUrl: 'http://api.test',
      getAccessToken: () => Promise.resolve('old'),
      refreshAccessToken: () => Promise.resolve('new'),
      onUnauthenticated: vi.fn(),
      fetch: fetchMock,
    })
    const pending = api.get('/me', { signal: controller.signal }).catch((e: unknown) => e)
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
    controller.abort()
    expect(await pending).toMatchObject({ status: 0, code: 'network' })
  })
})

describe('errorMessage', () => {
  it('prefers our own text for a known code', () => {
    expect(errorMessage(new ApiError(422, 'exam_in_past', 'כותרת של השרת'))).toBe(he.codes.exam_in_past)
  })

  it('returns the title when there is one', () => {
    expect(errorMessage(new ApiError(503, 'x_unknown', 'כותרת'))).toBe('כותרת')
  })

  it('says the server is unreachable when there was no response', () => {
    expect(errorMessage(new ApiError(0, null, null))).toBe(he.errors.unreachable)
    expect(errorMessage(new ApiError(0, 'timeout', null))).toBe(he.codes.timeout)
  })

  it('falls back to the generic message', () => {
    expect(errorMessage(new ApiError(500, null, null))).toBe(he.errors.generic)
    expect(errorMessage(new Error('boom'))).toBe(he.errors.generic)
  })
})
