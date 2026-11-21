import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { en } from '../i18n/en'
import { ConfigErrorScreen } from './ConfigErrorScreen'

it('shows the title, the explanation and every problem', () => {
  render(<ConfigErrorScreen problems={['VITE_API_URL is missing']} />)
  expect(screen.getByRole('heading', { level: 1, name: en.config.title })).toBeInTheDocument()
  expect(screen.getByText(en.config.body)).toBeInTheDocument()
  expect(screen.getByRole('listitem')).toHaveTextContent(/^VITE_API_URL is missing$/)
  // The problems are in English.
  expect(screen.getByRole('list')).toHaveAttribute('dir', 'ltr')
  expect(screen.getByRole('main')).toBeInTheDocument()
})
