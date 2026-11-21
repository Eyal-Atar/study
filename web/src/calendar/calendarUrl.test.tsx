import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../app/AppProviders'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { silentApi } from '../test/fakeApi'
import { createFakeStorage } from '../test/fakeStorage'
import { useCalendarUrl } from './calendarUrl'

function mockDesktop(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
}

function Probe() {
  const url = useCalendarUrl()
  return (
    <div>
      <output data-testid="state">{JSON.stringify({ view: url.view, date: url.date })}</output>
      <button onClick={() => { url.setDate('2026-11-25') }}>set date</button>
      <button onClick={() => { url.setView('week') }}>set week</button>
      <button onClick={() => { url.setView('day') }}>set day</button>
      <button onClick={() => { url.goToday() }}>today</button>
    </div>
  )
}

function renderAt(path: string) {
  const router = createMemoryRouter([{ path: '*', element: <Probe /> }], { initialEntries: [path] })
  const auth = createFakeAuth(fakeSession({ id: 'user-a' }))
  render(
    <StrictMode>
      <AppProviders auth={auth.client} api={silentApi()} storage={createFakeStorage().client} queryClient={new QueryClient()}>
        <RouterProvider router={router} />
      </AppProviders>
    </StrictMode>,
  )
  return router
}

const state = () => JSON.parse(screen.getByTestId('state').textContent) as { view: string; date: string | null }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useCalendarUrl', () => {
  it('reads ?from= when there is no ?date=', () => {
    mockDesktop(true)
    renderAt('/calendar?from=2026-11-24')
    expect(state().date).toBe('2026-11-24')
  })
  it('prefers ?date= over ?from=', () => {
    mockDesktop(true)
    renderAt('/calendar?date=2026-11-20&from=2026-11-24')
    expect(state().date).toBe('2026-11-20')
  })
  it('drops a date that is not a real day or is far from today', () => {
    mockDesktop(true)
    renderAt('/calendar?date=2026-02-31')
    expect(state().date).toBeNull()
  })
  it('drops a date more than 1800 days away', () => {
    mockDesktop(true)
    renderAt('/calendar?date=2032-01-01')
    expect(state().date).toBeNull()
  })
  it('shows the week on a desktop unless ?view=day', () => {
    mockDesktop(true)
    renderAt('/calendar')
    expect(state().view).toBe('week')
  })
  it('shows the day on a desktop with ?view=day', () => {
    mockDesktop(true)
    renderAt('/calendar?view=day')
    expect(state().view).toBe('day')
  })
  it('always shows the day on a phone', () => {
    mockDesktop(false)
    renderAt('/calendar?view=week')
    expect(state().view).toBe('day')
  })
  it('setDate pushes, keeps view and removes from', async () => {
    mockDesktop(true)
    const router = renderAt('/calendar?view=day&from=2026-11-24')
    await userEvent.click(screen.getByText('set date'))
    expect(router.state.location.search).toBe('?view=day&date=2026-11-25')
    await router.navigate(-1)
    expect(router.state.location.search).toBe('?view=day&from=2026-11-24')
  })
  it('setView(week) removes view and keeps the date; setView(day) sets it', async () => {
    mockDesktop(true)
    const router = renderAt('/calendar?view=day&date=2026-11-25')
    await userEvent.click(screen.getByText('set week'))
    expect(router.state.location.search).toBe('?date=2026-11-25')
    await userEvent.click(screen.getByText('set day'))
    expect(router.state.location.search).toBe('?date=2026-11-25&view=day')
  })
  it('goToday removes date and from and keeps view', async () => {
    mockDesktop(true)
    const router = renderAt('/calendar?view=day&date=2026-11-25&from=2026-11-24')
    await userEvent.click(screen.getByText('today'))
    expect(router.state.location.search).toBe('?view=day')
  })
})
