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
        <button type="button">פקד בסרגל</button>
      </ShellToolbar>
      <h1>עם סרגל</h1>
      <Link to="/plain">למסך אחר</Link>
    </>
  )
}

function Plain() {
  return <h1>בלי סרגל</h1>
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
    const control = await banner.findByRole('button', { name: 'פקד בסרגל' })
    expect(within(screen.getByRole('main')).queryByRole('button', { name: 'פקד בסרגל' })).not.toBeInTheDocument()
    expect(control).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'למסך אחר' }))
    expect(await screen.findByRole('heading', { name: 'בלי סרגל' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'פקד בסרגל' })).not.toBeInTheDocument()
  })

  it('outside the shell renders nothing', () => {
    render(
      <ShellToolbar>
        <button type="button">פקד בסרגל</button>
      </ShellToolbar>,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
