import { act, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { he } from '../i18n/he'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'

function expectFailure() {
  expect(screen.getByRole('heading', { level: 1, name: he.callback.title })).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent(he.callback.failed)
  // Trying again means going back to the login screen: the failure itself has no retry button.
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: he.callback.backToLogin })).toHaveAttribute('href', '/login')
  expect(screen.queryByText(he.callback.working)).not.toBeInTheDocument()
}

// Lets the INITIAL_SESSION microtask of the fake run, with what it renders, inside act.
async function initialSession() {
  await act(async () => {})
}

describe('AuthCallbackPage', () => {
  // The user cancelled on Google's consent screen, or Supabase refused the sign-in.
  it('shows the failure when Google or Supabase returned an error', async () => {
    const { router } = renderRoute('/auth/callback?error=access_denied&error_description=x', {
      auth: createFakeAuth(null),
    })
    // Before INITIAL_SESSION arrives, only the error in the URL can show the failure.
    expectFailure()

    await initialSession()
    expectFailure()
    expect(router.state.location.pathname).toBe('/auth/callback')
  })

  // On a URL with an error, auth-js keeps a session this browser already holds, so INITIAL_SESSION
  // carries it. Only the error in the URL stops the page from sending the user home as if it worked.
  it.each(['?error=access_denied', '?error_description=x'])(
    'shows the failure on %s even when this browser still holds a session',
    async (query) => {
      const { router } = renderRoute(`/auth/callback${query}`, { auth: createFakeAuth(fakeSession()) })
      expectFailure()

      await initialSession()
      expectFailure()
      expect(router.state.location.pathname).toBe('/auth/callback')
    },
  )

  // The code expired after 5 minutes, was used already, or the link was opened in another browser
  // (no code verifier): supabase-js creates no session, and INITIAL_SESSION is empty.
  it('shows the failure when no session came out of the callback', async () => {
    renderRoute('/auth/callback?code=expired', { auth: createFakeAuth(null) })
    expect(screen.getByRole('heading', { level: 1, name: he.callback.title })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(he.callback.working)

    await initialSession()
    expectFailure()
  })

  it('goes home once signed in', async () => {
    const { router } = renderRoute('/auth/callback?code=abc', { auth: createFakeAuth(fakeSession()) })
    expect(screen.getByText(he.callback.working)).toBeInTheDocument()

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/')
    })
    expect(screen.queryByText(he.callback.failed)).not.toBeInTheDocument()
  })
})
