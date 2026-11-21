import { screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { en } from '../i18n/en'
import { createFakeAuth } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'

const t = en.settings.goodbye

it('shows the title as the h1, the sentence, and one link to the login screen', async () => {
  renderRoute('/goodbye', { auth: createFakeAuth(null) })

  expect(await screen.findByRole('heading', { level: 1, name: t.title })).toBeInTheDocument()
  expect(screen.getByText(t.body)).toBeInTheDocument()
  expect(screen.getAllByRole('link')).toHaveLength(1)
  expect(screen.getByRole('link', { name: t.login })).toHaveAttribute('href', '/login')
  // A link and not a button: nothing is sent from this screen.
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})
