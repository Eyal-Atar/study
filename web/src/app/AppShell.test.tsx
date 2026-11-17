import type { Session } from '@supabase/supabase-js'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { he } from '../i18n/he'
import { COMPLETED_AT, examFixture, meFixture } from '../onboarding/testFixtures'
import { createFakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'

// A signed-in user with a plan, on `path`, inside the real routes.
function open(path: string, session: Session = fakeSession()) {
  const auth = createFakeAuth(session)
  const api = createFakeApi().on('GET /me', meFixture({ onboarding_completed_at: COMPLETED_AT })).api
  return { auth, ...renderRoute(path, { auth, api }) }
}

// A session as Google gives it: with or without a name, with or without an email.
function sessionOf({ fullName, email }: { fullName?: string; email?: string }): Session {
  const session = fakeSession()
  return {
    ...session,
    user: { ...session.user, email, user_metadata: fullName === undefined ? {} : { full_name: fullName } },
  }
}

async function profileButton() {
  return screen.findByRole('button', { name: he.shell.profile })
}

beforeEach(() => {
  sessionStorage.clear()
})

describe('AppShell', () => {
  it('the first Tab stop is "skip to content", and Enter on it moves the focus to main', async () => {
    const user = userEvent.setup()
    const { router } = open('/today')
    await profileButton()

    await user.tab()
    const skip = screen.getByRole('link', { name: he.shell.skipToContent })
    expect(skip).toHaveFocus()
    expect(skip).toHaveAttribute('href', '#main')

    await user.keyboard('{Enter}')
    const main = screen.getByRole('main')
    expect(main).toHaveFocus()
    expect(main).toHaveAttribute('id', 'main')
    // The router did not see a navigation.
    expect(router.state.location.pathname).toBe('/today')
    expect(router.state.location.hash).toBe('')
  })

  it('has one main navigation with the four destinations in order, and only the current one is marked', async () => {
    open('/exams')

    const navs = await screen.findAllByRole('navigation', { name: he.shell.mainNav })
    expect(navs).toHaveLength(1)
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
    const nav = within(screen.getByRole('navigation', { name: he.shell.mainNav }))
    const links = nav.getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([he.shell.today, he.shell.week, he.shell.exams, he.shell.progress])
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/today', '/week', '/exams', '/progress'])
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([null, null, 'page', null])
    expect(nav.queryByRole('link', { name: he.shell.settings })).not.toBeInTheDocument()
    // The icons are decoration: the name of a link is its label alone.
    for (const link of links) expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('on the settings screen no destination is marked', async () => {
    open('/settings')

    const nav = within(await screen.findByRole('navigation', { name: he.shell.mainNav }))
    for (const link of nav.getAllByRole('link')) expect(link).not.toHaveAttribute('aria-current')
  })

  it('the profile button opens a menu with settings and sign out', async () => {
    const user = userEvent.setup()
    open('/today')

    const button = await profileButton()
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await user.click(button)
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([he.shell.settings, he.shell.signOut])
  })

  it('"settings" in the profile menu opens the settings screen', async () => {
    const user = userEvent.setup()
    const { router } = open('/today')

    await user.click(await profileButton())
    await user.click(screen.getByRole('menuitem', { name: he.shell.settings }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/settings')
    })
    expect(await screen.findByRole('heading', { level: 1, name: he.settings.title })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('"sign out" in the profile menu signs out, and the app lands on login', async () => {
    const user = userEvent.setup()
    const { auth, router } = open('/today')

    await user.click(await profileButton())
    await user.click(screen.getByRole('menuitem', { name: he.shell.signOut }))
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
  })

  it('the profile menu works from the keyboard: Enter opens, the arrows move, Escape closes and returns the focus', async () => {
    const user = userEvent.setup()
    open('/today')

    const button = await profileButton()
    button.focus()
    await user.keyboard('{Enter}')
    const items = screen.getAllByRole('menuitem')
    expect(items[0]).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(items[1]).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    // React Aria restores the focus on the next frame.
    await waitFor(() => {
      expect(button).toHaveFocus()
    })
  })

  it('during the onboarding there is no navigation and no profile menu, only the name', async () => {
    const auth = createFakeAuth(fakeSession())
    const api = createFakeApi()
      .on('GET /me', meFixture({ onboarding_completed_at: null }))
      .on('GET /exams', [examFixture()])
      .on('GET /exams/e1/materials', []).api
    const { router } = renderRoute('/onboarding/exams', { auth, api })

    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/onboarding/exams')
    expect(screen.getByRole('banner')).toHaveTextContent(he.appName)
    // The onboarding has a navigation of its own, the steps: the shell's is the one that is gone.
    expect(screen.queryByRole('navigation', { name: he.shell.mainNav })).not.toBeInTheDocument()
    expect(within(screen.getByRole('banner')).queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: he.shell.profile })).not.toBeInTheDocument()
    // The skip link is part of every screen.
    expect(screen.getByRole('link', { name: he.shell.skipToContent })).toBeInTheDocument()
  })
})

describe('focus after a navigation', () => {
  it('a navigation link moves the focus to the h1 of the new screen', async () => {
    const user = userEvent.setup()
    open('/today')

    const nav = within(await screen.findByRole('navigation', { name: he.shell.mainNav }))
    await user.click(nav.getByRole('link', { name: he.shell.week }))
    const heading = await screen.findByRole('heading', { level: 1, name: he.week.title })
    await waitFor(() => {
      expect(heading).toHaveFocus()
    })
    // Focusable from code, not a Tab stop.
    expect(heading).toHaveAttribute('tabindex', '-1')
  })

  it('"settings" in the profile menu leaves the focus on the h1 of settings, not on the profile button', async () => {
    const user = userEvent.setup()
    open('/today')

    await user.click(await profileButton())
    await user.click(screen.getByRole('menuitem', { name: he.shell.settings }))
    const heading = await screen.findByRole('heading', { level: 1, name: he.settings.title })
    await waitFor(() => {
      expect(heading).toHaveFocus()
    })
    // Still there after the frame in which React Aria would give the focus back to the trigger.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(heading).toHaveFocus()
  })

  it('the first screen and the redirect from / do not take the focus', async () => {
    const { router } = open('/')

    const heading = await screen.findByRole('heading', { level: 1, name: he.today.title })
    expect(router.state.location.pathname).toBe('/today')
    expect(heading).not.toHaveFocus()
    expect(screen.getByRole('main')).not.toHaveFocus()
    expect(document.body).toHaveFocus()
  })

  it('a change of the search params alone does not move the focus', async () => {
    const { router } = open('/week')

    const heading = await screen.findByRole('heading', { level: 1, name: he.week.title })
    await router.navigate('/week?from=2026-11-22')
    await waitFor(() => {
      expect(router.state.location.search).toBe('?from=2026-11-22')
    })
    expect(heading).not.toHaveFocus()
    expect(document.body).toHaveFocus()
  })
})

describe('the letter on the profile button', () => {
  it('is the first letter of the Google name', async () => {
    open('/today', sessionOf({ fullName: 'אייל עטאר', email: 'eyal@example.com' }))

    const button = await profileButton()
    expect(button).toHaveTextContent(/^א$/)
    expect(button.querySelector('svg')).not.toBeInTheDocument()
    expect(button).toHaveAccessibleName(he.shell.profile)
  })

  it('without a name it is the first letter of the email, in upper case', async () => {
    open('/today', sessionOf({ email: 'dana@example.com' }))

    expect(await profileButton()).toHaveTextContent(/^D$/)
  })

  it('a name that starts with an emoji and no email: an icon, no letter', async () => {
    open('/today', sessionOf({ fullName: '🙂 x' }))

    const button = await profileButton()
    expect(button).toHaveTextContent('')
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('no name and no email: an icon, no letter', async () => {
    open('/today', sessionOf({}))

    const button = await profileButton()
    expect(button).toHaveTextContent('')
    expect(button.querySelector('svg')).toBeInTheDocument()
  })

  // The name first; a name without a first letter falls back to the email; user_metadata is
  // whatever the provider sent.
  it.each([
    { fullName: '  dana', email: undefined, letter: 'D' },
    { fullName: '', email: 'dana@example.com', letter: 'D' },
    { fullName: '🙂 x', email: 'dana@example.com', letter: 'D' },
    { fullName: 'אייל', email: 'x@example.com', letter: 'א' },
  ])('name "$fullName" and email "$email" give the letter $letter', async ({ fullName, email, letter }) => {
    open('/today', sessionOf({ fullName, email }))

    expect(await profileButton()).toHaveTextContent(new RegExp(`^${letter}$`))
  })

  it.each([
    { fullName: '   ', email: undefined },
    { fullName: '👨‍👩‍👧 family', email: '' },
    { fullName: undefined, email: '7up@example.com' },
    { fullName: 42, email: undefined },
    { fullName: null, email: undefined },
  ])('name "$fullName" and email "$email" give an icon and do not throw', async ({ fullName, email }) => {
    const session = sessionOf({ email })
    session.user.user_metadata = { full_name: fullName }
    open('/today', session)

    const button = await profileButton()
    expect(button).toHaveTextContent('')
    expect(button.querySelector('svg')).toBeInTheDocument()
  })
})
