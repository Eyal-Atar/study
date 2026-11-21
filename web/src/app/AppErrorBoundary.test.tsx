import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { en } from '../i18n/en'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { AppErrorBoundary, RouteCrash } from './AppErrorBoundary'

function Boom(): never {
  throw new Error('provider exploded')
}

describe('AppErrorBoundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the Hebrew crash screen instead of a white page when a child throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    )

    expect(screen.getByRole('heading', { name: en.crash.title })).toBeInTheDocument()
    expect(screen.getByText(en.crash.body)).toBeInTheDocument()
    expect(screen.getByText('Error: provider exploded')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: en.crash.reload }))
    expect(reload).toHaveBeenCalledOnce()
  })

  it('renders its children when nothing throws', () => {
    render(
      <AppErrorBoundary>
        <p>All good</p>
      </AppErrorBoundary>,
    )
    expect(screen.getByText('All good')).toBeInTheDocument()
  })
})

describe('RouteCrash', () => {
  it('shows the Hebrew crash screen for an error thrown inside a screen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const router = createMemoryRouter([{ ErrorBoundary: RouteCrash, children: [{ path: '/', Component: Boom }] }])
    render(<RouterProvider router={router} />)
    expect(await screen.findByRole('heading', { name: en.crash.title })).toBeInTheDocument()
    expect(screen.getByText('Error: provider exploded')).toBeInTheDocument()
  })
})
