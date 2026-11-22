import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BusyItem } from '../availability/types'
import { useToday } from '../board/api'
import { blockName } from '../board/blockName'
import type { Block, Today } from '../board/types'
import { codeText } from '../i18n/codes'
import { en } from '../i18n/en'
import { makeBlock, makeMe, makePlan, makeToday, renderBoard } from '../test/boardFixtures'
import { createFakeApi, type ApiCall } from '../test/fakeApi'
import { weekDays } from './days'
import { toPx, type GridSpan } from './geometry'
import type { Ghost } from './ghost'
import { makeBusy } from './testFixtures'
import { TimeGrid } from './TimeGrid'

// The gestures of the grid (S32 Task 8). The behaviour tests of the old day timeline (S18), moved
// to the calendar's grid, and the new gestures: the press that opens, the ghost, touch, the swipe,
// and the empty space.

const TZ = 'Asia/Jerusalem'
const TODAY = '2026-11-24'
const DAY = '2026-11-25'
const WEEK = weekDays(TODAY)
// 11:25 in Jerusalem, on Tuesday 24 November.
const NOW = '2026-11-24T09:25:00Z'
const SPAN: GridSpan = { startMin: 420, endMin: 1380 }
const HOUR = 48
// 48px an hour: 0.8px a minute.
const PX = HOUR / 60

// On Wednesday: 14:00–15:00 and 16:00–17:00 local (UTC+2), a done block at 09:00, busy time at 18:00.
const A = makeBlock({ id: 'a', task_id: 't-a', task_title: 'גרפים', study_date: DAY, starts_at: '2026-11-25T12:00:00Z', ends_at: '2026-11-25T13:00:00Z' })
const B = makeBlock({ id: 'b', task_id: 't-b', task_title: 'ערימות', study_date: DAY, starts_at: '2026-11-25T14:00:00Z', ends_at: '2026-11-25T15:00:00Z' })
const DONE = makeBlock({
  id: 'd',
  task_id: 't-d',
  task_title: 'מבוא',
  study_date: DAY,
  status: 'done',
  state: 'done',
  starts_at: '2026-11-25T07:00:00Z',
  ends_at: '2026-11-25T08:00:00Z',
})
const BUSY: BusyItem = makeBusy({ id: 'shift', starts_at: '2026-11-25T16:00:00Z', ends_at: '2026-11-25T17:00:00Z' })

// 07:00–23:00 local on every day.
function dayBounds(date: string) {
  return { dayStart: Date.parse(`${date}T05:00:00Z`), dayEnd: Date.parse(`${date}T21:00:00Z`) }
}

function makeSpies() {
  return {
    onOpenBlock: vi.fn<(block: Block) => void>(),
    onSwipeAction: vi.fn<(block: Block, action: 'defer' | 'skip') => void>(),
    onCreateBusy: vi.fn<(range: { date: string; startsAt: string; endsAt: string }) => void>(),
    onSwipeDay: vi.fn<(direction: 1 | -1) => void>(),
  }
}

type Spies = ReturnType<typeof makeSpies>

// The grid can be taken away alone, so a test sees what the grid leaves behind, apart from the
// providers around it.
function Harness({ spies, ghosts }: { spies: Spies; ghosts: Ghost[] }) {
  const today = useToday()
  const [shown, setShown] = useState(true)
  if (today.data === undefined) return null
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setShown(false)
        }}
      >
        hide the grid
      </button>
      {shown ? <Grid spies={spies} blocks={today.data.blocks} ghosts={ghosts} /> : null}
    </>
  )
}

function Grid({ spies, blocks, ghosts }: { spies: Spies; blocks: Block[]; ghosts: Ghost[] }) {
  return (
    <TimeGrid
      days={WEEK}
      today={TODAY}
      view="week"
      span={SPAN}
      hourPx={HOUR}
      blocks={blocks}
      busy={[BUSY]}
      ghosts={ghosts}
      tz={TZ}
      now={Date.parse(NOW)}
      restDays={new Set()}
      streakDays={new Set()}
      showHeader
      rangeText="22–28 November 2026"
      onOpenBlock={spies.onOpenBlock}
      onOpenBusy={vi.fn()}
      dayBounds={dayBounds}
      onSwipeAction={spies.onSwipeAction}
      onCreateBusy={spies.onCreateBusy}
      onSwipeDay={spies.onSwipeDay}
    />
  )
}

async function setup(blocks: Block[] = [A, B, DONE], ghosts: Ghost[] = []) {
  const state: { today: Today } = { today: makeToday(blocks) }
  const fake = createFakeApi()
    .on('GET /me', makeMe(TZ))
    .on('GET /today', () => state.today)
    .on({ method: 'GET', path: /^\/plan/ }, makePlan(blocks))
    .on({ method: 'POST', path: /^\/blocks\/[^/]+\/complete$/ }, (call: ApiCall) => {
      const id = call.path.split('/')[2]
      const block = state.today.blocks.find((b) => b.id === id) ?? A
      return { block: { ...block, status: 'done', state: 'done' }, task_status: 'done' }
    })
    .on({ method: 'PATCH', path: /^\/blocks\// }, (call: ApiCall) => {
      const id = call.path.split('/')[2]
      const body = call.body as { starts_at: string }
      const block = state.today.blocks.find((b) => b.id === id) ?? A
      const minutes = (Date.parse(block.ends_at) - Date.parse(block.starts_at)) / 60000
      const moved: Block = { ...block, starts_at: body.starts_at, ends_at: new Date(Date.parse(body.starts_at) + minutes * 60000).toISOString(), pinned: true }
      state.today = { ...state.today, blocks: state.today.blocks.map((b) => (b.id === id ? moved : b)) }
      return moved
    })
  const spies = makeSpies()
  const rendered = renderBoard(<Harness spies={spies} ghosts={ghosts} />, { api: fake.api })
  await waitFor(() => {
    expect(document.querySelector(`[data-block-id="${blocks[0]?.id ?? A.id}"]`)).not.toBeNull()
  })
  return { fake, state, spies, ...rendered }
}

function blockEl(block: Block): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-block-id="${block.id}"]`)
  if (el === null) throw new Error(`no block ${block.id}`)
  return el
}

function column(date: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-date="${date}"]`)
  if (el === null) throw new Error(`no column for ${date}`)
  return el
}

function live(): HTMLElement {
  const grid = screen.getByRole('group', { name: en.calendar.grid.label('22–28 November 2026') })
  const region = grid.querySelector<HTMLElement>('[aria-live="polite"]')
  if (region === null) throw new Error('no live region')
  return region
}

function ghostEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-ghost]')
}

function patches(fake: Awaited<ReturnType<typeof setup>>['fake']) {
  return fake.calls('PATCH').map((c) => c.body)
}

function candidate(range: string, problem: keyof typeof en.calendar.grid.problem = 'free') {
  return en.calendar.grid.candidate(range, en.calendar.grid.problem[problem])
}

const mouse = { pointerId: 1, pointerType: 'mouse', button: 0, isPrimary: true }
const touch = { pointerId: 7, pointerType: 'touch', button: 0, isPrimary: true }

// A mouse drag of the block by `dy` px, not yet released.
function mouseDrag(el: HTMLElement, dy: number) {
  fireEvent.pointerDown(el, { ...mouse, clientX: 100, clientY: 500 })
  fireEvent.pointerMove(el, { ...mouse, clientX: 100, clientY: 500 + dy })
}

function mouseUp(el: HTMLElement, dy: number) {
  fireEvent.pointerUp(el, { ...mouse, clientX: 100, clientY: 500 + dy })
  fireEvent.click(el)
}

function swipe(el: HTMLElement, dx: number, kind: typeof touch | typeof mouse = touch) {
  fireEvent.pointerDown(el, { ...kind, clientX: 200, clientY: 500 })
  fireEvent.pointerMove(el, { ...kind, clientX: 200 + dx / 2, clientY: 501 })
  fireEvent.pointerMove(el, { ...kind, clientX: 200 + dx, clientY: 501 })
  fireEvent.pointerUp(el, { ...kind, clientX: 200 + dx, clientY: 501 })
}

// The y of a local time in a column, as clientY: in jsdom every rectangle is at 0.
function yOf(minutes: number): number {
  return toPx(minutes, SPAN, HOUR)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the drag of a block by mouse', () => {
  it('a drag to free time sends PATCH on the 15-minute grid, with a ghost at the candidate while it lasts', async () => {
    const { fake, spies } = await setup()
    const el = blockEl(A)
    // An hour down: 15:00 local, touching B, which is allowed.
    mouseDrag(el, 60 * PX)
    expect(el).toHaveAttribute('data-lifted')
    expect(live()).toHaveTextContent(candidate('15:00–16:00'))
    const ghost = column(DAY).querySelector<HTMLElement>('[data-ghost]')
    expect(ghost).toHaveAttribute('data-tone', 'target')
    expect(ghost?.style.top).toBe(`${String(toPx(900, SPAN, HOUR) + 1)}px`)
    expect(ghost?.textContent).toContain('15:00–16:00')
    mouseUp(el, 60 * PX)

    expect(ghostEl()).toBeNull()
    await waitFor(() => {
      expect(patches(fake)).toEqual([{ starts_at: '2026-11-25T13:00:00.000Z' }])
    })
    // The click that ends a drag does not open the block.
    expect(spies.onOpenBlock).not.toHaveBeenCalled()
    expect(await screen.findByText(en.move.moved('15:00'))).toBeInTheDocument()
  })

  it('a move of 3px is a press: it opens the block and sends nothing', async () => {
    const { fake, spies } = await setup()
    const el = blockEl(A)
    mouseDrag(el, 3)
    expect(el).not.toHaveAttribute('data-lifted')
    expect(ghostEl()).toBeNull()
    mouseUp(el, 3)
    expect(spies.onOpenBlock).toHaveBeenCalledWith(A)
    expect(patches(fake)).toEqual([])
  })

  it('a drag onto another block is refused: the block goes back, the live region and a toast say so', async () => {
    const { fake } = await setup()
    const el = blockEl(A)
    mouseDrag(el, 120 * PX)
    expect(live()).toHaveTextContent(candidate('16:00–17:00', 'slot_taken'))
    const ghost = ghostEl()
    expect(ghost).toHaveAttribute('data-tone', 'problem')
    expect(ghost?.textContent).toContain(candidate('16:00–17:00', 'slot_taken'))
    mouseUp(el, 120 * PX)

    expect(await screen.findByText(codeText('slot_taken'))).toBeInTheDocument()
    expect(live()).toHaveTextContent(en.move.refused)
    expect(patches(fake)).toEqual([])
    expect(el).not.toHaveAttribute('data-lifted')
    expect(el.style.transform).toBe('')
    expect(ghostEl()).toBeNull()
  })

  it('a drag past the end of the day is refused', async () => {
    const { fake } = await setup()
    const el = blockEl(A)
    // 22:30–23:30, and the day ends at 23:00.
    mouseDrag(el, 510 * PX)
    expect(live()).toHaveTextContent(candidate('22:30–23:30', 'outside_day'))
    mouseUp(el, 510 * PX)
    expect(await screen.findByText(codeText('outside_day'))).toBeInTheDocument()
    expect(patches(fake)).toEqual([])
  })

  it('a drag over busy time says busy time, and its release sends nothing', async () => {
    const { fake } = await setup()
    const el = blockEl(A)
    mouseDrag(el, 240 * PX)
    expect(live()).toHaveTextContent(candidate('18:00–19:00', 'slot_busy'))
    expect(live().textContent).toContain('busy time')
    mouseUp(el, 240 * PX)
    expect(await screen.findByText(codeText('slot_busy'))).toBeInTheDocument()
    expect(patches(fake)).toEqual([])
  })

  it('moves only within its column: a sideways move does not change the day', async () => {
    const { fake } = await setup()
    const el = blockEl(A)
    fireEvent.pointerDown(el, { ...mouse, clientX: 100, clientY: 500 })
    fireEvent.pointerMove(el, { ...mouse, clientX: 400, clientY: 500 + 60 * PX })
    expect(column(DAY).querySelector('[data-ghost]')).not.toBeNull()
    expect(el.style.transform).not.toContain('translateX')
    fireEvent.pointerUp(el, { ...mouse, clientX: 400, clientY: 500 + 60 * PX })
    await waitFor(() => {
      expect(patches(fake)).toEqual([{ starts_at: '2026-11-25T13:00:00.000Z' }])
    })
  })

  it('Escape cancels the drag: no ghost, no request', async () => {
    const { fake } = await setup()
    const el = blockEl(A)
    mouseDrag(el, 60 * PX)
    expect(ghostEl()).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(ghostEl()).toBeNull()
    expect(live()).toHaveTextContent(en.move.cancelled)
    mouseUp(el, 60 * PX)
    expect(patches(fake)).toEqual([])
  })

  it('pointercancel and a lost capture put the block back without a request', async () => {
    const { fake } = await setup()
    const el = blockEl(A)
    mouseDrag(el, 60 * PX)
    fireEvent.pointerCancel(el, mouse)
    expect(ghostEl()).toBeNull()
    mouseDrag(el, 60 * PX)
    fireEvent.lostPointerCapture(el, mouse)
    expect(ghostEl()).toBeNull()
    expect(live()).toHaveTextContent(en.move.cancelled)
    mouseUp(el, 60 * PX)
    expect(patches(fake)).toEqual([])
  })

  it('a done block does not move', async () => {
    const { fake } = await setup()
    const el = blockEl(DONE)
    mouseDrag(el, 300 * PX)
    expect(el).not.toHaveAttribute('data-lifted')
    expect(ghostEl()).toBeNull()
    mouseUp(el, 300 * PX)
    expect(patches(fake)).toEqual([])
  })

  it('pressing or clicking the check neither starts a drag nor opens the block', async () => {
    const user = userEvent.setup()
    const { fake, spies } = await setup()
    const check = within(blockEl(A)).getByRole('button', { name: en.board.completeLabel(blockName(A)) })
    fireEvent.pointerDown(check, { ...mouse, clientX: 100, clientY: 500 })
    fireEvent.pointerMove(check, { ...mouse, clientX: 100, clientY: 500 + 60 * PX })
    expect(ghostEl()).toBeNull()
    expect(blockEl(A)).not.toHaveAttribute('data-lifted')
    fireEvent.pointerUp(check, { ...mouse, clientX: 100, clientY: 500 + 60 * PX })
    await user.click(check)
    await waitFor(() => {
      expect(fake.calls('POST').map((c) => c.path)).toContain(`/blocks/${A.id}/complete`)
    })
    expect(spies.onOpenBlock).not.toHaveBeenCalled()
    expect(patches(fake)).toEqual([])
  })
})

describe('the move of a block by keyboard', () => {
  it('an arrow starts the move, every candidate is said and drawn, Enter confirms and the focus stays', async () => {
    const user = userEvent.setup()
    const { fake, spies } = await setup()
    const el = blockEl(A)
    act(() => {
      el.focus()
    })
    await user.keyboard('{ArrowDown}')
    expect(live()).toHaveTextContent(candidate('14:15–15:15'))
    expect(ghostEl()).not.toBeNull()
    await user.keyboard('{ArrowDown}')
    expect(live()).toHaveTextContent(candidate('14:30–15:30'))
    // Left and right do nothing: the axis is vertical.
    await user.keyboard('{ArrowLeft}{ArrowRight}')
    expect(live()).toHaveTextContent(candidate('14:30–15:30'))
    await user.keyboard('{Enter}')
    expect(ghostEl()).toBeNull()
    await waitFor(() => {
      expect(patches(fake)).toEqual([{ starts_at: '2026-11-25T12:30:00.000Z' }])
    })
    // Enter during a move confirms it, and does not open the block.
    expect(spies.onOpenBlock).not.toHaveBeenCalled()
    await screen.findByText(en.move.moved('14:30'))
    expect(blockEl(A)).toHaveFocus()
  })

  it('PageDown moves an hour, a taken hour is refused, and PageUp moves an hour earlier', async () => {
    const user = userEvent.setup()
    const { fake } = await setup()
    act(() => {
      blockEl(A).focus()
    })
    await user.keyboard('{PageDown}{PageDown}')
    expect(live()).toHaveTextContent(candidate('16:00–17:00', 'slot_taken'))
    expect(ghostEl()).toHaveAttribute('data-tone', 'problem')
    await user.keyboard('{Enter}')
    expect(await screen.findByText(codeText('slot_taken'))).toBeInTheDocument()
    expect(live()).toHaveTextContent(en.move.refused)
    expect(patches(fake)).toEqual([])

    await user.keyboard('{PageUp}{Enter}')
    await waitFor(() => {
      expect(patches(fake)).toEqual([{ starts_at: '2026-11-25T11:00:00.000Z' }])
    })
  })

  it('Escape cancels with no request', async () => {
    const user = userEvent.setup()
    const { fake, spies } = await setup()
    act(() => {
      blockEl(A).focus()
    })
    await user.keyboard('{ArrowDown}{Escape}')
    expect(live()).toHaveTextContent(en.move.cancelled)
    expect(ghostEl()).toBeNull()
    expect(patches(fake)).toEqual([])
    expect(spies.onOpenBlock).not.toHaveBeenCalled()
  })

  it('Tab cancels the move', async () => {
    const user = userEvent.setup()
    const { fake } = await setup()
    act(() => {
      blockEl(A).focus()
    })
    await user.keyboard('{ArrowDown}')
    await user.tab()
    expect(live()).toHaveTextContent(en.move.cancelled)
    expect(ghostEl()).toBeNull()
    await user.keyboard('{Enter}')
    expect(patches(fake)).toEqual([])
  })

  it('Enter without a move opens the block', async () => {
    const user = userEvent.setup()
    const { spies } = await setup()
    act(() => {
      blockEl(A).focus()
    })
    await user.keyboard('{Enter}')
    expect(spies.onOpenBlock).toHaveBeenCalledWith(A)
  })
})

describe('a refresh in the middle of a drag', () => {
  it('ends the drag when the block stops being upcoming: no ghost, no request, cancelled', async () => {
    const { fake, state, queryClient } = await setup()
    const el = blockEl(A)
    mouseDrag(el, 60 * PX)
    expect(ghostEl()).not.toBeNull()

    state.today = { ...state.today, blocks: state.today.blocks.map((b) => (b.id === A.id ? { ...b, state: 'in_progress' } : b)) }
    await act(() => queryClient.invalidateQueries())
    await waitFor(() => {
      expect(ghostEl()).toBeNull()
    })
    expect(live()).toHaveTextContent(en.move.cancelled)
    expect(blockEl(A)).not.toHaveAttribute('data-lifted')
    mouseUp(blockEl(A), 60 * PX)
    expect(patches(fake)).toEqual([])
  })

  it('ends the drag when the block is gone', async () => {
    const { fake, state, queryClient } = await setup()
    act(() => {
      blockEl(A).focus()
    })
    fireEvent.keyDown(blockEl(A), { key: 'ArrowDown' })
    expect(ghostEl()).not.toBeNull()
    state.today = { ...state.today, blocks: state.today.blocks.filter((b) => b.id !== A.id) }
    await act(() => queryClient.invalidateQueries())
    await waitFor(() => {
      expect(document.querySelector(`[data-block-id="${A.id}"]`)).toBeNull()
    })
    expect(ghostEl()).toBeNull()
    expect(live()).toHaveTextContent(en.move.cancelled)
    expect(patches(fake)).toEqual([])
  })
})

describe('touch', () => {
  it('a long press of 350ms without moving starts the drag, and stops the scroll only while it lasts', async () => {
    const { fake } = await setup()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(NOW))
    const el = blockEl(A)
    // The listener is there before the finger comes down: a browser decides at the start of a touch
    // whether its touchmoves can be cancelled, and iOS ignores a listener added during the touch.
    const touchmove = () => {
      const event = new Event('touchmove', { cancelable: true, bubbles: true })
      el.dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(touchmove()).toBe(false)
    fireEvent.pointerDown(el, { ...touch, clientX: 100, clientY: 500 })
    expect(touchmove()).toBe(false)
    act(() => {
      vi.advanceTimersByTime(349)
    })
    expect(el).not.toHaveAttribute('data-lifted')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(el).toHaveAttribute('data-lifted')
    expect(touchmove()).toBe(true)

    fireEvent.pointerMove(el, { ...touch, clientX: 100, clientY: 500 + 60 * PX })
    expect(ghostEl()).not.toBeNull()
    fireEvent.pointerUp(el, { ...touch, clientX: 100, clientY: 500 + 60 * PX })
    vi.useFakeTimers({ toFake: ['Date'] })
    // Scrolling is back.
    expect(touchmove()).toBe(false)
    await waitFor(() => {
      expect(patches(fake)).toEqual([{ starts_at: '2026-11-25T13:00:00.000Z' }])
    })
  })

  it('the touchmove listener is not passive, and a mouse drag does not stop the scroll', async () => {
    const added = vi.spyOn(HTMLElement.prototype, 'addEventListener')
    await setup()
    const options = added.mock.calls.filter(([type]) => type === 'touchmove').map(([, , opts]) => opts)
    expect(options).toContainEqual({ passive: false })
    const el = blockEl(A)
    mouseDrag(el, 60 * PX)
    const event = new Event('touchmove', { cancelable: true, bubbles: true })
    el.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    fireEvent.keyDown(document, { key: 'Escape' })

    // Taken off with the grid. The last one: StrictMode mounts the effect twice.
    const lock = added.mock.calls.filter(([type, , opts]) => type === 'touchmove' && JSON.stringify(opts) === '{"passive":false}').at(-1)?.[1]
    expect(lock).toBeDefined()
    const removed = vi.spyOn(HTMLElement.prototype, 'removeEventListener')
    fireEvent.click(screen.getByRole('button', { name: 'hide the grid' }))
    expect(removed.mock.calls.some(([type, listener]) => type === 'touchmove' && listener === lock)).toBe(true)
  })

  it('a finger that scrolls over a block starts neither a drag nor a swipe', async () => {
    const { fake } = await setup()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(NOW))
    const el = blockEl(A)
    fireEvent.pointerDown(el, { ...touch, clientX: 100, clientY: 500 })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    fireEvent.pointerMove(el, { ...touch, clientX: 100, clientY: 510 })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(el).not.toHaveAttribute('data-lifted')
    fireEvent.pointerMove(el, { ...touch, clientX: 100, clientY: 600 })
    expect(ghostEl()).toBeNull()
    expect(el.style.transform).toBe('')
    expect(screen.queryByRole('button', { name: en.board.deferLabel(blockName(A)) })).not.toBeInTheDocument()
    fireEvent.pointerUp(el, { ...touch, clientX: 100, clientY: 600 })
    vi.useFakeTimers({ toFake: ['Date'] })
    expect(patches(fake)).toEqual([])
  })
})

describe('the swipe of a block', () => {
  it('a swipe of 80px to the left shows Defer and Skip, and Skip acts on the block and closes', async () => {
    const user = userEvent.setup()
    const { spies } = await setup()
    const el = blockEl(A)
    expect(screen.queryByRole('button', { name: en.review.skipLabel(blockName(A)) })).not.toBeInTheDocument()
    swipe(el, -80)
    const defer = screen.getByRole('button', { name: en.board.deferLabel(blockName(A)) })
    const skip = screen.getByRole('button', { name: en.review.skipLabel(blockName(A)) })
    expect(defer).toHaveTextContent(en.board.defer)
    expect(defer).toHaveClass('bg-gold', 'text-ink')
    expect(skip).toHaveTextContent(en.review.skip)
    expect(skip).toHaveClass('bg-clay', 'text-on-clay')
    expect(el.style.transform).toBe('translateX(-132px)')
    await user.click(skip)
    expect(spies.onSwipeAction).toHaveBeenCalledWith(A, 'skip')
    expect(spies.onOpenBlock).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: en.review.skipLabel(blockName(A)) })).not.toBeInTheDocument()
    expect(blockEl(A).style.transform).toBe('')
  })

  it('Defer calls the action with defer', async () => {
    const user = userEvent.setup()
    const { spies } = await setup()
    swipe(blockEl(A), -80)
    await user.click(screen.getByRole('button', { name: en.board.deferLabel(blockName(A)) }))
    expect(spies.onSwipeAction).toHaveBeenCalledWith(A, 'defer')
  })

  it('a swipe of 40px closes again', async () => {
    await setup()
    const el = blockEl(A)
    swipe(el, -40)
    expect(screen.queryByRole('button', { name: en.board.deferLabel(blockName(A)) })).not.toBeInTheDocument()
    expect(el.style.transform).toBe('')
  })

  it('a done block has no swipe', async () => {
    await setup()
    swipe(blockEl(DONE), -80)
    expect(screen.queryByRole('button', { name: en.board.deferLabel(blockName(DONE)) })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.review.skipLabel(blockName(DONE)) })).not.toBeInTheDocument()
  })

  it('a mouse does not swipe', async () => {
    await setup()
    swipe(blockEl(A), -80, mouse)
    expect(screen.queryByRole('button', { name: en.board.deferLabel(blockName(A)) })).not.toBeInTheDocument()
  })

  it('Escape, a press outside the block and a scroll close it', async () => {
    const { spies } = await setup()
    const name = en.board.deferLabel(blockName(A))
    swipe(blockEl(A), -80)
    expect(screen.getByRole('button', { name })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()

    swipe(blockEl(A), -80)
    fireEvent.pointerDown(document.body, touch)
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()

    swipe(blockEl(A), -80)
    fireEvent.scroll(window)
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    expect(spies.onSwipeAction).not.toHaveBeenCalled()
  })

  // S32 Task 13: the 132px of buttons would lie over the next column, or over the next block.
  it('a week column narrower than the buttons does not swipe', async () => {
    await setup()
    const col = column(DAY)
    col.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 96, width: 96, height: 0, toJSON: () => ({}) })
    swipe(blockEl(A), -80)
    expect(screen.queryByRole('button', { name: en.board.deferLabel(blockName(A)) })).not.toBeInTheDocument()
    expect(blockEl(A).style.transform).toBe('')
  })

  it('a short block with another right under it does not swipe, and the one under it does', async () => {
    // 14:00–14:30 and 14:30–15:30 local: the buttons of the first would cover the second.
    const short = makeBlock({ id: 's', task_id: 't-s', task_title: 'קצר', study_date: DAY, starts_at: '2026-11-25T12:00:00Z', ends_at: '2026-11-25T12:30:00Z' })
    const after = makeBlock({ id: 'n', task_id: 't-n', task_title: 'אחריו', study_date: DAY, starts_at: '2026-11-25T12:30:00Z', ends_at: '2026-11-25T13:30:00Z' })
    await setup([short, after])
    swipe(blockEl(short), -80)
    expect(screen.queryByRole('button', { name: en.board.deferLabel(blockName(short)) })).not.toBeInTheDocument()
    swipe(blockEl(after), -80)
    expect(screen.getByRole('button', { name: en.board.deferLabel(blockName(after)) })).toBeInTheDocument()
  })
})

describe('the empty space of a column', () => {
  it('a press at 10:07 asks for busy time from 10:00 to 11:00 of that day, in UTC', async () => {
    const { spies } = await setup()
    const col = column(DAY)
    fireEvent.pointerDown(col, { ...mouse, clientX: 50, clientY: yOf(607) })
    fireEvent.pointerUp(col, { ...mouse, clientX: 50, clientY: yOf(607) })
    expect(spies.onCreateBusy).toHaveBeenCalledWith({ date: DAY, startsAt: '2026-11-25T08:00:00.000Z', endsAt: '2026-11-25T09:00:00.000Z' })
  })

  it('a touch tap does the same', async () => {
    const { spies } = await setup()
    const col = column(DAY)
    fireEvent.pointerDown(col, { ...touch, clientX: 50, clientY: yOf(607) })
    fireEvent.pointerUp(col, { ...touch, clientX: 52, clientY: yOf(607) + 2 })
    expect(spies.onCreateBusy).toHaveBeenCalledWith({ date: DAY, startsAt: '2026-11-25T08:00:00.000Z', endsAt: '2026-11-25T09:00:00.000Z' })
  })

  it('a mouse drag from 10:00 to 11:30 picks that range, with a ghost of new busy time while it lasts', async () => {
    const { spies } = await setup()
    const col = column(DAY)
    fireEvent.pointerDown(col, { ...mouse, clientX: 50, clientY: yOf(600) })
    fireEvent.pointerMove(col, { ...mouse, clientX: 50, clientY: yOf(690) })
    const ghost = col.querySelector<HTMLElement>('[data-ghost]')
    expect(ghost).toHaveClass('border-busy')
    expect(ghost?.textContent).toContain(en.calendar.grid.newBusy)
    expect(ghost?.textContent).toContain('10:00–11:30')
    fireEvent.pointerUp(col, { ...mouse, clientX: 50, clientY: yOf(690) })
    expect(ghostEl()).toBeNull()
    expect(spies.onCreateBusy).toHaveBeenCalledTimes(1)
    expect(spies.onCreateBusy).toHaveBeenCalledWith({ date: DAY, startsAt: '2026-11-25T08:00:00.000Z', endsAt: '2026-11-25T09:30:00.000Z' })
  })

  it('a press on an hour that has passed does nothing', async () => {
    const { spies } = await setup()
    const col = column(TODAY)
    // 09:00 today, and now is 11:25.
    fireEvent.pointerDown(col, { ...mouse, clientX: 50, clientY: yOf(540) })
    fireEvent.pointerUp(col, { ...mouse, clientX: 50, clientY: yOf(540) })
    expect(spies.onCreateBusy).not.toHaveBeenCalled()
  })

  it('a press on a block or on busy time is not a press on empty space', async () => {
    const user = userEvent.setup()
    const { spies } = await setup()
    mouseDrag(blockEl(A), 2)
    mouseUp(blockEl(A), 2)
    await user.click(screen.getByRole('button', { name: en.calendar.grid.busyLabel(BUSY.title ?? '', '18:00–19:00') }))
    expect(spies.onCreateBusy).not.toHaveBeenCalled()
  })

  it('a touch swipe of 80px across empty space goes to the next day, and the other way to the day before', async () => {
    const { spies } = await setup()
    const col = column(DAY)
    swipe(col, -80)
    expect(spies.onSwipeDay).toHaveBeenLastCalledWith(1)
    swipe(col, 80)
    expect(spies.onSwipeDay).toHaveBeenLastCalledWith(-1)
    expect(spies.onSwipeDay).toHaveBeenCalledTimes(2)
    expect(spies.onCreateBusy).not.toHaveBeenCalled()
  })
})

describe('fixes of the review', () => {
  // A touch click comes in a later task than its pointerup (a tap is recognised after touchend), so
  // the guard lasts a time, not a task. The clock of performance.now is the fake timers' here.
  function fakeClock() {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(NOW))
  }

  function later(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms)
    })
  }

  it('the click 50ms after a drag is swallowed, and a click alone 700ms after one opens the block', async () => {
    const { spies } = await setup()
    fakeClock()
    const el = blockEl(A)
    mouseDrag(el, 120 * PX)
    fireEvent.pointerUp(el, { ...mouse, clientX: 100, clientY: 500 + 120 * PX })
    later(50)
    fireEvent.click(el)
    expect(spies.onOpenBlock).not.toHaveBeenCalled()

    mouseDrag(el, 120 * PX)
    fireEvent.pointerUp(el, { ...mouse, clientX: 100, clientY: 500 + 120 * PX })
    later(700)
    // A screen reader's double tap: a click alone.
    fireEvent.click(el)
    expect(spies.onOpenBlock).toHaveBeenCalledWith(A)
  })

  it('a long press released in place swallows its late click', async () => {
    const { spies } = await setup()
    fakeClock()
    const el = blockEl(A)
    fireEvent.pointerDown(el, { ...touch, clientX: 100, clientY: 500 })
    later(400)
    expect(el).toHaveAttribute('data-lifted')
    fireEvent.pointerUp(el, { ...touch, clientX: 100, clientY: 500 })
    later(80)
    fireEvent.click(el)
    expect(spies.onOpenBlock).not.toHaveBeenCalled()
  })

  it('the click 50ms after a swipe is swallowed, and one 700ms after it is not', async () => {
    const { spies } = await setup()
    fakeClock()
    // A tap on an open swipe closes it, and its late click does not open the block.
    swipe(blockEl(A), -80)
    fireEvent.pointerDown(blockEl(A), { ...touch, clientX: 100, clientY: 500 })
    fireEvent.pointerUp(blockEl(A), { ...touch, clientX: 100, clientY: 500 })
    later(50)
    fireEvent.click(blockEl(A))
    expect(spies.onOpenBlock).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: en.board.deferLabel(blockName(A)) })).not.toBeInTheDocument()

    swipe(blockEl(A), -40)
    later(700)
    fireEvent.click(blockEl(A))
    expect(spies.onOpenBlock).toHaveBeenCalledWith(A)
  })

  it('a new press or a key ends the guard at once', async () => {
    const { spies } = await setup()
    fakeClock()
    const el = blockEl(A)
    mouseDrag(el, 120 * PX)
    fireEvent.pointerUp(el, { ...mouse, clientX: 100, clientY: 500 + 120 * PX })
    later(50)
    fireEvent.pointerDown(el, { ...mouse, clientX: 100, clientY: 500 })
    fireEvent.pointerUp(el, { ...mouse, clientX: 100, clientY: 500 })
    fireEvent.click(el)
    expect(spies.onOpenBlock).toHaveBeenCalledTimes(1)

    mouseDrag(el, 120 * PX)
    fireEvent.pointerUp(el, { ...mouse, clientX: 100, clientY: 500 + 120 * PX })
    later(50)
    fireEvent.keyDown(el, { key: 'Shift' })
    fireEvent.click(el)
    expect(spies.onOpenBlock).toHaveBeenCalledTimes(2)

    swipe(blockEl(A), -40)
    later(50)
    fireEvent.keyDown(blockEl(A), { key: 'Shift' })
    fireEvent.click(blockEl(A))
    expect(spies.onOpenBlock).toHaveBeenCalledTimes(3)
  })


  it('a refresh that moves the dragged block on the server ends the drag', async () => {
    const { fake, state, queryClient } = await setup()
    const el = blockEl(A)
    mouseDrag(el, 60 * PX)
    expect(ghostEl()).not.toBeNull()
    state.today = {
      ...state.today,
      blocks: state.today.blocks.map((b) => (b.id === A.id ? { ...b, starts_at: '2026-11-25T11:00:00Z', ends_at: '2026-11-25T12:00:00Z' } : b)),
    }
    await act(() => queryClient.invalidateQueries())
    await waitFor(() => {
      expect(ghostEl()).toBeNull()
    })
    expect(live()).toHaveTextContent(en.move.cancelled)
    mouseUp(blockEl(A), 60 * PX)
    expect(patches(fake)).toEqual([])
  })

  it('the same words twice in a row are a new announcement', async () => {
    await setup()
    const el = blockEl(A)
    // 5px: lifted, still at its own place, so nothing is said until Escape.
    mouseDrag(el, 5)
    fireEvent.keyDown(document, { key: 'Escape' })
    const first = live().textContent
    mouseUp(el, 5)
    mouseDrag(el, 5)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(live()).toHaveTextContent(en.move.cancelled)
    expect(live().textContent).not.toBe(first)
    mouseUp(el, 5)
  })

  it('an arrow that cannot move the block says where it is, first or later', async () => {
    const user = userEvent.setup()
    // 11:30–12:30 today, and now is 11:25: 11:30 is the earliest start.
    const early = makeBlock({ id: 'e', task_id: 't-e', task_title: 'מוקדם', study_date: TODAY, starts_at: '2026-11-24T09:30:00Z', ends_at: '2026-11-24T10:30:00Z' })
    await setup([early])
    const el = blockEl(early)
    act(() => {
      el.focus()
    })
    await user.keyboard('{ArrowUp}')
    expect(live()).toHaveTextContent(candidate('11:30–12:30'))
    // Every later press at the edge is said again, not only the first.
    const first = live().textContent
    await user.keyboard('{ArrowUp}')
    expect(live()).toHaveTextContent(candidate('11:30–12:30'))
    expect(live().textContent).not.toBe(first)
    await user.keyboard('{Escape}')
    expect(live()).toHaveTextContent(en.move.cancelled)
  })

  it('a drag ghost never shares a key with a ghost the page previews for the same block', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const preview: Ghost = { id: A.id, date: DAY, startMin: 1200, endMin: 1260, colorIndex: 0, title: A.task_title, tone: 'target' }
    await setup([A, B, DONE], [preview])
    mouseDrag(blockEl(A), 60 * PX)
    expect(column(DAY).querySelectorAll('[data-ghost]')).toHaveLength(2)
    expect(errors.mock.calls.some((args) => args.some((arg) => typeof arg === 'string' && arg.includes('same key')))).toBe(false)
    fireEvent.keyDown(document, { key: 'Escape' })
  })
})

describe('motion and clean-up', () => {
  it('with reduced motion nothing animates and nothing has a transition', async () => {
    const animate = vi.fn()
    Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true })
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }))
    try {
      await setup()
      const el = blockEl(A)
      mouseDrag(el, 120 * PX)
      mouseUp(el, 120 * PX)
      expect(el.style.transition).toBe('')
      expect(el.style.transitionProperty).toBe('')
      swipe(el, -80)
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(el.style.transform).toBe('')
      expect(el.style.transitionProperty).toBe('')
      expect(animate).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      delete (Element.prototype as { animate?: unknown }).animate
    }
  })

  it('without reduced motion the block slides back', async () => {
    await setup()
    const el = blockEl(A)
    swipe(el, -80)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(el.style.transitionProperty).toContain('transform')
  })

  it('every listener on document and window is removed, when a gesture ends and on unmount', async () => {
    await setup()
    const targets = [document, window] as const
    const added = targets.map((t) => vi.spyOn(t, 'addEventListener'))
    const removed = targets.map((t) => vi.spyOn(t, 'removeEventListener'))
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(NOW))

    // A mouse drag that is cancelled, a touch drag that ends, a swipe that closes, a swipe left
    // open, and a touch drag held when the grid goes away.
    mouseDrag(blockEl(A), 60 * PX)
    fireEvent.keyDown(document, { key: 'Escape' })
    mouseUp(blockEl(A), 60 * PX)
    fireEvent.pointerDown(blockEl(B), { ...touch, clientX: 100, clientY: 500 })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    fireEvent.pointerUp(blockEl(B), { ...touch, clientX: 100, clientY: 500 })
    swipe(blockEl(A), -80)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.pointerDown(blockEl(B), { ...touch, clientX: 100, clientY: 500 })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    swipe(blockEl(A), -80)
    fireEvent.click(screen.getByRole('button', { name: 'hide the grid' }))
    expect(document.querySelector('[data-block-id]')).toBeNull()
    vi.useFakeTimers({ toFake: ['Date'] })

    targets.forEach((_, i) => {
      const adds = added[i]?.mock.calls ?? []
      const removes = removed[i]?.mock.calls ?? []
      expect(adds.length).toBeGreaterThan(0)
      expect(removes.length).toBe(adds.length)
      for (const [type, listener] of adds) {
        expect(removes.some(([t, l]) => t === type && l === listener)).toBe(true)
      }
    })
  })
})
