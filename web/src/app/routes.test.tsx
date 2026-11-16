import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { he } from '../i18n/he'
import { COMPLETED_AT, meFixture } from '../onboarding/testFixtures'
import { createFakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'
import { WEEK_PATH } from './routes'

describe('routes', () => {
  it('the home route sends a signed-out user to login', async () => {
    const { router } = renderRoute('/', { auth: createFakeAuth(null) })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
    // The router state changes before React commits the new screen (a transition), so wait for it.
    expect(await screen.findByRole('button', { name: he.login.google })).toBeInTheDocument()
  })

  it('the home route shows loading until the session is known', async () => {
    const { router } = renderRoute('/', { auth: createFakeAuth(null) })
    expect(screen.getByText(he.common.loading)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')

    await waitFor(() => {
      expect(screen.queryByText(he.common.loading)).not.toBeInTheDocument()
    })
  })

  it('the home route of a signed-in user with a plan is today, inside the app shell', async () => {
    const api = createFakeApi().on('GET /me', meFixture({ onboarding_completed_at: COMPLETED_AT })).api
    const { router } = renderRoute('/', { auth: createFakeAuth(fakeSession()), api })

    expect(await screen.findByRole('heading', { name: he.today.title })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/today')
    expect(screen.getByRole('banner')).toHaveTextContent(he.appName)
    // Sign out moved into the profile menu (S26).
    expect(screen.getByRole('button', { name: he.shell.profile })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: he.shell.signOut })).not.toBeInTheDocument()
  })

  it('the main navigation marks the current screen, and moves between today and week', async () => {
    const user = userEvent.setup()
    const api = createFakeApi().on('GET /me', meFixture({ onboarding_completed_at: COMPLETED_AT })).api
    const { router } = renderRoute('/today', { auth: createFakeAuth(fakeSession()), api })

    const nav = within(await screen.findByRole('navigation', { name: he.shell.mainNav }))
    expect(nav.getByRole('link', { name: he.shell.today })).toHaveAttribute('aria-current', 'page')
    expect(nav.getByRole('link', { name: he.shell.week })).not.toHaveAttribute('aria-current')

    await user.click(nav.getByRole('link', { name: he.shell.week }))
    expect(router.state.location.pathname).toBe(WEEK_PATH)
    expect(await screen.findByRole('heading', { level: 1, name: he.week.title })).toBeInTheDocument()
    expect(nav.getByRole('link', { name: he.shell.week })).toHaveAttribute('aria-current', 'page')
    expect(nav.getByRole('link', { name: he.shell.today })).not.toHaveAttribute('aria-current')
  })

  it('the week route needs a signed-in user', async () => {
    const { router } = renderRoute('/week', { auth: createFakeAuth(null) })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
  })

  it('an unknown path shows not found', async () => {
    renderRoute('/nope', { auth: createFakeAuth(null) })

    expect(await screen.findByRole('heading', { name: he.notFound.title })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: he.notFound.backHome })).toHaveAttribute('href', '/')
  })
})
