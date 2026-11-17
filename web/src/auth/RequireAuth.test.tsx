import { render, screen, within } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { expect, it } from 'vitest'
import { he } from '../i18n/he'
import { fakeSession } from '../test/fakeAuth'
import { AuthContext, type AuthState } from './AuthContext'
import { RequireAuth } from './RequireAuth'

function renderWith(state: AuthState) {
  const router = createMemoryRouter(
    [
      { element: <RequireAuth />, children: [{ path: '/', element: <p>inside</p> }] },
      { path: '/login', element: <p>login</p> },
    ],
    { initialEntries: ['/'] },
  )
  render(
    <AuthContext.Provider value={{ ...state, signInWithGoogle: () => Promise.resolve(), signOut: () => Promise.resolve() }}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  )
  return router
}

it('shows a loading state inside a main, and not the screen, until the session is known', () => {
  const router = renderWith({ status: 'loading' })

  const status = within(screen.getByRole('main')).getByRole('status')
  expect(status).toHaveTextContent(he.common.loading)
  expect(status.querySelector('[data-skeleton-card]')).not.toBeNull()
  expect(screen.queryByText('inside')).not.toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/')
})

it('sends a signed-out user to the login screen', () => {
  const router = renderWith({ status: 'signed_out' })

  expect(router.state.location.pathname).toBe('/login')
})

it('shows the screen to a signed-in user', () => {
  renderWith({ status: 'signed_in', session: fakeSession() })

  expect(screen.getByText('inside')).toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})
