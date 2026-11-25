import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useEffect, useState } from 'react'
import type { UNSTABLE_ToastQueue as ToastQueue } from 'react-aria-components'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, errorMessage } from '../api/client'
import type { DeferRequest } from '../availability/types'
import { onCompleted } from './xpEvents'
import { codeText, unscheduledText } from '../i18n/codes'
import { en } from '../i18n/en'
import { makeBlock, makeMe, makePlan, makeToday, renderBoard, USER_ID } from '../test/boardFixtures'
import { createFakeApi, problem } from '../test/fakeApi'
import { progressKey } from '../progress/api'
import type { Progress } from '../progress/types'
import { useToastContext, type Content } from '../ui/useToast'
import { useBlockActions } from './actions'
import { planKey, todayKey, usePlan, useToday } from './api'
import { blockName } from './blockName'
import { dayLabel, useProfileTimezone } from './time'
import type { Block, Today } from './types'

// A promise the test resolves or rejects when it wants.
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
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
function setup({
  block = makeBlock(),
  timezone = 'Asia/Jerusalem',
  todayDate = '2026-11-16',
  others = [],
}: { block?: Block; timezone?: string; todayDate?: string; others?: Block[] } = {}) {
  const state = { block, frozen: false, others }
  const never = new Promise<never>(() => undefined)
  const fake = createFakeApi()
    .on('GET /me', makeMe(timezone))
    .on('GET /today', () => (state.frozen ? never : makeToday([state.block, ...state.others], { date: todayDate })))
    .on({ method: 'GET', path: /^\/plan/ }, () => (state.frozen ? never : makePlan([state.block, ...state.others])))
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
  return within(await screen.findByRole('region', { name: en.common.notifications }))
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
    answer.resolve({
      block: state.block,
      task_status: 'done',
      progress: { xp_change: 15, total_xp: 115, level: 2, level_up: true, badges_earned: [], badges_lost: [] },
    })
    // S19's progress in the toast: the XP and the new level.
    expect(
      await (await toasts()).findByText(`${en.board.completed}. ${en.board.xpGained(15)}. ${en.board.levelUp(2)}`),
    ).toBeInTheDocument()
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
    await user.click(await (await toasts()).findByRole('button', { name: en.common.undo }))
    expect(fake.calls('POST', '/blocks/block-1/uncomplete')).toHaveLength(1)
    await ready()
    expect(await (await toasts()).findByText(en.board.uncompleted)).toBeInTheDocument()
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

  it("complete moves today's minutes from planned to done at once, and a failure moves them back", async () => {
    const user = userEvent.setup()
    const { fake, state, queryClient } = setup()
    await ready()
    const minutes = () => {
      const today = queryClient.getQueryData<Today>(todayKey(USER_ID))
      return [today?.planned_minutes, today?.done_minutes]
    }
    expect(minutes()).toEqual([60, 0])
    const answer = deferred<unknown>()
    fake.on('POST /blocks/block-1/complete', () => answer.promise)

    await user.click(screen.getByRole('button', { name: 'complete' }))
    await ready('done/done/free')
    expect(minutes()).toEqual([0, 60])

    state.frozen = true
    answer.reject(problem(0, 'network'))
    await ready()
    expect(minutes()).toEqual([60, 0])
  })

  it('a pin does not touch the minutes of today', async () => {
    const user = userEvent.setup()
    const { fake, state, queryClient } = setup()
    await ready()
    state.frozen = true
    fake.on('PATCH /blocks/block-1', () => new Promise<never>(() => undefined))

    await user.click(screen.getByRole('button', { name: 'pin' }))
    await ready('planned/upcoming/pinned')
    const today = queryClient.getQueryData<Today>(todayKey(USER_ID))
    expect([today?.planned_minutes, today?.done_minutes]).toEqual([60, 0])
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
    await user.click(await (await toasts()).findByRole('button', { name: en.common.undo }))
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
    const text = en.board.deferred(dayLabel('2026-11-17', '2026-11-16'), '09:00')
    expect(await (await toasts()).findByText(text)).toBeInTheDocument()

    await user.click((await toasts()).getByRole('button', { name: en.common.undo }))
    expect(fake.calls('POST', '/plan/undo')).toEqual([{ method: 'POST', path: '/plan/undo', body: { version_id: 'v1' } }])
    expect(await (await toasts()).findByText(en.board.deferUndone)).toBeInTheDocument()
  })

  it('the defer toast names the new block, not a later part of the task that stayed in place', async () => {
    const user = userEvent.setup()
    // Part 1 now, part 2 later today; place_task keeps part 2 and writes part 1's minutes tomorrow.
    const part1 = makeBlock({ part_index: 1, part_count: 2 })
    const part2 = makeBlock({ id: 'block-3', part_index: 2, part_count: 2, starts_at: '2026-11-16T15:00:00Z', ends_at: '2026-11-16T16:00:00Z' })
    const { fake } = setup({ block: part1, others: [part2] })
    await ready()
    await waitFor(() => {
      expect(screen.getByTestId('tz')).toHaveTextContent('Asia/Jerusalem')
    })
    const moved = makeBlock({ id: 'block-4', part_index: 2, part_count: 2, starts_at: '2026-11-17T14:00:00Z', ends_at: '2026-11-17T15:00:00Z', study_date: '2026-11-17' })
    fake.on('POST /blocks/block-1/defer', { blocks: [{ ...part2, part_index: 1 }, moved], version_id: 'v1' })

    await user.click(screen.getByRole('button', { name: 'defer' }))
    expect(await (await toasts()).findByText(en.board.deferred(en.board.tomorrow, '16:00'))).toBeInTheDocument()
  })

  it('the defer toast counts days from the server study day, not the calendar day', async () => {
    const user = userEvent.setup()
    // At 00:30 before sleep the study day is still the 15th: a block later tonight is "today".
    const { fake } = setup({ todayDate: '2026-11-15' })
    await ready()
    await waitFor(() => {
      expect(screen.getByTestId('tz')).toHaveTextContent('Asia/Jerusalem')
    })
    const moved = makeBlock({ id: 'block-2', starts_at: '2026-11-15T23:30:00Z', ends_at: '2026-11-16T00:00:00Z', study_date: '2026-11-15' })
    fake.on('POST /blocks/block-1/defer', { blocks: [moved], version_id: 'v1' })

    await user.click(screen.getByRole('button', { name: 'defer' }))
    expect(await (await toasts()).findByText(en.board.deferred(en.board.today, '01:30'))).toBeInTheDocument()
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
    const text = en.board.deferred(dayLabel('2026-11-17', '2026-11-16'), '10:00')
    expect(await (await toasts()).findByText(text)).toBeInTheDocument()
    // Without a version there is nothing to undo.
    expect((await toasts()).queryByRole('button', { name: en.common.undo })).not.toBeInTheDocument()
  })

  it('pressing the undo of a defer twice sends one POST /plan/undo', async () => {
    const user = userEvent.setup()
    const { fake } = setup()
    await ready()
    const moved = makeBlock({ id: 'block-2', starts_at: '2026-11-17T07:00:00Z', ends_at: '2026-11-17T08:00:00Z', study_date: '2026-11-17' })
    fake.on('POST /blocks/block-1/defer', { blocks: [moved], version_id: 'v1' })
    fake.on('POST /plan/undo', () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve({ restored: 1, deleted: 1, replaced: [], unplaced: [] })
        }, 0)
      }),
    )

    await user.click(screen.getByRole('button', { name: 'defer' }))
    const undo = await (await toasts()).findByRole('button', { name: en.common.undo })
    act(() => {
      fireEvent.click(undo)
      fireEvent.click(undo)
    })
    expect(await (await toasts()).findByText(en.board.deferUndone)).toBeInTheDocument()
    expect(fake.calls('POST', '/plan/undo')).toHaveLength(1)
    expect(screen.queryByText(errorMessage(problem(409, 'nothing_to_undo')))).not.toBeInTheDocument()
  })

  it('an undo that the server refuses shows its text and refreshes the board', async () => {
    const user = userEvent.setup()
    const { fake } = setup()
    await ready()
    const moved = makeBlock({ id: 'block-2', starts_at: '2026-11-17T07:00:00Z', ends_at: '2026-11-17T08:00:00Z', study_date: '2026-11-17' })
    fake.on('POST /blocks/block-1/defer', { blocks: [moved], version_id: 'v1' })
    fake.on('POST /plan/undo', problem(409, 'nothing_to_undo'))

    await user.click(screen.getByRole('button', { name: 'defer' }))
    const undo = await (await toasts()).findByRole('button', { name: en.common.undo })
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

  it('a defer that finds no place offers a replan with the reason, and leaves the board as it was', async () => {
    const user = userEvent.setup()
    const { fake } = setup()
    await ready()
    fake.on('POST /blocks/block-1/defer', problem(409, 'placement_failed', { reason: 'not_enough_time', blocked_by: null }))

    await user.click(screen.getByRole('button', { name: 'defer' }))
    const text = `${codeText('placement_failed')} ${unscheduledText('not_enough_time')}`
    // S13's ReplanOffer: a dialog with the reason, which runs the preview itself.
    const dialog = within(await screen.findByRole('dialog', { name: en.replan.title }))
    expect(dialog.getByText(text)).toBeInTheDocument()
    expect(screen.getByTestId('today')).toHaveTextContent('planned/upcoming/free')
    expect(screen.getByTestId('week')).toHaveTextContent('planned/upcoming/free')
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
    await user.click(await (await toasts()).findByRole('button', { name: en.common.undo }))
    expect(fake.calls('PATCH', '/blocks/block-1').map((c) => c.body)).toEqual([{ pinned: true }, { pinned: false }])
    await ready()
    expect(await (await toasts()).findByText(en.board.unpinnedDone)).toBeInTheDocument()
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

// S32: defer with a choice, skip, and the XP of a complete.
//
// A probe that can be hidden: the toast region stays, so a test can press a toast's undo after the
// component that started the action is gone (Review Focus 4).
interface CallProbeProps {
  request?: DeferRequest
  onSuccess?: () => void
  onError?: (error: ApiError) => boolean
}

// The toast queue of the rendered app, so a callback can see what shows at the moment it runs.
let toastQueue: ToastQueue<Content> | null = null

function CallProbe({ request, onSuccess, onError }: CallProbeProps) {
  const today = useToday()
  const actions = useBlockActions()
  const { queue } = useToastContext()
  useEffect(() => {
    toastQueue = queue
  }, [queue])
  const block = today.data?.blocks[0]
  if (block === undefined) return <p data-testid="loading">loading</p>
  return (
    <div>
      <p data-testid="skipping">{String(actions.skipping(block.id))}</p>
      <p data-testid="pending">{String(actions.pending(block.id))}</p>
      <button
        onClick={() => {
          actions.defer(block, request, onSuccess === undefined && onError === undefined ? undefined : { onSuccess, onError })
        }}
      >
        defer
      </button>
      <button onClick={() => { actions.skip(block) }}>skip</button>
      <button onClick={() => { actions.complete(block) }}>complete</button>
      <button onClick={() => { actions.uncomplete(block) }}>uncomplete</button>
    </div>
  )
}

function Hideable(props: CallProbeProps) {
  const [shown, setShown] = useState(true)
  return (
    <>
      <button onClick={() => { setShown(false) }}>hide</button>
      {shown ? <CallProbe {...props} /> : null}
    </>
  )
}

function setupCalls(props: CallProbeProps & { block?: Block } = {}) {
  const { block = makeBlock(), ...probe } = props
  const fake = createFakeApi()
    .on('GET /me', makeMe())
    .on('GET /today', () => makeToday([block]))
    .on({ method: 'GET', path: /^\/plan/ }, () => makePlan([block]))
  const rendered = renderBoard(<Hideable {...probe} />, { api: fake.api })
  return { fake, ...rendered }
}

async function loaded() {
  await screen.findByRole('button', { name: 'defer' })
}

const MOVED = makeBlock({ id: 'block-2', starts_at: '2026-11-17T07:00:00Z', ends_at: '2026-11-17T08:00:00Z', study_date: '2026-11-17' })
const UNDONE = { restored: 1, deleted: 1, replaced: [], unplaced: [] }
// A block that ends in the future (upcoming) and one that already ended.
const UPCOMING = makeBlock({ starts_at: '2099-01-01T10:00:00Z', ends_at: '2099-01-01T11:00:00Z', study_date: '2099-01-01' })
const ENDED = makeBlock({ starts_at: '2020-01-01T10:00:00Z', ends_at: '2020-01-01T11:00:00Z', study_date: '2020-01-01', state: 'overdue' })

function progressOf(totalXp: number, level: number): Progress {
  return {
    total_xp: totalXp,
    level,
    level_start_xp: 1000,
    next_level_xp: 1500,
    max_level: 10,
    blocks_done: 30,
    streak: { current: 3, longest: 5, studied_today: true, today: '2026-11-16' },
    days: [],
    badges: [],
    archive: [],
  }
}

describe('useBlockActions: defer with a choice', () => {
  it('sends the request as the body, says where the task went, and undo sends POST /plan/undo', async () => {
    const user = userEvent.setup()
    const { fake } = setupCalls({ request: { to: 'tomorrow' } })
    await loaded()
    fake.on('POST /blocks/block-1/defer', { blocks: [MOVED], version_id: 'v1' })
    fake.on('POST /plan/undo', UNDONE)

    await user.click(screen.getByRole('button', { name: 'defer' }))
    expect(await (await toasts()).findByText(en.board.deferred(dayLabel('2026-11-17', '2026-11-16'), '09:00'))).toBeInTheDocument()
    expect(fake.calls('POST', '/blocks/block-1/defer').map((c) => c.body)).toEqual([{ to: 'tomorrow' }])

    await user.click((await toasts()).getByRole('button', { name: en.common.undo }))
    expect(fake.calls('POST', '/plan/undo').map((c) => c.body)).toEqual([{ version_id: 'v1' }])
    expect(await (await toasts()).findByText(en.board.deferUndone)).toBeInTheDocument()
  })

  it('without a request it sends no body', async () => {
    const user = userEvent.setup()
    const { fake } = setupCalls()
    await loaded()
    fake.on('POST /blocks/block-1/defer', { blocks: [MOVED], version_id: null })

    await user.click(screen.getByRole('button', { name: 'defer' }))
    await (await toasts()).findByText(en.board.deferred(dayLabel('2026-11-17', '2026-11-16'), '09:00'))
    expect(fake.calls('POST', '/blocks/block-1/defer').map((c) => c.body)).toEqual([undefined])
  })

  it('calls onSuccess after the toast', async () => {
    const user = userEvent.setup()
    let toastShown: boolean | null = null
    const onSuccess = vi.fn(() => {
      toastShown = toastQueue?.visibleToasts.some((t) => t.content.options.text === en.board.deferredSomewhere) ?? null
    })
    const { fake } = setupCalls({ request: { to: 'next' }, onSuccess })
    await loaded()
    fake.on('POST /blocks/block-1/defer', { blocks: [], version_id: null })

    await user.click(screen.getByRole('button', { name: 'defer' }))
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledOnce()
    })
    expect(toastShown).toBe(true)
  })

  it('an error that onError takes (returns true) shows no toast', async () => {
    const user = userEvent.setup()
    const onError = vi.fn((error: ApiError) => error.code === 'slot_busy')
    const { fake } = setupCalls({ request: { to: 'at', starts_at: '2026-11-17T07:00:00Z' }, onError })
    await loaded()
    fake.on('POST /blocks/block-1/defer', problem(409, 'slot_busy'))

    await user.click(screen.getByRole('button', { name: 'defer' }))
    await waitFor(() => {
      expect(onError).toHaveBeenCalledOnce()
    })
    expect(onError.mock.calls[0]?.[0].code).toBe('slot_busy')
    await waitFor(() => {
      expect(screen.getByTestId('pending')).toHaveTextContent('false')
    })
    expect(screen.queryByRole('region', { name: en.common.notifications })).not.toBeInTheDocument()
  })

  it('an error that onError leaves (returns false) shows the toast as before', async () => {
    const user = userEvent.setup()
    const onError = vi.fn(() => false)
    const { fake } = setupCalls({ request: { to: 'at', starts_at: '2026-11-17T07:00:00Z' }, onError })
    await loaded()
    const failure = problem(409, 'slot_busy')
    fake.on('POST /blocks/block-1/defer', failure)

    await user.click(screen.getByRole('button', { name: 'defer' }))
    expect(await (await toasts()).findByText(errorMessage(failure))).toBeInTheDocument()
    expect(onError).toHaveBeenCalledOnce()
  })

  it('placement_failed offers a replan and then calls onError', async () => {
    const user = userEvent.setup()
    const onError = vi.fn<(error: ApiError) => boolean>(() => true)
    const { fake } = setupCalls({ request: { to: 'tomorrow' }, onError })
    await loaded()
    fake.on('POST /blocks/block-1/defer', problem(409, 'placement_failed', { reason: 'not_enough_time', blocked_by: null }))

    await user.click(screen.getByRole('button', { name: 'defer' }))
    const dialog = within(await screen.findByRole('dialog', { name: en.replan.title }))
    expect(dialog.getByText(`${codeText('placement_failed')} ${unscheduledText('not_enough_time')}`)).toBeInTheDocument()
    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ code: 'placement_failed' })
  })

  it('the undo of a defer still works after the component that deferred is gone', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    const { fake } = setupCalls({ request: { to: 'tomorrow' }, onSuccess })
    await loaded()
    const answer = deferred<unknown>()
    fake.on('POST /blocks/block-1/defer', () => answer.promise)
    fake.on('POST /plan/undo', UNDONE)

    await user.click(screen.getByRole('button', { name: 'defer' }))
    // The user moves to another day before the answer comes.
    await user.click(screen.getByRole('button', { name: 'hide' }))
    expect(screen.queryByRole('button', { name: 'defer' })).not.toBeInTheDocument()
    answer.resolve({ blocks: [MOVED], version_id: 'v1' })

    await user.click(await (await toasts()).findByRole('button', { name: en.common.undo }))
    expect(fake.calls('POST', '/plan/undo').map((c) => c.body)).toEqual([{ version_id: 'v1' }])
    expect(await (await toasts()).findByText(en.board.deferUndone)).toBeInTheDocument()
    expect(onSuccess).toHaveBeenCalledOnce()
  })
})

describe('useBlockActions: skip', () => {
  it('an upcoming block skips its task with PATCH /tasks/{id}, and undo sends POST /plan/undo', async () => {
    const user = userEvent.setup()
    const { fake } = setupCalls({ block: UPCOMING })
    await loaded()
    const answer = deferred<unknown>()
    fake.on('PATCH /tasks/task-1', () => answer.promise)
    fake.on('POST /plan/undo', UNDONE)

    await user.click(screen.getByRole('button', { name: 'skip' }))
    expect(screen.getByTestId('skipping')).toHaveTextContent('true')
    expect(screen.getByTestId('pending')).toHaveTextContent('true')
    expect(fake.calls('PATCH', '/tasks/task-1').map((c) => c.body)).toEqual([{ status: 'skipped' }])
    expect(fake.calls('POST', /\/skip$/)).toHaveLength(0)

    answer.resolve({ task: {}, placement: null, version_id: 'v2' })
    expect(await (await toasts()).findByText(en.calendar.sheets.defer.skipped(blockName(UPCOMING)))).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('skipping')).toHaveTextContent('false')
    })

    await user.click((await toasts()).getByRole('button', { name: en.common.undo }))
    expect(fake.calls('POST', '/plan/undo').map((c) => c.body)).toEqual([{ version_id: 'v2' }])
    expect(await (await toasts()).findByText(en.review.skipUndone)).toBeInTheDocument()
  })

  it('a block that ended is skipped with POST /blocks/{id}/skip', async () => {
    const user = userEvent.setup()
    const { fake } = setupCalls({ block: ENDED })
    await loaded()
    fake.on('POST /blocks/block-1/skip', { task_status: 'skipped', version_id: 'v3' })

    await user.click(screen.getByRole('button', { name: 'skip' }))
    expect(await (await toasts()).findByText(en.calendar.sheets.defer.skipped(blockName(ENDED)))).toBeInTheDocument()
    expect(fake.calls('POST', '/blocks/block-1/skip')).toHaveLength(1)
    expect(fake.calls('PATCH', /^\/tasks/)).toHaveLength(0)
  })

  it('names a split block with its part', async () => {
    const user = userEvent.setup()
    const split = { ...UPCOMING, part_index: 2, part_count: 3 }
    const { fake } = setupCalls({ block: split })
    await loaded()
    fake.on('PATCH /tasks/task-1', { task: {}, placement: null, version_id: null })

    await user.click(screen.getByRole('button', { name: 'skip' }))
    expect(await (await toasts()).findByText(en.calendar.sheets.defer.skipped(blockName(split)))).toBeInTheDocument()
  })

  it('without a version there is no undo', async () => {
    const user = userEvent.setup()
    const { fake } = setupCalls({ block: UPCOMING })
    await loaded()
    fake.on('PATCH /tasks/task-1', { task: {}, placement: null, version_id: null })

    await user.click(screen.getByRole('button', { name: 'skip' }))
    await (await toasts()).findByText(en.calendar.sheets.defer.skipped(blockName(UPCOMING)))
    expect((await toasts()).queryByRole('button', { name: en.common.undo })).not.toBeInTheDocument()
  })

  it('a failed skip says why and refreshes the board', async () => {
    const user = userEvent.setup()
    const { fake } = setupCalls({ block: UPCOMING })
    await loaded()
    const failure = problem(409, 'invalid_state')
    fake.on('PATCH /tasks/task-1', failure)
    const before = fake.calls('GET', '/today').length

    await user.click(screen.getByRole('button', { name: 'skip' }))
    expect(await (await toasts()).findByText(errorMessage(failure))).toBeInTheDocument()
    await waitFor(() => {
      expect(fake.calls('GET', '/today').length).toBeGreaterThan(before)
    })
  })
})

describe('useBlockActions: the XP of a complete', () => {
  const change = { xp_change: 20, total_xp: 1240, level: 4, level_up: false, badges_earned: [], badges_lost: [] }

  it('writes the new total and level into the progress cache and tells the listeners once', async () => {
    const user = userEvent.setup()
    const { fake, queryClient } = setupCalls()
    await loaded()
    queryClient.setQueryData(progressKey(USER_ID), progressOf(1220, 3))
    const listener = vi.fn()
    const off = onCompleted(listener)
    // Nothing answers the progress refetch, so what the cache holds is what complete wrote.
    fake.on('GET /progress', () => new Promise<never>(() => undefined))
    fake.on('POST /blocks/block-1/complete', {
      block: makeBlock({ status: 'done', state: 'done' }),
      task_status: 'done',
      progress: change,
    })

    await user.click(screen.getByRole('button', { name: 'complete' }))
    await (await toasts()).findByText(`${en.board.completed}. ${en.board.xpGained(20)}`)
    expect(queryClient.getQueryData(progressKey(USER_ID))).toEqual({ ...progressOf(1220, 3), total_xp: 1240, level: 4 })
    expect(listener).toHaveBeenCalledExactlyOnceWith({ blockId: 'block-1', xp: 20, level: 4, levelUp: false, badgesEarned: [] })
    off()
  })

  it('no XP gained, no event', async () => {
    const user = userEvent.setup()
    const { fake } = setupCalls()
    await loaded()
    const listener = vi.fn()
    const off = onCompleted(listener)
    fake.on('POST /blocks/block-1/complete', {
      block: makeBlock({ status: 'done', state: 'done' }),
      task_status: 'done',
      progress: { ...change, xp_change: 0 },
    })

    await user.click(screen.getByRole('button', { name: 'complete' }))
    await (await toasts()).findByText(en.board.completed)
    expect(listener).not.toHaveBeenCalled()
    off()
  })

  // Decision 2: a level or a badge is a moment of its own, also with no XP (a split block's part).
  it('a Done that rises a level and earns a badge carries them in the event', async () => {
    const user = userEvent.setup()
    const { fake } = setupCalls()
    await loaded()
    const listener = vi.fn()
    const off = onCompleted(listener)
    fake.on('POST /blocks/block-1/complete', {
      block: makeBlock({ status: 'done', state: 'done' }),
      task_status: 'done',
      progress: { ...change, level: 5, level_up: true, badges_earned: ['first_task'] },
    })

    await user.click(screen.getByRole('button', { name: 'complete' }))
    await waitFor(() => {
      expect(listener).toHaveBeenCalledExactlyOnceWith({ blockId: 'block-1', xp: 20, level: 5, levelUp: true, badgesEarned: ['first_task'] })
    })
    off()
  })

  it('a Done with no XP that earns a badge still tells the listeners', async () => {
    const user = userEvent.setup()
    const { fake } = setupCalls()
    await loaded()
    const listener = vi.fn()
    const off = onCompleted(listener)
    fake.on('POST /blocks/block-1/complete', {
      block: makeBlock({ status: 'done', state: 'done' }),
      task_status: 'done',
      progress: { ...change, xp_change: 0, badges_earned: ['task_master_10'] },
    })

    await user.click(screen.getByRole('button', { name: 'complete' }))
    await waitFor(() => {
      expect(listener).toHaveBeenCalledExactlyOnceWith({ blockId: 'block-1', xp: 0, level: 4, levelUp: false, badgesEarned: ['task_master_10'] })
    })
    off()
  })

  it('the complete that undoes "Not done" tells no listener, even with a level and a badge', async () => {
    const user = userEvent.setup()
    const done = makeBlock({ status: 'done', state: 'done' })
    const { fake } = setupCalls({ block: done })
    await loaded()
    const listener = vi.fn()
    const off = onCompleted(listener)
    fake.on('POST /blocks/block-1/uncomplete', { block: makeBlock(), task_status: 'todo', progress: { ...change, xp_change: -20, total_xp: 1220 } })
    fake.on('POST /blocks/block-1/complete', { block: done, task_status: 'done', progress: { ...change, level_up: true, badges_earned: ['first_task'] } })

    await user.click(screen.getByRole('button', { name: 'uncomplete' }))
    await user.click(await (await toasts()).findByRole('button', { name: en.common.undo }))
    await waitFor(() => {
      expect(fake.calls('POST', '/blocks/block-1/complete')).toHaveLength(1)
    })
    await waitFor(() => {
      expect(screen.getByTestId('pending')).toHaveTextContent('false')
    })
    expect(listener).not.toHaveBeenCalled()
    off()
  })

  it('uncomplete sends no event', async () => {
    const user = userEvent.setup()
    const done = makeBlock({ status: 'done', state: 'done' })
    const { fake } = setupCalls({ block: done })
    await loaded()
    const listener = vi.fn()
    const off = onCompleted(listener)
    fake.on('POST /blocks/block-1/uncomplete', {
      block: makeBlock(),
      task_status: 'todo',
      progress: { ...change, xp_change: -20, total_xp: 1220 },
    })

    await user.click(screen.getByRole('button', { name: 'uncomplete' }))
    await (await toasts()).findByText(`${en.board.uncompleted}. ${en.board.xpLost(20)}`)
    expect(listener).not.toHaveBeenCalled()
    off()
  })

  // A manager ruling (S32 Task 13): the Undo of "Not done" puts back a mark the user already had,
  // so the reward is not played again; a press of Done after it plays it once.
  it('the complete that undoes "Not done" tells no listener, and a later Done tells them once', async () => {
    const user = userEvent.setup()
    const done = makeBlock({ status: 'done', state: 'done' })
    const { fake } = setupCalls({ block: done })
    await loaded()
    const listener = vi.fn()
    const off = onCompleted(listener)
    fake.on('POST /blocks/block-1/uncomplete', { block: makeBlock(), task_status: 'todo', progress: { ...change, xp_change: -20, total_xp: 1220 } })
    fake.on('POST /blocks/block-1/complete', { block: done, task_status: 'done', progress: change })

    await user.click(screen.getByRole('button', { name: 'uncomplete' }))
    await user.click(await (await toasts()).findByRole('button', { name: en.common.undo }))
    await waitFor(() => {
      expect(fake.calls('POST', '/blocks/block-1/complete')).toHaveLength(1)
    })
    await waitFor(() => {
      expect(screen.getByTestId('pending')).toHaveTextContent('false')
    })
    expect(listener).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'complete' }))
    await waitFor(() => {
      expect(fake.calls('POST', '/blocks/block-1/complete')).toHaveLength(2)
    })
    await waitFor(() => {
      expect(listener).toHaveBeenCalledExactlyOnceWith({ blockId: 'block-1', xp: 20, level: 4, levelUp: false, badgesEarned: [] })
    })
    off()
  })

  it('an empty progress cache stays empty', async () => {
    const user = userEvent.setup()
    const { fake, queryClient } = setupCalls()
    await loaded()
    const listener = vi.fn()
    const off = onCompleted(listener)
    fake.on('POST /blocks/block-1/complete', {
      block: makeBlock({ status: 'done', state: 'done' }),
      task_status: 'done',
      progress: change,
    })

    await user.click(screen.getByRole('button', { name: 'complete' }))
    await (await toasts()).findByText(`${en.board.completed}. ${en.board.xpGained(20)}`)
    expect(queryClient.getQueryData(progressKey(USER_ID))).toBeUndefined()
    expect(listener).toHaveBeenCalledOnce()
    off()
  })
})
