import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { he } from '../i18n/he'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'

describe('LoginPage', () => {
  it('starts Google sign-in, with the account chooser and a redirect to the callback route', async () => {
    const user = userEvent.setup()
    const auth = createFakeAuth(null)
    renderRoute('/login', { auth })

    await user.click(await screen.findByRole('button', { name: he.login.google }))
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

    await user.click(await screen.findByRole('button', { name: he.login.google }))
    expect(await screen.findByRole('alert')).toHaveTextContent(he.login.failed)
  })

  it('sends a signed-in user home', async () => {
    const { router } = renderRoute('/login', { auth: createFakeAuth(fakeSession()) })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
  })
})
