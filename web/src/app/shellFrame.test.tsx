import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { StrictMode } from 'react'
import { createMemoryRouter, Link } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { describe, expect, it } from 'vitest'
import { INSTALL_HINT_KEY } from '../notifications/InstallHint'
import { IPHONE_UA, installFakePush } from '../notifications/fakePush'
import { en } from '../i18n/en'
import { createFakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { createFakeStorage } from '../test/fakeStorage'
import { makeMe } from '../test/boardFixtures'
import { AppProviders } from './AppProviders'
import { AppShell } from './AppShell'
import { useToast } from '../ui/useToast'
import { useShellFrame } from './shellFrame'

// S32 decision 2: a screen may ask the shell for the whole width and for its own phone header.
function Calendarish() {
  useShellFrame({ fullBleed: true, ownPhoneHeader: true })
  return (
    <>
      <h1>Board</h1>
      <Link to="/plain">Plain</Link>
    </>
  )
}

// S42: the focus screen stands alone, with no bar and no navigation.
function Bare() {
  useShellFrame({ bare: true })
  const toast = useToast()
  return (
    <>
      <h1>Focus</h1>
      <button type="button" onClick={() => toast.show({ text: 'Stopped for now' })}>
        Stop
      </button>
      <Link to="/plain">Plain</Link>
    </>
  )
}

function Plain() {
  return <h1>Plain</h1>
}

function open(path: string) {
  const router = createMemoryRouter(
    [
      {
        element: <AppShell />,
        children: [
          { path: '/full', element: <Calendarish /> },
          { path: '/bare', element: <Bare /> },
          { path: '/plain', element: <Plain /> },
          // The focus route, with a screen that does not ask: the shell knows it from the route alone.
          { path: '/focus/:blockId', element: <Plain /> },
        ],
      },
    ],
    { initialEntries: [path] },
  )
  const api = createFakeApi().on('GET /me', makeMe()).api
  render(
    <StrictMode>
      <AppProviders
        auth={createFakeAuth(fakeSession()).client}
        api={api}
        storage={createFakeStorage().client}
        queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router} />
      </AppProviders>
    </StrictMode>,
  )
  return router
}

describe('useShellFrame', () => {
  it('a screen that asks gets the whole width, and the bar folds below lg while the navigation stays', async () => {
    open('/full')
    await screen.findByRole('heading', { name: 'Board' })
    const main = screen.getByRole('main')
    expect(main.className).not.toContain('max-w-3xl')
    expect(main.className).not.toContain('px-page')
    const header = screen.getByRole('banner')
    expect(header.className).toContain('max-lg:pt-0')
    // The navigation is inside the header and must not go with the bar.
    expect(screen.getByRole('navigation', { name: en.shell.mainNav })).toBeVisible()
  })

  it('a screen that does not ask keeps the column, and leaving the asking screen gives the plain frame back', async () => {
    const user = userEvent.setup()
    open('/full')
    await screen.findByRole('heading', { name: 'Board' })
    await user.click(screen.getByRole('link', { name: 'Plain' }))
    await screen.findByRole('heading', { name: 'Plain' })
    expect(screen.getByRole('main').className).toContain('max-w-3xl')
    expect(screen.getByRole('banner').className).not.toContain('max-lg:pt-0')
  })

  it('a bare screen has no bar and no navigation, keeps the skip link and the toasts, and gives them back on leaving', async () => {
    const user = userEvent.setup()
    open('/bare')
    await screen.findByRole('heading', { name: 'Focus' })
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: en.shell.mainNav })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: en.shell.skipToContent })).toBeInTheDocument()
    const main = screen.getByRole('main')
    expect(main.className).not.toContain('max-w-3xl')
    expect(main.className).not.toContain('px-page')
    expect(main.className).not.toContain('pb-[calc(7rem')
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(await screen.findByText('Stopped for now')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Plain' }))
    await screen.findByRole('heading', { name: 'Plain' })
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: en.shell.mainNav })).toBeInTheDocument()
    expect(screen.getByRole('main').className).toContain('max-w-3xl')
  })

  it('a bare screen does not show the install hint', async () => {
    localStorage.clear()
    const push = installFakePush({ userAgent: IPHONE_UA, supported: false })
    try {
      open('/bare')
      await screen.findByRole('heading', { name: 'Focus' })
      expect(screen.queryByRole('region', { name: en.notifications.installTitle })).not.toBeInTheDocument()
    } finally {
      push.restore()
      localStorage.clear()
    }
  })

  it('the focus route is bare from the very first render, before any effect asks, and never mounts the install hint', async () => {
    localStorage.clear()
    const push = installFakePush({ userAgent: IPHONE_UA, supported: false })
    try {
      open('/focus/block-1')
      // No waiting: the first commit already has no bar and no column.
      expect(screen.queryByRole('banner')).not.toBeInTheDocument()
      expect(screen.queryByRole('navigation', { name: en.shell.mainNav })).not.toBeInTheDocument()
      expect(screen.getByRole('main').className).not.toContain('max-w-3xl')
      await screen.findByRole('heading', { name: 'Plain' })
      expect(screen.queryByRole('banner')).not.toBeInTheDocument()
      // The hint was never mounted, so it was not marked seen and still shows on the next screen.
      expect(localStorage.getItem(INSTALL_HINT_KEY)).toBeNull()
    } finally {
      push.restore()
      localStorage.clear()
    }
  })
})
