import { GoTrueClient } from '@supabase/auth-js'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createStorage } from './storage'
import { createSupabase, type AuthClient } from './supabase'
import { createTimeoutFetch } from './timeoutFetch'

// Pass-through spies: the real classes still run, so the storage tests below exercise the real
// auth-js session lookup and the real storage-js request.
vi.mock('@supabase/auth-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/auth-js')>()
  return { ...actual, GoTrueClient: vi.fn(actual.GoTrueClient) }
})
vi.mock('./timeoutFetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./timeoutFetch')>()
  return { ...actual, createTimeoutFetch: vi.fn(actual.createTimeoutFetch) }
})

const env = {
  supabaseUrl: 'https://test-ref.supabase.co',
  supabasePublishableKey: 'sb_publishable_abc123',
  apiUrl: 'http://localhost:8000',
}
// The key supabase-js stores the session under. It must not change, or every signed-in user is
// signed out by the deploy that drops supabase-js.
const STORAGE_KEY = 'sb-test-ref-auth-token'

const clients: GoTrueClient[] = []
function create(): ReturnType<typeof createSupabase> {
  const supabase = createSupabase(env)
  clients.push(supabase.auth)
  return supabase
}

afterEach(async () => {
  // Stops the refresh ticker and the visibility listener of every client a test created.
  await Promise.all(clients.splice(0).map((client) => client.stopAutoRefresh()))
  localStorage.clear()
  vi.unstubAllGlobals()
})

it('builds auth with the PKCE flow, the supabase-js storage key and the timeout fetch', () => {
  const supabase = create()

  expect(vi.mocked(createTimeoutFetch)).toHaveBeenCalledWith({ timeoutMs: 15000, uploadTimeoutMs: 120000, cooldownMs: 30000 })
  const timeoutFetch = vi.mocked(createTimeoutFetch).mock.results[0]?.value as unknown
  expect(vi.mocked(GoTrueClient)).toHaveBeenCalledOnce()
  const options = vi.mocked(GoTrueClient).mock.calls[0]?.[0]
  expect(options).toEqual({
    url: 'https://test-ref.supabase.co/auth/v1',
    storageKey: STORAGE_KEY,
    flowType: 'pkce',
    headers: { apikey: 'sb_publishable_abc123', Authorization: 'Bearer sb_publishable_abc123' },
    fetch: timeoutFetch,
  })
  // Left out rather than undefined: auth-js spreads the options over its defaults, so an
  // undefined value would switch off detectSessionInUrl, persistSession or autoRefreshToken.
  expect(options).not.toHaveProperty('detectSessionInUrl')
  expect(options).not.toHaveProperty('persistSession')
  expect(options).not.toHaveProperty('autoRefreshToken')
  expect(supabase.auth).toBeInstanceOf(GoTrueClient)
})

it('accepts the real auth client as an AuthClient, without a cast', () => {
  expectTypeOf<ReturnType<typeof createSupabase>['auth']>().toExtend<AuthClient>()
  expectTypeOf<GoTrueClient>().toExtend<AuthClient>()
})

describe('storage upload', () => {
  function fakeFetch() {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ Key: 'materials/u/e/m', Id: 'id-1' }), { status: 200 })),
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  async function upload() {
    const supabase = create()
    const storage = createStorage(supabase)
    return storage.upload('u/e/m', new Blob(['x']), { contentType: 'application/pdf', upsert: false })
  }

  function storageRequest(fetchMock: ReturnType<typeof fakeFetch>): { url: string; headers: Headers } {
    const urlOf = (input: RequestInfo | URL) =>
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const call = fetchMock.mock.calls.find(([input]) => urlOf(input).includes('/storage/v1/'))
    if (call === undefined) throw new Error('no request reached Storage')
    return { url: urlOf(call[0]), headers: new Headers(call[1]?.headers) }
  }

  it('sends the access token of the current session', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        access_token: 'user-access-token',
        refresh_token: 'user-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: 'user-1', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
      }),
    )
    const fetchMock = fakeFetch()

    await expect(upload()).resolves.toMatchObject({ error: null })

    const request = storageRequest(fetchMock)
    expect(request.url).toBe('https://test-ref.supabase.co/storage/v1/object/materials/u/e/m')
    expect(request.headers.get('Authorization')).toBe('Bearer user-access-token')
    expect(request.headers.get('apikey')).toBe('sb_publishable_abc123')
  })

  it('falls back to the publishable key without a session, like supabase-js', async () => {
    const fetchMock = fakeFetch()

    await upload()

    const request = storageRequest(fetchMock)
    expect(request.url).toBe('https://test-ref.supabase.co/storage/v1/object/materials/u/e/m')
    expect(request.headers.get('Authorization')).toBe('Bearer sb_publishable_abc123')
    expect(request.headers.get('apikey')).toBe('sb_publishable_abc123')
  })

  it('keeps a header the caller set', async () => {
    const fetchMock = fakeFetch()
    const supabase = create()

    await supabase.storage.from('materials').upload('u/e/m', new Blob(['x']), {
      contentType: 'application/pdf',
      upsert: false,
      headers: { Authorization: 'Bearer explicit' },
    })

    expect(storageRequest(fetchMock).headers.get('Authorization')).toBe('Bearer explicit')
  })
})
