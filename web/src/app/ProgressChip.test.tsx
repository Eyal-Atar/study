import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { describe, expect, it } from 'vitest'
import { he } from '../i18n/he'
import { makeProgress } from '../progress/testFixtures'
import type { Progress } from '../progress/types'
import { createFakeApi, problem } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { createFakeStorage } from '../test/fakeStorage'
import { AppProviders } from './AppProviders'
import { ProgressChip } from './ProgressChip'

// The chip alone, signed in, with `reply` as the answer of GET /progress.
function renderChip(reply: unknown) {
  const api = createFakeApi().on('GET /progress', reply).api
  const router = createMemoryRouter([{ path: '/', element: <ProgressChip /> }])
  return render(
    <AppProviders
      auth={createFakeAuth(fakeSession()).client}
      api={api}
      storage={createFakeStorage().client}
      queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </AppProviders>,
  )
}

function progressWith(streak: number, level: number, xp: Partial<Progress> = {}): Progress {
  const base = makeProgress()
  return { ...base, level, streak: { ...base.streak, current: streak }, ...xp }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

describe('ProgressChip', () => {
  it('is one link to the progress board, named by the streak and the level', async () => {
    renderChip(progressWith(5, 3))

    const link = await screen.findByRole('link', { name: he.shell.progressChip(5, 3) })
    expect(he.shell.progressChip(5, 3)).toBe('רצף של 5 ימים, רמה 3')
    expect(link).toHaveAttribute('href', '/progress')
    expect(screen.getAllByRole('link')).toHaveLength(1)
    // The numbers are what the eye reads; the drawings are decoration.
    expect(link).toHaveTextContent('5')
    expect(link).toHaveTextContent('3')
    for (const svg of link.querySelectorAll('svg')) expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('says one day and two days in words', async () => {
    const { unmount } = renderChip(progressWith(1, 1))
    expect(await screen.findByRole('link', { name: 'רצף של יום אחד, רמה 1' })).toBeInTheDocument()
    unmount()

    renderChip(progressWith(2, 4))
    expect(await screen.findByRole('link', { name: 'רצף של יומיים, רמה 4' })).toBeInTheDocument()
  })

  // The arc is counted out of 100 (pathLength), so its dash is the percentage.
  it('the ring fills with the way to the next level', async () => {
    renderChip(progressWith(3, 2, { total_xp: 1240, level_start_xp: 1000, next_level_xp: 2000 }))
    const link = await screen.findByRole('link', { name: he.shell.progressChip(3, 2) })
    expect(link.querySelector('[data-part="arc"]')).toHaveAttribute('stroke-dasharray', '24.0 100')
  })

  it('the ring is full at the top level, where there is no next level', async () => {
    renderChip(progressWith(3, 50, { next_level_xp: null, total_xp: 99000, level_start_xp: 90000 }))
    const link = await screen.findByRole('link', { name: he.shell.progressChip(3, 50) })
    expect(link.querySelector('[data-part="arc"]')).toHaveAttribute('stroke-dasharray', '100.0 100')
  })

  it('at the start of a level the ring has no arc', async () => {
    renderChip(progressWith(0, 1, { total_xp: 0, level_start_xp: 0, next_level_xp: 100 }))
    const link = await screen.findByRole('link', { name: he.shell.progressChip(0, 1) })
    expect(link.querySelector('[data-part="arc"]')).not.toBeInTheDocument()
  })

  it('while loading there is no link and no status', async () => {
    renderChip(() => new Promise(() => undefined))
    await settle()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('a failed GET /progress shows nothing: no link and no alert', async () => {
    renderChip(problem(503, 'database_unavailable'))
    await settle()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
