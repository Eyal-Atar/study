import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { he } from '../i18n/he'
import { createFakeAuth } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'

describe('LegalPage', () => {
  // Outside RequireAuth: the login screen links here before anyone has signed in.
  it.each([
    ['/terms', he.legal.terms],
    ['/privacy', he.legal.privacy],
  ])('%s opens signed out, with its name as the h1, "soon" and the way back', async (path, title) => {
    const { router } = renderRoute(path, { auth: createFakeAuth(null) })

    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    expect(screen.getByText(he.legal.soon)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: he.legal.back })).toHaveAttribute('href', '/login')
    expect(router.state.location.pathname).toBe(path)
    expect(document.title).toBe(`${title} · ${he.appName}`)
  })
})
