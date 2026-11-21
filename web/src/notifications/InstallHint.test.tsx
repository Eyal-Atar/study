import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { en } from '../i18n/en'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'
import { CHROME_UA, IPHONE_UA, VAPID_KEY, installFakePush, pushServer, type FakePush } from './fakePush'
import { INSTALL_HINT_KEY } from './InstallHint'
import { NOTIFICATIONS_PATH } from './paths'

let push: FakePush | null = null

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  push?.restore()
  push = null
  vi.restoreAllMocks()
  localStorage.clear()
})

function open(path = '/today') {
  return renderRoute(path, { auth: createFakeAuth(fakeSession()), api: pushServer().api, vapidPublicKey: VAPID_KEY })
}

const hint = () => screen.queryByRole('region', { name: en.notifications.installTitle })

describe('InstallHint', () => {
  it('shows once in iPhone Safari, with a link to the reminder settings', async () => {
    push = installFakePush({ userAgent: IPHONE_UA, supported: false })
    const first = open()
    await screen.findByRole('heading', { name: en.today.title })
    expect(hint()).toBeInTheDocument()
    expect(screen.getByRole('link', { name: en.notifications.installHow })).toHaveAttribute('href', NOTIFICATIONS_PATH)
    expect(localStorage.getItem(INSTALL_HINT_KEY)).not.toBeNull()

    // The next load of the app does not show it again.
    first.unmount()
    open()
    await screen.findByRole('heading', { name: en.today.title })
    expect(hint()).not.toBeInTheDocument()
  })

  it('the dismiss button closes it', async () => {
    const user = userEvent.setup()
    push = installFakePush({ userAgent: IPHONE_UA, supported: false })
    open()
    await screen.findByRole('heading', { name: en.today.title })
    await user.click(screen.getByRole('button', { name: en.notifications.installDismiss }))
    expect(hint()).not.toBeInTheDocument()
  })

  it('is not shown outside iOS, or when the app is installed', async () => {
    push = installFakePush({ userAgent: CHROME_UA })
    const first = open()
    await screen.findByRole('heading', { name: en.today.title })
    expect(hint()).not.toBeInTheDocument()
    first.unmount()
    push.restore()

    push = installFakePush({ userAgent: IPHONE_UA, standalone: true })
    open()
    await screen.findByRole('heading', { name: en.today.title })
    expect(hint()).not.toBeInTheDocument()
  })

  it('a localStorage that throws does not crash the app, and the hint is still shown', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    push = installFakePush({ userAgent: IPHONE_UA, supported: false })
    open()
    await screen.findByRole('heading', { name: en.today.title })
    expect(hint()).toBeInTheDocument()
  })
})
