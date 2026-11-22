import type { Session } from '@supabase/auth-js'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { COMPLETED_AT, examFixture, meFixture } from '../test/onboardingFixtures'
import { makeProgress } from '../progress/testFixtures'
import { SproutIcon } from '../ui/icons'
import { createFakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'

// Emoji are written as code points, so this file holds no emoji character.
const FACE = String.fromCodePoint(0x1f642)
const FAMILY = [0x1f468, 0x1f469, 0x1f467].map((c) => String.fromCodePoint(c)).join(String.fromCodePoint(0x200d))

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
  return screen.findByRole('button', { name: en.shell.profile })
}

beforeEach(() => {
  sessionStorage.clear()
})

describe('AppShell', () => {
  it('the first Tab stop is "skip to content", and Enter on it moves the focus to main', async () => {
    const user = userEvent.setup()
    const { router } = open('/calendar')
    await profileButton()

    await user.tab()
    const skip = screen.getByRole('link', { name: en.shell.skipToContent })
    expect(skip).toHaveFocus()
    expect(skip).toHaveAttribute('href', '#main')

    await user.keyboard('{Enter}')
    const main = screen.getByRole('main')
    expect(main).toHaveFocus()
    expect(main).toHaveAttribute('id', 'main')
    // The router did not see a navigation.
    expect(router.state.location.pathname).toBe('/calendar')
    expect(router.state.location.hash).toBe('')
  })

  it('has one main navigation with the three destinations in order, and only the current one is marked', async () => {
    open('/exams')

    const navs = await screen.findAllByRole('navigation', { name: en.shell.mainNav })
    expect(navs).toHaveLength(1)
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
    const nav = within(screen.getByRole('navigation', { name: en.shell.mainNav }))
    const links = nav.getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([en.shell.calendar, en.shell.exams, en.shell.progress])
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/calendar', '/exams', '/progress'])
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([null, 'page', null])
    expect(nav.queryByRole('link', { name: en.shell.settings })).not.toBeInTheDocument()
    // The icons are decoration: the name of a link is its label alone.
    for (const link of links) expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    // The icons of the mockup's bottom bar: the progress is a sprout (S31 decision 29).
    const sprout = render(<SproutIcon />).container.querySelector('svg')?.innerHTML
    expect(sprout).toBeTruthy()
    expect(links.map((link) => link.querySelector('svg')?.innerHTML === sprout)).toEqual([false, false, true])
    expect(nav.queryByRole('link', { name: en.shell.progress })?.querySelector('.lucide-trending-up')).toBeNull()
  })

  it('on the week of the calendar the calendar is the current destination', async () => {
    open('/calendar?view=week')

    const nav = within(await screen.findByRole('navigation', { name: en.shell.mainNav }))
    expect(nav.getAllByRole('link').map((link) => link.getAttribute('aria-current'))).toEqual(['page', null, null])
  })

  it('one banner holds the logo, the progress chip and the profile button', async () => {
    const auth = createFakeAuth(fakeSession())
    const api = createFakeApi()
      .on('GET /me', meFixture({ onboarding_completed_at: COMPLETED_AT }))
      .on('GET /progress', makeProgress({ streak: { current: 5, longest: 9, studied_today: true, today: '2026-11-16' }, level: 3 })).api
    renderRoute('/exams', { auth, api })

    const banner = within(await screen.findByRole('banner'))
    expect(screen.getAllByRole('banner')).toHaveLength(1)
    expect(banner.getByText(en.appName)).toBeInTheDocument()
    // The logo of the mockup (S31 decision 29): Archie's joy as a 34px avatar, decoration beside
    // the name, and the name in the display font.
    const logo = screen.getByText(en.appName).parentElement
    const archie = logo?.querySelector('[data-size="avatar"]')
    expect(archie).toHaveAttribute('data-mood', 'joy')
    expect(archie).toHaveClass('size-[34px]')
    expect(archie?.querySelector('img')).toHaveAttribute('alt', '')
    expect(screen.getByText(en.appName)).toHaveClass('font-display', 'font-bold')
    expect(await banner.findByRole('button', { name: en.shell.profile })).toBeInTheDocument()
    expect(await banner.findByRole('link', { name: en.shell.progressChip(5, 3) })).toHaveAttribute('href', '/progress')
  })

  it('without an answer from GET /progress the shell has no chip and no error', async () => {
    open('/settings')

    expect(await screen.findByRole('heading', { level: 1, name: en.settings.title })).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const banner = within(screen.getByRole('banner'))
    expect(banner.queryByRole('link', { name: /streak/ })).not.toBeInTheDocument()
    expect(banner.queryByRole('alert')).not.toBeInTheDocument()
    expect(banner.getByRole('button', { name: en.shell.profile })).toBeInTheDocument()
  })

  it('on the settings screen no destination is marked', async () => {
    open('/settings')

    const nav = within(await screen.findByRole('navigation', { name: en.shell.mainNav }))
    for (const link of nav.getAllByRole('link')) expect(link).not.toHaveAttribute('aria-current')
  })

  it('the profile button opens a menu with settings and sign out', async () => {
    const user = userEvent.setup()
    open('/today')

    const button = await profileButton()
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await user.click(button)
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([en.shell.settings, en.shell.signOut])
  })

  it('"settings" in the profile menu opens the settings screen', async () => {
    const user = userEvent.setup()
    const { router } = open('/today')

    await user.click(await profileButton())
    await user.click(screen.getByRole('menuitem', { name: en.shell.settings }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/settings')
    })
    expect(await screen.findByRole('heading', { level: 1, name: en.settings.title })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('"sign out" in the profile menu signs out, and the app lands on login', async () => {
    const user = userEvent.setup()
    const { auth, router } = open('/today')

    await user.click(await profileButton())
    await user.click(screen.getByRole('menuitem', { name: en.shell.signOut }))
    // After the push subscription of this device is dropped (S16), so not in the same tick.
    await waitFor(() => {
      expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' })
    })
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

  it('during the onboarding there is no navigation, no progress chip and no profile menu, only the name', async () => {
    const auth = createFakeAuth(fakeSession())
    const api = createFakeApi()
      .on('GET /me', meFixture({ onboarding_completed_at: null }))
      .on('GET /exams', [examFixture()])
      .on('GET /exams/e1/materials', [])
      .on('GET /progress', makeProgress()).api
    const { router } = renderRoute('/onboarding/exams', { auth, api })

    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/onboarding/exams')
    expect(screen.getByRole('banner')).toHaveTextContent(en.appName)
    // The onboarding has a navigation of its own, the steps: the shell's is the one that is gone.
    expect(screen.queryByRole('navigation', { name: en.shell.mainNav })).not.toBeInTheDocument()
    // No link at all in the banner: neither a destination nor the progress chip.
    expect(within(screen.getByRole('banner')).queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.shell.profile })).not.toBeInTheDocument()
    // The skip link is part of every screen.
    expect(screen.getByRole('link', { name: en.shell.skipToContent })).toBeInTheDocument()
  })
})

describe('focus after a navigation', () => {
  it('a navigation link moves the focus to the h1 of the new screen', async () => {
    const user = userEvent.setup()
    open('/calendar')

    const nav = within(await screen.findByRole('navigation', { name: en.shell.mainNav }))
    await user.click(nav.getByRole('link', { name: en.shell.exams }))
    const heading = await screen.findByRole('heading', { level: 1, name: en.exam.list.title })
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
    await user.click(screen.getByRole('menuitem', { name: en.shell.settings }))
    const heading = await screen.findByRole('heading', { level: 1, name: en.settings.title })
    await waitFor(() => {
      expect(heading).toHaveFocus()
    })
    // Still there after the frame in which React Aria would give the focus back to the trigger.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(heading).toHaveFocus()
  })

  it('the first screen and the redirect from / do not take the focus', async () => {
    const { router } = open('/')

    // Below lg (jsdom has no matchMedia) the h1 is the calendar's phone header: the day's name.
    const heading = await screen.findByRole('heading', { level: 1, name: en.board.today })
    expect(router.state.location.pathname).toBe('/calendar')
    expect(heading).not.toHaveFocus()
    expect(screen.getByRole('main')).not.toHaveFocus()
    expect(document.body).toHaveFocus()
  })

  it('a change of the search params alone does not move the focus', async () => {
    const { router } = open('/calendar?view=week')

    const heading = await screen.findByRole('heading', { level: 1, name: en.board.today })
    await router.navigate('/calendar?view=week&from=2026-11-22')
    await waitFor(() => {
      expect(router.state.location.search).toBe('?view=week&from=2026-11-22')
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
    expect(button).toHaveAccessibleName(en.shell.profile)
  })

  it('without a name it is the first letter of the email, in upper case', async () => {
    open('/today', sessionOf({ email: 'dana@example.com' }))

    expect(await profileButton()).toHaveTextContent(/^D$/)
  })

  it('a name that starts with an emoji and no email: an icon, no letter', async () => {
    open('/today', sessionOf({ fullName: `${FACE} x` }))

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
    { fullName: `${FACE} x`, email: 'dana@example.com', letter: 'D' },
    { fullName: 'אייל', email: 'x@example.com', letter: 'א' },
  ])('name "$fullName" and email "$email" give the letter $letter', async ({ fullName, email, letter }) => {
    open('/today', sessionOf({ fullName, email }))

    expect(await profileButton()).toHaveTextContent(new RegExp(`^${letter}$`))
  })

  it.each([
    { fullName: '   ', email: undefined },
    { fullName: `${FAMILY} family`, email: '' },
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
