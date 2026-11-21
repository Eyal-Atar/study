import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'

describe('LoginPage', () => {
  it('starts Google sign-in, with the account chooser and a redirect to the callback route', async () => {
    const user = userEvent.setup()
    const auth = createFakeAuth(null)
    renderRoute('/login', { auth })

    await user.click(await screen.findByRole('button', { name: en.login.google }))
    expect(auth.signInWithOAuth).toHaveBeenCalledExactlyOnceWith({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { prompt: 'select_account' },
      },
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows an error when sign-in cannot start', async () => {
    const user = userEvent.setup()
    const auth = createFakeAuth(null)
    auth.signInWithOAuth.mockResolvedValueOnce({ error: new Error('x') })
    renderRoute('/login', { auth })

    await user.click(await screen.findByRole('button', { name: en.login.google }))
    expect(await screen.findByRole('alert')).toHaveTextContent(en.login.failed)
  })

  // The first impression: the name as the only h1, one sentence, and one button.
  it('shows the name as the h1, the tagline, and a single button', async () => {
    renderRoute('/login', { auth: createFakeAuth(null) })

    expect(await screen.findByRole('heading', { level: 1, name: en.appName })).toBeInTheDocument()
    expect(screen.getAllByRole('heading')).toHaveLength(1)
    expect(screen.getByText(en.tagline)).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('is pending while the request is on its way, sends it once, and comes back when it fails', async () => {
    const user = userEvent.setup()
    const auth = createFakeAuth(null)
    let fail: (error: Error) => void = () => {}
    auth.signInWithOAuth.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject
      }),
    )
    renderRoute('/login', { auth })

    const button = await screen.findByRole('button', { name: en.login.google })
    await user.click(button)
    // React Aria: a pending button keeps its name and its focus, and ignores presses.
    expect(button).toHaveAttribute('data-pending', 'true')
    await user.click(button)
    expect(auth.signInWithOAuth).toHaveBeenCalledOnce()

    fail(new Error('x'))
    expect(await screen.findByRole('alert')).toHaveTextContent(en.login.failed)
    expect(button).not.toHaveAttribute('data-pending')

    await user.click(button)
    expect(auth.signInWithOAuth).toHaveBeenCalledTimes(2)
  })

  it('sends a signed-in user home', async () => {
    const { router } = renderRoute('/login', { auth: createFakeAuth(fakeSession()) })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
  })
})
