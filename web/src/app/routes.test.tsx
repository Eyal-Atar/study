import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { COMPLETED_AT, meFixture } from '../test/onboardingFixtures'
import { createFakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'
import { CALENDAR_PATH, EXAMS_PATH } from './routes'

describe('routes', () => {
  it('the home route sends a signed-out user to login', async () => {
    const { router } = renderRoute('/', { auth: createFakeAuth(null) })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
    // The router state changes before React commits the new screen (a transition), so wait for it.
    expect(await screen.findByRole('button', { name: en.login.google })).toBeInTheDocument()
  })

  it('the home route shows loading until the session is known', async () => {
    const { router } = renderRoute('/', { auth: createFakeAuth(null) })
    expect(screen.getByText(en.common.loading)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')

    await waitFor(() => {
      expect(screen.queryByText(en.common.loading)).not.toBeInTheDocument()
    })
  })

  it('the home route of a signed-in user with a plan is the calendar, inside the app shell', async () => {
    const api = createFakeApi().on('GET /me', meFixture({ onboarding_completed_at: COMPLETED_AT })).api
    const { router } = renderRoute('/', { auth: createFakeAuth(fakeSession()), api })

    expect(await screen.findByRole('heading', { name: en.today.title })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(CALENDAR_PATH)
    expect(router.state.historyAction).toBe('REPLACE')
    expect(screen.getByRole('banner')).toHaveTextContent(en.appName)
    // Sign out moved into the profile menu (S26).
    expect(screen.getByRole('button', { name: en.shell.profile })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.shell.signOut })).not.toBeInTheDocument()
  })

  // S31: /today and /week were the two first destinations. Notifications that were already sent,
  // the installed app (manifest.start_url) and old bookmarks still open them.
  it.each([
    { from: '/today', to: '/calendar', search: '' },
    { from: '/today?x=1', to: '/calendar', search: '?x=1' },
    { from: '/week', to: '/calendar', search: '?view=week' },
    { from: '/week?from=2026-11-15', to: '/calendar', search: '?view=week&from=2026-11-15' },
  ])('$from is replaced by $to with the search "$search"', async ({ from, to, search }) => {
    const api = createFakeApi().on('GET /me', meFixture({ onboarding_completed_at: COMPLETED_AT })).api
    const { router } = renderRoute(from, { auth: createFakeAuth(fakeSession()), api })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(to)
    })
    expect(router.state.location.search).toBe(search)
    expect(router.state.historyAction).toBe('REPLACE')
    // The redirect is not a navigation the user asked for: the focus stays where it was.
    expect(await screen.findByRole('heading', { level: 1 })).not.toHaveFocus()
    expect(document.body).toHaveFocus()
  })

  it('the main navigation marks the current screen, and moves between the calendar and the exams', async () => {
    const user = userEvent.setup()
    const api = createFakeApi().on('GET /me', meFixture({ onboarding_completed_at: COMPLETED_AT })).api
    const { router } = renderRoute(CALENDAR_PATH, { auth: createFakeAuth(fakeSession()), api })

    const nav = within(await screen.findByRole('navigation', { name: en.shell.mainNav }))
    expect(nav.getByRole('link', { name: en.shell.calendar })).toHaveAttribute('aria-current', 'page')
    expect(nav.getByRole('link', { name: en.shell.exams })).not.toHaveAttribute('aria-current')

    await user.click(nav.getByRole('link', { name: en.shell.exams }))
    expect(router.state.location.pathname).toBe(EXAMS_PATH)
    expect(await screen.findByRole('heading', { level: 1, name: en.exam.list.title })).toBeInTheDocument()
    expect(nav.getByRole('link', { name: en.shell.exams })).toHaveAttribute('aria-current', 'page')
    expect(nav.getByRole('link', { name: en.shell.calendar })).not.toHaveAttribute('aria-current')
  })

  it('the calendar route needs a signed-in user', async () => {
    const { router } = renderRoute(CALENDAR_PATH, { auth: createFakeAuth(null) })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
  })

  it('the week route needs a signed-in user', async () => {
    const { router } = renderRoute('/week', { auth: createFakeAuth(null) })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
  })

  it('an unknown path shows not found', async () => {
    renderRoute('/nope', { auth: createFakeAuth(null) })

    expect(await screen.findByRole('heading', { name: en.notFound.title })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: en.notFound.backHome })).toHaveAttribute('href', '/')
  })
})
