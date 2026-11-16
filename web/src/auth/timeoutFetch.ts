// The fetch that supabase-js uses (global.fetch in createSupabase).
//
// supabase-js has no timeout of its own: a request to a server that does not answer waits for the
// browser, and auth-js then retries a failed refresh with backoff for up to 30 seconds. This gives
// every request a timeout, and after an Auth request times out, Auth requests in the next
// `cooldownMs` fail at once without the network, so the retries do not wait again. Uploads to
// Storage get a longer timeout: a 20 MiB file on a slow connection takes a while.

export interface TimeoutFetchOptions {
  timeoutMs: number
  uploadTimeoutMs: number
  cooldownMs: number
  fetch?: typeof fetch
  now?: () => number
}

export class FetchTimeoutError extends Error {
  constructor() {
    super('The request timed out')
    this.name = 'FetchTimeoutError'
  }
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

export function createTimeoutFetch({
  timeoutMs,
  uploadTimeoutMs,
  cooldownMs,
  fetch: fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
}: TimeoutFetchOptions): typeof fetch {
  let authTimedOutAt: number | null = null

  return async (input, init) => {
    const url = urlOf(input)
    const isAuth = url.includes('/auth/v1/')
    if (isAuth && authTimedOutAt !== null && now() - authTimedOutAt < cooldownMs) {
      throw new FetchTimeoutError()
    }
    const limit = url.includes('/storage/v1/object') ? uploadTimeoutMs : timeoutMs
    const timeout = AbortSignal.timeout(limit)
    const caller = init?.signal ?? undefined
    const signal = caller === undefined ? timeout : AbortSignal.any([caller, timeout])
    try {
      const response = await fetchImpl(input, { ...init, signal })
      if (isAuth) authTimedOutAt = null
      return response
    } catch (error) {
      if (timeout.aborted) {
        if (isAuth) authTimedOutAt = now()
        throw new FetchTimeoutError()
      }
      throw error
    }
  }
}
