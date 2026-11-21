import { QueryClient } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { createMemoryRouter, Link } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { describe, expect, it } from 'vitest'
import { createFakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { createFakeStorage } from '../test/fakeStorage'
import { AppProviders } from './AppProviders'
import { AppShell } from './AppShell'
import { ShellToolbar } from './ShellToolbar'

// A screen that puts a control into the header, and one that does not.
function WithToolbar() {
  return (
    <>
      <ShellToolbar>
        <button type="button">Toolbar control</button>
      </ShellToolbar>
      <h1>With toolbar</h1>
      <Link to="/plain">To another screen</Link>
    </>
  )
}

function Plain() {
  return <h1>Without toolbar</h1>
}

function renderShell() {
  const router = createMemoryRouter([{ Component: AppShell, children: [{ path: '/', Component: WithToolbar }, { path: '/plain', Component: Plain }] }])
  return render(
    <AppProviders
      auth={createFakeAuth(fakeSession()).client}
      api={createFakeApi().api}
      storage={createFakeStorage().client}
      queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </AppProviders>,
  )
}

describe('ShellToolbar', () => {
  it('renders the children of a screen inside the banner, and they leave with the screen', async () => {
    const user = userEvent.setup()
    renderShell()

    const banner = within(await screen.findByRole('banner'))
    const control = await banner.findByRole('button', { name: 'Toolbar control' })
    expect(within(screen.getByRole('main')).queryByRole('button', { name: 'Toolbar control' })).not.toBeInTheDocument()
    expect(control).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'To another screen' }))
    expect(await screen.findByRole('heading', { name: 'Without toolbar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Toolbar control' })).not.toBeInTheDocument()
  })

  it('outside the shell renders nothing', () => {
    render(
      <ShellToolbar>
        <button type="button">Toolbar control</button>
      </ShellToolbar>,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
