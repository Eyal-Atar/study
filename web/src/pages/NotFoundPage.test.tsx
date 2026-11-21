import { screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { en } from '../i18n/en'
import { createFakeAuth } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'

it('shows the title as the h1, one sentence, and the way home', async () => {
  renderRoute('/no/such/page', { auth: createFakeAuth(null) })

  expect(await screen.findByRole('heading', { level: 1, name: en.notFound.title })).toBeInTheDocument()
  expect(screen.getByText(en.notFound.body)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: en.notFound.backHome })).toHaveAttribute('href', '/')
  expect(document.title).toBe(`${en.notFound.title} – ${en.appName}`)
})
