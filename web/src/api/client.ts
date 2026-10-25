import { he } from '../i18n/he'

// Every failure of a call to our API. `status` is 0 when there was no response at all,
// with `code` 'network' or 'timeout'. `code` and `title` come from the application/problem+json body.
export class ApiError extends Error {
  readonly status: number
  readonly code: string | null
  readonly title: string | null

  constructor(status: number, code: string | null, title: string | null) {
    super(title ?? code ?? `HTTP ${String(status)}`)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.title = title
  }
}

export interface ApiClient {
  get<T>(path: string, init?: { signal?: AbortSignal }): Promise<T>
}

export interface ApiClientOptions {
  baseUrl: string
  // Returns the current access token (supabase-js refreshes it when needed), or null without a session.
  getAccessToken: () => Promise<string | null>
  // Called when the API says the session is not valid, so the app can sign the user out.
  onUnauthenticated: () => void
  fetch?: typeof fetch
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function readProblem(response: Response): Promise<ApiError> {
  let code: string | null = null
  let title: string | null = null
  if (response.headers.get('content-type')?.includes('json') === true) {
    try {
      const body: unknown = await response.json()
      if (isRecord(body)) {
        code = typeof body.code === 'string' ? body.code : null
        title = typeof body.title === 'string' ? body.title : null
      }
    } catch {
      // A body that claims to be JSON but is not: keep only the status.
    }
  }
  return new ApiError(response.status, code, title)
}

// The one place where the web app talks to our API.
export function createApiClient({
  baseUrl,
  getAccessToken,
  onUnauthenticated,
  fetch: fetchImpl = (input, init) => fetch(input, init),
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ApiClientOptions): ApiClient {
  return {
    async get<T>(path: string, init: { signal?: AbortSignal } = {}): Promise<T> {
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

      let response: Response
      try {
        response = await fetchImpl(baseUrl + path, { headers: { Authorization: `Bearer ${token}` }, signal })
      } catch {
        throw noResponse()
      }

      if (!response.ok) {
        const error = await readProblem(response)
        if (response.status === 401) onUnauthenticated()
        throw error
      }
      try {
        return (await response.json()) as T
      } catch {
        throw signal.aborted ? noResponse() : new ApiError(response.status, null, null)
      }
    },
  }
}

// The text to show the user: the server's Hebrew title when it sent one.
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.title !== null) return error.title
    if (error.status === 0) return he.errors.unreachable
  }
  return he.errors.generic
}
