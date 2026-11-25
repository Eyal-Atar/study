import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { createElement } from 'react'
import { AppProviders } from '../app/AppProviders'
import { createFakeAuth } from '../test/fakeAuth'
import { createFakeStorage } from '../test/fakeStorage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { boardKey } from '../board/api'
import { renderBoard, USER_ID } from '../test/boardFixtures'
import { createFakeApi } from '../test/fakeApi'
import { closuresKey, CLOSURES_REFRESH_MS, useClosures } from './api'
import { makeClosureItem } from '../test/closureFixtures'
import { examState } from './types'

// A frozen clock, as in every closure test: 20:00 in Jerusalem on the evening of the exam.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-11-23T18:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

function Probe() {
  const q = useClosures()
  return createElement('p', null, q.data === undefined ? 'loading' : q.data.pending[0]?.exam_name)
}

describe('useClosures', () => {
  it('keys under the board and asks GET /closures', async () => {
    expect(closuresKey(USER_ID).slice(0, 2)).toEqual(boardKey(USER_ID))
    const data = { pending: [makeClosureItem()], waiting: [] }
    const fake = createFakeApi().on('GET /closures', data)
    const { queryClient } = renderBoard(createElement(Probe), {
      api: fake.api,
    })
    await waitFor(() => {
      expect(screen.getByText('הסתברות')).toBeInTheDocument()
    })
    const query = queryClient.getQueryCache().find({ queryKey: closuresKey(USER_ID), exact: true })
    expect(query?.state.data).toEqual(data)
    expect(query?.observers[0]?.options.refetchInterval).toBe(CLOSURES_REFRESH_MS)
    expect(CLOSURES_REFRESH_MS).toBe(300_000)
  })
})

describe('useClosures without a user', () => {
  it('sends nothing', () => {
    const fake = createFakeApi().on('GET /closures', {
      pending: [],
      waiting: [],
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <AppProviders auth={createFakeAuth(null).client} api={fake.api} storage={createFakeStorage().client} queryClient={queryClient}>
        <Probe />
      </AppProviders>,
    )
    // No wait on the real clock: the query is there, disabled, and has never fetched.
    expect(screen.getByText('loading')).toBeInTheDocument()
    const query = queryClient.getQueryCache().find({ queryKey: closuresKey(null), exact: true })
    expect(query?.state.fetchStatus).toBe('idle')
    expect(query?.state.dataUpdateCount).toBe(0)
    expect(fake.calls('GET', '/closures')).toHaveLength(0)
  })
})

describe('examState', () => {
  it('is active when the server did not say', () => {
    expect(examState({})).toBe('active')
    expect(examState({ state: 'pending' })).toBe('pending')
  })
})
