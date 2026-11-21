import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { StrictMode } from 'react'
import { createMemoryRouter, Link } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { createFakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { createFakeStorage } from '../test/fakeStorage'
import { makeMe } from '../test/boardFixtures'
import { AppProviders } from './AppProviders'
import { AppShell } from './AppShell'
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
          { path: '/plain', element: <Plain /> },
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
})
