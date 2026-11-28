import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { blockName } from '../board/blockName'
import { completeText } from '../board/progressText'
import type { Block, CompleteResult, Today } from '../board/types'
import { archiMayInterrupt } from '../calendar/archi'
import { CAL_NOW, CAL_TODAY, openCalendar, stubMedia } from '../calendar/testFixtures'
import { en } from '../i18n/en'
import { makeBlock, makeToday, USER_ID } from '../test/boardFixtures'
import { problem } from '../test/fakeApi'
import { focusView, type FocusViewInput } from './focusView'
import { FIVE_MINUTES_MS, focusPath, focusStorageKey, writeSession, type FocusSession } from './focusSession'

// The focus screen (S42 Task 4) through the real routes, the real shell and a fake server. The clock
// is frozen at CAL_NOW (11:25 in Jerusalem) and moves only when a test moves it.

const MINUTE = 60_000
const NOW = Date.parse(CAL_NOW)

// 11:00–12:30 in Jerusalem: running now.
const RUNNING = makeBlock({
  id: 'b-run',
  task_id: 't-run',
  task_title: 'פרק 3: גרפים',
  exam_name: 'אלגוריתמים',
  task_kind: 'learn',
  study_date: CAL_TODAY,
  state: 'in_progress',
  starts_at: '2026-11-24T09:00:00Z',
  ends_at: '2026-11-24T10:30:00Z',
})
// 14:00–15:00: later today.
const LATER = makeBlock({
  id: 'b-later',
  task_id: 't-later',
  task_title: 'אחר כך: ערימות',
  study_date: CAL_TODAY,
  state: 'upcoming',
  starts_at: '2026-11-24T12:00:00Z',
  ends_at: '2026-11-24T13:00:00Z',
})
const RUNNING_ENDS = Date.parse(RUNNING.ends_at)

function fullSession(startedAt = NOW, endsAt = RUNNING_ENDS, blockId = RUNNING.id): FocusSession {
  return { v: 1, blockId, startedAt, endsAt, fiveEndsAt: null }
}

function fiveSession(startedAt = NOW): FocusSession {
  return { v: 1, blockId: RUNNING.id, startedAt, endsAt: RUNNING_ENDS, fiveEndsAt: startedAt + FIVE_MINUTES_MS }
}

function stored(): FocusSession | null {
  const raw = window.localStorage.getItem(focusStorageKey(USER_ID))
  return raw === null ? null : (JSON.parse(raw) as FocusSession)
}

function doneResult(block: Block): CompleteResult {
  const done = { ...block, status: 'done' as const, state: 'done' as const }
  return {
    block: done,
    task_status: 'done',
    progress: { xp_change: 20, total_xp: 120, level: 2, level_up: false, badges_earned: [], badges_lost: [] },
  }
}

function open(blocks: Block[], blockId = RUNNING.id) {
  const opened = openCalendar(focusPath(blockId), { blocks })
  opened.fake.on({ method: 'POST', path: /^\/blocks\/[^/]+\/complete$/ }, (call: { path: string }) => {
    const id = call.path.split('/')[2]
    const block = opened.state.blocks.find((b) => b.id === id) ?? RUNNING
    const result = doneResult(block)
    opened.state.blocks = opened.state.blocks.map((b) => (b.id === id ? result.block : b))
    return result
  })
  return opened
}

// The statuses of the screen itself. The shell has one more, outside main: the offline announcer (S38).
function inMain() {
  return within(screen.getByRole('main'))
}

async function heading() {
  return screen.findByRole('heading', { level: 1, name: RUNNING.task_title })
}

function ringCentre() {
  const meter = screen.getByRole('meter', { name: en.focus.timerLabel })
  return within(meter.parentElement as HTMLElement)
}

// The arrow has the same name as the button with the words; this is the one with the words.
function backButton() {
  const button = screen.getAllByRole('button', { name: en.focus.back }).find((b) => b.textContent === en.focus.back)
  if (button === undefined) throw new Error('no Back to the calendar button with words')
  return button
}

function isPrimary(button: HTMLElement) {
  return button.className.split(/\s+/).includes('bg-brand')
}

// A minute per act: the clock sets its next timeout when React renders the new minute, as the
// browser would between two timeouts.
function advance(ms: number) {
  for (let left = ms; left > 0; left -= MINUTE) {
    act(() => {
      vi.advanceTimersByTime(Math.min(MINUTE, left))
    })
  }
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

describe('FocusPage, a block in focus', () => {
  it('a saved full session: the task’s name is the h1, the timer is a meter in words, and the frame is bare', async () => {
    writeSession(USER_ID, fullSession())
    open([RUNNING, LATER])
    const h1 = await heading()
    expect(h1.querySelector('[data-user-text]')).toHaveTextContent(RUNNING.task_title)
    const meter = await screen.findByRole('meter', { name: en.focus.timerLabel })
    // 11:25 to 12:30: 65 minutes.
    expect(meter).toHaveAttribute('aria-valuetext', en.focus.valueText(65, '12:30'))
    expect(ringCentre().getByText('65')).toBeInTheDocument()
    expect(ringCentre().getByText(en.focus.unit(65))).toBeInTheDocument()
    expect(screen.getByText(en.focus.until('12:30'))).toBeInTheDocument()
    expect(screen.getByText(en.focus.meta(RUNNING.exam_name, en.board.kinds.learn))).toBeInTheDocument()
    expect(inMain().getByRole('status')).toHaveTextContent(/./)
    expect(en.focus.running).toContain(inMain().getAllByRole('status')[0]?.textContent)
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: en.shell.mainNav })).not.toBeInTheDocument()
    // Done is there but not the primary action while the block runs; one primary at most.
    const done = screen.getByRole('button', { name: en.board.completeLabel(blockName(RUNNING)) })
    expect(isPrimary(done)).toBe(false)
    expect(screen.getAllByRole('button').filter(isPrimary)).toHaveLength(0)
  })

  it('the h1 takes the focus after a navigation to the screen', async () => {
    writeSession(USER_ID, fullSession())
    const { router } = open([RUNNING, LATER])
    await act(async () => {
      await router.navigate('/calendar')
    })
    await screen.findByRole('navigation', { name: en.shell.mainNav })
    await act(async () => {
      await router.navigate(focusPath(RUNNING.id))
    })
    const h1 = await heading()
    await waitFor(() => {
      expect(h1).toHaveFocus()
    })
  })

  it('"Just 5 minutes" counts the five, then goes on into the block with no dialog and no new button', async () => {
    writeSession(USER_ID, fiveSession())
    open([RUNNING, LATER])
    await heading()
    const status = inMain().getByRole('status')
    expect(status).toHaveTextContent(en.focus.fiveTask.learn)
    expect(ringCentre().getByText('5')).toBeInTheDocument()
    expect(ringCentre().getByText(en.focus.ofFive)).toBeInTheDocument()
    const meter = screen.getByRole('meter', { name: en.focus.timerLabel })
    const before = Number(meter.getAttribute('aria-valuenow'))
    const buttons = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)

    advance(FIVE_MINUTES_MS)
    expect(status).toHaveTextContent(en.focus.fiveDone('12:30'))
    // The same element: the live region speaks once, and the ring did not jump back.
    expect(inMain().getByRole('status')).toBe(status)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(buttons)
    expect(Number(meter.getAttribute('aria-valuenow'))).toBeGreaterThan(before)
    // 11:30 to 12:30.
    expect(ringCentre().getByText('60')).toBeInTheDocument()
    expect(stored()?.endsAt).toBe(RUNNING_ENDS)
  })

  it('a refresh in the middle comes back to the same phase and number; after the end, to Done', async () => {
    writeSession(USER_ID, fiveSession())
    const first = open([RUNNING, LATER])
    await heading()
    first.unmount()

    vi.setSystemTime(NOW + 3 * MINUTE)
    const second = open([RUNNING, LATER])
    await heading()
    expect(ringCentre().getByText('2')).toBeInTheDocument()
    expect(ringCentre().getByText(en.focus.ofFive)).toBeInTheDocument()
    expect(inMain().getByRole('status')).toHaveTextContent(en.focus.fiveTask.learn)
    second.unmount()

    vi.setSystemTime(RUNNING_ENDS + MINUTE)
    open([RUNNING, LATER])
    await heading()
    expect(inMain().getByRole('status')).toHaveTextContent(en.focus.over)
    const done = screen.getByRole('button', { name: en.board.completeLabel(blockName(RUNNING)) })
    expect(isPrimary(done)).toBe(true)
    expect(screen.getAllByRole('button').filter(isPrimary)).toHaveLength(1)
    // Not a new session: the old one is still there.
    expect(stored()?.startedAt).toBe(NOW)
  })
})

describe('FocusPage, Done', () => {
  it('without a break: one POST even for two presses, back to the calendar with the XP toast and Undo', async () => {
    writeSession(USER_ID, fullSession())
    const { fake, router } = open([RUNNING, LATER])
    await heading()
    const done = screen.getByRole('button', { name: en.board.completeLabel(blockName(RUNNING)) })
    await user.dblClick(done)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/calendar')
    })
    expect(router.state.historyAction).toBe('REPLACE')
    const region = within(await screen.findByRole('region', { name: en.common.notifications }))
    expect(await region.findByText(completeText(doneResult(RUNNING), false))).toBeInTheDocument()
    expect(region.getByRole('button', { name: en.common.undo })).toBeInTheDocument()
    expect(fake.calls('POST', `/blocks/${RUNNING.id}/complete`)).toHaveLength(1)
    expect(stored()).toBeNull()
  })

  it('with a break: the screen stays for the tea, shows the next block, and the calendar will not say it again', async () => {
    // Two done blocks of 45 minutes, 09:30–11:00, and the focus from 11:05 to now (11:25).
    const a = makeBlock({ id: 'b-a', task_id: 't-a', study_date: CAL_TODAY, status: 'done', state: 'done', starts_at: '2026-11-24T07:30:00Z', ends_at: '2026-11-24T08:15:00Z' })
    const b = makeBlock({ id: 'b-b', task_id: 't-b', study_date: CAL_TODAY, status: 'done', state: 'done', starts_at: '2026-11-24T08:15:00Z', ends_at: '2026-11-24T09:00:00Z' })
    writeSession(USER_ID, fullSession(NOW - 20 * MINUTE))
    const { fake, router } = open([a, b, RUNNING, LATER])
    await heading()
    await user.click(screen.getByRole('button', { name: en.board.completeLabel(blockName(RUNNING)) }))
    const status = await inMain().findByRole('status')
    await waitFor(() => {
      expect(status).toHaveTextContent(en.calendar.archi.breakTitle)
    })
    expect(screen.getByText(en.calendar.archi.breakBody('14:00'))).toBeInTheDocument()
    expect(screen.getByText(LATER.task_title)).toBeInTheDocument()
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
    const back = backButton()
    const primaries = screen.getAllByRole('button').filter(isPrimary)
    expect(primaries).toHaveLength(1)
    expect(primaries[0]?.textContent).toBe(en.focus.back)
    expect(back).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(focusPath(RUNNING.id))
    // Noted once the server said yes.
    await waitFor(() => {
      expect(archiMayInterrupt(Date.now())).toBe(false)
    })
    // The server's answer and the refetch make the block done: the screen still shows its own break.
    await waitFor(() => {
      expect(fake.calls('GET', '/today').length).toBeGreaterThan(1)
    })
    expect(screen.queryByText(en.focus.alreadyDone)).not.toBeInTheDocument()
    expect(status).toHaveTextContent(en.calendar.archi.breakTitle)
    expect(stored()).toBeNull()

    await user.click(primaries[0] as HTMLElement)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/calendar')
    })
  })
})

// Two done blocks of 45 minutes, 09:30–11:00: with a focus from 11:05 to now (11:25), Done earns a break.
const DONE_A = makeBlock({ id: 'b-a', task_id: 't-a', study_date: CAL_TODAY, status: 'done', state: 'done', starts_at: '2026-11-24T07:30:00Z', ends_at: '2026-11-24T08:15:00Z' })
const DONE_B = makeBlock({ id: 'b-b', task_id: 't-b', study_date: CAL_TODAY, status: 'done', state: 'done', starts_at: '2026-11-24T08:15:00Z', ends_at: '2026-11-24T09:00:00Z' })

describe('FocusPage, the break and the arrow', () => {
  it('leaving the break more than 20 minutes later: the calendar does not pour the tea again', async () => {
    writeSession(USER_ID, fullSession(NOW - 20 * MINUTE))
    const { router } = open([DONE_A, DONE_B, RUNNING, LATER])
    await heading()
    await user.click(screen.getByRole('button', { name: en.board.completeLabel(blockName(RUNNING)) }))
    await waitFor(() => {
      expect(inMain().getByRole('status')).toHaveTextContent(en.calendar.archi.breakTitle)
    })
    await waitFor(() => {
      expect(archiMayInterrupt(Date.now())).toBe(false)
    })
    // Past the block's planned end (12:30), where the calendar would see the run as just over.
    vi.setSystemTime(RUNNING_ENDS + 5 * MINUTE)
    await user.click(backButton())
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/calendar')
    })
    await screen.findByRole('navigation', { name: en.shell.mainNav })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.queryByText(en.calendar.archi.breakTitle)).not.toBeInTheDocument()
  })

  it('when the time is over, the arrow ends the session too, like the button of the same name', async () => {
    writeSession(USER_ID, fullSession(NOW - 30 * MINUTE, NOW - MINUTE))
    const { router } = open([RUNNING])
    await heading()
    const arrow = screen.getAllByRole('button', { name: en.focus.back }).find((b) => b.textContent !== en.focus.back)
    await user.click(arrow as HTMLElement)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/calendar')
    })
    expect(stored()).toBeNull()
  })

  it('the h1 is described by Archi’s line, so a screen reader hears the tiny task on the way in', async () => {
    writeSession(USER_ID, fiveSession())
    open([RUNNING, LATER])
    const h1 = await heading()
    expect(h1).toHaveAccessibleDescription(en.focus.fiveTask.learn)
  })
})

describe('FocusPage, a Done that fails', () => {
  function failing(blocks: Block[]) {
    const opened = open(blocks)
    opened.fake.on({ method: 'POST', path: /^\/blocks\/[^/]+\/complete$/ }, problem(500, 'internal'))
    return opened
  }

  it('without a break: the session comes back, with the same start, and the block stays planned', async () => {
    writeSession(USER_ID, fullSession(NOW - 5 * MINUTE))
    const { fake, router } = failing([RUNNING, LATER])
    await heading()
    await user.click(screen.getByRole('button', { name: en.board.completeLabel(blockName(RUNNING)) }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/calendar')
    })
    await waitFor(() => {
      expect(fake.calls('POST', `/blocks/${RUNNING.id}/complete`)).toHaveLength(1)
    })
    await waitFor(() => {
      expect(stored()?.startedAt).toBe(NOW - 5 * MINUTE)
    })
    expect(stored()?.blockId).toBe(RUNNING.id)
  })

  it('with a break: the screen goes back to the timer and the calendar may still speak', async () => {
    writeSession(USER_ID, fullSession(NOW - 20 * MINUTE))
    const { router } = failing([DONE_A, DONE_B, RUNNING, LATER])
    await heading()
    await user.click(screen.getByRole('button', { name: en.board.completeLabel(blockName(RUNNING)) }))
    expect(await screen.findByRole('meter', { name: en.focus.timerLabel })).toBeInTheDocument()
    await waitFor(() => {
      expect(stored()?.startedAt).toBe(NOW - 20 * MINUTE)
    })
    expect(en.focus.running).toContain(inMain().getByRole('status').textContent)
    expect(screen.getByRole('button', { name: en.board.completeLabel(blockName(RUNNING)) })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(focusPath(RUNNING.id))
    expect(archiMayInterrupt(Date.now())).toBe(true)
  })
})

describe('FocusPage, the focus between views', () => {
  it('Done keeps the focus when the time runs out', async () => {
    writeSession(USER_ID, fullSession(NOW - 10 * MINUTE, NOW + 2 * MINUTE))
    open([RUNNING, LATER])
    await heading()
    const done = screen.getByRole('button', { name: en.board.completeLabel(blockName(RUNNING)) })
    act(() => {
      done.focus()
    })
    expect(done).toHaveFocus()
    advance(2 * MINUTE)
    await screen.findByText(en.focus.over)
    expect(isPrimary(screen.getByRole('button', { name: en.board.completeLabel(blockName(RUNNING)) }))).toBe(true)
    expect(document.activeElement).toBe(done)
  })

  it('after a Done that brings the break, the focus is on the h1', async () => {
    writeSession(USER_ID, fullSession(NOW - 20 * MINUTE))
    open([DONE_A, DONE_B, RUNNING, LATER])
    const h1 = await heading()
    await user.click(screen.getByRole('button', { name: en.board.completeLabel(blockName(RUNNING)) }))
    await waitFor(() => {
      expect(inMain().getByRole('status')).toHaveTextContent(en.calendar.archi.breakTitle)
    })
    await waitFor(() => {
      expect(document.activeElement).toBe(h1)
    })
  })
})

describe('FocusPage, a block that cannot be focused', () => {
  it('a block that is not on today’s calendar: gone, and the session goes', async () => {
    writeSession(USER_ID, fullSession())
    open([LATER])
    expect(await screen.findByText(en.focus.gone)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: en.focus.title })).toBeInTheDocument()
    expect(isPrimary(backButton())).toBe(true)
    await waitFor(() => {
      expect(stored()).toBeNull()
    })
  })

  it('a block already done: says so, and the session goes', async () => {
    writeSession(USER_ID, fullSession())
    open([{ ...RUNNING, status: 'done', state: 'done' }])
    await heading()
    expect(inMain().getByRole('status')).toHaveTextContent(en.focus.alreadyDone)
    expect(isPrimary(backButton())).toBe(true)
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(stored()).toBeNull()
    })
  })

  it('a planned block that ended, with no session: Done is the primary action, Back the secondary', async () => {
    const ended = { ...RUNNING, state: 'overdue' as const, starts_at: '2026-11-24T06:00:00Z', ends_at: '2026-11-24T07:00:00Z' }
    const { fake } = open([ended])
    await heading()
    expect(inMain().getByRole('status')).toHaveTextContent(en.focus.ended)
    const done = screen.getByRole('button', { name: en.board.completeLabel(blockName(ended)) })
    expect(isPrimary(done)).toBe(true)
    expect(isPrimary(backButton())).toBe(false)
    expect(stored()).toBeNull()
    await user.click(done)
    await waitFor(() => {
      expect(fake.calls('POST', `/blocks/${ended.id}/complete`)).toHaveLength(1)
    })
  })

  it('a block of tomorrow, with no session: not today, and nothing is started', async () => {
    const tomorrow = { ...LATER, id: 'b-tomorrow', study_date: '2026-11-25', starts_at: '2026-11-25T07:00:00Z', ends_at: '2026-11-25T08:00:00Z' }
    const { fake } = open([tomorrow], tomorrow.id)
    // A block of another study day in GET /today (the server's day turned while the screen was open).
    fake.on('GET /today', makeToday([tomorrow], { date: CAL_TODAY }))
    await screen.findByRole('heading', { level: 1, name: tomorrow.task_title })
    expect(inMain().getByRole('status')).toHaveTextContent(en.focus.notToday)
    expect(isPrimary(backButton())).toBe(true)
    expect(stored()).toBeNull()
  })

  it('GET /today failing shows the error with a way to try again', async () => {
    const { state } = open([RUNNING])
    state.today = problem(500, 'internal')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.common.retry })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.focus.back })).toBeInTheDocument()
  })
})

describe('FocusPage, starting from the address alone', () => {
  it('a block that runs, with no saved session: one full session is written, to the block’s end', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    open([RUNNING, LATER])
    await heading()
    await screen.findByRole('meter', { name: en.focus.timerLabel })
    const writes = setItem.mock.calls.filter(([key]) => key === focusStorageKey(USER_ID))
    expect(writes).toHaveLength(1)
    const session = stored()
    expect(session?.blockId).toBe(RUNNING.id)
    expect(session?.endsAt).toBe(RUNNING_ENDS)
    expect(session?.fiveEndsAt).toBeNull()
    expect(ringCentre().getByText('65')).toBeInTheDocument()
  })

  it('a block that has not started: the session is the block’s length from now, and the block does not move', async () => {
    open([RUNNING, LATER], LATER.id)
    await screen.findByRole('heading', { level: 1, name: LATER.task_title })
    await screen.findByRole('meter', { name: en.focus.timerLabel })
    const session = stored()
    expect(session?.blockId).toBe(LATER.id)
    expect((session?.endsAt ?? 0) - (session?.startedAt ?? 0)).toBe(60 * MINUTE)
  })
})

describe('FocusPage, leaving', () => {
  it('Stop for now clears the session, says so, and goes back with no POST', async () => {
    writeSession(USER_ID, fullSession())
    const { fake, router } = open([RUNNING, LATER])
    await heading()
    await user.click(screen.getByRole('button', { name: en.focus.stop }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/calendar')
    })
    expect(await screen.findByText(en.focus.stopped)).toBeInTheDocument()
    expect(stored()).toBeNull()
    expect(fake.calls('POST')).toHaveLength(0)
  })

  it('the arrow goes back to the calendar and the session keeps running', async () => {
    writeSession(USER_ID, fullSession())
    const { router } = open([RUNNING, LATER])
    await heading()
    await user.click(screen.getByRole('button', { name: en.focus.back }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/calendar')
    })
    expect(stored()?.blockId).toBe(RUNNING.id)
  })

  it('when the time is over, Back to the calendar ends the session', async () => {
    writeSession(USER_ID, fullSession(NOW - 30 * MINUTE, NOW - MINUTE))
    const { router } = open([RUNNING])
    await heading()
    // The quiet button under Done, not the arrow.
    await user.click(backButton())
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/calendar')
    })
    expect(stored()).toBeNull()
  })
})

describe('FocusPage, quiet', () => {
  it('with reduced motion nothing on the screen animates', async () => {
    stubMedia({ reducedMotion: true })
    const animate = vi.fn()
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, writable: true, value: animate })
    writeSession(USER_ID, fiveSession())
    open([RUNNING, LATER])
    await heading()
    advance(FIVE_MINUTES_MS)
    expect(animate).not.toHaveBeenCalled()
  })

  it('keeps the screen on while the block runs, and lets it go when the time is over', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    const release = vi.fn(() => Promise.resolve())
    const sentinel = { released: false, release }
    const request = vi.fn(() => Promise.resolve(sentinel))
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
    try {
      writeSession(USER_ID, fullSession(NOW - 10 * MINUTE, NOW + 2 * MINUTE))
      open([RUNNING, LATER])
      await heading()
      await waitFor(() => {
        expect(request).toHaveBeenCalledWith('screen')
      })
      advance(2 * MINUTE)
      await screen.findByText(en.focus.over)
      expect(release).toHaveBeenCalled()
    } finally {
      delete (navigator as { wakeLock?: unknown }).wakeLock
      delete (document as { visibilityState?: unknown }).visibilityState
    }
  })
})

describe('focusView', () => {
  const today: Today = makeToday([RUNNING, LATER], { date: CAL_TODAY })
  const base: FocusViewInput = {
    finished: null,
    today: { isPending: false, isError: false, data: today },
    blockId: RUNNING.id,
    session: null,
    now: NOW,
  }
  const withBlock = (block: Block): FocusViewInput => ({ ...base, today: { ...base.today, data: makeToday([block], { date: CAL_TODAY }) } })

  it.each<[string, FocusViewInput, ReturnType<typeof focusView>]>([
    ['our own Done with a break comes first, whatever the cache says', { ...withBlock({ ...RUNNING, status: 'done' }), finished: 'break' }, 'break'],
    ['our own Done without a break is on its way out', { ...base, finished: 'leaving' }, 'leaving'],
    ['loading', { ...base, today: { isPending: true, isError: false, data: undefined } }, 'loading'],
    ['an error', { ...base, today: { isPending: false, isError: true, data: undefined } }, 'error'],
    ['not in today', { ...base, blockId: 'nope', session: fullSession(NOW, RUNNING_ENDS, 'nope') }, 'gone'],
    ['skipped', withBlock({ ...RUNNING, status: 'skipped' }), 'gone'],
    ['done, even with a session', { ...withBlock({ ...RUNNING, status: 'done' }), session: fullSession() }, 'alreadyDone'],
    ['a five session in its five', { ...base, session: fiveSession() }, 'five'],
    ['a five session after its five', { ...base, session: fiveSession(NOW - 6 * MINUTE) }, 'full'],
    ['a full session', { ...base, session: fullSession() }, 'full'],
    ['a session that is over', { ...base, session: fullSession(NOW - 30 * MINUTE, NOW - MINUTE) }, 'over'],
    ['no session, a block that can start', base, 'full'],
    ['a session of another block does not count', { ...base, blockId: LATER.id, session: fullSession() }, 'full'],
    ['no session, a planned block that ended', { ...base, now: RUNNING_ENDS + MINUTE }, 'ended'],
    ['no session, a block of another day', withBlock({ ...RUNNING, study_date: '2026-11-25' }), 'notToday'],
  ])('%s', (_name, input, view) => {
    expect(focusView(input)).toBe(view)
  })
})
