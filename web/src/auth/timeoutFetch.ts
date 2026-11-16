// The fetch that supabase-js uses (global.fetch in createSupabase).
//
// supabase-js has no timeout of its own: a request to a server that does not answer waits for the
// browser. This gives every request a timeout, and after an Auth request times out, Auth requests
// in the next `cooldownMs` fail at once without the network, so each retry of auth-js does not wait
// for the network again. It does not bound the whole refresh: auth-js still sleeps 200 * 2^n ms
// between its retries for up to 30 seconds. The API client (api/client.ts) bounds the token lookup
// and the refresh with its own timeout, so the user sees a message after one timeout, not ~28 s.
// Uploads to Storage get a longer timeout: a 20 MiB file on a slow connection takes a while.
//
// Every failure here is a throw, never a made-up Response: auth-js turns a throw into
// AuthRetryableFetchError and keeps the session, while an error status from Auth (4xx) could make
// it drop the session and sign the user out.

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
