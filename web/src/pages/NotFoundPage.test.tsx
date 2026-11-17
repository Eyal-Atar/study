import { screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { he } from '../i18n/he'
import { createFakeAuth } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'

it('shows the title as the h1, one sentence, and the way home', async () => {
  renderRoute('/no/such/page', { auth: createFakeAuth(null) })

  expect(await screen.findByRole('heading', { level: 1, name: he.notFound.title })).toBeInTheDocument()
  expect(screen.getByText(he.notFound.body)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: he.notFound.backHome })).toHaveAttribute('href', '/')
  expect(document.title).toBe(`${he.notFound.title} · ${he.appName}`)
})
