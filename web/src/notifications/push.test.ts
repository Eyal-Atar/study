import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AUTH,
  CHROME_UA,
  ENDPOINT,
  IPAD_DESKTOP_UA,
  IPHONE_UA,
  OTHER_VAPID_KEY,
  P256DH,
  VAPID_KEY,
  installFakePush,
  type FakePush,
} from './fakePush'
import {
  base64UrlToUint8Array,
  currentSubscription,
  isIos,
  isStandalone,
  pushSupport,
  subscribe,
  toSubscriptionBody,
  unsubscribeThisDevice,
} from './push'

let fake: FakePush | null = null
function install(...args: Parameters<typeof installFakePush>) {
  fake = installFakePush(...args)
  return fake
}

afterEach(() => {
  fake?.restore()
  fake = null
  vi.useRealTimers()
})

describe('pushSupport', () => {
  it('is supported with a service worker, PushManager and Notification', () => {
    install()
    expect(pushSupport()).toBe('supported')
  })

  it('is unsupported without them', () => {
    install({ supported: false })
    expect(pushSupport()).toBe('unsupported')
  })

  it('an iPhone in Safari is ios_not_installed, even without the Push API', () => {
    install({ userAgent: IPHONE_UA, supported: false })
    expect(isIos()).toBe(true)
    expect(isStandalone()).toBe(false)
    expect(pushSupport()).toBe('ios_not_installed')
  })

  it('an iPad that reports a desktop Mac is iOS by its touch points', () => {
    install({ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 5, supported: false })
    expect(pushSupport()).toBe('ios_not_installed')
  })

  it('a real Mac is not iOS', () => {
    install({ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 0 })
    expect(isIos()).toBe(false)
    expect(pushSupport()).toBe('supported')
  })

  it('an installed iPhone app (navigator.standalone) is supported', () => {
    install({ userAgent: IPHONE_UA, standalone: true })
    expect(isStandalone()).toBe(true)
    expect(pushSupport()).toBe('supported')
  })

  it('display-mode standalone also counts as installed', () => {
    install({ userAgent: IPHONE_UA, displayModeStandalone: true })
    expect(pushSupport()).toBe('supported')
  })
})

describe('base64UrlToUint8Array', () => {
  it('decodes base64url without padding', () => {
    const bytes = base64UrlToUint8Array(VAPID_KEY)
    expect(bytes).toHaveLength(65)
    expect(bytes[0]).toBe(4)
    expect(Array.from(base64UrlToUint8Array('_-8'))).toEqual([0xff, 0xef])
  })
})

describe('subscriptions', () => {
  it('currentSubscription is null without one, and the one the browser has otherwise', async () => {
    install()
    expect(await currentSubscription()).toBeNull()
    fake?.restore()
    install({ subscribedWith: VAPID_KEY })
    expect((await currentSubscription())?.endpoint).toBe(ENDPOINT)
  })

  it('currentSubscription gives up when no service worker ever becomes ready', async () => {
    vi.useFakeTimers()
    install({ serviceWorkerReady: false, subscribedWith: VAPID_KEY })
    const pending = currentSubscription()
    await vi.advanceTimersByTimeAsync(5000)
    expect(await pending).toBeNull()
  })

  it('currentSubscription is null without a service worker at all', async () => {
    install({ supported: false })
    expect(await currentSubscription()).toBeNull()
  })

  it('subscribe asks for user-visible pushes with the VAPID key', async () => {
    const push = install()
    const sub = await subscribe(VAPID_KEY)
    expect(sub.endpoint).toBe(ENDPOINT)
    const init = push.subscribe.mock.calls[0]?.[0]
    expect(init?.userVisibleOnly).toBe(true)
    expect(Array.from(init?.applicationServerKey as Uint8Array)).toEqual(Array.from(base64UrlToUint8Array(VAPID_KEY)))
  })

  it('subscribe keeps an existing subscription made with the same key', async () => {
    const push = install({ subscribedWith: VAPID_KEY })
    const sub = await subscribe(VAPID_KEY)
    expect(sub.endpoint).toBe(ENDPOINT)
    expect(push.subscribe).not.toHaveBeenCalled()
  })

  it('subscribe replaces a subscription made with another key (the browser refuses a second key)', async () => {
    const push = install({ subscribedWith: OTHER_VAPID_KEY })
    const old = push.current()
    await subscribe(VAPID_KEY)
    expect(old?.unsubscribe).toHaveBeenCalledOnce()
    expect(push.subscribe).toHaveBeenCalledOnce()
  })

  it('subscribe fails without a service worker', async () => {
    vi.useFakeTimers()
    install({ serviceWorkerReady: false })
    const pending = subscribe(VAPID_KEY)
    const check = expect(pending).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(5000)
    await check
  })

  it('unsubscribeThisDevice unsubscribes the current subscription, and does nothing without one', async () => {
    const push = install({ subscribedWith: VAPID_KEY })
    const sub = push.current()
    await unsubscribeThisDevice()
    expect(sub?.unsubscribe).toHaveBeenCalledOnce()
    expect(push.current()).toBeNull()
    await expect(unsubscribeThisDevice()).resolves.toBeUndefined()
  })

  it('toSubscriptionBody takes the endpoint and keys, and the user agent up to 500 characters', async () => {
    install({ userAgent: `${CHROME_UA}${'x'.repeat(600)}`, subscribedWith: VAPID_KEY })
    const sub = await currentSubscription()
    if (sub === null) throw new Error('no subscription')
    const body = toSubscriptionBody(sub)
    expect(body.endpoint).toBe(ENDPOINT)
    expect(body.keys).toEqual({ p256dh: P256DH, auth: AUTH })
    expect(body.user_agent).toHaveLength(500)
  })

  it('toSubscriptionBody refuses a subscription without keys', () => {
    const sub = { toJSON: () => ({ endpoint: ENDPOINT, keys: {} }) } as unknown as PushSubscription
    expect(() => toSubscriptionBody(sub)).toThrow()
  })
})
