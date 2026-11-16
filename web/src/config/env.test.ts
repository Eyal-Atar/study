import { describe, expect, it } from 'vitest'
import { EnvError, findSecretKeys, readEnv } from './env'

const valid = {
  VITE_SUPABASE_URL: 'https://test-ref.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc123',
  VITE_API_URL: 'http://localhost:8000',
}

function base64url(text: string): string {
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

// A JWT shaped like the legacy Supabase keys. The signature is never checked, so any value will do.
function jwt(payload: object): string {
  return `${base64url('{"alg":"HS256","typ":"JWT"}')}.${base64url(JSON.stringify(payload))}.c2lnbmF0dXJl`
}

function problemsOf(source: Readonly<Record<string, unknown>>): readonly string[] {
  try {
    readEnv(source)
  } catch (error) {
    if (error instanceof EnvError) return error.problems
    throw error
  }
  throw new Error('readEnv accepted the source')
}

describe('readEnv', () => {
  it('reads and normalizes the three variables', () => {
    const env = readEnv({
      ...valid,
      VITE_SUPABASE_URL: 'https://test-ref.supabase.co/',
      VITE_API_URL: 'http://localhost:8000/',
    })
    expect(env).toEqual({
      supabaseUrl: 'https://test-ref.supabase.co',
      supabasePublishableKey: 'sb_publishable_abc123',
      apiUrl: 'http://localhost:8000',
      vapidPublicKey: null,
    })
  })

  it('names every missing variable', () => {
    expect(() => readEnv({})).toThrow(EnvError)
    const problems = problemsOf({})
    expect(problems).toHaveLength(3)
    for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_API_URL']) {
      expect(problems.some((problem) => problem.includes(name))).toBe(true)
    }
  })

  it('refuses a Supabase secret key', () => {
    const problems = problemsOf({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('VITE_SUPABASE_PUBLISHABLE_KEY')
    expect(problems[0]).toContain('sb_secret_')
    expect(findSecretKeys({ ...valid, VITE_OTHER: 'sb_secret_x' })).toEqual(['VITE_OTHER'])
    expect(findSecretKeys(valid)).toEqual([])
  })

  it('refuses a legacy service_role key', () => {
    const serviceRole = jwt({ iss: 'supabase', ref: 'test-ref', role: 'service_role' })
    expect(findSecretKeys({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: serviceRole })).toEqual([
      'VITE_SUPABASE_PUBLISHABLE_KEY',
    ])
    expect(findSecretKeys({ ...valid, VITE_OTHER: ` ${serviceRole} ` })).toEqual(['VITE_OTHER'])

    const problems = problemsOf({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: serviceRole })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('VITE_SUPABASE_PUBLISHABLE_KEY')
    expect(problems[0]).toContain('service_role')
    expect(problems[0]).not.toContain(serviceRole)
  })

  it('does not flag a legacy anon key as secret, but still refuses it as not publishable', () => {
    const anon = jwt({ iss: 'supabase', ref: 'test-ref', role: 'anon' })
    expect(findSecretKeys({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: anon })).toEqual([])

    const problems = problemsOf({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: anon })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('sb_publishable_')
    expect(problems[0]).not.toContain('service_role')
  })

  it.each([
    'a.b.c',
    'a.b',
    'a..c',
    `x.${base64url('not json')}.y`,
    `x.${base64url('null')}.y`,
    `x.${base64url('"service_role"')}.y`,
    `x.${base64url('{"role":"service_role"}')}.y.z`,
    // Standard base64 (with + and /), not base64url, so not shaped like a JWT.
    `x.${btoa('{"role":"service_role","n":"???>>>"}')}.y`,
  ])('does not flag a value that is not a service_role JWT (%s)', (value) => {
    expect(findSecretKeys({ VITE_OTHER: value })).toEqual([])
  })

  it.each(['eyJhbGciOiJIUzI1NiJ9.e30.x', 'abc'])(
    'refuses a key that is not a publishable key (%s)',
    (key) => {
      const problems = problemsOf({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: key })
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain('VITE_SUPABASE_PUBLISHABLE_KEY')
      // The value of a rejected key is never echoed: a legacy service_role JWT is a secret too.
      expect(problems[0]).not.toContain(key)
    },
  )

  it.each([
    'https://test-ref.supabase.co/auth/v1',
    'test-ref.supabase.co',
    'https://test-ref.supabase.co?x=1',
  ])('refuses a Supabase URL that is not the bare project URL (%s)', (url) => {
    const problems = problemsOf({ ...valid, VITE_SUPABASE_URL: url })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('VITE_SUPABASE_URL')
  })

  it.each(['localhost:8000', 'ftp://localhost:8000', 'http://localhost:8000/?x=1'])(
    'refuses an API URL that is not http(s) without a query (%s)',
    (url) => {
      const problems = problemsOf({ ...valid, VITE_API_URL: url })
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain('VITE_API_URL')
    },
  )

  // The client appends paths like /me, so nothing may follow the path, not even an empty ? or #.
  it.each([
    ['http://localhost:8000/?', 'http://localhost:8000'],
    ['http://localhost:8000/#', 'http://localhost:8000'],
    ['http://localhost:8000/api/?', 'http://localhost:8000/api'],
  ])('normalizes the API URL %s to %s', (url, expected) => {
    expect(readEnv({ ...valid, VITE_API_URL: url }).apiUrl).toBe(expected)
  })

  // VITE_VAPID_PUBLIC_KEY is optional: without it the app runs, and the reminders say they are not set up.
  it('without a VAPID key, vapidPublicKey is null', () => {
    expect(readEnv(valid).vapidPublicKey).toBeNull()
    expect(readEnv({ ...valid, VITE_VAPID_PUBLIC_KEY: '  ' }).vapidPublicKey).toBeNull()
  })

  it('reads a VAPID public key: 65 bytes in base64url, starting 0x04', () => {
    const key = base64url(String.fromCharCode(4, ...Array.from({ length: 64 }, (_, i) => i)))
    expect(readEnv({ ...valid, VITE_VAPID_PUBLIC_KEY: ` ${key} ` }).vapidPublicKey).toBe(key)
  })

  it.each([
    ['too short', base64url(String.fromCharCode(4, 1, 2, 3))],
    ['not an uncompressed point', base64url(String.fromCharCode(2, ...Array.from({ length: 64 }, () => 1)))],
    ['standard base64', `${base64url(String.fromCharCode(4, ...Array.from({ length: 63 }, () => 1)))}+/`],
    ['not base64 at all', 'not a key!'],
  ])('refuses a VAPID key that is %s', (_name, key) => {
    const problems = problemsOf({ ...valid, VITE_VAPID_PUBLIC_KEY: key })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('VITE_VAPID_PUBLIC_KEY')
  })
})
