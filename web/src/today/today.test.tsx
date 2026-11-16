import { QueryClient } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { codeText, unscheduledText } from '../i18n/codes'
import { he } from '../i18n/he'
import { todayKey } from '../board/api'
import { dayLabel, formatDay } from '../board/time'
import type { Block, Plan, Today } from '../board/types'
import { EXAMS, makeBlock, makeMe, makePlan, makePreview, makeToday, USER_ID } from '../test/boardFixtures'
import { createFakeApi, problem } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'

// The today screen through the real routes, with a fake server whose answers follow `state`.
function setup({
  today = makeToday(),
  plan = makePlan([]),
  timezone = 'Asia/Jerusalem',
  path = '/today',
}: { today?: Today | Error; plan?: Plan; timezone?: string; path?: string } = {}) {
  const state = { today, plan }
  const fake = createFakeApi()
    .on('GET /me', makeMe(timezone))
    .on('GET /today', () => state.today)
    .on({ method: 'GET', path: /^\/plan/ }, () => state.plan)
    .on('GET /exams', EXAMS)
    .on('POST /plan/replan', makePreview())
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const auth = createFakeAuth(fakeSession({ id: USER_ID }))
  const rendered = renderRoute(path, { auth, api: fake.api, queryClient })
  return { fake, state, auth, queryClient, ...rendered }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function region(name: string) {
  return within(await screen.findByRole('region', { name }))
}

async function toasts() {
  return within(await screen.findByRole('region', { name: he.common.notifications }))
}

function card(title: string) {
  return screen.getByRole('article', { name: title })
}

const NOW = makeBlock({
  id: 'b-now',
  task_id: 't-now',
  task_title: 'עכשיו: מיון',
  state: 'in_progress',
  starts_at: '2026-11-16T10:00:00Z',
  ends_at: '2026-11-16T11:00:00Z',
})
const LATER = makeBlock({
  id: 'b-later',
  task_id: 't-later',
  task_title: 'אחר כך: ערימות',
  starts_at: '2026-11-16T08:00:00Z',
  ends_at: '2026-11-16T09:00:00Z',
})
const LATE = makeBlock({
  id: 'b-late',
  task_id: 't-late',
  task_title: 'פספסתי: רקורסיה',
  state: 'overdue',
  starts_at: '2026-11-16T06:00:00Z',
  ends_at: '2026-11-16T07:00:00Z',
})
const DONE = makeBlock({
  id: 'b-done',
  task_id: 't-done',
  task_title: 'בוצע: מבוא',
  status: 'done',
  state: 'done',
  starts_at: '2026-11-16T05:00:00Z',
  ends_at: '2026-11-16T06:00:00Z',
})
const TOMORROW = makeBlock({
  id: 'b-tomorrow',
  task_id: 't-tomorrow',
  task_title: 'מחר: גרפים מכוונים',
  study_date: '2026-11-17',
  starts_at: '2026-11-17T07:00:00Z',
  ends_at: '2026-11-17T08:00:00Z',
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the today screen', () => {
  it('shows the title, the day and the progress in minutes', async () => {
    setup({ today: makeToday([makeBlock()], { planned_minutes: 120, done_minutes: 60 }) })

    expect(await screen.findByRole('heading', { level: 1, name: he.today.title })).toBeInTheDocument()
    expect(await screen.findByText(formatDay('2026-11-16'))).toBeInTheDocument()
    expect(screen.getByText('60 מתוך 180 דקות')).toBeInTheDocument()
    const meter = screen.getByRole('meter', { name: he.today.progressLabel })
    expect(meter).toHaveAttribute('aria-valuenow', '60')
    expect(meter).toHaveAttribute('aria-valuemax', '180')
  })

  it('the next block is the one in progress, before an upcoming one, and never an overdue one', async () => {
    setup({ today: makeToday([LATE, LATER, NOW]) })

    const next = await region(he.today.next)
    expect(next.getByRole('article', { name: NOW.task_title })).toBeInTheDocument()
    expect(next.getByText(he.board.states.in_progress)).toBeInTheDocument()
    expect(next.queryByRole('article', { name: LATE.task_title })).not.toBeInTheDocument()
  })

  it("lists today's other blocks in order, with their states", async () => {
    setup({ today: makeToday([NOW, LATE, DONE, LATER]) })

    const list = await region(he.today.moreBlocks)
    const titles = list.getAllByRole('article').map((a) => a.getAttribute('aria-labelledby'))
    // The next block (in progress) is in its own card, so the list has the others, by start time.
    expect(titles).toEqual([`block-${DONE.id}-title`, `block-${LATE.id}-title`, `block-${LATER.id}-title`])
    expect(within(card(LATE.task_title)).getByText(he.board.states.overdue)).toBeInTheDocument()
    expect(within(card(DONE.task_title)).getByText(he.board.states.done)).toBeInTheDocument()
    // An overdue block can only be marked done (decision 2).
    expect(within(card(LATE.task_title)).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      he.board.completeLabel(LATE.task_title),
    ])
  })

  it('with no next block today, takes the first one of the plan, labelled with its day and time', async () => {
    const { fake } = setup({ today: makeToday([LATE]), plan: makePlan([LATE, TOMORROW]) })

    const next = await region(he.today.next)
    expect(await next.findByText(he.today.nextAt(he.board.tomorrow, '09:00'))).toBeInTheDocument()
    expect(next.getByRole('article', { name: TOMORROW.task_title })).toBeInTheDocument()
    // GET /plan without a range: the server's seven days from today.
    expect(fake.calls('GET', '/plan').length).toBeGreaterThan(0)
    // The overdue block stays in the list of today.
    expect((await region(he.today.blocks)).getByRole('article', { name: LATE.task_title })).toBeInTheDocument()
  })

  it('an empty day with a block tomorrow says so and shows the block', async () => {
    setup({ today: makeToday([], { planned_minutes: 0 }), plan: makePlan([TOMORROW]) })

    expect(await screen.findByText(he.today.noBlocksToday)).toBeInTheDocument()
    const next = await region(he.today.next)
    expect(await next.findByRole('article', { name: TOMORROW.task_title })).toBeInTheDocument()
    expect(next.getByText(he.today.nextAt(he.board.tomorrow, '09:00'))).toBeInTheDocument()
    expect(screen.queryByText(he.today.noTasks)).not.toBeInTheDocument()
  })

  it('with nothing on the board at all, says there are no tasks', async () => {
    setup({ today: makeToday([], { planned_minutes: 0 }), plan: makePlan([]) })

    expect(await screen.findByText(he.today.noTasks)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: he.today.next })).not.toBeInTheDocument()
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
  })

  it('complete updates the screen at once, and the undo sends uncomplete', async () => {
    const user = userEvent.setup()
    const { fake, state } = setup({ today: makeToday([NOW, LATER]) })
    const answer = deferred<unknown>()
    fake.on(`POST /blocks/${NOW.id}/complete`, () => answer.promise)
    fake.on(`POST /blocks/${NOW.id}/uncomplete`, { block: NOW, task_status: 'todo' })

    await user.click(await screen.findByRole('button', { name: he.board.completeLabel(NOW.task_title) }))
    // Before the server answers: the block is done and the next block is the upcoming one.
    await waitFor(() => {
      expect(within(card(NOW.task_title)).getByText(he.board.states.done)).toBeInTheDocument()
    })
    expect(within(screen.getByRole('region', { name: he.today.next })).getByRole('article', { name: LATER.task_title })).toBeInTheDocument()

    const done: Block = { ...NOW, status: 'done', state: 'done' }
    state.today = makeToday([done, LATER])
    answer.resolve({ block: done, task_status: 'done' })
    await user.click(await (await toasts()).findByRole('button', { name: he.common.undo }))
    await waitFor(() => {
      expect(fake.calls('POST', `/blocks/${NOW.id}/uncomplete`)).toHaveLength(1)
    })
  })

  it('defer shows where the task went, and the undo sends POST /plan/undo', async () => {
    const user = userEvent.setup()
    const { fake } = setup({ today: makeToday([LATER]) })
    // The server releases the deferred block and writes the minutes as a new block (a new id).
    const moved = makeBlock({ ...LATER, id: 'block-moved', study_date: '2026-11-17', starts_at: '2026-11-17T07:00:00Z', ends_at: '2026-11-17T08:00:00Z' })
    fake.on(`POST /blocks/${LATER.id}/defer`, { blocks: [moved], version_id: 'v-2' })
    fake.on('POST /plan/undo', { version_id: 'v-2' })

    await user.click(await screen.findByRole('button', { name: he.board.deferLabel(LATER.task_title) }))
    const region = await toasts()
    expect(await region.findByText(he.board.deferred(dayLabel('2026-11-17', '2026-11-16'), '09:00'))).toBeInTheDocument()
    await user.click(region.getByRole('button', { name: he.common.undo }))
    await waitFor(() => {
      expect(fake.calls('POST', '/plan/undo')).toEqual([{ method: 'POST', path: '/plan/undo', body: { version_id: 'v-2' } }])
    })
  })

  it('a defer that finds no place says why, and the board stays', async () => {
    const user = userEvent.setup()
    const { fake } = setup({ today: makeToday([LATER]) })
    fake.on(`POST /blocks/${LATER.id}/defer`, problem(409, 'placement_failed', { reason: 'not_enough_time' }))

    await user.click(await screen.findByRole('button', { name: he.board.deferLabel(LATER.task_title) }))
    const region = await toasts()
    expect(await region.findByText(`${codeText('placement_failed')} ${unscheduledText('not_enough_time')}`)).toBeInTheDocument()
    expect(card(LATER.task_title)).toBeInTheDocument()
  })

  it('pin marks the block pinned and sends PATCH', async () => {
    const user = userEvent.setup()
    const { fake, state } = setup({ today: makeToday([LATER]) })
    fake.on(`PATCH /blocks/${LATER.id}`, () => {
      // The server now has the block pinned, so the refetch after the action agrees.
      state.today = makeToday([{ ...LATER, pinned: true }])
      return { ...LATER, pinned: true }
    })

    await user.click(await screen.findByRole('button', { name: he.board.pinLabel(LATER.task_title) }))
    await waitFor(() => {
      expect(within(card(LATER.task_title)).getByText(he.board.pinned)).toBeInTheDocument()
    })
    expect(fake.calls('PATCH', `/blocks/${LATER.id}`)).toEqual([
      { method: 'PATCH', path: `/blocks/${LATER.id}`, body: { pinned: true } },
    ])
  })

  it('announces the loading as a status', async () => {
    const { fake } = setup()
    fake.on('GET /today', () => new Promise(() => undefined))

    expect(await screen.findByRole('heading', { level: 1, name: he.today.title })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(he.common.loading)
  })

  it('a network error shows an alert, and the retry works', async () => {
    const user = userEvent.setup()
    const { state } = setup({ today: problem(0, 'network') })

    expect(await screen.findByRole('alert')).toHaveTextContent(codeText('network'))
    state.today = makeToday([LATER])
    await user.click(screen.getByRole('button', { name: he.common.retry }))
    expect(await screen.findByRole('article', { name: LATER.task_title })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a failed refresh keeps the data and says it may be stale', async () => {
    const { state, queryClient } = setup({ today: makeToday([LATER]) })
    expect(await screen.findByRole('article', { name: LATER.task_title })).toBeInTheDocument()

    state.today = problem(0, 'network')
    await act(() => queryClient.refetchQueries({ queryKey: todayKey(USER_ID) }))
    expect(await screen.findByText(he.today.stale)).toBeInTheDocument()
    expect(screen.getByRole('article', { name: LATER.task_title })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a block across the switch to winter time shows 00:30–01:30 and two hours', async () => {
    const block = makeBlock({ study_date: '2026-10-25', starts_at: '2026-10-24T21:30:00Z', ends_at: '2026-10-24T23:30:00Z' })
    setup({ today: makeToday([block], { date: '2026-10-25' }) })

    const article = await screen.findByRole('article', { name: block.task_title })
    await waitFor(() => {
      expect(article).toHaveTextContent('00:30–01:30')
    })
    expect(article).toHaveTextContent(he.board.twoHours)
  })

  it("shows times in the profile's timezone, not the browser's", async () => {
    setup({ today: makeToday([makeBlock()]), timezone: 'America/New_York' })

    const article = await screen.findByRole('article', { name: makeBlock().task_title })
    await waitFor(() => {
      expect(article).toHaveTextContent('07:00–08:00')
    })
  })

  it('shows the report when the plan has tasks that did not fit', async () => {
    setup({
      today: makeToday([LATER]),
      plan: makePlan([LATER], { unplaced: [{ task_id: 't-x', exam_id: EXAMS[0]?.id ?? '', title: 'סימולציה מלאה', minutes: 90 }] }),
    })

    expect(await screen.findByRole('heading', { name: he.board.report.title })).toBeInTheDocument()
  })

  it('scrolls the report into view when the address is /today#report', async () => {
    const scroll = vi.fn()
    // jsdom has no scrollIntoView; the spy stands in for it during this test only.
    Element.prototype.scrollIntoView = scroll
    onTestFinished(() => {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    })
    setup({
      path: '/today#report',
      today: makeToday([LATER]),
      plan: makePlan([LATER], { unplaced: [{ task_id: 't-x', exam_id: EXAMS[0]?.id ?? '', title: 'סימולציה מלאה', minutes: 90 }] }),
    })

    await screen.findByRole('heading', { name: he.board.report.title })
    await waitFor(() => {
      expect(scroll).toHaveBeenCalled()
    })
    expect(scroll.mock.contexts[0]).toBe(document.getElementById('report'))
  })

  it('keys today by user, under the board', async () => {
    const { queryClient } = setup({ today: makeToday([LATER]) })
    await screen.findByRole('article', { name: LATER.task_title })
    expect(queryClient.getQueryCache().find({ queryKey: ['board', USER_ID, 'today'], exact: true })).toBeDefined()
  })

  it('sign out still works from /today', async () => {
    const user = userEvent.setup()
    const { auth, router } = setup()

    await user.click(await screen.findByRole('button', { name: he.shell.signOut }))
    expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
  })
})
