import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { he } from '../i18n/he'
import { createFakeAuth } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'

describe('routes', () => {
  it('the home route sends a signed-out user to login', async () => {
    const { router } = renderRoute('/', { auth: createFakeAuth(null) })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
    expect(screen.getByRole('button', { name: he.login.google })).toBeInTheDocument()
  })

  it('the home route shows loading until the session is known', async () => {
    const { router } = renderRoute('/', { auth: createFakeAuth(null) })
    expect(screen.getByText(he.common.loading)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')

    await waitFor(() => {
      expect(screen.queryByText(he.common.loading)).not.toBeInTheDocument()
    })
  })

  it('an unknown path shows not found', async () => {
    renderRoute('/nope', { auth: createFakeAuth(null) })

    expect(await screen.findByRole('heading', { name: he.notFound.title })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: he.notFound.backHome })).toHaveAttribute('href', '/')
  })
})
