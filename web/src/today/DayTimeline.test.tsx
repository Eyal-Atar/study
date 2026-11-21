import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToday } from '../board/api'
import type { Block, Today } from '../board/types'
import { codeText } from '../i18n/codes'
import { en } from '../i18n/en'
import { makeBlock, makeMe, makePlan, makeToday, renderBoard } from '../test/boardFixtures'
import { createFakeApi, type ApiCall } from '../test/fakeApi'
import { DayTimeline, PX_PER_MINUTE } from './DayTimeline'

// Now is 09:00 in Jerusalem; the day is 07:00–23:00 (makeToday).
const NOW = '2026-11-16T07:00:00Z'

// 14:00–15:00 and 16:00–17:00 local.
const A = makeBlock({ id: 'a', task_id: 't-a', task_title: 'גרפים', starts_at: '2026-11-16T12:00:00Z', ends_at: '2026-11-16T13:00:00Z' })
const B = makeBlock({ id: 'b', task_id: 't-b', task_title: 'ערימות', starts_at: '2026-11-16T14:00:00Z', ends_at: '2026-11-16T15:00:00Z' })
const DONE = makeBlock({
  id: 'd',
  task_id: 't-d',
  task_title: 'מבוא',
  status: 'done',
  state: 'done',
  starts_at: '2026-11-16T05:00:00Z',
  ends_at: '2026-11-16T06:00:00Z',
})

function Harness() {
  const today = useToday()
  if (today.data === undefined) return null
  return <DayTimeline today={today.data} tz="Asia/Jerusalem" />
}

function setup(blocks: Block[] = [A, B, DONE]) {
  const state: { today: Today } = { today: makeToday(blocks) }
  const fake = createFakeApi()
    .on('GET /me', makeMe())
    .on('GET /today', () => state.today)
    .on({ method: 'GET', path: /^\/plan/ }, makePlan(blocks))
    .on({ method: 'PATCH', path: /^\/blocks\// }, (call: ApiCall) => {
      const id = call.path.split('/')[2]
      const body = call.body as { starts_at: string; pinned?: boolean }
      const block = state.today.blocks.find((b) => b.id === id) ?? A
      const minutes = (Date.parse(block.ends_at) - Date.parse(block.starts_at)) / 60000
      const moved: Block = {
        ...block,
        starts_at: body.starts_at,
        ends_at: new Date(Date.parse(body.starts_at) + minutes * 60000).toISOString(),
        pinned: body.pinned ?? true,
      }
      state.today = { ...state.today, blocks: state.today.blocks.map((b) => (b.id === id ? moved : b)) }
      return moved
    })
  const rendered = renderBoard(<Harness />, { api: fake.api })
  return { fake, state, ...rendered }
}

async function handle(block: Block) {
  return screen.findByRole('button', { name: en.move.handleLabel(block.task_title) })
}

function itemOf(element: HTMLElement) {
  const item = element.closest('li')
  if (item === null) throw new Error('no timeline item')
  return within(item)
}

function live() {
  return within(screen.getByRole('region', { name: en.today.blocks })).getByRole('status')
}

function patches(fake: ReturnType<typeof setup>['fake']) {
  return fake.calls('PATCH').map((c) => c.body)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DayTimeline', () => {
  it('shows the hours, the blocks with their times, and a handle only on upcoming blocks', async () => {
    setup()
    await handle(A)
    const list = screen.getByRole('list', { name: en.move.timelineLabel })
    expect(within(list).getByText(A.task_title)).toBeInTheDocument()
    expect(within(list).getByText('14:00–15:00')).toBeInTheDocument()
    expect(within(list).getByText(DONE.task_title)).toBeInTheDocument()
    expect(screen.getByText('07:00')).toBeInTheDocument()
    expect(screen.getByText('22:00')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.move.handleLabel(DONE.task_title) })).not.toBeInTheDocument()
    // The handle says how to use the keyboard.
    const grip = await handle(A)
    expect(grip).toHaveAccessibleDescription(en.move.instructions)
  })

  it('a drag to free time sends PATCH with a start on the 15-minute grid', async () => {
    const { fake } = setup()
    const grip = await handle(A)
    fireEvent.pointerDown(grip, { pointerId: 1, button: 0, clientY: 500 })
    // An hour down: 15:00 local, touching B, which is allowed.
    fireEvent.pointerMove(grip, { pointerId: 1, clientY: 500 + 60 * PX_PER_MINUTE })
    expect(live()).toHaveTextContent(en.move.candidate('15:00–16:00', true))
    fireEvent.pointerUp(grip, { pointerId: 1, clientY: 500 + 60 * PX_PER_MINUTE })

    await waitFor(() => {
      expect(patches(fake)).toEqual([{ starts_at: '2026-11-16T13:00:00.000Z' }])
    })
    // Shown at once where it moved, and pinned.
    expect(itemOf(grip).getByText('15:00–16:00')).toBeInTheDocument()
    expect(itemOf(grip).getByText(en.board.pinned)).toBeInTheDocument()
    expect(await screen.findByText(en.move.moved('15:00'))).toBeInTheDocument()
  })

  it('a drag onto another block sends nothing, says so, and puts the block back', async () => {
    const { fake } = setup()
    const grip = await handle(A)
    fireEvent.pointerDown(grip, { pointerId: 1, button: 0, clientY: 500 })
    fireEvent.pointerMove(grip, { pointerId: 1, clientY: 500 + 120 * PX_PER_MINUTE })
    expect(live()).toHaveTextContent(en.move.candidate('16:00–17:00', false))
    fireEvent.pointerUp(grip, { pointerId: 1, clientY: 500 + 120 * PX_PER_MINUTE })

    expect(await screen.findByText(codeText('slot_taken'))).toBeInTheDocument()
    expect(patches(fake)).toEqual([])
    expect(itemOf(grip).getByText('14:00–15:00')).toBeInTheDocument()
  })

  it('the ghost says the new time, left to right, and whether it is free, in words', async () => {
    setup()
    const grip = await handle(A)
    fireEvent.pointerDown(grip, { pointerId: 1, button: 0, clientY: 500 })
    fireEvent.pointerMove(grip, { pointerId: 1, clientY: 500 + 60 * PX_PER_MINUTE })
    const free = document.querySelector('[data-ghost="free"]')
    expect(free).toHaveTextContent(en.move.candidate('15:00–16:00', true))
    expect(free?.querySelector('[dir="ltr"]')).toHaveTextContent(/^15:00–16:00$/)
    fireEvent.pointerMove(grip, { pointerId: 1, clientY: 500 + 120 * PX_PER_MINUTE })
    const taken = document.querySelector('[data-ghost="taken"]')
    expect(taken).toHaveTextContent(en.move.candidate('16:00–17:00', false))
    fireEvent.pointerCancel(grip, { pointerId: 1 })
  })

  // ink-muted on a state background is not an allowed pair (design language 2).
  it('a tinted block holds no muted text, and a done one is struck', async () => {
    setup()
    await handle(A)
    const done = screen.getByText(DONE.task_title)
    expect(done).toHaveClass('line-through')
    const item = done.closest('li')
    expect(item?.querySelector('.bg-success-soft')).not.toBeNull()
    expect(item?.querySelector('.text-ink-muted')).toBeNull()
    expect(within(item as HTMLElement).getByText(en.board.states.done)).toBeInTheDocument()
  })

  it('a small drag moves in 15-minute steps, and a tiny one does nothing', async () => {
    const { fake } = setup()
    const grip = await handle(A)
    fireEvent.pointerDown(grip, { pointerId: 1, button: 0, clientY: 500 })
    fireEvent.pointerMove(grip, { pointerId: 1, clientY: 505 })
    fireEvent.pointerUp(grip, { pointerId: 1, clientY: 505 })
    expect(patches(fake)).toEqual([])

    // 10 px is about 8 minutes: the nearest quarter hour is 14:15.
    fireEvent.pointerDown(grip, { pointerId: 2, button: 0, clientY: 500 })
    fireEvent.pointerMove(grip, { pointerId: 2, clientY: 510 })
    expect(live()).toHaveTextContent(en.move.candidate('14:15–15:15', true))
    fireEvent.pointerUp(grip, { pointerId: 2, clientY: 510 })
    await waitFor(() => {
      expect(patches(fake)).toEqual([{ starts_at: '2026-11-16T12:15:00.000Z' }])
    })
  })

  it('pointercancel puts the block back without a request', async () => {
    const { fake } = setup()
    const grip = await handle(A)
    fireEvent.pointerDown(grip, { pointerId: 1, button: 0, clientY: 500 })
    fireEvent.pointerMove(grip, { pointerId: 1, clientY: 500 + 60 * PX_PER_MINUTE })
    fireEvent.pointerCancel(grip, { pointerId: 1 })
    fireEvent.pointerUp(grip, { pointerId: 1, clientY: 500 + 60 * PX_PER_MINUTE })
    expect(patches(fake)).toEqual([])
    expect(itemOf(grip).getByText('14:00–15:00')).toBeInTheDocument()
  })

  it('keyboard: Enter, two arrows down and Enter move the block 30 minutes later', async () => {
    const user = userEvent.setup()
    const { fake } = setup()
    const grip = await handle(A)
    act(() => {
      grip.focus()
    })
    await user.keyboard('{Enter}{ArrowDown}{ArrowDown}')
    expect(live()).toHaveTextContent(en.move.candidate('14:30–15:30', true))
    // Left and right do nothing: the axis is vertical.
    await user.keyboard('{ArrowLeft}{ArrowRight}')
    expect(live()).toHaveTextContent(en.move.candidate('14:30–15:30', true))
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(patches(fake)).toEqual([{ starts_at: '2026-11-16T12:30:00.000Z' }])
    })
    expect(itemOf(grip).getByText(en.board.pinned)).toBeInTheDocument()
    expect(grip).toHaveFocus()
  })

  it('keyboard: Escape cancels with no request', async () => {
    const user = userEvent.setup()
    const { fake } = setup()
    const grip = await handle(A)
    act(() => {
      grip.focus()
    })
    await user.keyboard('{Enter}{ArrowDown}{Escape}')
    expect(live()).toHaveTextContent(en.move.cancelled)
    await user.keyboard('{Enter}{Escape}')
    expect(patches(fake)).toEqual([])
    expect(itemOf(grip).getByText('14:00–15:00')).toBeInTheDocument()
  })

  it('keyboard: PageUp moves an hour earlier, and a taken hour is refused', async () => {
    const user = userEvent.setup()
    const { fake } = setup()
    const grip = await handle(A)
    act(() => {
      grip.focus()
    })
    await user.keyboard('{Enter}{PageDown}{PageDown}')
    expect(live()).toHaveTextContent(en.move.candidate('16:00–17:00', false))
    await user.keyboard('{Enter}')
    expect(await screen.findByText(codeText('slot_taken'))).toBeInTheDocument()
    expect(patches(fake)).toEqual([])

    await user.keyboard('{Enter}{PageUp}{Enter}')
    await waitFor(() => {
      expect(patches(fake)).toEqual([{ starts_at: '2026-11-16T11:00:00.000Z' }])
    })
  })

  it('keyboard: PageUp into the past stops at the first quarter hour not before now', async () => {
    // 09:05: the earliest start is 09:15.
    vi.setSystemTime(new Date('2026-11-16T07:05:00Z'))
    const user = userEvent.setup()
    const { fake } = setup()
    const grip = await handle(A)
    act(() => {
      grip.focus()
    })
    await user.keyboard('{Enter}{PageUp}{PageUp}{PageUp}{PageUp}{PageUp}')
    expect(live()).toHaveTextContent(en.move.candidate('09:15–10:15', true))
    await user.keyboard('{PageUp}{ArrowUp}')
    expect(live()).toHaveTextContent(en.move.candidate('09:15–10:15', true))
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(patches(fake)).toEqual([{ starts_at: '2026-11-16T07:15:00.000Z' }])
    })
  })

  it('a lost pointer capture cancels the drag', async () => {
    const { fake } = setup()
    const grip = await handle(A)
    fireEvent.pointerDown(grip, { pointerId: 1, button: 0, clientY: 500 })
    fireEvent.pointerMove(grip, { pointerId: 1, clientY: 500 + 60 * PX_PER_MINUTE })
    expect(document.querySelector('[data-ghost]')).not.toBeNull()
    fireEvent.lostPointerCapture(grip, { pointerId: 1 })
    expect(document.querySelector('[data-ghost]')).toBeNull()
    expect(live()).toHaveTextContent(en.move.cancelled)
    fireEvent.pointerUp(grip, { pointerId: 1, clientY: 500 + 60 * PX_PER_MINUTE })
    expect(patches(fake)).toEqual([])
  })

  it('a drag ends when the block stops being upcoming (a refetch while dragging)', async () => {
    const { fake, state, queryClient } = setup()
    const grip = await handle(A)
    fireEvent.pointerDown(grip, { pointerId: 1, button: 0, clientY: 500 })
    fireEvent.pointerMove(grip, { pointerId: 1, clientY: 500 + 60 * PX_PER_MINUTE })
    expect(document.querySelector('[data-ghost]')).not.toBeNull()

    state.today = { ...state.today, blocks: state.today.blocks.map((b) => (b.id === A.id ? { ...b, state: 'in_progress' } : b)) }
    await act(() => queryClient.invalidateQueries())
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: en.move.handleLabel(A.task_title) })).not.toBeInTheDocument()
    })
    expect(document.querySelector('[data-ghost]')).toBeNull()
    expect(live()).toHaveTextContent(en.move.cancelled)

    // Upcoming again: a fresh handle with no move left over.
    state.today = { ...state.today, blocks: state.today.blocks.map((b) => (b.id === A.id ? { ...b, state: 'upcoming' } : b)) }
    await act(() => queryClient.invalidateQueries())
    const again = await handle(A)
    fireEvent.pointerUp(again, { pointerId: 1, clientY: 500 + 60 * PX_PER_MINUTE })
    expect(patches(fake)).toEqual([])
    expect(document.querySelector('[data-ghost]')).toBeNull()
  })

  it('leaving the handle with Tab cancels the move', async () => {
    const user = userEvent.setup()
    const { fake } = setup()
    const grip = await handle(A)
    act(() => {
      grip.focus()
    })
    await user.keyboard('{Enter}{ArrowDown}')
    await user.tab()
    await user.keyboard('{Enter}')
    expect(patches(fake)).toEqual([])
  })
})
