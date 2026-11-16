import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { he } from '../i18n/he'
import { problem } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'
import { AUTH, ENDPOINT, P256DH, VAPID_KEY, installFakePush, pushServer, type FakePush } from './fakePush'

let push: FakePush | null = null

afterEach(() => {
  push?.restore()
  push = null
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

describe('PushSync', () => {
  it('with permission and a subscription, sends it once per load, also across screens', async () => {
    const user = userEvent.setup()
    push = installFakePush({ permission: 'granted', subscribedWith: VAPID_KEY })
    const server = pushServer()
    renderRoute('/today', { auth: createFakeAuth(fakeSession()), api: server.api, vapidPublicKey: VAPID_KEY })

    await waitFor(() => {
      expect(server.calls('POST', '/push/subscriptions')).toHaveLength(1)
    })
    expect(server.calls('POST', '/push/subscriptions')[0]?.body).toEqual({
      endpoint: ENDPOINT,
      keys: { p256dh: P256DH, auth: AUTH },
      user_agent: navigator.userAgent,
    })

    await user.click(await screen.findByRole('link', { name: he.shell.week }))
    await settle()
    expect(server.calls('POST', '/push/subscriptions')).toHaveLength(1)
  })

  it('sends nothing without permission', async () => {
    push = installFakePush({ permission: 'default', subscribedWith: VAPID_KEY })
    const server = pushServer()
    renderRoute('/today', { auth: createFakeAuth(fakeSession()), api: server.api, vapidPublicKey: VAPID_KEY })
    await screen.findByRole('heading', { name: he.today.title })
    await settle()
    expect(server.calls('POST', '/push/subscriptions')).toEqual([])
  })

  it('sends nothing without a subscription', async () => {
    push = installFakePush({ permission: 'granted' })
    const server = pushServer()
    renderRoute('/today', { auth: createFakeAuth(fakeSession()), api: server.api, vapidPublicKey: VAPID_KEY })
    await screen.findByRole('heading', { name: he.today.title })
    await settle()
    expect(server.calls('POST', '/push/subscriptions')).toEqual([])
  })

  it('a failed sync is silent', async () => {
    push = installFakePush({ permission: 'granted', subscribedWith: VAPID_KEY })
    const server = pushServer().on('POST /push/subscriptions', problem(503, 'database_unavailable'))
    renderRoute('/today', { auth: createFakeAuth(fakeSession()), api: server.api, vapidPublicKey: VAPID_KEY })
    await waitFor(() => {
      expect(server.calls('POST', '/push/subscriptions')).toHaveLength(1)
    })
    await settle()
    expect(screen.queryByText(he.codes.database_unavailable)).not.toBeInTheDocument()
  })
})
