import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { he } from '../i18n/he'
import { ConfigErrorScreen } from './ConfigErrorScreen'

it('shows the title, the explanation and every problem', () => {
  render(<ConfigErrorScreen problems={['VITE_API_URL is missing']} />)
  expect(screen.getByRole('heading', { level: 1, name: he.config.title })).toBeInTheDocument()
  expect(screen.getByText(he.config.body)).toBeInTheDocument()
  expect(screen.getByRole('listitem')).toHaveTextContent(/^VITE_API_URL is missing$/)
  // The problems are in English.
  expect(screen.getByRole('list')).toHaveAttribute('dir', 'ltr')
  expect(screen.getByRole('main')).toBeInTheDocument()
})
