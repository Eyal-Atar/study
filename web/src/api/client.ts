import { codeText, isKnownCode } from '../i18n/codes'
import { he } from '../i18n/he'

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

// The one place where the web app talks to our API.
export function createApiClient({
  baseUrl,
  getAccessToken,
  refreshAccessToken,
  onUnauthenticated,
  fetch: fetchImpl = (input, init) => fetch(input, init),
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ApiClientOptions): ApiClient {
  // One attempt with a given token. Resolves to the response, or throws an ApiError with status 0.
  async function send(method: string, path: string, token: string, body: unknown, signal: AbortSignal, timeout: AbortSignal) {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
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
    let token: string | null
    try {
      token = await getAccessToken()
    } catch {
      // The token could not be looked up or refreshed (offline, Auth down). That says nothing about
      // the session itself, so the user stays signed in.
      throw new ApiError(0, 'network', null)
    }
    if (token === null) {
      onUnauthenticated()
      throw new ApiError(401, 'unauthenticated', null)
    }

    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = init.signal === undefined ? timeout : AbortSignal.any([init.signal, timeout])
    // The signal also covers reading the body, so a stall after the headers is an abort here too.
    const noResponse = () => new ApiError(0, timeout.aborted ? 'timeout' : 'network', null)

    let response = await send(method, path, token, body, signal, timeout)

    if (response.status === 401 && refreshAccessToken !== undefined) {
      // The token may have expired between the lookup and the request, or been revoked: one refresh,
      // then one more try. Only a second 401 (or a refresh that says the session is gone) signs out.
      let fresh: string | null
      try {
        fresh = await refreshAccessToken()
      } catch {
        throw new ApiError(0, 'network', null)
      }
      if (fresh === null) {
        const error = await readProblem(response)
        onUnauthenticated()
        throw error
      }
      response = await send(method, path, fresh, body, signal, timeout)
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
      throw signal.aborted ? noResponse() : new ApiError(response.status, null, null)
    }
  }

  return {
    get: (path, init) => request('GET', path, undefined, init),
    post: (path, body, init) => request('POST', path, body, init),
    patch: (path, body, init) => request('PATCH', path, body, init),
    delete: (path, init) => request('DELETE', path, undefined, init),
  }
}

// The text to show the user: our own Hebrew text for a code we know, else the server's Hebrew title.
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code !== null && isKnownCode(error.code)) return codeText(error.code, error.details)
    if (error.title !== null) return error.title
    if (error.status === 0) return he.errors.unreachable
  }
  return he.errors.generic
}
