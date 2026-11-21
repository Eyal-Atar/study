import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { problem } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'
import {
  AUTH,
  ENDPOINT,
  IPHONE_UA,
  P256DH,
  VAPID_KEY,
  installFakePush,
  pushServer,
  type FakePush,
  type FakePushOptions,
} from './fakePush'
import { NOTIFICATIONS_PATH } from './paths'

let push: FakePush | null = null

afterEach(() => {
  push?.restore()
  push = null
})

function open(
  options: FakePushOptions = {},
  { vapidPublicKey = VAPID_KEY, server = pushServer() }: { vapidPublicKey?: string | null; server?: ReturnType<typeof pushServer> } = {},
) {
  push = installFakePush(options)
  const result = renderRoute(NOTIFICATIONS_PATH, { auth: createFakeAuth(fakeSession()), api: server.api, vapidPublicKey })
  return { ...result, server, push }
}

const device = () => screen.findByRole('region', { name: en.notifications.deviceTitle })

describe('NotificationSettings', () => {
  it('without a VAPID key says reminders are not set up, but still shows the lead time', async () => {
    open({}, { vapidPublicKey: null })
    const card = within(await device())
    expect(card.getByText(en.notifications.notConfigured)).toBeInTheDocument()
    expect(card.queryByRole('button', { name: en.notifications.enable })).not.toBeInTheDocument()
    expect(await screen.findByRole('radiogroup', { name: en.notifications.leadLabel })).toBeInTheDocument()
  })

  it('a browser without the Push API says it is not supported', async () => {
    open({ supported: false })
    const card = within(await device())
    expect(card.getByText(en.notifications.unsupported)).toBeInTheDocument()
    expect(card.queryByRole('button', { name: en.notifications.enable })).not.toBeInTheDocument()
  })

  it('iPhone Safari explains how to add the app to the home screen', async () => {
    open({ userAgent: IPHONE_UA, supported: false })
    const card = within(await device())
    expect(card.getByText(en.notifications.iosTitle)).toBeInTheDocument()
    const steps = card.getAllByRole('listitem')
    expect(steps.map((step) => step.textContent)).toEqual([...en.notifications.iosSteps])
    expect(card.queryByRole('button', { name: en.notifications.enable })).not.toBeInTheDocument()
  })

  it('denied permission explains how to unblock it', async () => {
    open({ permission: 'denied' })
    const card = within(await device())
    expect(card.getByText(en.notifications.blockedTitle)).toBeInTheDocument()
    expect(card.getByText(en.notifications.blockedBrowser)).toBeInTheDocument()
    expect(card.queryByRole('button', { name: en.notifications.enable })).not.toBeInTheDocument()
  })

  it('enabling asks for permission first, subscribes, sends the subscription and shows it is on', async () => {
    const user = userEvent.setup()
    const { server, push: fake } = open()
    const card = within(await device())
    expect(await card.findByRole('status')).toHaveTextContent(en.notifications.off)

    await user.click(card.getByRole('button', { name: en.notifications.enable }))

    await waitFor(() => {
      expect(card.getByRole('status')).toHaveTextContent(en.notifications.on)
    })
    expect(fake.log.slice(0, 2)).toEqual(['requestPermission', 'subscribe'])
    expect(server.calls('POST', '/push/subscriptions')).toEqual([
      {
        method: 'POST',
        path: '/push/subscriptions',
        body: { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH }, user_agent: navigator.userAgent },
      },
    ])
    // The card's status line says the same words, so the toast makes two.
    expect(await screen.findAllByText(en.notifications.enabled)).toHaveLength(2)
    expect(card.getByRole('button', { name: en.notifications.disable })).toBeInTheDocument()
  })

  it('a refused permission shows the blocked state, with no subscription and no POST', async () => {
    const user = userEvent.setup()
    const { server, push: fake } = open({ requestResult: 'denied' })
    const card = within(await device())
    await user.click(await card.findByRole('button', { name: en.notifications.enable }))

    expect(await card.findByText(en.notifications.blockedTitle)).toBeInTheDocument()
    expect(fake.subscribe).not.toHaveBeenCalled()
    expect(server.calls('POST', '/push/subscriptions')).toEqual([])
  })

  it('a dismissed permission prompt stays off and says why', async () => {
    const user = userEvent.setup()
    const { server } = open({ requestResult: 'default' })
    const card = within(await device())
    await user.click(await card.findByRole('button', { name: en.notifications.enable }))

    expect(await screen.findByText(en.notifications.notAllowed)).toBeInTheDocument()
    expect(card.getByRole('status')).toHaveTextContent(en.notifications.off)
    expect(server.calls('POST', '/push/subscriptions')).toEqual([])
  })

  it('a failed POST shows the error, stays off and drops the browser subscription', async () => {
    const user = userEvent.setup()
    const server = pushServer().on('POST /push/subscriptions', problem(422, 'push_endpoint_invalid'))
    const { push: fake } = open({}, { server })
    const card = within(await device())
    await user.click(await card.findByRole('button', { name: en.notifications.enable }))

    expect(await screen.findByText(en.codes.push_endpoint_invalid)).toBeInTheDocument()
    expect(card.getByRole('status')).toHaveTextContent(en.notifications.off)
    expect(fake.current()).toBeNull()
  })

  it('turning off deletes the subscription with the id the sync learned, then unsubscribes', async () => {
    const user = userEvent.setup()
    const { server, push: fake } = open({ permission: 'granted', subscribedWith: VAPID_KEY })
    const card = within(await device())
    await waitFor(() => {
      expect(card.getByRole('status')).toHaveTextContent(en.notifications.on)
    })
    // PushSync sent the existing subscription on load, and learned its id.
    await waitFor(() => {
      expect(server.calls('POST', '/push/subscriptions')).toHaveLength(1)
    })

    await user.click(card.getByRole('button', { name: en.notifications.disable }))

    await waitFor(() => {
      expect(card.getByRole('status')).toHaveTextContent(en.notifications.off)
    })
    expect(server.calls('DELETE')).toEqual([{ method: 'DELETE', path: '/push/subscriptions/s1', body: undefined }])
    expect(server.calls('POST', '/push/subscriptions')).toHaveLength(1)
    expect(fake.log.at(-1)).toBe('unsubscribe')
    expect(fake.current()).toBeNull()
    // The card's status line says the same words, so the toast makes two.
    expect(await screen.findAllByText(en.notifications.disabled)).toHaveLength(2)
  })

  it('turning off without a known id sends the subscription first to learn it', async () => {
    const user = userEvent.setup()
    let posts = 0
    const server = pushServer().on('POST /push/subscriptions', () => {
      posts += 1
      // The sync on load fails; the one before the delete works.
      return posts === 1 ? problem(503, 'database_unavailable') : { id: 's1', created: false }
    })
    open({ permission: 'granted', subscribedWith: VAPID_KEY }, { server })
    const card = within(await device())
    await waitFor(() => {
      expect(server.calls('POST', '/push/subscriptions')).toHaveLength(1)
    })
    // The failed sync is silent.
    expect(screen.queryByText(en.codes.database_unavailable)).not.toBeInTheDocument()

    await user.click(await card.findByRole('button', { name: en.notifications.disable }))

    await waitFor(() => {
      expect(server.calls('DELETE', '/push/subscriptions/s1')).toHaveLength(1)
    })
    expect(server.calls('POST', '/push/subscriptions')).toHaveLength(2)
  })

  it('a failed DELETE keeps reminders on and says so', async () => {
    const user = userEvent.setup()
    const server = pushServer().on('DELETE /push/subscriptions/s1', problem(503, 'database_unavailable'))
    const { push: fake } = open({ permission: 'granted', subscribedWith: VAPID_KEY }, { server })
    const card = within(await device())
    await waitFor(() => {
      expect(server.calls('POST', '/push/subscriptions')).toHaveLength(1)
    })
    await user.click(await card.findByRole('button', { name: en.notifications.disable }))

    expect(await screen.findByText(en.codes.database_unavailable)).toBeInTheDocument()
    expect(card.getByRole('status')).toHaveTextContent(en.notifications.on)
    expect(fake.current()).not.toBeNull()
  })

  it('choosing "10 minutes before" saves notify_lead_minutes with PATCH /me and says so', async () => {
    const user = userEvent.setup()
    const { server } = open({}, { server: pushServer({ lead: 0 }) })
    const group = within(await screen.findByRole('radiogroup', { name: en.notifications.leadLabel }))
    expect(group.getByRole('radio', { name: en.notifications.lead0 })).toBeChecked()

    await user.click(group.getByRole('radio', { name: en.notifications.lead10 }))

    expect(await screen.findByText(en.notifications.leadSaved)).toBeInTheDocument()
    expect(server.calls('PATCH', '/me')).toEqual([{ method: 'PATCH', path: '/me', body: { notify_lead_minutes: 10 } }])
    expect(group.getByRole('radio', { name: en.notifications.lead10 })).toBeChecked()
    expect(screen.getByText(en.notifications.leadHint)).toBeInTheDocument()
  })
})
