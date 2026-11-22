import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorMessage } from '../api/client'
import { todayKey } from '../board/api'
import { blockName } from '../board/blockName'
import type { Block } from '../board/types'
import { codeText } from '../i18n/codes'
import { en } from '../i18n/en'
import { makeBlock, USER_ID } from '../test/boardFixtures'
import { problem, type FakeApi } from '../test/fakeApi'
import { CAL_NOW, CAL_TODAY, openCalendar, stubMedia } from './testFixtures'

// The behaviour of the old today and week screens (S14, S18, S19), moved to the calendar that
// replaced them (S32 Task 13). Each test names the old one it came from.

const RANGE = '22–28 November 2026'
const SUNDAY = '2026-11-22'
const SATURDAY = '2026-11-28'

// Jerusalem is UTC+2 in November.
const NOW_BLOCK = makeBlock({ id: 'b-now', task_id: 't-now', task_title: 'עכשיו: מיון', study_date: CAL_TODAY, state: 'in_progress', starts_at: '2026-11-24T09:00:00Z', ends_at: '2026-11-24T10:00:00Z' })
const LATER = makeBlock({ id: 'b-later', task_id: 't-later', task_title: 'אחר כך: ערימות', study_date: CAL_TODAY, starts_at: '2026-11-24T12:00:00Z', ends_at: '2026-11-24T13:00:00Z' })
const LATE = makeBlock({ id: 'b-late', task_id: 't-late', task_title: 'פספסתי: רקורסיה', study_date: CAL_TODAY, state: 'overdue', starts_at: '2026-11-24T06:00:00Z', ends_at: '2026-11-24T07:00:00Z' })
const TOMORROW = makeBlock({ id: 'b-tomorrow', task_id: 't-tomorrow', task_title: 'מחר: גרפים מכוונים', study_date: '2026-11-25', starts_at: '2026-11-25T07:00:00Z', ends_at: '2026-11-25T08:00:00Z' })

const never = () => new Promise<never>(() => undefined)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function columns() {
  return document.querySelectorAll('[data-date]')
}

function column(date: string) {
  const el = document.querySelector<HTMLElement>(`[data-date="${date}"]`)
  if (el === null) throw new Error(`no column for ${date}`)
  return el
}

async function upNext() {
  return within(await screen.findByRole('region', { name: en.today.next }))
}

async function toasts() {
  return within(await screen.findByRole('region', { name: en.common.notifications }))
}

// The ranges asked for. (Before GET /today answers, useCalendarData asks once for /plan with no
// range: a request of Task 4's hook, reported to the manager, and not one of a week.)
function planCalls(fake: FakeApi) {
  return fake.calls('GET', /^\/plan\?/).map((c) => c.path)
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

describe('what to do next (from today.test.tsx)', () => {
  beforeEach(() => {
    stubMedia({ desktop: true })
  })

  // "the next block is the one in progress, before an upcoming one, and never an overdue one"
  it('Up next is the block in progress, before an upcoming one, and never an overdue one', async () => {
    openCalendar('/calendar', { blocks: [LATE, LATER, NOW_BLOCK] })
    const next = await upNext()
    expect(next.getByText(NOW_BLOCK.task_title)).toBeInTheDocument()
    expect(next.queryByText(LATE.task_title)).not.toBeInTheDocument()
    expect(next.queryByText(LATER.task_title)).not.toBeInTheDocument()
  })

  // "with no next block today, takes the first one of the plan, labelled with its day and time"
  it('with nothing left today, Up next is tomorrow’s first block, with its day and time', async () => {
    openCalendar('/calendar', { blocks: [LATE, TOMORROW] })
    const next = await upNext()
    expect(await next.findByText(en.today.nextAt(en.board.tomorrow, '09:00'))).toBeInTheDocument()
    expect(next.getByText(TOMORROW.task_title)).toBeInTheDocument()
  })

  // "complete moves the meter before the server answers, and a failure puts it back"
  it('Done moves the minutes of today before the server answers, and a failure puts them back', async () => {
    const user = userEvent.setup()
    const { fake } = openCalendar('/calendar', { blocks: [NOW_BLOCK, LATER] })
    const answer = deferred<unknown>()
    fake.on(`POST /blocks/${NOW_BLOCK.id}/complete`, () => answer.promise)
    const meter = await screen.findByRole('meter', { name: en.today.progressLabel })
    expect(meter).toHaveAttribute('aria-valuenow', '0')
    await user.click((await upNext()).getByRole('button', { name: en.board.completeLabel(blockName(NOW_BLOCK)) }))
    await waitFor(() => {
      expect(meter).toHaveAttribute('aria-valuenow', '60')
    })
    fake.on('GET /today', never)
    answer.reject(problem(0, 'network'))
    await waitFor(() => {
      expect(meter).toHaveAttribute('aria-valuenow', '0')
    })
  })

  // "complete updates the screen at once, and the undo sends uncomplete"
  it('Done marks the block at once, and Undo sends uncomplete', async () => {
    const user = userEvent.setup()
    const { fake, state } = openCalendar('/calendar', { blocks: [NOW_BLOCK, LATER] })
    const done: Block = { ...NOW_BLOCK, status: 'done', state: 'done' }
    fake.on(`POST /blocks/${NOW_BLOCK.id}/complete`, () => {
      state.blocks = [done, LATER]
      return { block: done, task_status: 'done' }
    })
    fake.on(`POST /blocks/${NOW_BLOCK.id}/uncomplete`, { block: NOW_BLOCK, task_status: 'todo' })
    await user.click((await upNext()).getByRole('button', { name: en.board.completeLabel(blockName(NOW_BLOCK)) }))
    // The next block is now the upcoming one.
    await waitFor(async () => {
      expect((await upNext()).getByText(LATER.task_title)).toBeInTheDocument()
    })
    await user.click(await (await toasts()).findByRole('button', { name: en.common.undo }))
    await waitFor(() => {
      expect(fake.calls('POST', `/blocks/${NOW_BLOCK.id}/uncomplete`)).toHaveLength(1)
    })
  })

  // "defer shows where the task went, and the undo sends POST /plan/undo": Defer is now a question.
  it('Defer on Up next asks when, and Next free spot says where the task went, with an Undo', async () => {
    const user = userEvent.setup()
    const { fake } = openCalendar('/calendar', { blocks: [LATER] })
    const moved = makeBlock({ ...LATER, id: 'b-moved', study_date: '2026-11-25', starts_at: '2026-11-25T07:00:00Z', ends_at: '2026-11-25T08:00:00Z' })
    fake.on(`POST /blocks/${LATER.id}/defer`, { blocks: [moved], version_id: 'v-2' })
    fake.on('POST /plan/undo', { version_id: 'v-2' })
    await user.click((await upNext()).getByRole('button', { name: en.board.deferLabel(blockName(LATER)) }))
    await user.click(await screen.findByRole('button', { name: en.calendar.sheets.defer.next }))
    const region = await toasts()
    expect(await region.findByText(en.board.deferred(en.board.tomorrow, '09:00'))).toBeInTheDocument()
    await user.click(region.getByRole('button', { name: en.common.undo }))
    await waitFor(() => {
      expect(fake.calls('POST', '/plan/undo')).toEqual([{ method: 'POST', path: '/plan/undo', body: { version_id: 'v-2' } }])
    })
  })

  // "a defer that finds no place says why, and the board stays"
  it('a defer that finds no place offers a replan', async () => {
    const user = userEvent.setup()
    const { fake } = openCalendar('/calendar', { blocks: [LATER] })
    fake.on(`POST /blocks/${LATER.id}/defer`, problem(409, 'placement_failed', { reason: 'not_enough_time' }))
    await user.click((await upNext()).getByRole('button', { name: en.board.deferLabel(blockName(LATER)) }))
    await user.click(await screen.findByRole('button', { name: en.calendar.sheets.defer.next }))
    expect(await screen.findByRole('dialog', { name: en.replan.title })).toBeInTheDocument()
  })

  // "shows times in the profile's timezone, not the browser's" and "a block across the switch to
  // winter time shows 00:30–01:30 and two hours" are covered in the grid (TimeGrid.test.tsx) and in
  // NextCard (Sidebar.test.tsx); here, the card of the screen in Jerusalem.
  it('Up next shows the time range in the profile’s timezone', async () => {
    openCalendar('/calendar', { blocks: [LATER] })
    const next = await upNext()
    expect(next.getByText('14:00–15:00')).toBeInTheDocument()
  })

  // "two parts of one task on the same day have buttons with different names"
  it('two parts of one task have buttons with different names', async () => {
    const part1 = makeBlock({ ...LATER, id: 'b-part-1', part_index: 1, part_count: 2 })
    const part2 = makeBlock({ ...LATER, id: 'b-part-2', part_index: 2, part_count: 2, starts_at: '2026-11-24T14:00:00Z', ends_at: '2026-11-24T15:00:00Z' })
    openCalendar('/calendar', { blocks: [part1, part2] })
    const first = en.board.partName(LATER.task_title, en.board.part(1, 2))
    const second = en.board.partName(LATER.task_title, en.board.part(2, 2))
    expect(await screen.findByRole('button', { name: en.board.deferLabel(first) })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: en.board.completeLabel(second) }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: en.board.completeLabel(first) }).length).toBeGreaterThan(0)
  })

  // "pin marks the block pinned and sends PATCH": pin is in the actions sheet of the block.
  it('Lock from the actions of a block sends PATCH', async () => {
    const user = userEvent.setup()
    const { fake, state } = openCalendar('/calendar', { blocks: [LATER] })
    fake.on(`PATCH /blocks/${LATER.id}`, () => {
      state.blocks = [{ ...LATER, pinned: true }]
      return { ...LATER, pinned: true }
    })
    const grid = within(await screen.findByRole('group', { name: en.calendar.grid.label(RANGE) }))
    await user.click(await grid.findByRole('button', { name: en.calendar.grid.blockLabel(LATER.task_title, '14:00–15:00', LATER.exam_name, en.board.kinds.learn, null, false) }))
    await user.click(await screen.findByRole('button', { name: en.board.pinLabel(blockName(LATER)) }))
    await waitFor(() => {
      expect(fake.calls('PATCH', `/blocks/${LATER.id}`)).toEqual([{ method: 'PATCH', path: `/blocks/${LATER.id}`, body: { pinned: true } }])
    })
  })
})

describe('the states of the screen (from today.test.tsx and week.test.tsx)', () => {
  // "while loading, the title is already there and the loading is announced once"
  it('while loading, the h1 is already there and the loading is announced', async () => {
    openCalendar('/calendar', { today: never(), plan: never() })
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(within(screen.getByRole('main')).getByRole('status')).toHaveTextContent(en.common.loading)
    expect(columns()).toHaveLength(0)
  })

  it('on a computer the h1 is there while loading too', async () => {
    stubMedia({ desktop: true })
    openCalendar('/calendar', { today: never(), plan: never() })
    expect(await screen.findByRole('heading', { level: 1, name: en.calendar.page.heading(null) })).toBeInTheDocument()
  })

  // "a network error shows an alert, and the retry works" / "a failed GET /today with no date…"
  it('a failed GET /today shows an alert, and the retry works', async () => {
    const user = userEvent.setup()
    const { state } = openCalendar('/calendar', { today: problem(0, 'network'), blocks: [LATER] })
    expect(await screen.findByRole('alert')).toHaveTextContent(codeText('network'))
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    state.today = null
    await user.click(screen.getByRole('button', { name: en.common.retry }))
    await waitFor(() => {
      expect(columns()).toHaveLength(1)
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  // week.test.tsx: "a network error with no data shows an alert, and retry loads the week"
  it('a failed GET /plan with no data shows an alert, and the retry loads the week', async () => {
    stubMedia({ desktop: true })
    const user = userEvent.setup()
    const failure = problem(0, 'network')
    const { state } = openCalendar('/calendar', { plan: failure, blocks: [LATER] })
    expect(await screen.findByRole('alert')).toHaveTextContent(errorMessage(failure))
    state.plan = null
    await user.click(screen.getByRole('button', { name: en.common.retry }))
    await waitFor(() => {
      expect(columns()).toHaveLength(7)
    })
  })

  // "a failed refresh keeps the data and says it may be stale" (today and week)
  it('a failed refresh keeps the calendar and says it may be out of date', async () => {
    const { state, queryClient } = openCalendar('/calendar', { blocks: [LATER] })
    await waitFor(() => {
      expect(columns()).toHaveLength(1)
    })
    state.today = problem(0, 'network')
    await act(() => queryClient.refetchQueries({ queryKey: todayKey(USER_ID) }))
    expect(await screen.findByText(en.calendar.page.stale)).toBeInTheDocument()
    expect(columns()).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.common.retry })).toBeInTheDocument()
  })

  it('a failed refresh of the week says so too', async () => {
    stubMedia({ desktop: true })
    const { state, queryClient } = openCalendar('/calendar', { blocks: [LATER] })
    await waitFor(() => {
      expect(columns()).toHaveLength(7)
    })
    state.plan = problem(0, 'network')
    await act(() => queryClient.refetchQueries({ queryKey: ['board', USER_ID, 'plan'] }))
    expect(await screen.findByText(en.calendar.page.stale)).toBeInTheDocument()
    expect(columns()).toHaveLength(7)
  })

  // "with nothing on the board at all, says there are no tasks"
  it('an empty calendar says so, with Archi, and links to the exams', async () => {
    openCalendar('/calendar', { blocks: [] })
    expect(await screen.findByText(en.today.noTasks)).toBeInTheDocument()
    expect(screen.getByText(en.today.noTasksHint)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: en.today.toExams })).toHaveAttribute('href', '/exams')
    expect(columns()).toHaveLength(0)
    // The strip stays, with no marks.
    const strip = screen.getByRole('group', { name: en.calendar.side.stripLabel })
    expect(strip.querySelectorAll('[data-dot], [data-streak-leaf]')).toHaveLength(0)
  })

  // "shows the report when the plan has tasks that did not fit" and "scrolls the report into view
  // when the address is /today#report"
  it('#report opens what did not fit, and scrolls to it', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    try {
      openCalendar('/calendar#report', {
        blocks: [LATER],
        unplaced: [{ task_id: 't-x', exam_id: 'exam-1', exam_color_index: 0, title: 'סימולציה מלאה', minutes: 90 }],
      })
      expect(await screen.findByText(en.calendar.side.banner.report(1))).toBeInTheDocument()
      await waitFor(() => {
        expect(document.getElementById('report')).not.toBeNull()
      })
      expect(screen.getByRole('button', { name: en.calendar.side.banner.close })).toHaveAttribute('aria-expanded', 'true')
      await waitFor(() => {
        expect(scroll).toHaveBeenCalled()
      })
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })

  // "keys today by user, under the board"
  it('keys today by user, under the board', async () => {
    const { queryClient } = openCalendar('/calendar', { blocks: [LATER] })
    await waitFor(() => {
      expect(queryClient.getQueryCache().find({ queryKey: ['board', USER_ID, 'today'], exact: true })?.state.data).toBeDefined()
    })
  })

  // "sign out still works from /today"
  it('sign out works from the calendar', async () => {
    const user = userEvent.setup()
    const { router } = openCalendar('/calendar', { blocks: [LATER] })
    await user.click(await screen.findByRole('button', { name: en.shell.profile }))
    await user.click(await screen.findByRole('menuitem', { name: en.shell.signOut }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
  })
})

describe('the week (from week.test.tsx)', () => {
  beforeEach(() => {
    stubMedia({ desktop: true })
  })

  // "asks for the plan of the week of today, Sunday to Saturday"
  it('asks for the plan of the week of today, Sunday to Saturday', async () => {
    const { fake } = openCalendar('/calendar', { blocks: [LATER] })
    await waitFor(() => {
      expect(columns()).toHaveLength(7)
    })
    expect(planCalls(fake)).toContain(`/plan?from=${SUNDAY}&to=${SATURDAY}`)
    expect([...columns()].map((c) => c.getAttribute('data-date'))).toEqual([
      '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28',
    ])
  })

  // "groups blocks by the study_date of the server, not by their times"
  it('a block just after midnight is in the column of its study day', async () => {
    const late = makeBlock({ id: 'b-midnight', task_id: 't-m', task_title: 'סימולציה מאוחרת', study_date: '2026-11-23', starts_at: '2026-11-23T22:30:00Z', ends_at: '2026-11-23T23:30:00Z' })
    openCalendar('/calendar', { blocks: [late, LATER] })
    await waitFor(() => {
      expect(column('2026-11-23').querySelector('[data-block-id="b-midnight"]')).not.toBeNull()
    })
    expect(column('2026-11-24').querySelector('[data-block-id="b-midnight"]')).toBeNull()
  })

  // "?from= on any day shows the week that contains it"
  it('?from= on any day shows the week that contains it', async () => {
    const { fake } = openCalendar('/calendar?view=week&from=2026-12-02', { blocks: [LATER] })
    await waitFor(() => {
      expect(columns()).toHaveLength(7)
    })
    expect(planCalls(fake)).toContain('/plan?from=2026-11-29&to=2026-12-05')
    expect(within(await screen.findByRole('banner')).getByText('29 November–5 December 2026')).toBeInTheDocument()
  })

  // "an invalid ?from= shows the current week" and "a ?from= further than the API accepts…"
  it.each(['2026-02-31', '2099-01-04'])('?from=%s shows the current week', async (from) => {
    const { fake } = openCalendar(`/calendar?from=${from}`, { blocks: [LATER] })
    await waitFor(() => {
      expect(columns()).toHaveLength(7)
    })
    expect(planCalls(fake).every((p) => p === `/plan?from=${SUNDAY}&to=${SATURDAY}`)).toBe(true)
    expect(within(await screen.findByRole('banner')).getByText(RANGE)).toBeInTheDocument()
  })

  // "the next, previous and this-week buttons move the week through ?from=": now ?date=.
  it('Previous week and Next week write ?date=, and Today takes it away', async () => {
    const user = userEvent.setup()
    const { fake, router } = openCalendar('/calendar', { blocks: [LATER] })
    const header = within(await screen.findByRole('banner'))
    await waitFor(() => {
      expect(columns()).toHaveLength(7)
    })
    await user.click(header.getByRole('button', { name: en.calendar.page.nextWeek }))
    await waitFor(() => {
      expect(router.state.location.search).toBe('?date=2026-12-01')
    })
    await waitFor(() => {
      expect(planCalls(fake)).toContain('/plan?from=2026-11-29&to=2026-12-05')
    })
    await user.click(header.getByRole('button', { name: en.calendar.page.previousWeek }))
    await user.click(header.getByRole('button', { name: en.calendar.page.previousWeek }))
    await waitFor(() => {
      expect(router.state.location.search).toBe('?date=2026-11-17')
    })
    await user.click(header.getByRole('button', { name: en.board.today }))
    await waitFor(() => {
      expect(router.state.location.search).toBe('')
    })
    expect(header.getByText(RANGE)).toBeInTheDocument()
  })

  // "the check button updates the week, and today has the block done without waiting for a request"
  it('the check of a block marks it in the week and in today at once', async () => {
    const user = userEvent.setup()
    const { fake, queryClient } = openCalendar('/calendar', { blocks: [LATER] })
    fake.on(`POST /blocks/${LATER.id}/complete`, never)
    const grid = within(await screen.findByRole('group', { name: en.calendar.grid.label(RANGE) }))
    await user.click(await grid.findByRole('button', { name: en.board.completeLabel(blockName(LATER)) }))
    await waitFor(() => {
      expect(queryClient.getQueryData<{ blocks: Block[] }>(todayKey(USER_ID))?.blocks[0]?.status).toBe('done')
    })
    expect(fake.calls('POST', `/blocks/${LATER.id}/complete`)).toHaveLength(1)
  })

  // "shows loading until the week is known"
  it('shows loading until the week is known', async () => {
    openCalendar('/calendar', { plan: never(), blocks: [LATER] })
    await waitFor(() => {
      expect(within(screen.getByRole('main')).getAllByRole('status').length).toBeGreaterThan(0)
    })
    expect(columns()).toHaveLength(0)
  })
})
