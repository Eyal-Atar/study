import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { blockName } from '../board/blockName'
import { completeText } from '../board/progressText'
import type { Block, CompleteResult } from '../board/types'
import { CAL_NOW, CAL_TODAY, openCalendar, stubMedia } from '../calendar/testFixtures'
import { en } from '../i18n/en'
import { makeBlock, USER_ID } from '../test/boardFixtures'
import { FIVE_MINUTES_MS, focusPath, focusStorageKey, type FocusSession } from './focusSession'

// The whole way in (S42 Task 5): the calendar, the block's sheet, the focus screen, and back, through
// the real routes and a fake server. The clock is frozen at CAL_NOW (11:25 in Jerusalem).

const MINUTE = 60_000

// 11:00-12:00: running now.
const RUNNING = makeBlock({
  id: 'b-run',
  task_id: 't-run',
  task_title: 'עכשיו: מיון',
  exam_name: 'אלגוריתמים',
  task_kind: 'learn',
  study_date: CAL_TODAY,
  state: 'in_progress',
  starts_at: '2026-11-24T09:00:00Z',
  ends_at: '2026-11-24T10:00:00Z',
})
// 14:00-15:00: has not started.
const LATER = makeBlock({
  id: 'b-later',
  task_id: 't-later',
  task_title: 'אחר כך: ערימות',
  exam_name: 'אלגוריתמים',
  task_kind: 'learn',
  study_date: CAL_TODAY,
  state: 'upcoming',
  starts_at: '2026-11-24T12:00:00Z',
  ends_at: '2026-11-24T13:00:00Z',
})

function doneResult(block: Block): CompleteResult {
  const done = { ...block, status: 'done' as const, state: 'done' as const }
  return {
    block: done,
    task_status: 'done',
    progress: { xp_change: 20, total_xp: 120, level: 2, level_up: false, badges_earned: [], badges_lost: [] },
  }
}

function stored(): FocusSession | null {
  const raw = window.localStorage.getItem(focusStorageKey(USER_ID))
  return raw === null ? null : (JSON.parse(raw) as FocusSession)
}

function open() {
  const opened = openCalendar('/calendar', { blocks: [RUNNING, LATER] })
  opened.fake.on({ method: 'POST', path: /^\/blocks\/[^/]+\/complete$/ }, (call: { path: string }) => {
    const id = call.path.split('/')[2]
    const block = opened.state.blocks.find((b) => b.id === id) ?? RUNNING
    const result = doneResult(block)
    opened.state.blocks = opened.state.blocks.map((b) => (b.id === id ? result.block : b))
    return result
  })
  opened.fake.on({ method: 'POST', path: /^\/blocks\/[^/]+\/uncomplete$/ }, (call: { path: string }) => {
    const id = call.path.split('/')[2]
    const original = [RUNNING, LATER].find((b) => b.id === id) ?? RUNNING
    opened.state.blocks = opened.state.blocks.map((b) => (b.id === id ? original : b))
    return { block: original, task_status: 'todo' }
  })
  return opened
}

function gridBlock(block: Block, range: string, state: string | null) {
  return screen.findByRole('button', {
    name: en.calendar.grid.blockLabel(block.task_title, range, block.exam_name, en.board.kinds.learn, state, false),
  })
}

const runningBlock = () => gridBlock(RUNNING, '11:00–12:00', en.board.states.in_progress)
const laterBlock = () => gridBlock(LATER, '14:00–15:00', null)

async function sheet() {
  return within(await screen.findByRole('dialog', { name: en.calendar.sheets.actions.title }))
}

async function heading(block: Block) {
  return screen.findByRole('heading', { level: 1, name: block.task_title })
}

let user: ReturnType<typeof userEvent.setup>

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(CAL_NOW))
  stubMedia()
  window.localStorage.clear()
  user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('from the calendar into focus and out', () => {
  it('Start now on a block that runs: the screen with the task as the h1 and no top bar', async () => {
    const { router } = open()
    await user.click(await runningBlock())
    await user.click((await sheet()).getByRole('button', { name: en.focus.startLabel(blockName(RUNNING)) }))
    const h1 = await heading(RUNNING)
    expect(router.state.location.pathname).toBe(focusPath(RUNNING.id))
    expect(h1.querySelector('[data-user-text]')).toHaveTextContent(RUNNING.task_title)
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: en.shell.mainNav })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Done on the screen: back to the calendar, one POST, the XP toast with Undo, and the block marked on the grid', async () => {
    const { fake, router } = open()
    await user.click(await runningBlock())
    await user.click((await sheet()).getByRole('button', { name: en.focus.startLabel(blockName(RUNNING)) }))
    await heading(RUNNING)
    await user.click(screen.getByRole('button', { name: en.board.completeLabel(blockName(RUNNING)) }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/calendar')
    })
    const region = within(await screen.findByRole('region', { name: en.common.notifications }))
    expect(await region.findByText(completeText(doneResult(RUNNING), false))).toBeInTheDocument()
    expect(region.getByRole('button', { name: en.common.undo })).toBeInTheDocument()
    expect(fake.calls('POST', `/blocks/${RUNNING.id}/complete`)).toHaveLength(1)
    // The grid shows it done: a done block offers "Mark as not done" in its check.
    expect(await screen.findAllByRole('button', { name: en.board.uncompleteLabel(blockName(RUNNING)) })).not.toHaveLength(0)
    expect(stored()).toBeNull()
  })

  it('Done on the screen flies the XP once, on the calendar it goes back to', async () => {
    // jsdom lays nothing out: every element counts as shown.
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get: () => document.body })
    const animate = vi.fn<(keyframes: Keyframe[], options: KeyframeAnimationOptions) => unknown>(() => ({
      finished: new Promise(() => undefined),
      cancel: vi.fn(),
    }))
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, writable: true, value: animate })
    try {
      stubMedia({ reducedMotion: false })
      open()
      await user.click(await runningBlock())
      await user.click((await sheet()).getByRole('button', { name: en.focus.startLabel(blockName(RUNNING)) }))
      await heading(RUNNING)
      await user.click(screen.getByRole('button', { name: en.board.completeLabel(blockName(RUNNING)) }))
      const chip = await screen.findByText(en.calendar.page.xp(20))
      expect(chip.closest('[aria-hidden="true"]')).not.toBeNull()
      // The flight is the animation of 600 ms; nothing else on these screens takes that long.
      const flights = () => animate.mock.calls.filter(([, options]) => options.duration === 600)
      expect(flights()).toHaveLength(1)
      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(flights()).toHaveLength(1)
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'offsetParent')
      Reflect.deleteProperty(Element.prototype, 'animate')
    }
  })

  it('Just 5 minutes on a block that has not started: five minutes of a small task, then the same session goes on, with no dialog', async () => {
    open()
    await user.click(await laterBlock())
    await user.click((await sheet()).getByRole('button', { name: en.focus.fiveLabel(blockName(LATER)) }))
    await heading(LATER)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(en.focus.fiveTask.learn)
    // The clock runs on a little while the test waits for the screen: a full hour from the start.
    const endsAt = stored()?.endsAt
    expect((endsAt ?? 0) - (stored()?.startedAt ?? 0)).toBe(60 * MINUTE)
    expect(stored()?.fiveEndsAt).toBe((stored()?.startedAt ?? 0) + FIVE_MINUTES_MS)
    for (let left = FIVE_MINUTES_MS; left > 0; left -= MINUTE) {
      act(() => {
        vi.advanceTimersByTime(MINUTE)
      })
    }
    expect(screen.getByRole('status')).toHaveTextContent(en.focus.fiveDone('12:25'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(stored()?.endsAt).toBe(endsAt)
  })

  it('the back arrow leaves, the same block offers Back to focus, and it is the same session', async () => {
    const { router } = open()
    await user.click(await runningBlock())
    await user.click((await sheet()).getByRole('button', { name: en.focus.startLabel(blockName(RUNNING)) }))
    await heading(RUNNING)
    const startedAt = stored()?.startedAt
    expect(startedAt).toBeGreaterThanOrEqual(Date.parse(CAL_NOW))
    expect(startedAt).toBeLessThan(Date.parse(CAL_NOW) + MINUTE)
    await user.click(screen.getByRole('button', { name: en.focus.back }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/calendar')
    })
    // Time passes while the student is away.
    act(() => {
      vi.advanceTimersByTime(3 * MINUTE)
    })
    await user.click(await runningBlock())
    const actions = await sheet()
    expect(actions.queryByRole('button', { name: en.focus.startLabel(blockName(RUNNING)) })).not.toBeInTheDocument()
    expect(actions.queryByRole('button', { name: en.focus.fiveLabel(blockName(RUNNING)) })).not.toBeInTheDocument()
    await user.click(actions.getByRole('button', { name: en.focus.resume }))
    await heading(RUNNING)
    expect(router.state.location.pathname).toBe(focusPath(RUNNING.id))
    expect(stored()?.startedAt).toBe(startedAt)
  })

  it('Undo after Done puts the block back to planned on the server and leaves no session', async () => {
    const { fake, state } = open()
    await user.click(await runningBlock())
    await user.click((await sheet()).getByRole('button', { name: en.focus.startLabel(blockName(RUNNING)) }))
    await heading(RUNNING)
    await user.click(screen.getByRole('button', { name: en.board.completeLabel(blockName(RUNNING)) }))
    const region = within(await screen.findByRole('region', { name: en.common.notifications }))
    await user.click(await region.findByRole('button', { name: en.common.undo }))
    await waitFor(() => {
      expect(fake.calls('POST', `/blocks/${RUNNING.id}/uncomplete`)).toHaveLength(1)
    })
    await waitFor(() => {
      expect(state.blocks.find((b) => b.id === RUNNING.id)?.status).toBe('planned')
    })
    // The grid too: its box offers to mark the block done again.
    expect(await screen.findAllByRole('button', { name: en.board.completeLabel(blockName(RUNNING)) })).not.toHaveLength(0)
    expect(screen.queryByRole('button', { name: en.board.uncompleteLabel(blockName(RUNNING)) })).not.toBeInTheDocument()
    expect(stored()).toBeNull()
    // And the grid offers to start it again.
    await user.click(await runningBlock())
    expect((await sheet()).getByRole('button', { name: en.focus.startLabel(blockName(RUNNING)) })).toBeInTheDocument()
  })
})
