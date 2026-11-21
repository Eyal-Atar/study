import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { en } from '../i18n/en'
import { VAPID_KEY, installFakePush, pushServer, type FakePush } from '../notifications/fakePush'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'

// S16 decision 9: "sign out" in the profile menu drops this browser's push subscription first.
let push: FakePush | null = null

afterEach(() => {
  push?.restore()
  push = null
  vi.useRealTimers()
})

async function signOutFromMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: en.shell.profile }))
  await user.click(screen.getByRole('menuitem', { name: en.shell.signOut }))
}

describe('sign out and the push subscription', () => {
  it('unsubscribes this device first, then signs out', async () => {
    const user = userEvent.setup()
    push = installFakePush({ permission: 'granted', subscribedWith: VAPID_KEY })
    const sub = push.current()
    const auth = createFakeAuth(fakeSession())
    const order: string[] = []
    sub?.unsubscribe.mockImplementation(() => {
      order.push('unsubscribe')
      return Promise.resolve(true)
    })
    auth.signOut.mockImplementation(() => {
      order.push('signOut')
      auth.emit('SIGNED_OUT', null)
      return Promise.resolve({ error: null })
    })
    const { router } = renderRoute('/today', { auth, api: pushServer().api, vapidPublicKey: VAPID_KEY })

    await signOutFromMenu(user)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
    expect(order).toEqual(['unsubscribe', 'signOut'])
  })

  it('a stuck unsubscribe does not hold the sign-out for more than 3 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    push = installFakePush({ permission: 'granted', subscribedWith: VAPID_KEY })
    push.current()?.unsubscribe.mockImplementation(() => new Promise<boolean>(() => undefined))
    const auth = createFakeAuth(fakeSession())
    renderRoute('/today', { auth, api: pushServer().api, vapidPublicKey: VAPID_KEY })

    await signOutFromMenu(user)
    expect(auth.signOut).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3100)
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' })
  })

  it('a failing unsubscribe still signs out', async () => {
    const user = userEvent.setup()
    push = installFakePush({ permission: 'granted', subscribedWith: VAPID_KEY })
    push.current()?.unsubscribe.mockImplementation(() => Promise.reject(new Error('boom')))
    const auth = createFakeAuth(fakeSession())
    renderRoute('/today', { auth, api: pushServer().api, vapidPublicKey: VAPID_KEY })

    await signOutFromMenu(user)
    await waitFor(() => {
      expect(auth.signOut).toHaveBeenCalledOnce()
    })
  })
})
