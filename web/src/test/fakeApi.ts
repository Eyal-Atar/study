import { vi } from 'vitest'
import { ApiError, type ApiClient } from '../api/client'

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export interface ApiCall {
  method: Method
  path: string
  body: unknown
}

// A reply: a value (or a function of the call) that the fake resolves with, or an ApiError it rejects with.
export type Reply = unknown

export interface FakeApi {
  api: ApiClient
  // Answers "METHOD /path" (exact path, or a RegExp on it). The last handler set for a route wins.
  on(route: `${Method} ${string}` | { method: Method; path: RegExp }, reply: Reply): FakeApi
  calls(method?: Method, path?: string | RegExp): ApiCall[]
}

// A problem the way client.ts builds it from a problem+json answer.
export function problem(status: number, code: string, details: Record<string, unknown> = {}): ApiError {
  return new ApiError(status, code, null, details)
}

// An ApiClient without a network. A call with no handler rejects with a 404 problem, so a test that
// forgot a route fails loudly instead of hanging.
export function createFakeApi(): FakeApi {
  const handlers: { method: Method; path: string | RegExp; reply: Reply }[] = []
  const log: ApiCall[] = []

  async function call(method: Method, path: string, body: unknown): Promise<unknown> {
    const entry: ApiCall = { method, path, body }
    log.push(entry)
    await Promise.resolve()
    const handler = [...handlers]
      .reverse()
      .find((h) => h.method === method && (typeof h.path === 'string' ? h.path === path : h.path.test(path)))
    if (handler === undefined) throw problem(404, 'not_found')
    const value: unknown = typeof handler.reply === 'function' ? (handler.reply as (c: ApiCall) => unknown)(entry) : handler.reply
    const resolved: unknown = await value
    if (resolved instanceof Error) throw resolved
    return resolved
  }

  const api: ApiClient = {
    get: <T,>(path: string) => call('GET', path, undefined) as Promise<T>,
    post: <T,>(path: string, body?: unknown) => call('POST', path, body) as Promise<T>,
    patch: <T,>(path: string, body: unknown) => call('PATCH', path, body) as Promise<T>,
    delete: <T,>(path: string) => call('DELETE', path, undefined) as Promise<T>,
  }

  const fake: FakeApi = {
    api,
    on(route, reply) {
      if (typeof route === 'string') {
        const space = route.indexOf(' ')
        handlers.push({ method: route.slice(0, space) as Method, path: route.slice(space + 1), reply })
      } else {
        handlers.push({ ...route, reply })
      }
      return fake
    },
    calls(method, path) {
      return log.filter(
        (c) =>
          (method === undefined || c.method === method) &&
          (path === undefined || (typeof path === 'string' ? c.path === path : path.test(c.path))),
      )
    },
  }
  return fake
}

// For tests that do not care about the API: every call stays pending.
export function silentApi(): ApiClient {
  const never = vi.fn(() => new Promise<never>(() => undefined))
  return { get: never, post: never, patch: never, delete: never }
}
