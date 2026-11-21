import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { createFakeAuth } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'

describe('LegalPage', () => {
  // Outside RequireAuth: the login screen links here before anyone has signed in.
  it.each([
    ['/terms', en.entry.legal.terms],
    ['/privacy', en.entry.legal.privacy],
  ])('%s opens signed out, with its name as the h1, "soon" and the way back', async (path, title) => {
    const { router } = renderRoute(path, { auth: createFakeAuth(null) })

    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    expect(screen.getByText(en.entry.legal.soon)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: en.entry.legal.back })).toHaveAttribute('href', '/login')
    expect(router.state.location.pathname).toBe(path)
    expect(document.title).toBe(`${title} – ${en.appName}`)
  })
})
