// Every use of the browser's Push API goes through here. Each function reads navigator and the
// globals at call time, so the tests can install a fake browser (fakePush.ts).

export type PushSupport = 'supported' | 'ios_not_installed' | 'unsupported'

// The body of POST /push/subscriptions.
export interface SubscriptionBody {
  endpoint: string
  keys: { p256dh: string; auth: string }
  user_agent?: string
}

// navigator.serviceWorker.ready never settles when no service worker is registered (as in
// `npm run dev`, S16 decision 15), so every wait for it is bounded.
const READY_TIMEOUT_MS = 3000
const USER_AGENT_MAX = 500

export class PushUnavailableError extends Error {
  constructor() {
    super('No service worker is active, so the browser cannot subscribe to push')
    this.name = 'PushUnavailableError'
  }
}

// Resolves to the promise's value, or to `fallback` after `ms`.
export function withTimeout<T, F>(promise: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  return new Promise<T | F>((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve(fallback)
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

// iPhone, iPod, and iPad. Since iPadOS 13 Safari on an iPad reports a desktop Mac; only the touch
// screen tells them apart (a Mac has no touch points).
export function isIos(): boolean {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return true
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1
}

// Opened from the home screen. iOS Safari has its own navigator.standalone; the others report the
// manifest's display mode.
export function isStandalone(): boolean {
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true
  try {
    return typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(display-mode: standalone)').matches
  } catch {
    return false
  }
}

// On iOS, Push exists only in an app added to the home screen (16.4+), and Safari in a tab has no
// PushManager at all, so iOS-not-installed is checked first: it has its own explanation.
export function pushSupport(): PushSupport {
  if (isIos() && !isStandalone()) return 'ios_not_installed'
  const supported = 'serviceWorker' in navigator && 'PushManager' in globalThis && 'Notification' in globalThis
  return supported ? 'supported' : 'unsupported'
}

export function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='))
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  return withTimeout(navigator.serviceWorker.ready, READY_TIMEOUT_MS, null)
}

// This browser's subscription, or null (none, or no service worker).
export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration()
  if (reg === null) return null
  return reg.pushManager.getSubscription()
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (a === null || a.byteLength !== b.length) return false
  const bytes = new Uint8Array(a)
  return bytes.every((byte, i) => byte === b[i])
}

// Subscribes this browser with the VAPID key. An existing subscription made with the same key is
// reused (subscribe would return it anyway). One made with another key is dropped first, because the
// browser refuses a second key (InvalidStateError) and the old one cannot be sent to any more.
export async function subscribe(vapidKey: string): Promise<PushSubscription> {
  const reg = await registration()
  if (reg === null) throw new PushUnavailableError()
  const key = base64UrlToUint8Array(vapidKey)
  const existing = await reg.pushManager.getSubscription()
  if (existing !== null) {
    if (sameKey(existing.options.applicationServerKey, key)) return existing
    await existing.unsubscribe()
  }
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
}

// S16 decision 9: on sign-out the browser forgets the subscription, so the next reminder gets a 410
// from the push service and the worker deletes the row. Works without the API.
export async function unsubscribeThisDevice(): Promise<void> {
  const sub = await currentSubscription()
  if (sub !== null) await sub.unsubscribe()
}

export function toSubscriptionBody(sub: PushSubscription): SubscriptionBody {
  const json = sub.toJSON()
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (json.endpoint === undefined || p256dh === undefined || auth === undefined) {
    throw new Error('The push subscription has no endpoint or keys')
  }
  const body: SubscriptionBody = { endpoint: json.endpoint, keys: { p256dh, auth } }
  const ua = navigator.userAgent.slice(0, USER_AGENT_MAX)
  if (ua !== '') body.user_agent = ua
  return body
}
