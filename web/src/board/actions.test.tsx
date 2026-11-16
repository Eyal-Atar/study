import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { errorMessage } from '../api/client'
import { codeText, unscheduledText } from '../i18n/codes'
import { he } from '../i18n/he'
import { makeBlock, makeMe, makePlan, makeToday, renderBoard, USER_ID } from '../test/boardFixtures'
import { createFakeApi, problem } from '../test/fakeApi'
import { useBlockActions } from './actions'
import { planKey, todayKey, usePlan, useToday } from './api'
import { dateIn, dayLabel, useProfileTimezone } from './time'
import type { Block } from './types'

// A promise the test resolves or rejects when it wants.
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function show(block: Block | undefined) {
  return block === undefined ? 'none' : `${block.status}/${block.state}/${block.pinned ? 'pinned' : 'free'}`
}

// Reads "today", the default plan and one week range, and acts on the first block of today.
function Probe() {
  const today = useToday()
  const plan = usePlan()
  const week = usePlan('2026-11-15', '2026-11-21')
  const tz = useProfileTimezone()
  const actions = useBlockActions()
  const block = today.data?.blocks[0]
  return (
    <div>
      <p data-testid="tz">{tz}</p>
      <p data-testid="today">{show(block)}</p>
      <p data-testid="plan">{show(plan.data?.blocks[0])}</p>
      <p data-testid="week">{show(week.data?.blocks[0])}</p>
      <p data-testid="pending">{String(actions.pending('block-1'))}</p>
      {block === undefined ? null : (
        <>
          <button onClick={() => { actions.complete(block) }}>complete</button>
          <button onClick={() => { actions.uncomplete(block) }}>uncomplete</button>
          <button onClick={() => { actions.defer(block) }}>defer</button>
          <button onClick={() => { actions.setPinned(block, !block.pinned) }}>pin</button>
        </>
      )}
    </div>
  )
}

// A fake server with one block, whose GET answers follow `state.block`.
function setup({ block = makeBlock(), timezone = 'Asia/Jerusalem' }: { block?: Block; timezone?: string } = {}) {
  const state = { block, frozen: false }
  const never = new Promise<never>(() => undefined)
  const fake = createFakeApi()
    .on('GET /me', makeMe(timezone))
    .on('GET /today', () => (state.frozen ? never : makeToday([state.block])))
    .on({ method: 'GET', path: /^\/plan/ }, () => (state.frozen ? never : makePlan([state.block])))
  const rendered = renderBoard(<Probe />, { api: fake.api })
  return { fake, state, ...rendered }
}

async function ready(text = 'planned/upcoming/free') {
  await waitFor(() => {
    expect(screen.getByTestId('today')).toHaveTextContent(text)
    expect(screen.getByTestId('plan')).toHaveTextContent(text)
    expect(screen.getByTestId('week')).toHaveTextContent(text)
  })
}

// The region exists only while a toast shows.
async function toasts() {
  return within(await screen.findByRole('region', { name: he.common.notifications }))
}

describe('useBlockActions', () => {
  it('complete marks the block done at once in today and in every plan range, then refreshes the board', async () => {
    const user = userEvent.setup()
    const { fake, state } = setup()
    await ready()
    const answer = deferred<unknown>()
    fake.on('POST /blocks/block-1/complete', () => answer.promise)
    const todayCalls = fake.calls('GET', '/today').length
    const planCalls = fake.calls('GET', /^\/plan/).length

    await user.click(screen.getByRole('button', { name: 'complete' }))
    await ready('done/done/free')
    expect(screen.getByTestId('pending')).toHaveTextContent('true')
    expect(fake.calls('POST', '/blocks/block-1/complete')).toHaveLength(1)

    state.block = makeBlock({ status: 'done', state: 'done' })
    answer.resolve({ block: state.block, task_status: 'done' })
    expect(await (await toasts()).findByText(he.board.completed)).toBeInTheDocument()
    await waitFor(() => {
      expect(fake.calls('GET', '/today').length).toBeGreaterThan(todayCalls)
      expect(fake.calls('GET', /^\/plan/).length).toBeGreaterThan(planCalls)
    })
    expect(screen.getByTestId('pending')).toHaveTextContent('false')
  })

  it('the undo of complete sends uncomplete', async () => {
    const user = userEvent.setup()
    const { fake, state } = setup()
    await ready()
    fake.on('POST /blocks/block-1/complete', () => {
      state.block = makeBlock({ status: 'done', state: 'done' })
      return { block: state.block, task_status: 'done' }
    })
    fake.on('POST /blocks/block-1/uncomplete', () => {
      state.block = makeBlock()
      return { block: state.block, task_status: 'todo' }
    })

    await user.click(screen.getByRole('button', { name: 'complete' }))
    await user.click(await (await toasts()).findByRole('button', { name: he.common.undo }))
    expect(fake.calls('POST', '/blocks/block-1/uncomplete')).toHaveLength(1)
    await ready()
    expect(await (await toasts()).findByText(he.board.uncompleted)).toBeInTheDocument()
  })

  it('a failed complete puts the block back in both caches and says why', async () => {
    const user = userEvent.setup()
    const { fake, state, queryClient } = setup()
    await ready()
    // The refetch after the failure never answers, so what shows is the restored snapshot.
    state.frozen = true
    const failure = problem(0, 'network')
    fake.on('POST /blocks/block-1/complete', failure)

    await user.click(screen.getByRole('button', { name: 'complete' }))
    expect(await (await toasts()).findByText(errorMessage(failure))).toBeInTheDocument()
    await ready()
    expect(queryClient.getQueryData<{ blocks: Block[] }>(todayKey(USER_ID))?.blocks[0]?.status).toBe('planned')
    expect(queryClient.getQueryData<{ blocks: Block[] }>(planKey(USER_ID, '2026-11-15', '2026-11-21'))?.blocks[0]?.state).toBe('upcoming')
  })

  it('uncomplete marks the block planned again, and its undo sends complete', async () => {
    const user = userEvent.setup()
    const done = makeBlock({ status: 'done', state: 'done' })
    const { fake, state } = setup({ block: done })
    await ready('done/done/free')
    const answer = deferred<unknown>()
    fake.on('POST /blocks/block-1/uncomplete', () => answer.promise)
    fake.on('POST /blocks/block-1/complete', () => ({ block: done, task_status: 'done' }))

    await user.click(screen.getByRole('button', { name: 'uncomplete' }))
    // The block (12:00–13:00Z today) is upcoming, in progress or overdue by the clock; never done.
    await waitFor(() => {
      expect(screen.getByTestId('today')).toHaveTextContent(/^planned\/(upcoming|in_progress|overdue)\/free$/)
    })
    state.block = makeBlock()
    answer.resolve({ block: state.block, task_status: 'todo' })
    await user.click(await (await toasts()).findByRole('button', { name: he.common.undo }))
    expect(fake.calls('POST', '/blocks/block-1/complete')).toHaveLength(1)
  })

  it('defer is not optimistic, then says where the task went, and undo sends POST /plan/undo', async () => {
    const user = userEvent.setup()
    const { fake, state } = setup()
    await ready()
    await waitFor(() => {
      expect(screen.getByTestId('tz')).toHaveTextContent('Asia/Jerusalem')
    })
    const moved = makeBlock({ id: 'block-2', starts_at: '2026-11-17T07:00:00Z', ends_at: '2026-11-17T08:00:00Z', study_date: '2026-11-17' })
    const earlierDone = makeBlock({ id: 'block-0', starts_at: '2026-11-15T07:00:00Z', ends_at: '2026-11-15T08:00:00Z', status: 'done', state: 'done' })
    const answer = deferred<unknown>()
    fake.on('POST /blocks/block-1/defer', () => answer.promise)
    fake.on('POST /plan/undo', () => {
      state.block = makeBlock()
      return { restored: 1, deleted: 1, replaced: [], unplaced: [] }
    })

    await user.click(screen.getByRole('button', { name: 'defer' }))
    expect(screen.getByTestId('pending')).toHaveTextContent('true')
    expect(screen.getByTestId('today')).toHaveTextContent('planned/upcoming/free')

    state.block = moved
    answer.resolve({ blocks: [earlierDone, moved], version_id: 'v1' })
    const text = he.board.deferred(dayLabel('2026-11-17', dateIn('Asia/Jerusalem')), '09:00')
    expect(await (await toasts()).findByText(text)).toBeInTheDocument()

    await user.click((await toasts()).getByRole('button', { name: he.common.undo }))
    expect(fake.calls('POST', '/plan/undo')).toEqual([{ method: 'POST', path: '/plan/undo', body: { version_id: 'v1' } }])
    expect(await (await toasts()).findByText(he.board.deferUndone)).toBeInTheDocument()
  })

  it('the defer toast shows the time in the profile timezone', async () => {
    const user = userEvent.setup()
    const { fake } = setup({ timezone: 'America/New_York' })
    await ready()
    await waitFor(() => {
      expect(screen.getByTestId('tz')).toHaveTextContent('America/New_York')
    })
    const moved = makeBlock({ id: 'block-2', starts_at: '2026-11-17T15:00:00Z', ends_at: '2026-11-17T16:00:00Z', study_date: '2026-11-17' })
    fake.on('POST /blocks/block-1/defer', { blocks: [moved], version_id: null })

    await user.click(screen.getByRole('button', { name: 'defer' }))
    const text = he.board.deferred(dayLabel('2026-11-17', dateIn('America/New_York')), '10:00')
    expect(await (await toasts()).findByText(text)).toBeInTheDocument()
    // Without a version there is nothing to undo.
    expect((await toasts()).queryByRole('button', { name: he.common.undo })).not.toBeInTheDocument()
  })

  it('an undo that the server refuses shows its text and refreshes the board', async () => {
    const user = userEvent.setup()
    const { fake } = setup()
    await ready()
    const moved = makeBlock({ id: 'block-2', starts_at: '2026-11-17T07:00:00Z', ends_at: '2026-11-17T08:00:00Z', study_date: '2026-11-17' })
    fake.on('POST /blocks/block-1/defer', { blocks: [moved], version_id: 'v1' })
    fake.on('POST /plan/undo', problem(409, 'nothing_to_undo'))

    await user.click(screen.getByRole('button', { name: 'defer' }))
    const undo = await (await toasts()).findByRole('button', { name: he.common.undo })
    await waitFor(() => {
      expect(screen.getByTestId('pending')).toHaveTextContent('false')
    })
    const before = fake.calls('GET', '/today').length
    await user.click(undo)
    expect(await (await toasts()).findByText(codeText('nothing_to_undo'))).toBeInTheDocument()
    await waitFor(() => {
      expect(fake.calls('GET', '/today').length).toBeGreaterThan(before)
    })
  })

  it('a defer that finds no place says why, offers the report, and leaves the board as it was', async () => {
    const user = userEvent.setup()
    const { fake, router } = setup()
    await ready()
    fake.on('POST /blocks/block-1/defer', problem(409, 'placement_failed', { reason: 'not_enough_time', blocked_by: null }))

    await user.click(screen.getByRole('button', { name: 'defer' }))
    const text = `${codeText('placement_failed')} ${unscheduledText('not_enough_time')}`
    expect(await (await toasts()).findByText(text)).toBeInTheDocument()
    expect(screen.getByTestId('today')).toHaveTextContent('planned/upcoming/free')
    expect(screen.getByTestId('week')).toHaveTextContent('planned/upcoming/free')

    await user.click((await toasts()).getByRole('button', { name: he.board.toReport }))
    expect(router.state.location.pathname).toBe('/today')
    expect(router.state.location.hash).toBe('#report')
  })

  it('pin sets pinned at once, and undo unpins', async () => {
    const user = userEvent.setup()
    const { fake, state } = setup()
    await ready()
    fake.on('PATCH /blocks/block-1', (call: { body: unknown }) => {
      const { pinned } = call.body as { pinned: boolean }
      state.block = makeBlock({ pinned })
      return state.block
    })

    await user.click(screen.getByRole('button', { name: 'pin' }))
    await ready('planned/upcoming/pinned')
    await user.click(await (await toasts()).findByRole('button', { name: he.common.undo }))
    expect(fake.calls('PATCH', '/blocks/block-1').map((c) => c.body)).toEqual([{ pinned: true }, { pinned: false }])
    await ready()
    expect(await (await toasts()).findByText(he.board.unpinnedDone)).toBeInTheDocument()
  })

  it('a failed pin puts pinned back', async () => {
    const user = userEvent.setup()
    const { fake, state } = setup()
    await ready()
    state.frozen = true
    fake.on('PATCH /blocks/block-1', problem(409, 'invalid_state'))

    await user.click(screen.getByRole('button', { name: 'pin' }))
    expect(await (await toasts()).findByText(codeText('invalid_state'))).toBeInTheDocument()
    await ready()
  })
})
