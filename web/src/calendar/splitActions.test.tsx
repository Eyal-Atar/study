import { useEffect, useState } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorMessage } from '../api/client'
import { useBlockActions } from '../board/actions'
import { todayKey } from '../board/api'
import { dayLabel } from '../board/time'
import { codeText } from '../i18n/codes'
import { en } from '../i18n/en'
import { makeBlock, makeMe, makePlan, makeToday, renderBoard, USER_ID } from '../test/boardFixtures'
import { createFakeApi, problem, type Reply } from '../test/fakeApi'
import { useSplitActions, type SplitActions } from './splitActions'
import { splitOffersKey, useSplitOffers, type SplitOffers, type SplitResult } from './splitOffers'
import { makeSplitOffer } from './testFixtures'

vi.mock('../board/offerReplan', () => ({ useOfferReplan: () => vi.fn() }))

const s = en.calendar.side.banner.split
const OFFER = makeSplitOffer()
const SPLIT_PATH = `/tasks/${OFFER.task_id}/split`
const DISMISS_PATH = `/tasks/${OFFER.task_id}/split/dismiss`

let actions: SplitActions
let blockPending: (id: string) => boolean
let unmountCaller: () => void

// The caller of split (the banner row in Task 4), which a test can take off the tree.
function Caller() {
  const current = useSplitActions()
  useEffect(() => {
    actions = current
  })
  return <p data-testid="splitting">{String(current.splitting(OFFER.task_id))}</p>
}

// The rest of the screen: the offers query (so an invalidation refetches it) and the block actions.
function Harness() {
  const [shown, setShown] = useState(true)
  const offers = useSplitOffers()
  const blocks = useBlockActions()
  useEffect(() => {
    blockPending = (id) => blocks.pending(id)
    unmountCaller = () => {
      setShown(false)
    }
  })
  return (
    <>
      <p data-testid="offers">{offers.data?.offers.map((o) => o.task_id).join(',') ?? ''}</p>
      <p data-testid="blockPending">{String(blocks.pending('b1'))}</p>
      {shown && <Caller />}
    </>
  )
}

// The first planned block is the second in the list: the toast names the earliest by time.
function result(overrides: Partial<SplitResult> = {}): SplitResult {
  return {
    task_id: OFFER.task_id,
    bite_minutes: 30,
    blocks: [
      makeBlock({ id: 'n2', starts_at: '2026-11-25T07:00:00Z', ends_at: '2026-11-25T07:30:00Z', study_date: '2026-11-25' }),
      makeBlock({ id: 'n1', starts_at: '2026-11-24T14:00:00Z', ends_at: '2026-11-24T14:30:00Z', study_date: '2026-11-24' }),
      makeBlock({ id: 'n3', starts_at: '2026-11-26T07:00:00Z', ends_at: '2026-11-26T07:30:00Z', study_date: '2026-11-26' }),
    ],
    version_id: 'v1',
    ...overrides,
  }
}

function setup({ split = result(), dismiss, offers = { offers: [OFFER] } }: { split?: Reply; dismiss?: Reply; offers?: SplitOffers } = {}) {
  const fake = createFakeApi()
    .on('GET /me', makeMe())
    .on('GET /today', makeToday([makeBlock({ id: 'b1' })]))
    .on({ method: 'GET', path: /^\/plan/ }, makePlan([makeBlock({ id: 'b1' })]))
    .on('GET /split-offers', offers)
    .on(`POST ${SPLIT_PATH}`, split)
    .on(`POST ${DISMISS_PATH}`, dismiss)
    .on('POST /plan/undo', {})
  const view = renderBoard(<Harness />, { api: fake.api })
  return { fake, ...view }
}

// A reply the test resolves when it wants.
function later<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })

// Today's study day in makeToday (seeded into the cache) is 2026-11-16; the first bite is 16:00 in Jerusalem on the 24th.
const DONE_3 = s.done(3, dayLabel('2026-11-24', '2026-11-16'), '16:00')

async function ready() {
  await waitFor(() => {
    expect(screen.getByTestId('offers')).toHaveTextContent(OFFER.task_id)
  })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useSplitActions split', () => {
  it('posts the basis, names the first bite with Undo, and takes the offer out of the cache', async () => {
    const { fake, queryClient } = setup()
    await ready()
    queryClient.setQueryData(todayKey(USER_ID), makeToday())
    // The refetch after the split never answers: only the hook's own write can take the offer out.
    fake.on('GET /split-offers', () => new Promise(() => undefined))
    act(() => {
      actions.split(OFFER)
    })
    expect(await screen.findByText(DONE_3)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.common.undo })).toBeInTheDocument()
    expect(fake.calls('POST', SPLIT_PATH).map((c) => c.body)).toEqual([{ basis: 'basis-1' }])
    expect(DONE_3).toBe('I split it into 3 bites. The first is Tue, 24 Nov at 16:00.')
    expect(queryClient.getQueryData<SplitOffers>(splitOffersKey(USER_ID))?.offers).toEqual([])
  })

  // S44 final review, M1: the answer holds the task's live blocks, also one that has started and
  // not ended; the split leaves it. The toast names the first part of the offer, not that block.
  it('names the first part even when the answer has an earlier planned block that is running', async () => {
    const running = makeBlock({ id: 'run', starts_at: '2026-11-24T09:00:00Z', ends_at: '2026-11-24T10:00:00Z', study_date: '2026-11-24' })
    const { queryClient } = setup({ split: result({ blocks: [running, ...result().blocks] }) })
    await ready()
    queryClient.setQueryData(todayKey(USER_ID), makeToday())
    act(() => {
      actions.split(OFFER)
    })
    expect(await screen.findByText(DONE_3)).toBeInTheDocument()
  })

  it('takes the study day of the first part from the offer when the answer has no block at its start', async () => {
    const { queryClient } = setup({ split: result({ blocks: [] }) })
    await ready()
    queryClient.setQueryData(todayKey(USER_ID), makeToday())
    act(() => {
      actions.split(OFFER)
    })
    expect(await screen.findByText(DONE_3)).toBeInTheDocument()
  })

  it('counts the parts of the offer: two parts say 2', async () => {
    const two = makeSplitOffer({ parts: OFFER.parts.slice(0, 2), split_minutes: 60 })
    const { queryClient } = setup({ offers: { offers: [two] } })
    await ready()
    queryClient.setQueryData(todayKey(USER_ID), makeToday())
    act(() => {
      actions.split(two)
    })
    expect(await screen.findByText(s.done(2, dayLabel('2026-11-24', '2026-11-16'), '16:00'))).toBeInTheDocument()
  })

  it('Undo posts /plan/undo once even when pressed twice, says so, and asks for the offers again', async () => {
    const { fake } = setup()
    await ready()
    act(() => {
      actions.split(OFFER)
    })
    const undo = await screen.findByRole('button', { name: en.common.undo })
    const before = fake.calls('GET', '/split-offers').length
    fake.on('POST /plan/undo', () => new Promise((r) => setTimeout(() => { r({}) }, 50)))
    const u = user()
    await u.dblClick(undo)
    expect(await screen.findByText(s.undone)).toBeInTheDocument()
    expect(fake.calls('POST', '/plan/undo').map((c) => c.body)).toEqual([{ version_id: 'v1' }])
    await waitFor(() => {
      expect(fake.calls('GET', '/split-offers').length).toBeGreaterThan(before)
    })
  })

  it('a failed Undo says why', async () => {
    const { fake } = setup()
    await ready()
    act(() => {
      actions.split(OFFER)
    })
    fake.on('POST /plan/undo', problem(409, 'invalid_state'))
    await user().click(await screen.findByRole('button', { name: en.common.undo }))
    expect(await screen.findByText(codeText('invalid_state'))).toBeInTheDocument()
  })

  it('the toast and its Undo work after the caller is gone', async () => {
    const reply = later<SplitResult>()
    const { fake } = setup({ split: () => reply.promise })
    await ready()
    act(() => {
      actions.split(OFFER)
    })
    await waitFor(() => {
      expect(fake.calls('POST', SPLIT_PATH)).toHaveLength(1)
    })
    act(() => {
      unmountCaller()
    })
    expect(screen.queryByTestId('splitting')).not.toBeInTheDocument()
    await act(async () => {
      reply.resolve(result())
      await Promise.resolve()
    })
    await user().click(await screen.findByRole('button', { name: en.common.undo }))
    expect(await screen.findByText(s.undone)).toBeInTheDocument()
    expect(fake.calls('POST', '/plan/undo')).toHaveLength(1)
  })

  it('stale_plan says Archi looked again and asks for the offers again', async () => {
    const { fake } = setup({ split: problem(409, 'stale_plan') })
    await ready()
    const before = fake.calls('GET', '/split-offers').length
    act(() => {
      actions.split(OFFER)
    })
    expect(await screen.findByText(s.stale)).toBeInTheDocument()
    await waitFor(() => {
      expect(fake.calls('GET', '/split-offers').length).toBeGreaterThan(before)
    })
    expect(screen.queryByRole('button', { name: en.common.undo })).not.toBeInTheDocument()
  })

  it('no_split_offer shows the code text and asks for the offers again', async () => {
    const { fake } = setup({ split: problem(409, 'no_split_offer') })
    await ready()
    const before = fake.calls('GET', '/split-offers').length
    act(() => {
      actions.split(OFFER)
    })
    expect(await screen.findByText(codeText('no_split_offer'))).toBeInTheDocument()
    await waitFor(() => {
      expect(fake.calls('GET', '/split-offers').length).toBeGreaterThan(before)
    })
  })

  it('any other error shows its message', async () => {
    setup({ split: problem(409, 'placement_failed') })
    await ready()
    act(() => {
      actions.split(OFFER)
    })
    expect(await screen.findByText(codeText('placement_failed'))).toBeInTheDocument()
  })

  it('two splits of one offer in a row send one POST', async () => {
    const reply = later<SplitResult>()
    const { fake } = setup({ split: () => reply.promise })
    await ready()
    act(() => {
      actions.split(OFFER)
      actions.split(OFFER)
    })
    act(() => {
      actions.split(OFFER)
    })
    await act(async () => {
      reply.resolve(result())
      await Promise.resolve()
    })
    expect(await screen.findByText(DONE_3)).toBeInTheDocument()
    expect(fake.calls('POST', SPLIT_PATH)).toHaveLength(1)
  })

  it('splitting(taskId) is true only while the POST waits, and the block actions are not confused by it', async () => {
    const reply = later<SplitResult>()
    setup({ split: () => reply.promise })
    await ready()
    expect(screen.getByTestId('splitting')).toHaveTextContent('false')
    act(() => {
      actions.split(OFFER)
    })
    await waitFor(() => {
      expect(screen.getByTestId('splitting')).toHaveTextContent('true')
    })
    expect(actions.splitting('task-other')).toBe(false)
    expect(blockPending('b1')).toBe(false)
    expect(screen.getByTestId('blockPending')).toHaveTextContent('false')
    await act(async () => {
      reply.resolve(result())
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getByTestId('splitting')).toHaveTextContent('false')
    })
  })
})

describe('useSplitActions dismiss', () => {
  it('takes the offer out before the server answers, then says so', async () => {
    const reply = later<undefined>()
    const { fake, queryClient } = setup({ dismiss: () => reply.promise })
    await ready()
    act(() => {
      actions.dismiss(OFFER)
    })
    await waitFor(() => {
      expect(screen.getByTestId('offers')).toHaveTextContent('')
    })
    expect(fake.calls('POST', DISMISS_PATH).map((c) => c.body)).toEqual([undefined])
    fake.on('GET /split-offers', { offers: [] })
    await act(async () => {
      reply.resolve(undefined)
      await Promise.resolve()
    })
    expect(await screen.findByText(s.dismissed)).toBeInTheDocument()
    await waitFor(() => {
      expect(queryClient.getQueryData<SplitOffers>(splitOffersKey(USER_ID))?.offers).toEqual([])
    })
  })

  it('a 500 puts the offer back with an error toast', async () => {
    const reply = later<Error>()
    const { fake } = setup({ dismiss: () => reply.promise })
    await ready()
    act(() => {
      actions.dismiss(OFFER)
    })
    await waitFor(() => {
      expect(screen.getByTestId('offers')).toHaveTextContent('')
    })
    // The refetch after the failure must not be what brings it back: it would answer the same.
    fake.on('GET /split-offers', () => new Promise(() => undefined))
    await act(async () => {
      reply.resolve(problem(500, 'internal'))
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getByTestId('offers')).toHaveTextContent(OFFER.task_id)
    })
    expect(await screen.findByText(errorMessage(problem(500, 'internal')))).toBeInTheDocument()
  })

  // S44 final review, M2: only the dismissed offer comes back, not the whole answer from before.
  it('a failed "Not now" puts back only its own offer, first', async () => {
    const other = makeSplitOffer({ task_id: 'task-2', basis: 'basis-2' })
    const reply = later<Error>()
    const { fake, queryClient } = setup({ dismiss: () => reply.promise, offers: { offers: [OFFER, other] } })
    await ready()
    act(() => {
      actions.dismiss(OFFER)
    })
    await waitFor(() => {
      expect(screen.getByTestId('offers')).toHaveTextContent('task-2')
    })
    fake.on('GET /split-offers', () => new Promise(() => undefined))
    // Meanwhile the other offer was split in another tab and left the cache.
    act(() => {
      queryClient.setQueryData<SplitOffers>(splitOffersKey(USER_ID), { offers: [] })
    })
    await act(async () => {
      reply.resolve(problem(500, 'internal'))
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(queryClient.getQueryData<SplitOffers>(splitOffersKey(USER_ID))?.offers.map((o) => o.task_id)).toEqual([OFFER.task_id])
    })
  })

  it('no_split_offer shows no toast', async () => {
    const { fake } = setup({ dismiss: problem(409, 'no_split_offer') })
    await ready()
    fake.on('GET /split-offers', { offers: [] })
    act(() => {
      actions.dismiss(OFFER)
    })
    await waitFor(() => {
      expect(fake.calls('POST', DISMISS_PATH)).toHaveLength(1)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(screen.queryByText(codeText('no_split_offer'))).not.toBeInTheDocument()
    expect(screen.queryByText(s.dismissed)).not.toBeInTheDocument()
    expect(screen.getByTestId('offers')).toHaveTextContent('')
  })
})
