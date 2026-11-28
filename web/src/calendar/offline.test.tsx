import { onlineManager, QueryClient } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { meKey } from '../api/me'
import { planKey, todayKey } from '../board/api'
import { blockName } from '../board/blockName'
import { addDays, blockMinutes } from '../board/time'
import type { Block, Plan } from '../board/types'
import { closuresKey } from '../closure/api'
import { tasksKey } from '../exam/api'
import { en } from '../i18n/en'
import { asOf } from '../offline/asOf'
import { restoreSnapshot, SNAPSHOT_KEY, startSnapshot, WRITE_DELAY_MS } from '../offline/snapshot'
import { examsKey } from '../onboarding/api'
import { progressKey } from '../progress/api'
import { makeProgress } from '../progress/testFixtures'
import { makeClosureItem } from '../test/closureFixtures'
import { taskFixture } from '../test/examFixtures'
import { makeBlock, makeMe, makePlan, makeToday, USER_ID } from '../test/boardFixtures'
import type { FakeApi } from '../test/fakeApi'
import { focusStorageKey, type FocusSession } from '../session/focusSession'
import { CAL_NOW, CAL_TODAY, CAL_TZ, makeExam, openCalendar, stubMedia } from './testFixtures'

// The calendar without a network (S38 Task 5): the last calendar the device holds, read only. The
// cache is filled as the device snapshot leaves it, and the network is off before the first render,
// so no query is asked for: everything on screen comes from the cache.

const SUNDAY = '2026-11-22'
const SATURDAY = '2026-11-28'
const NOW = Date.parse(CAL_NOW)

// 11:00–12:00 in Jerusalem: running now (CAL_NOW is 11:25).
const NOW_BLOCK = makeBlock({ id: 'b-now', task_id: 't-now', task_title: 'עכשיו: מיון', study_date: CAL_TODAY, state: 'in_progress', starts_at: '2026-11-24T09:00:00Z', ends_at: '2026-11-24T10:00:00Z' })
// 14:00–15:00 today.
const LATER = makeBlock({ id: 'b-later', task_id: 't-later', task_title: 'אחר כך: ערימות', study_date: CAL_TODAY, starts_at: '2026-11-24T12:00:00Z', ends_at: '2026-11-24T13:00:00Z' })
// Tomorrow, 09:00–10:00.
const TOMORROW = makeBlock({ id: 'b-tomorrow', task_id: 't-tomorrow', task_title: 'מחר: גרפים', study_date: '2026-11-25', starts_at: '2026-11-25T07:00:00Z', ends_at: '2026-11-25T08:00:00Z' })
const BLOCKS = [NOW_BLOCK, LATER, TOMORROW]
const UNPLACED: Plan['unplaced'] = [{ task_id: 't-x', exam_id: 'exam-1', exam_color_index: 0, title: 'סימולציה מלאה', minutes: 90 }]

let opened: FakeApi | null = null

// What the device snapshot holds after a visit to this week: today, the week, the seven days from
// today, the profile, the progress and the exams.
function seed(queryClient: QueryClient, blocks: Block[]) {
  const todayBlocks = blocks.filter((b) => b.study_date === CAL_TODAY)
  queryClient.setQueryData(
    todayKey(USER_ID),
    makeToday(todayBlocks, {
      date: CAL_TODAY,
      planned_minutes: todayBlocks.filter((b) => b.status === 'planned').reduce((sum, b) => sum + blockMinutes(b), 0),
      done_minutes: 0,
      day_starts_at: `${CAL_TODAY}T06:00:00Z`,
      day_ends_at: `${CAL_TODAY}T21:00:00Z`,
    }),
  )
  const inRange = (from: string, to: string) => blocks.filter((b) => b.study_date >= from && b.study_date <= to)
  queryClient.setQueryData(planKey(USER_ID, SUNDAY, SATURDAY), makePlan(inRange(SUNDAY, SATURDAY), { from: SUNDAY, to: SATURDAY, unplaced: UNPLACED }))
  const aheadTo = addDays(CAL_TODAY, 6)
  queryClient.setQueryData(planKey(USER_ID), makePlan(inRange(CAL_TODAY, aheadTo), { from: CAL_TODAY, to: aheadTo, unplaced: UNPLACED }))
  queryClient.setQueryData(meKey(USER_ID), makeMe(CAL_TZ))
  queryClient.setQueryData(progressKey(USER_ID), makeProgress())
  queryClient.setQueryData(examsKey(USER_ID), [makeExam()])
}

// A real device snapshot, written by startSnapshot from a cache that holds `fill`: what comes back
// is what the closed list of saved keys lets through.
function writeSnapshot(fill: (queryClient: QueryClient) => void) {
  const source = new QueryClient()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(new Date(CAL_NOW))
  const stop = startSnapshot(source, () => USER_ID)
  fill(source)
  vi.advanceTimersByTime(WRITE_DELAY_MS)
  stop()
  source.clear()
  vi.useRealTimers()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(CAL_NOW))
}

// The calendar with no network, from the cache alone. The server behind it answers as
// openCalendar's does, for the test that brings the network back. `fromSnapshot`: the cache is the
// device snapshot already written (writeSnapshot), loaded as main.tsx loads it.
function openOffline({ closures = false, fromSnapshot = false }: { closures?: boolean; fromSnapshot?: boolean } = {}) {
  onlineManager.setOnline(false)
  // The snapshot's owner, as main.tsx leaves it after loading the snapshot: AuthProvider keeps the
  // cache for the same user (with no owner it would clear it when the session arrives).
  if (!fromSnapshot) {
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ version: 1, userId: USER_ID, state: { mutations: [], queries: [] } }))
  }
  const result = openCalendar('/calendar', { blocks: BLOCKS, unplaced: UNPLACED })
  act(() => {
    if (fromSnapshot) expect(restoreSnapshot(result.queryClient)).toBe(USER_ID)
    else seed(result.queryClient, BLOCKS)
    if (closures) {
      result.queryClient.setQueryData(closuresKey(USER_ID), { pending: [makeClosureItem({ opens_at: '2026-11-23T17:00:00Z' })], waiting: [] })
    }
  })
  opened = result.fake
  return result
}

function blockEl(block: Block) {
  const el = document.querySelector<HTMLElement>(`[data-block-id="${block.id}"]`)
  if (el === null) throw new Error(`no block ${block.id}`)
  return el
}

function column(date: string) {
  const el = document.querySelector<HTMLElement>(`[data-date="${date}"]`)
  if (el === null) throw new Error(`no column for ${date}`)
  return el
}

function notice() {
  return document.querySelector('[data-offline-notice]')
}

async function upNext() {
  return within(await screen.findByRole('region', { name: en.today.next }))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(CAL_NOW))
  stubMedia({ desktop: true })
})

afterEach(() => {
  // Not one write in the whole file: the calendar does not even try.
  if (opened !== null) {
    expect(opened.calls('POST')).toEqual([])
    expect(opened.calls('PATCH')).toEqual([])
    expect(opened.calls('DELETE')).toEqual([])
  }
  opened = null
  onlineManager.setOnline(true)
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('the calendar without a network', () => {
  it('shows the cached week with its blocks and the one notice, and no banner and no stale note', async () => {
    openOffline()
    expect(await screen.findByText(LATER.task_title, { selector: '[data-block-id] *' })).toBeInTheDocument()
    expect(blockEl(TOMORROW)).toBeInTheDocument()
    expect(notice()).toHaveTextContent(en.offline.notice(asOf(NOW, CAL_TZ) ?? ''))
    expect(document.querySelectorAll('[data-offline-notice]')).toHaveLength(1)
    expect(screen.queryByText(en.calendar.page.stale)).not.toBeInTheDocument()
    expect(document.querySelector('[data-banner-row]')).toBeNull()
    expect(screen.queryByText(en.calendar.side.banner.report(1))).not.toBeInTheDocument()
  })

  it('every write is disabled: the checks on the grid and in the list, Done and Defer, free time and busy time', async () => {
    openOffline()
    await screen.findByText(LATER.task_title, { selector: '[data-block-id] *' })
    expect(within(blockEl(TOMORROW)).getByRole('button', { name: en.board.completeLabel(blockName(TOMORROW)) })).toBeDisabled()
    const next = await upNext()
    expect(next.getByRole('button', { name: en.board.completeLabel(blockName(NOW_BLOCK)) })).toBeDisabled()
    expect(next.getByRole('button', { name: en.board.deferLabel(blockName(NOW_BLOCK)) })).toBeDisabled()
    const side = screen.getByRole('complementary')
    expect(within(side).getByRole('button', { name: en.board.completeLabel(blockName(LATER)) })).toBeDisabled()
    expect(screen.getByRole('button', { name: en.calendar.side.freeTime })).toBeDisabled()
    expect(screen.getByRole('button', { name: en.calendar.side.markBusy })).toBeDisabled()
    // Navigation stays.
    expect(screen.getByRole('button', { name: en.calendar.page.nextWeek })).toBeEnabled()
  })

  it('a press on a block opens its sheet, which says why and has every action disabled', async () => {
    const user = userEvent.setup()
    openOffline()
    await screen.findByText(LATER.task_title, { selector: '[data-block-id] *' })
    await user.click(blockEl(LATER))
    const dialog = within(await screen.findByRole('dialog', { name: en.calendar.sheets.actions.title }))
    expect(dialog.getByText(en.offline.blockOnly)).toBeInTheDocument()
    const name = blockName(LATER)
    for (const label of [en.focus.startLabel(name), en.board.completeLabel(name), en.board.deferLabel(name), en.move.moveLabel(name), en.board.pinLabel(name), en.review.skipLabel(name)]) {
      expect(dialog.getByRole('button', { name: label })).toBeDisabled()
    }
  })

  it('Just 5 minutes is disabled too, and Back to focus of a running session stays', async () => {
    const user = userEvent.setup()
    const live: FocusSession = { v: 1, blockId: NOW_BLOCK.id, startedAt: NOW - 60_000, endsAt: NOW + 30 * 60_000, fiveEndsAt: null }
    window.localStorage.setItem(focusStorageKey(USER_ID), JSON.stringify(live))
    openOffline()
    await screen.findByText(LATER.task_title, { selector: '[data-block-id] *' })
    await user.click(blockEl(NOW_BLOCK))
    const dialog = within(await screen.findByRole('dialog', { name: en.calendar.sheets.actions.title }))
    expect(dialog.getByRole('button', { name: en.focus.resume })).toBeEnabled()
    expect(dialog.getByRole('button', { name: en.board.completeLabel(blockName(NOW_BLOCK)) })).toBeDisabled()
    await user.keyboard('{Escape}')

    window.localStorage.removeItem(focusStorageKey(USER_ID))
    await user.click(blockEl(LATER))
    const later = within(await screen.findByRole('dialog', { name: en.calendar.sheets.actions.title }))
    // LATER is today's next block of an hour: the sheet offers Just 5 minutes for it, disabled.
    expect(later.getByRole('button', { name: en.focus.fiveLabel(blockName(LATER)) })).toBeDisabled()
  })

  it('a block does not move by keyboard, and a press on empty space opens no busy time', async () => {
    const user = userEvent.setup()
    openOffline()
    await screen.findByText(LATER.task_title, { selector: '[data-block-id] *' })
    act(() => {
      blockEl(TOMORROW).focus()
    })
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(document.querySelector('[data-ghost]')).toBeNull()

    const col = column('2026-11-26')
    // A drag past the mouse slop (4px), which online draws a ghost and opens the busy sheet on release.
    fireEvent.pointerDown(col, { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 200 })
    fireEvent.pointerMove(col, { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 260 })
    expect(document.querySelector('[data-ghost]')).toBeNull()
    fireEvent.pointerUp(col, { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 260 })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.querySelector('[data-ghost]')).toBeNull()
  })

  it('a coming exam keeps its progress from the device snapshot', async () => {
    writeSnapshot((queryClient) => {
      seed(queryClient, BLOCKS)
      // One of two tasks of an hour done: 50%.
      queryClient.setQueryData(tasksKey(USER_ID, 'exam-1'), [
        taskFixture({ id: 'task-1', exam_id: 'exam-1', status: 'done' }),
        taskFixture({ id: 'task-2', exam_id: 'exam-1' }),
      ])
    })
    openOffline({ fromSnapshot: true })
    await screen.findByText(LATER.task_title, { selector: '[data-block-id] *' })
    const bar = within(screen.getByRole('complementary')).getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuetext', en.calendar.side.examProgress(50))
  })

  it('a pending closure in the cache does not open its sheet', async () => {
    openOffline({ closures: true })
    await screen.findByText(LATER.task_title, { selector: '[data-block-id] *' })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('the next week, never saved, says so, and does not show this week’s blocks under its header', async () => {
    const user = userEvent.setup()
    openOffline()
    await screen.findByText(LATER.task_title, { selector: '[data-block-id] *' })
    await user.click(screen.getByRole('button', { name: en.calendar.page.nextWeek }))
    expect(await screen.findByText(en.offline.notSaved)).toBeInTheDocument()
    expect(document.querySelector('[data-block-id]')).toBeNull()
  })

  it('with the network back, the notice goes, the banner comes back and the buttons work', async () => {
    openOffline()
    await screen.findByText(LATER.task_title, { selector: '[data-block-id] *' })
    expect(screen.getByRole('button', { name: en.calendar.side.freeTime })).toBeDisabled()
    act(() => {
      onlineManager.setOnline(true)
    })
    await waitFor(() => {
      expect(notice()).toBeNull()
    })
    expect(await screen.findByText(en.calendar.side.banner.report(1))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.calendar.side.freeTime })).toBeEnabled()
    expect(screen.getByRole('button', { name: en.calendar.side.markBusy })).toBeEnabled()
    expect((await upNext()).getByRole('button', { name: en.board.completeLabel(blockName(NOW_BLOCK)) })).toBeEnabled()
    expect(within(blockEl(TOMORROW)).getByRole('button', { name: en.board.completeLabel(blockName(TOMORROW)) })).toBeEnabled()
  })
})

describe('the calendar without a network, on a phone', () => {
  beforeEach(() => {
    stubMedia({ desktop: false })
  })

  it('the notice sits in the sticky block above the header, and the tasks sheet’s checks and buttons are disabled', async () => {
    const user = userEvent.setup()
    openOffline()
    await screen.findByText(LATER.task_title, { selector: '[data-block-id] *' })
    // The page opens scrolled to now: in the sticky block, the notice stays on screen.
    const sticky = document.querySelector('[data-calendar-sticky]')
    expect(sticky).not.toBeNull()
    const box = notice()
    expect(box).not.toBeNull()
    expect(sticky?.contains(box)).toBe(true)
    const header = sticky?.querySelector('header') ?? null
    expect(header).not.toBeNull()
    if (box !== null && header !== null) {
      expect(box.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    await user.click(screen.getByRole('button', { name: new RegExp(en.today.blocks) }))
    const dialog = within(await screen.findByRole('dialog', { name: en.today.blocks }))
    expect(dialog.getByRole('button', { name: en.board.completeLabel(blockName(LATER)) })).toBeDisabled()
    expect(dialog.getByRole('button', { name: en.calendar.side.freeTime })).toBeDisabled()
    expect(dialog.getByRole('button', { name: en.calendar.side.markBusy })).toBeDisabled()
  })

  it('a swipe across the day still goes to the next day (navigation), and a tap makes no busy time', async () => {
    const { router } = openOffline()
    await screen.findByText(LATER.task_title, { selector: '[data-block-id] *' })
    const col = column(CAL_TODAY)
    fireEvent.pointerDown(col, { button: 0, pointerId: 2, pointerType: 'touch', clientX: 20, clientY: 600 })
    fireEvent.pointerUp(col, { button: 0, pointerId: 2, pointerType: 'touch', clientX: 20, clientY: 600 })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.pointerDown(col, { button: 0, pointerId: 3, pointerType: 'touch', clientX: 200, clientY: 600 })
    fireEvent.pointerUp(col, { button: 0, pointerId: 3, pointerType: 'touch', clientX: 50, clientY: 600 })
    await waitFor(() => {
      expect(router.state.location.search).toContain('2026-11-25')
    })
  })
})
