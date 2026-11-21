import { vi, type Mock } from 'vitest'
import { COMPLETED_AT, meFixture } from '../test/onboardingFixtures'
import { createFakeApi, type ApiCall, type FakeApi } from '../test/fakeApi'

// Test helper: a browser with (or without) the Push API, installed on the real jsdom navigator and
// window, because push.ts reads them at call time. restore() puts everything back.

export const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
export const IPAD_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'
export const CHROME_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

// A public key shaped like a VAPID key: an uncompressed P-256 point, 65 bytes starting 0x04.
export const VAPID_KEY = base64url(new Uint8Array([4, ...Array.from({ length: 64 }, (_, i) => i + 1)]))
export const OTHER_VAPID_KEY = base64url(new Uint8Array([4, ...Array.from({ length: 64 }, () => 9)]))

export const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-1'
export const P256DH = 'BPublicKeyOfTheBrowserxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
export const AUTH = 'authsecret123456'

export interface FakeSubscription {
  endpoint: string
  options: { applicationServerKey: ArrayBuffer | null }
  toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } }
  unsubscribe: Mock<() => Promise<boolean>>
}

export interface FakePushOptions {
  userAgent?: string
  maxTouchPoints?: number
  // navigator.standalone (iOS) and matchMedia('(display-mode: standalone)').
  standalone?: boolean
  displayModeStandalone?: boolean
  // serviceWorker, PushManager and Notification present.
  supported?: boolean
  permission?: NotificationPermission
  // What requestPermission() answers.
  requestResult?: NotificationPermission
  // A subscription that already exists in the browser, made with this key.
  subscribedWith?: string | null
  // false: navigator.serviceWorker.ready never resolves (no service worker, as in `npm run dev`).
  serviceWorkerReady?: boolean
}

export interface FakePush {
  requestPermission: Mock<() => Promise<NotificationPermission>>
  subscribe: Mock<(options: PushSubscriptionOptionsInit) => Promise<FakeSubscription>>
  getSubscription: Mock<() => Promise<FakeSubscription | null>>
  current: () => FakeSubscription | null
  // Every call in order, to check what happened first.
  log: string[]
  restore: () => void
}

function decode(key: string): ArrayBuffer {
  const binary = atob(key.replaceAll('-', '+').replaceAll('_', '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

export function installFakePush(options: FakePushOptions = {}): FakePush {
  const {
    userAgent = CHROME_UA,
    maxTouchPoints = 0,
    standalone = false,
    displayModeStandalone = false,
    supported = true,
    permission: initialPermission = 'default',
    requestResult = 'granted',
    subscribedWith = null,
    serviceWorkerReady = true,
  } = options
  const log: string[] = []
  let permission = initialPermission
  let current: FakeSubscription | null = null
  let count = 0

  function makeSubscription(key: ArrayBuffer | null): FakeSubscription {
    count += 1
    const endpoint = count === 1 ? ENDPOINT : `${ENDPOINT}-${String(count)}`
    const sub: FakeSubscription = {
      endpoint,
      options: { applicationServerKey: key },
      toJSON: () => ({ endpoint, keys: { p256dh: P256DH, auth: AUTH } }),
      unsubscribe: vi.fn(() => {
        log.push('unsubscribe')
        if (current === sub) current = null
        return Promise.resolve(true)
      }),
    }
    return sub
  }
  if (subscribedWith !== null) current = makeSubscription(decode(subscribedWith))

  const requestPermission = vi.fn(() => {
    log.push('requestPermission')
    permission = requestResult
    return Promise.resolve(requestResult)
  })
  const subscribe = vi.fn((init: PushSubscriptionOptionsInit) => {
    log.push('subscribe')
    const key = init.applicationServerKey
    const buffer = key instanceof Uint8Array ? Uint8Array.from(key as Uint8Array).buffer : null
    current = makeSubscription(buffer)
    return Promise.resolve(current)
  })
  const getSubscription = vi.fn(() => Promise.resolve(current))

  const own: string[] = []
  function define(name: string, value: unknown) {
    Object.defineProperty(navigator, name, { configurable: true, get: () => value })
    own.push(name)
  }
  define('userAgent', userAgent)
  define('maxTouchPoints', maxTouchPoints)
  if (standalone) define('standalone', true)
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(display-mode: standalone)' && displayModeStandalone,
    media: query,
  }))

  if (supported) {
    const registration = { pushManager: { subscribe, getSubscription } }
    define('serviceWorker', {
      ready: serviceWorkerReady ? Promise.resolve(registration) : new Promise(() => undefined),
    })
    vi.stubGlobal('PushManager', function PushManager() {
      return undefined
    })
    vi.stubGlobal('Notification', {
      get permission() {
        return permission
      },
      requestPermission,
    })
  }

  return {
    requestPermission,
    subscribe,
    getSubscription,
    current: () => current,
    log,
    restore: () => {
      for (const name of own) Reflect.deleteProperty(navigator, name)
      vi.unstubAllGlobals()
    },
  }
}

// The API of a user with a plan: GET/PATCH /me and the two push routes. POST answers id 's1'.
export function pushServer({ lead = 0 }: { lead?: number } = {}): FakeApi {
  let me = meFixture({ onboarding_completed_at: COMPLETED_AT, notify_lead_minutes: lead })
  return createFakeApi()
    .on('GET /me', () => me)
    .on('PATCH /me', (call: ApiCall) => {
      me = { ...me, ...(call.body as object) }
      return { ...me, plan_affected: false }
    })
    .on('POST /push/subscriptions', { id: 's1', created: true })
    .on('DELETE /push/subscriptions/s1', undefined)
}
