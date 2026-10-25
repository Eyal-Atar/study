import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { he } from '../i18n/he'
import { App } from './App'

it('shows the product name as the main heading, and the tagline', () => {
  render(<App />)
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^StudyFlow$/)
  expect(screen.getByText(he.tagline)).toBeInTheDocument()
})
