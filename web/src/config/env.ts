// Reads the VITE_ variables once at startup. vite.config.ts imports this file too, so it runs in the
// browser and in Node: only APIs both have (URL, no DOM).
// The problems are for the developer, so they are in English.

export interface WebEnv {
  supabaseUrl: string
  supabasePublishableKey: string
  apiUrl: string
}

export class EnvError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(`The web app is not configured:\n${problems.map((problem) => `- ${problem}`).join('\n')}`)
    this.name = 'EnvError'
    this.problems = problems
  }
}

const SUPABASE_URL = 'VITE_SUPABASE_URL'
const PUBLISHABLE_KEY = 'VITE_SUPABASE_PUBLISHABLE_KEY'
const API_URL = 'VITE_API_URL'

const SECRET_PREFIX = 'sb_secret_'
const PUBLISHABLE_PREFIX = 'sb_publishable_'

// The names of the variables that hold a Supabase secret key. A secret key bypasses RLS, and every
// VITE_ value ends up in the browser bundle.
export function findSecretKeys(source: Readonly<Record<string, unknown>>): string[] {
  return Object.entries(source)
    .filter(([, value]) => typeof value === 'string' && isSecretKey(value.trim()))
    .map(([name]) => name)
}

function isSecretKey(value: string): boolean {
  return value.startsWith(SECRET_PREFIX) || isServiceRoleJwt(value)
}

const BASE64URL = /^[A-Za-z0-9_-]+$/

// The legacy service_role key is a JWT whose payload has "role": "service_role", and it bypasses RLS
// like sb_secret_. atob is global in browsers and in Node. A value that does not decode is not flagged.
function isServiceRoleJwt(value: string): boolean {
  const segments = value.split('.')
  const payload = segments[1]
  if (segments.length !== 3 || payload === undefined || !segments.every((segment) => BASE64URL.test(segment))) {
    return false
  }
  try {
    const claims: unknown = JSON.parse(atob(payload.replaceAll('-', '+').replaceAll('_', '/')))
    return typeof claims === 'object' && claims !== null && 'role' in claims && claims.role === 'service_role'
  } catch {
    return false
  }
}

export function readEnv(source: Readonly<Record<string, unknown>>): WebEnv {
  const problems: string[] = []
  const secretKeys = findSecretKeys(source)
  for (const name of secretKeys) {
    problems.push(
      `${name} holds a Supabase secret key (${SECRET_PREFIX}… or a legacy service_role JWT), which must never reach the browser. ` +
        'Delete it from web/.env, and revoke it in Supabase (Project Settings → API Keys).',
    )
  }

  // Returns the normalized value, or '' after recording a problem.
  function read(
    name: string,
    normalize: (value: string) => string | null,
    { expected, showValue }: { expected: string; showValue: boolean },
  ): string {
    const raw = source[name]
    if (typeof raw !== 'string' || raw.trim() === '') {
      problems.push(`${name} is missing`)
      return ''
    }
    if (secretKeys.includes(name)) return ''
    const value = normalize(raw.trim())
    if (value === null) {
      problems.push(`${name} must be ${expected}${showValue ? `, got ${JSON.stringify(raw)}` : ''}`)
      return ''
    }
    return value
  }

  const env: WebEnv = {
    supabaseUrl: read(SUPABASE_URL, projectUrl, {
      expected: 'the bare project URL, like https://<project-ref>.supabase.co (no path, query or fragment)',
      showValue: true,
    }),
    supabasePublishableKey: read(PUBLISHABLE_KEY, publishableKey, {
      expected: `the publishable key (${PUBLISHABLE_PREFIX}…) from Supabase → Project Settings → API Keys`,
      // A rejected key is not shown: a legacy service_role JWT is a secret too.
      showValue: false,
    }),
    apiUrl: read(API_URL, apiUrl, {
      expected: 'an http:// or https:// URL without a query or fragment, like http://localhost:8000',
      showValue: true,
    }),
  }
  if (problems.length > 0) throw new EnvError(problems)
  return env
}

function parseHttpUrl(value: string): URL | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  const http = url.protocol === 'http:' || url.protocol === 'https:'
  const plain = url.search === '' && url.hash === '' && url.username === '' && url.password === ''
  return http && plain ? url : null
}

// https://<ref>.supabase.co, with nothing after the host. supabase-js adds /auth/v1 itself.
function projectUrl(value: string): string | null {
  const url = parseHttpUrl(value)
  return url !== null && url.pathname === '/' ? url.origin : null
}

function publishableKey(value: string): string | null {
  return value.startsWith(PUBLISHABLE_PREFIX) && value.length > PUBLISHABLE_PREFIX.length ? value : null
}

// The API may sit under a path. The trailing slash goes, since the client appends paths like /me.
function apiUrl(value: string): string | null {
  const url = parseHttpUrl(value)
  return url === null ? null : url.href.replace(/\/+$/, '')
}
