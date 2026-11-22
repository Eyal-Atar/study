import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { blockName } from '../board/blockName'
import type { Block } from '../board/types'
import { en } from '../i18n/en'
import { makeBlock } from '../test/boardFixtures'
import { problem } from '../test/fakeApi'
import { CAL_NOW, CAL_TODAY, makeBusy, openCalendar, stubMedia } from './testFixtures'

// The calendar screen itself (S32 Task 13): the layout of each width, the toolbar, the sheets and
// their ghosts, the XP moment, the break and the scroll. calendarFlow.test.tsx has the behaviour
// moved over from the old today and week screens.

const RANGE = '22–28 November 2026'

// 11:00–12:00 local, in progress at 11:25; 14:00–15:00 local, upcoming; Thursday 10:00–11:00.
const NOW_BLOCK = makeBlock({
  id: 'b-now',
  task_id: 't-now',
  task_title: 'גרפים',
  study_date: CAL_TODAY,
  state: 'in_progress',
  starts_at: '2026-11-24T09:00:00Z',
  ends_at: '2026-11-24T10:00:00Z',
})
const LATER = makeBlock({
  id: 'b-later',
  task_id: 't-later',
  task_title: 'ערימות',
  study_date: CAL_TODAY,
  starts_at: '2026-11-24T12:00:00Z',
  ends_at: '2026-11-24T13:00:00Z',
})
const THURSDAY = makeBlock({
  id: 'b-thu',
  task_id: 't-thu',
  task_title: 'Practice set',
  study_date: '2026-11-26',
  starts_at: '2026-11-26T08:00:00Z',
  ends_at: '2026-11-26T09:00:00Z',
})
const BLOCKS = [NOW_BLOCK, LATER, THURSDAY]

const SLOTS = {
  study_date: CAL_TODAY,
  day_starts_at: '2026-11-24T06:00:00Z',
  day_ends_at: '2026-11-24T21:00:00Z',
  slots: ['2026-11-24T14:00:00Z'],
}

const never = () => new Promise<never>(() => undefined)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function grid(range = RANGE) {
  return screen.getByRole('group', { name: en.calendar.grid.label(range) })
}

function columns() {
  return document.querySelectorAll('[data-date]')
}

function laterBlock() {
  return screen.findByRole('button', {
    name: en.calendar.grid.blockLabel(LATER.task_title, '14:00–15:00', LATER.exam_name, en.board.kinds.learn, null, false),
  })
}

async function toasts() {
  return within(await screen.findByRole('region', { name: en.common.notifications }))
}

async function pickATime(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await laterBlock())
  await user.click(await screen.findByRole('button', { name: en.board.deferLabel(blockName(LATER)) }))
  await user.click(await screen.findByRole('button', { name: en.calendar.sheets.defer.pick }))
  const slots = await screen.findByRole('listbox', { name: en.calendar.sheets.defer.slots })
  await user.click(within(slots).getByRole('option', { name: '16:00' }))
  await waitFor(() => {
    expect(document.querySelector('[data-ghost]')).not.toBeNull()
  })
}

const touch = { pointerId: 7, pointerType: 'touch', button: 0, isPrimary: true }

function swipeAcross(el: HTMLElement, dx: number) {
  fireEvent.pointerDown(el, { ...touch, clientX: 200, clientY: 300 })
  fireEvent.pointerMove(el, { ...touch, clientX: 200 + dx / 2, clientY: 301 })
  fireEvent.pointerMove(el, { ...touch, clientX: 200 + dx, clientY: 301 })
  fireEvent.pointerUp(el, { ...touch, clientX: 200 + dx, clientY: 301 })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(CAL_NOW))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('the calendar on a computer', () => {
  beforeEach(() => {
    stubMedia({ desktop: true })
  })

  it('shows seven columns, the side panel, and the toolbar inside the header of the shell', async () => {
    openCalendar('/calendar', { blocks: BLOCKS })
    await waitFor(() => {
      expect(columns()).toHaveLength(7)
    })
    expect(screen.getByRole('complementary', { name: en.today.title })).toBeInTheDocument()
    const header = within(await screen.findByRole('banner'))
    expect(header.getByRole('button', { name: en.board.today })).toBeInTheDocument()
    const nav = within(header.getByRole('group', { name: en.calendar.page.dateNav }))
    // LTR: back in time points left.
    expect(nav.getByRole('button', { name: en.calendar.page.previousWeek }).querySelector('svg')).toHaveClass('lucide-chevron-left')
    expect(nav.getByRole('button', { name: en.calendar.page.nextWeek }).querySelector('svg')).toHaveClass('lucide-chevron-right')
    const range = header.getByText(RANGE)
    expect(range).toHaveAttribute('aria-live', 'polite')
    expect(range).toHaveClass('tabular-nums')
    expect(header.getByRole('radiogroup', { name: en.calendar.view })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en.calendar.page.heading(RANGE))
  })

  it('?view=day has one column, and the arrows move by a day', async () => {
    const user = userEvent.setup()
    const { router } = openCalendar('/calendar?view=day', { blocks: BLOCKS })
    await waitFor(() => {
      expect(columns()).toHaveLength(1)
    })
    const header = within(await screen.findByRole('banner'))
    expect(header.getByText('Tue, 24 Nov')).toBeInTheDocument()
    await user.click(header.getByRole('button', { name: en.calendar.page.nextDay }))
    await waitFor(() => {
      expect(router.state.location.search).toBe('?view=day&date=2026-11-25')
    })
    await user.click(header.getByRole('button', { name: en.calendar.page.previousDay }))
    await waitFor(() => {
      expect(router.state.location.search).toBe('?view=day&date=2026-11-24')
    })
  })

  it('the switch changes the view, and the focus stays on it', async () => {
    const user = userEvent.setup()
    const { router } = openCalendar('/calendar', { blocks: BLOCKS })
    const header = within(await screen.findByRole('banner'))
    await user.click(await header.findByRole('radio', { name: en.calendar.day }))
    await waitFor(() => {
      expect(router.state.location.search).toBe('?view=day')
    })
    await waitFor(() => {
      expect(columns()).toHaveLength(1)
    })
    expect(header.getByRole('radio', { name: en.calendar.day })).toHaveFocus()
  })

  // From the S31 calendar: the switch is one Tab stop, the arrows move and Space chooses.
  it('the switch works from the keyboard', async () => {
    const user = userEvent.setup()
    const { router } = openCalendar('/calendar', { blocks: BLOCKS })
    const header = within(await screen.findByRole('banner'))
    const week = await header.findByRole('radio', { name: en.calendar.week })
    expect(week).toBeChecked()
    week.focus()
    await user.keyboard('{ArrowLeft} ')
    await waitFor(() => {
      expect(router.state.location.search).toBe('?view=day')
    })
    expect(header.getByRole('radio', { name: en.calendar.day })).toHaveFocus()
    await user.keyboard('{ArrowRight} ')
    await waitFor(() => {
      expect(router.state.location.search).toBe('')
    })
    expect(header.getByRole('radio', { name: en.calendar.week })).toHaveFocus()
  })

  it('scrolls the box to now once, and a refresh of the data does not scroll it again', async () => {
    const scrollTo = vi.fn()
    const { queryClient } = openCalendar('/calendar', { blocks: BLOCKS })
    Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, writable: true, value: scrollTo })
    await waitFor(() => {
      expect(document.querySelector('[data-calendar-scroller]')).not.toBeNull()
    })
    const box = document.querySelector('[data-calendar-scroller]')
    await waitFor(() => {
      expect(scrollTo.mock.contexts.filter((el) => el === box)).toHaveLength(1)
    })
    const nowY = Number(grid().getAttribute('data-now-y'))
    expect(nowY).toBeGreaterThan(0)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: nowY, behavior: 'auto' })
    await act(() => queryClient.refetchQueries())
    expect(scrollTo.mock.contexts.filter((el) => el === box)).toHaveLength(1)
  })

  it('a move to another week closes an open sheet and clears its ghosts (Review Focus 6)', async () => {
    const user = userEvent.setup()
    const { fake, router } = openCalendar('/calendar', { blocks: BLOCKS })
    fake.on({ method: 'GET', path: /^\/blocks\/b-later\/slots/ }, SLOTS)
    await pickATime(user)
    await act(() => router.navigate('/calendar?date=2026-12-01'))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    await act(() => router.navigate('/calendar'))
    await waitFor(() => {
      expect(columns()).toHaveLength(7)
    })
    expect(document.querySelector('[data-ghost]')).toBeNull()
  })

  it('the level ring stays within 0 to 100% while the progress cache holds only the new total', async () => {
    const user = userEvent.setup()
    const { fake } = openCalendar('/calendar', { blocks: BLOCKS })
    await within(await screen.findByRole('banner')).findByRole('link', { name: /level/ })
    await waitFor(() => {
      expect(columns()).toHaveLength(7)
    })
    fake.on('GET /progress', never)
    fake.on(`POST /blocks/${LATER.id}/complete`, {
      block: { ...LATER, status: 'done', state: 'done' },
      task_status: 'done',
      progress: { xp_change: 20, total_xp: 2600, level: 2, level_up: false, badges_earned: [], badges_lost: [] },
    })
    await user.click(within(grid()).getByRole('button', { name: en.board.completeLabel(blockName(LATER)) }))
    await (await toasts()).findByText(`${en.board.completed}. ${en.board.xpGained(20)}`)
    const arc = (await screen.findByRole('banner')).querySelector('[data-part="arc"]')
    expect(arc).toHaveAttribute('stroke-dasharray', '100.0 100')
  })

  it('the outline has one h1 and never skips a level, with the review open', async () => {
    const user = userEvent.setup()
    const past = makeBlock({ id: 'b-past', task_id: 't-past', task_title: 'Yesterday', study_date: '2026-11-23', starts_at: '2026-11-23T08:00:00Z', ends_at: '2026-11-23T09:00:00Z', state: 'overdue' })
    openCalendar('/calendar', { blocks: BLOCKS, review: [past] })
    await user.click(await screen.findByRole('button', { name: en.calendar.side.banner.review }))
    await screen.findByRole('heading', { level: 3, name: past.task_title })
    const levels = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => Number(h.tagName.slice(1)))
    expect(levels.filter((level) => level === 1)).toHaveLength(1)
    expect(levels[0]).toBe(1)
    levels.forEach((level, i) => {
      if (i > 0) expect(level).toBeLessThanOrEqual((levels[i - 1] ?? 1) + 1)
    })
  })

  it('with the review open and nothing left in it, "all done" is said once', async () => {
    const user = userEvent.setup()
    const past = makeBlock({ id: 'b-past', task_id: 't-past', task_title: 'Yesterday', study_date: '2026-11-23', starts_at: '2026-11-23T08:00:00Z', ends_at: '2026-11-23T09:00:00Z', state: 'overdue' })
    const { fake, state } = openCalendar('/calendar', { blocks: BLOCKS, review: [past] })
    fake.on(`POST /blocks/${past.id}/complete`, () => {
      state.review = []
      return { block: { ...past, status: 'done', state: 'done' }, task_status: 'done' }
    })
    await user.click(await screen.findByRole('button', { name: en.calendar.side.banner.review }))
    await user.click(await screen.findByRole('button', { name: en.review.completeLabel(blockName(past)) }))
    await waitFor(() => {
      expect(document.body.textContent).toContain(en.review.allDone)
    })
    expect(document.body.textContent.split(en.review.allDone)).toHaveLength(2)
  })

  it('on a day with nothing to count that is not a rest day, Archi has the line of an open day and counts nothing', async () => {
    const skipped = makeBlock({ ...LATER, status: 'skipped', state: 'skipped' })
    openCalendar('/calendar', { blocks: [skipped] })
    const side = within(await screen.findByRole('complementary', { name: en.today.title }))
    await waitFor(() => {
      expect(en.calendar.archi.openDay.some((line) => side.queryByText(line) !== null)).toBe(true)
    })
    expect(side.queryByText(/\b0 blocks?\b/)).not.toBeInTheDocument()
  })
})

describe('the calendar on a phone', () => {
  it('shows one day, the strip, the tasks bar and one h1, with no side panel', async () => {
    openCalendar('/calendar', { blocks: BLOCKS })
    await waitFor(() => {
      expect(columns()).toHaveLength(1)
    })
    expect(screen.getByRole('group', { name: en.calendar.side.stripLabel })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: new RegExp(en.today.blocks) })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en.board.today)
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('a day of the strip writes ?date=', async () => {
    const user = userEvent.setup()
    const { router } = openCalendar('/calendar', { blocks: BLOCKS })
    const strip = within(await screen.findByRole('group', { name: en.calendar.side.stripLabel }))
    await user.click(strip.getAllByRole('button')[4] as HTMLElement)
    await waitFor(() => {
      expect(router.state.location.search).toBe('?date=2026-11-26')
    })
    expect(await screen.findByRole('heading', { level: 1, name: 'Thursday' })).toBeInTheDocument()
  })

  // S32 final review, I2: the swipe has visible buttons, and the strip's arrows cross the week.
  it('the week buttons of the header write ?date= a week away', async () => {
    const user = userEvent.setup()
    const { router } = openCalendar('/calendar', { blocks: BLOCKS })
    await user.click(await screen.findByRole('button', { name: en.calendar.page.nextWeek }))
    await waitFor(() => {
      expect(router.state.location.search).toBe('?date=2026-12-01')
    })
    await user.click(screen.getByRole('button', { name: en.calendar.page.previousWeek }))
    await user.click(screen.getByRole('button', { name: en.calendar.page.previousWeek }))
    await waitFor(() => {
      expect(router.state.location.search).toBe('?date=2026-11-17')
    })
  })

  it('the arrow key past the last day of the strip selects the next Sunday', async () => {
    const user = userEvent.setup()
    const { router } = openCalendar('/calendar?date=2026-11-28', { blocks: BLOCKS })
    const strip = within(await screen.findByRole('group', { name: en.calendar.side.stripLabel }))
    ;(strip.getAllByRole('button')[6] as HTMLElement).focus()
    await user.keyboard('{ArrowRight}')
    await waitFor(() => {
      expect(router.state.location.search).toBe('?date=2026-11-29')
    })
  })

  it('a sideways swipe across empty space moves a day', async () => {
    const { router } = openCalendar('/calendar', { blocks: BLOCKS })
    await waitFor(() => {
      expect(columns()).toHaveLength(1)
    })
    swipeAcross(columns()[0] as HTMLElement, -80)
    await waitFor(() => {
      expect(router.state.location.search).toBe('?date=2026-11-25')
    })
  })

  it('a press on a block opens its actions, and Defer there replaces them with the defer sheet', async () => {
    const user = userEvent.setup()
    openCalendar('/calendar', { blocks: BLOCKS })
    await user.click(await laterBlock())
    const actions = await screen.findByRole('dialog', { name: en.calendar.sheets.actions.title })
    await user.click(within(actions).getByRole('button', { name: en.board.deferLabel(blockName(LATER)) }))
    expect(await screen.findByRole('dialog', { name: en.calendar.sheets.defer.title })).toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('a time picked in the defer sheet is a ghost on the grid, and Escape takes it away (Review Focus 6)', async () => {
    const user = userEvent.setup()
    const { fake } = openCalendar('/calendar', { blocks: BLOCKS })
    fake.on({ method: 'GET', path: /^\/blocks\/b-later\/slots/ }, SLOTS)
    await pickATime(user)
    // The first Escape may be the list of times' own; the sheet closes on the next at the latest.
    await user.keyboard('{Escape}')
    if (screen.queryByRole('dialog') !== null) await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(document.querySelector('[data-ghost]')).toBeNull()
  })

  it('a commitment opens its sheet, and an event opens the edit of busy time', async () => {
    const user = userEvent.setup()
    const shift = makeBusy({ id: 'shift', title: 'Work', starts_at: '2026-11-24T15:00:00Z', ends_at: '2026-11-24T16:00:00Z' })
    const dentist = makeBusy({ id: 'dentist', source: 'event', kind: null, title: 'Dentist', starts_at: '2026-11-24T17:00:00Z', ends_at: '2026-11-24T18:00:00Z' })
    openCalendar('/calendar', { blocks: BLOCKS, busy: [shift, dentist] })
    await user.click(await screen.findByRole('button', { name: en.calendar.grid.busyLabel('Work', '17:00–18:00') }))
    expect(await screen.findByRole('dialog', { name: 'Work' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: en.calendar.grid.busyLabel('Dentist', '19:00–20:00') }))
    expect(await screen.findByRole('dialog', { name: en.calendar.sheets.busy.titleEdit })).toBeInTheDocument()
  })

  it('a deleted event leaves the grid at once, and comes back on Undo', async () => {
    const user = userEvent.setup()
    const dentist = makeBusy({ id: 'dentist-2', source: 'event', kind: null, title: 'Dentist', starts_at: '2026-11-24T17:00:00Z', ends_at: '2026-11-24T18:00:00Z' })
    openCalendar('/calendar', { blocks: BLOCKS, busy: [dentist] })
    await user.click(await screen.findByRole('button', { name: en.calendar.grid.busyLabel('Dentist', '19:00–20:00') }))
    await user.click(await screen.findByRole('button', { name: en.calendar.sheets.busy.delete }))
    await waitFor(() => {
      expect(document.querySelector('[data-busy-id="dentist-2"]')).toBeNull()
    })
    await user.click(await (await toasts()).findByRole('button', { name: en.common.undo }))
    await waitFor(() => {
      expect(document.querySelector('[data-busy-id="dentist-2"]')).not.toBeNull()
    })
  })

  it('an old answer with no busy time still opens the screen (Review Focus 5)', async () => {
    openCalendar('/calendar', { blocks: BLOCKS, legacy: true })
    await waitFor(() => {
      expect(columns()).toHaveLength(1)
    })
    expect(document.querySelector('[data-busy-id]')).toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('the XP moment', () => {
  const COMPLETE = {
    block: { ...LATER, status: 'done', state: 'done' } as Block,
    task_status: 'done',
    progress: { xp_change: 20, total_xp: 1260, level: 2, level_up: false, badges_earned: [], badges_lost: [] },
  }

  // jsdom lays nothing out: every element counts as shown.
  function stubLayout() {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get: () => document.body })
  }

  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'offsetParent')
    Reflect.deleteProperty(Element.prototype, 'animate')
  })

  it('Done flies a chip of the XP from the box to the level, and the toast says the XP', async () => {
    stubLayout()
    const user = userEvent.setup()
    const finished = deferred<undefined>()
    const animate = vi.fn<(keyframes: Keyframe[], options: KeyframeAnimationOptions) => unknown>(() => ({ finished: finished.promise, cancel: vi.fn() }))
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, writable: true, value: animate })
    const { fake } = openCalendar('/calendar', { blocks: BLOCKS })
    await screen.findAllByRole('link', { name: /level/ })
    fake.on(`POST /blocks/${LATER.id}/complete`, COMPLETE)

    await user.click(within(await screen.findByRole('group', { name: en.calendar.grid.label('Tue, 24 Nov') })).getByRole('button', { name: en.board.completeLabel(blockName(LATER)) }))
    expect(await (await toasts()).findByText('Marked as done. +20 XP')).toBeInTheDocument()
    const chip = await screen.findByText(en.calendar.page.xp(20))
    expect(chip.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(animate).toHaveBeenCalledTimes(1)
    expect(animate.mock.calls[0]?.[1]).toMatchObject({ duration: 600 })

    finished.resolve(undefined)
    await waitFor(() => {
      expect(screen.queryByText(en.calendar.page.xp(20))).not.toBeInTheDocument()
    })
    expect(animate).toHaveBeenCalledTimes(2)
    expect(animate.mock.calls[1]?.[1]).toMatchObject({ duration: 400 })
  })

  it('with reduced motion nothing flies and nothing animates (Review Focus 8)', async () => {
    stubMedia({ reducedMotion: true })
    stubLayout()
    const user = userEvent.setup()
    const animate = vi.fn()
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, writable: true, value: animate })
    const { fake } = openCalendar('/calendar', { blocks: BLOCKS })
    await screen.findAllByRole('link', { name: /level/ })
    fake.on(`POST /blocks/${LATER.id}/complete`, COMPLETE)

    await user.click(within(await screen.findByRole('group', { name: en.calendar.grid.label('Tue, 24 Nov') })).getByRole('button', { name: en.board.completeLabel(blockName(LATER)) }))
    expect(await (await toasts()).findByText('Marked as done. +20 XP')).toBeInTheDocument()
    expect(screen.queryByText(en.calendar.page.xp(20))).not.toBeInTheDocument()
    expect(animate).not.toHaveBeenCalled()
  })
})

describe('the break', () => {
  // 09:00–10:30 and 10:30–11:00 local: two hours in a row that ended 25 minutes before now, and the
  // next block of today at 14:00.
  const RUN = [
    makeBlock({ id: 'b-run-1', task_id: 't-run-1', task_title: 'Run one', study_date: CAL_TODAY, status: 'done', state: 'done', starts_at: '2026-11-24T07:00:00Z', ends_at: '2026-11-24T08:30:00Z' }),
    makeBlock({ id: 'b-run-2', task_id: 't-run-2', task_title: 'Run two', study_date: CAL_TODAY, status: 'done', state: 'done', starts_at: '2026-11-24T08:30:00Z', ends_at: '2026-11-24T09:00:00Z' }),
    LATER,
  ]

  it('after 90 minutes in a row Archi offers the tea once, and not again within 20 minutes', async () => {
    const user = userEvent.setup()
    const first = openCalendar('/calendar', { blocks: RUN })
    expect(await screen.findByText(en.calendar.archi.breakTitle)).toBeInTheDocument()
    expect(screen.getByText(en.calendar.archi.breakBody('14:00'))).toBeInTheDocument()
    expect(screen.getByText(en.calendar.archi.breakTitle).closest('[role="status"]')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: en.calendar.archi.breakClose }))
    expect(screen.queryByText(en.calendar.archi.breakTitle)).not.toBeInTheDocument()
    first.unmount()

    openCalendar('/calendar', { blocks: RUN })
    await waitFor(() => {
      expect(columns()).toHaveLength(1)
    })
    expect(screen.queryByText(en.calendar.archi.breakTitle)).not.toBeInTheDocument()
  })
})

describe('the states of the screen', () => {
  it('a failed GET /today with no data is an error with a retry', async () => {
    const user = userEvent.setup()
    const { state } = openCalendar('/calendar', { today: problem(0, 'network') })
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    state.today = null
    state.blocks = BLOCKS
    await user.click(screen.getByRole('button', { name: en.common.retry }))
    await waitFor(() => {
      expect(columns()).toHaveLength(1)
    })
  })
})
