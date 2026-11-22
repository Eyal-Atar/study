import { useEffect } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BusyEventWriteResponse } from '../availability/types'
import { en } from '../i18n/en'
import { makeBlock, makeMe, makePlan, makeToday, renderBoard } from '../test/boardFixtures'
import { createFakeApi, problem } from '../test/fakeApi'
import { UNDO_TIMEOUT_MS } from '../ui/useToast'
import { useBusyWrite } from './busyActions'
import { makeBusy } from './testFixtures'

const offer = vi.fn()
vi.mock('../board/offerReplan', () => ({ useOfferReplan: () => offer }))

type Write = ReturnType<typeof useBusyWrite>
let write: Write

function Harness() {
  const current = useBusyWrite()
  useEffect(() => {
    write = current
  })
  const shown = current
  return <p data-testid="hidden">{[...shown.hidden].join(',')}</p>
}

const INPUT = { title: null, starts_at: '2026-11-16T10:00:00Z', ends_at: '2026-11-16T11:00:00Z' }
const OPTIONS = { onSuccess: vi.fn(), onError: vi.fn(() => false) }

function answer(overrides: Partial<BusyEventWriteResponse> = {}): BusyEventWriteResponse {
  return {
    event: { id: 'e1', title: null, starts_at: INPUT.starts_at, ends_at: INPUT.ends_at, created_at: INPUT.starts_at },
    blocks: [],
    unplaced: [],
    version_id: 'v1',
    ...overrides,
  }
}

function setup(reply: unknown) {
  const fake = createFakeApi()
    .on('GET /me', makeMe())
    .on('GET /today', makeToday([makeBlock()]))
    .on({ method: 'GET', path: /^\/plan/ }, makePlan([makeBlock()]))
    .on('POST /busy-events', reply)
    .on('POST /plan/undo', {})
    .on({ method: 'DELETE', path: /^\/busy-events\// }, undefined)
  renderBoard(<Harness />, { api: fake.api })
  return fake
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  offer.mockClear()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useBusyWrite create', () => {
  it('names the moved blocks by distinct task and undoes with POST /plan/undo', async () => {
    const fake = setup(
      answer({ blocks: [makeBlock({ id: 'a', task_id: 't1' }), makeBlock({ id: 'b', task_id: 't1' })] }),
    )
    await screen.findByTestId('hidden')
    act(() => {
      write.create(INPUT, OPTIONS)
    })
    expect(await screen.findByText(en.calendar.sheets.busy.savedMoved(1))).toBeInTheDocument()
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) }).click(
      screen.getByRole('button', { name: en.common.undo }),
    )
    await waitFor(() => {
      expect(fake.calls('POST', '/plan/undo')[0]?.body).toEqual({ version_id: 'v1' })
    })
    expect(await screen.findByText(en.calendar.sheets.busy.undone)).toBeInTheDocument()
  })

  it('says what did not fit and offers a replan', async () => {
    setup(answer({ unplaced: [{ task_id: 't9', minutes: 30, reason: 'no_room' }] }))
    await screen.findByTestId('hidden')
    act(() => {
      write.create(INPUT, OPTIONS)
    })
    expect(await screen.findByText(en.calendar.sheets.busy.savedUnplaced(1))).toBeInTheDocument()
    expect(offer).toHaveBeenCalled()
  })

  it('has no Undo without a version', async () => {
    setup(answer({ version_id: null }))
    await screen.findByTestId('hidden')
    act(() => {
      write.create(INPUT, OPTIONS)
    })
    expect(await screen.findByText(en.calendar.sheets.busy.saved)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.common.undo })).not.toBeInTheDocument()
  })
})

describe('useBusyWrite remove', () => {
  const item = makeBusy({ source: 'event', id: 'ev-1', kind: null, title: 'Dentist' })

  it('hides at once, sends nothing, and deletes when the toast expires', async () => {
    const fake = setup(answer())
    await screen.findByTestId('hidden')
    act(() => {
      write.remove(item)
    })
    expect(screen.getByTestId('hidden')).toHaveTextContent('ev-1')
    expect(await screen.findByText(en.calendar.sheets.busy.deleted)).toBeInTheDocument()
    expect(fake.calls('DELETE')).toHaveLength(0)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_TIMEOUT_MS + 500)
    })
    await waitFor(() => {
      expect(fake.calls('DELETE', '/busy-events/ev-1')).toHaveLength(1)
    })
    await waitFor(() => {
      expect(screen.getByTestId('hidden')).toHaveTextContent('')
    })
  })

  it('Undo brings it back and sends nothing', async () => {
    const fake = setup(answer())
    await screen.findByTestId('hidden')
    act(() => {
      write.remove(item)
    })
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })
      .click(await screen.findByRole('button', { name: en.common.undo }))
    await waitFor(() => {
      expect(screen.getByTestId('hidden')).toHaveTextContent('')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_TIMEOUT_MS + 500)
    })
    expect(fake.calls('DELETE')).toHaveLength(0)
  })

  it('a failed DELETE shows an error and brings it back', async () => {
    const fake = setup(answer())
    fake.on({ method: 'DELETE', path: /^\/busy-events\// }, problem(500, 'server_error'))
    await screen.findByTestId('hidden')
    act(() => {
      write.remove(item)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_TIMEOUT_MS + 500)
    })
    await waitFor(() => {
      expect(screen.getByTestId('hidden')).toHaveTextContent('')
    })
    expect(await screen.findByText(en.errors.generic)).toBeInTheDocument()
  })
})
