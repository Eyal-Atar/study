import { describe, expect, it, vi } from 'vitest'
import { createTimeoutFetch, FetchTimeoutError } from './timeoutFetch'

// A fetch that never answers, and rejects when its signal aborts, like the browser.
function hangingFetch() {
  return vi.fn<typeof fetch>(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      }),
  )
}

const AUTH = 'https://ref.supabase.co/auth/v1/token?grant_type=refresh_token'

describe('createTimeoutFetch', () => {
  it('fails a hung request after the timeout', async () => {
    const wrapped = createTimeoutFetch({ timeoutMs: 10, uploadTimeoutMs: 1000, cooldownMs: 1000, fetch: hangingFetch() })
    await expect(wrapped(AUTH)).rejects.toBeInstanceOf(FetchTimeoutError)
  })

  it('after an Auth timeout, Auth requests fail at once until the cooldown ends', async () => {
    let clock = 0
    const inner = hangingFetch()
    const wrapped = createTimeoutFetch({ timeoutMs: 10, uploadTimeoutMs: 1000, cooldownMs: 30000, fetch: inner, now: () => clock })
    await expect(wrapped(AUTH)).rejects.toBeInstanceOf(FetchTimeoutError)
    expect(inner).toHaveBeenCalledTimes(1)

    clock = 29999
    await expect(wrapped(AUTH)).rejects.toBeInstanceOf(FetchTimeoutError)
    expect(inner).toHaveBeenCalledTimes(1)

    clock = 30000
    inner.mockResolvedValueOnce(new Response('{}'))
    await expect(wrapped(AUTH)).resolves.toBeInstanceOf(Response)
    expect(inner).toHaveBeenCalledTimes(2)
  })

  it('an upload to Storage gets the longer timeout', async () => {
    const wrapped = createTimeoutFetch({ timeoutMs: 10, uploadTimeoutMs: 80, cooldownMs: 1000, fetch: hangingFetch() })
    const started = Date.now()
    await expect(wrapped('https://ref.supabase.co/storage/v1/object/materials/a/b/c')).rejects.toBeInstanceOf(
      FetchTimeoutError,
    )
    expect(Date.now() - started).toBeGreaterThanOrEqual(70)
  })

  it('a caller abort is passed on and is not a timeout', async () => {
    const wrapped = createTimeoutFetch({ timeoutMs: 1000, uploadTimeoutMs: 1000, cooldownMs: 1000, fetch: hangingFetch() })
    const controller = new AbortController()
    const pending = wrapped(AUTH, { signal: controller.signal }).catch((e: unknown) => e)
    controller.abort()
    const error = await pending
    expect(error).not.toBeInstanceOf(FetchTimeoutError)
    expect(error).toBeInstanceOf(DOMException)
  })

  it('a timeout of a non-Auth request does not start the cooldown', async () => {
    const inner = hangingFetch()
    const wrapped = createTimeoutFetch({ timeoutMs: 10, uploadTimeoutMs: 10, cooldownMs: 30000, fetch: inner })
    await expect(wrapped('https://ref.supabase.co/storage/v1/object/materials/x')).rejects.toBeInstanceOf(FetchTimeoutError)
    inner.mockResolvedValueOnce(new Response('{}'))
    await expect(wrapped(AUTH)).resolves.toBeInstanceOf(Response)
  })
})
