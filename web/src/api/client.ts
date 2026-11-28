import { codeText, isKnownCode } from '../i18n/codes'
import { en } from '../i18n/en'

// Every failure of a call to our API. `status` is 0 when there was no response at all,
// with `code` 'network' or 'timeout'. `code` and `title` come from the application/problem+json body,
// and `details` holds the rest of it (limit, resets_at, reason, blocked_by, errors, ...).
export class ApiError extends Error {
  readonly status: number
  readonly code: string | null
  readonly title: string | null
  readonly details: Readonly<Record<string, unknown>>

  constructor(status: number, code: string | null, title: string | null, details: Record<string, unknown> = {}) {
    super(title ?? code ?? `HTTP ${String(status)}`)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.title = title
    this.details = details
  }
}

export interface RequestInit {
  signal?: AbortSignal
}

export interface ApiClient {
  get<T>(path: string, init?: RequestInit): Promise<T>
  post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>
  patch<T>(path: string, body: unknown, init?: RequestInit): Promise<T>
  // A 204 answer resolves to undefined.
  delete<T = undefined>(path: string, init?: RequestInit): Promise<T>
}

export interface ApiClientOptions {
  baseUrl: string
  // Returns the current access token (supabase-js refreshes it when needed), or null without a session.
  getAccessToken: () => Promise<string | null>
  // Called once when the API answers 401: asks Auth for a new token. null means the session is not
  // valid any more; a throw means Auth could not be reached, which says nothing about the session.
  refreshAccessToken?: () => Promise<string | null>
  // Called when the API says the session is not valid, so the app can sign the user out.
  onUnauthenticated: () => void
  fetch?: typeof fetch
  // Bounds each step on its own: the token lookup, each send, and the refresh after a 401.
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15000
const PROBLEM_FIELDS = new Set(['type', 'title', 'status', 'code'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function readProblem(response: Response): Promise<ApiError> {
  let code: string | null = null
  let title: string | null = null
  const details: Record<string, unknown> = {}
  if (response.headers.get('content-type')?.includes('json') === true) {
    try {
      const body: unknown = await response.json()
      if (isRecord(body)) {
        code = typeof body.code === 'string' ? body.code : null
        title = typeof body.title === 'string' ? body.title : null
        for (const [key, value] of Object.entries(body)) {
          if (!PROBLEM_FIELDS.has(key)) details[key] = value
        }
      }
    } catch {
      // A body that claims to be JSON but is not: keep only the status.
    }
  }
  return new ApiError(response.status, code, title, details)
}

// Waits for an Auth lookup (the token, or a refresh) for at most `ms`. auth-js retries a failed
// refresh with a backoff of 200 * 2^n ms for up to 30 seconds, and that sleep happens even when
// fetch fails at once (timeoutFetch's cooldown), so without this bound a dead Auth would cost the
// user ~28 seconds before any message. A throw from the lookup is a network error; running out of
// time is a timeout; the caller's abort ends the wait as well. None of these signs the user out.
function boundAuth<T>(lookup: () => Promise<T>, ms: number, caller: AbortSignal | undefined): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      done()
      reject(new ApiError(0, 'timeout', null))
    }, ms)
    const onAbort = () => {
      done()
      reject(new ApiError(0, 'network', null))
    }
    function done() {
      clearTimeout(timer)
      caller?.removeEventListener('abort', onAbort)
    }
    if (caller?.aborted === true) {
      onAbort()
      return
    }
    caller?.addEventListener('abort', onAbort)
    lookup().then(
      (value) => {
        done()
        resolve(value)
      },
      () => {
        done()
        reject(new ApiError(0, 'network', null))
      },
    )
  })
}

// The signals of one send: its own timeout, joined with the caller's abort.
function attemptSignals(timeoutMs: number, caller: AbortSignal | undefined) {
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = caller === undefined ? timeout : AbortSignal.any([caller, timeout])
  return { timeout, signal }
}

// The one place where the web app talks to our API.
export function createApiClient({
  baseUrl,
  getAccessToken,
  refreshAccessToken,
  onUnauthenticated,
  fetch: fetchImpl = (input, init) => fetch(input, init),
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ApiClientOptions): ApiClient {
  // The refresh that answers a 401 on `from`, shared by every request that got a 401 with that
  // token: N parallel requests after the token expired make one refreshSession, not N. It stays
  // after it resolves, so a 401 that arrives a moment later reuses the new token; a refresh that
  // throws is dropped, so the next 401 tries again.
  let refresh: { from: string; promise: Promise<string | null> } | null = null

  function refreshFor(token: string, refreshImpl: () => Promise<string | null>): Promise<string | null> {
    if (refresh?.from !== token) {
      const current = { from: token, promise: refreshImpl() }
      refresh = current
      current.promise.catch(() => {
        if (refresh === current) refresh = null
      })
    }
    return refresh.promise
  }

  // One attempt with a given token. Resolves to the response, or throws an ApiError with status 0.
  async function send(
    method: string,
    path: string,
    token: string,
    body: unknown,
    { signal, timeout }: { signal: AbortSignal; timeout: AbortSignal },
  ) {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    // Aborted while the token was looked up or refreshed: do not start the request at all.
    if (signal.aborted) throw new ApiError(0, timeout.aborted ? 'timeout' : 'network', null)
    try {
      return await fetchImpl(baseUrl + path, {
        method,
        headers,
        signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      throw new ApiError(0, timeout.aborted ? 'timeout' : 'network', null)
    }
  }

  async function request<T>(method: string, path: string, body: unknown, init: RequestInit = {}): Promise<T> {
    // The token lookup may refresh an expired token through Auth (offline, Auth down): bounded, and
    // a failure says nothing about the session itself, so the user stays signed in.
    const token = await boundAuth(getAccessToken, timeoutMs, init.signal)
    if (token === null) {
      onUnauthenticated()
      throw new ApiError(401, 'unauthenticated', null)
    }

    let attempt = attemptSignals(timeoutMs, init.signal)
    let response = await send(method, path, token, body, attempt)

    if (response.status === 401 && refreshAccessToken !== undefined) {
      // The token may have expired between the lookup and the request, or been revoked: one refresh,
      // then one more try. Only a second 401 (or a refresh that says the session is gone) signs out.
      const fresh = await boundAuth(() => refreshFor(token, refreshAccessToken), timeoutMs, init.signal)
      if (fresh === null) {
        const error = await readProblem(response)
        onUnauthenticated()
        throw error
      }
      // A new timeout: the time the refresh took does not count against the second send.
      attempt = attemptSignals(timeoutMs, init.signal)
      response = await send(method, path, fresh, body, attempt)
    }

    if (!response.ok) {
      const error = await readProblem(response)
      if (response.status === 401) onUnauthenticated()
      throw error
    }
    if (response.status === 204) return undefined as T
    try {
      return (await response.json()) as T
    } catch {
      // The signal also covers reading the body, so a stall after the headers is an abort here too.
      if (attempt.signal.aborted) throw new ApiError(0, attempt.timeout.aborted ? 'timeout' : 'network', null)
      throw new ApiError(response.status, null, null)
    }
  }

  return {
    get: (path, init) => request('GET', path, undefined, init),
    post: (path, body, init) => request('POST', path, body, init),
    patch: (path, body, init) => request('PATCH', path, body, init),
    delete: (path, init) => request('DELETE', path, undefined, init),
  }
}

// The text to show the user: our own English text for a code we know, else the server's title.
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'offline') return en.errors.offline
    if (error.code !== null && isKnownCode(error.code)) return codeText(error.code, error.details)
    if (error.title !== null) return error.title
    if (error.status === 0) return en.errors.unreachable
  }
  return en.errors.generic
}
