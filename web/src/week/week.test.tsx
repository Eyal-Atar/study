import { QueryClient } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { errorMessage } from '../api/client'
import { todayKey } from '../board/api'
import { formatDay } from '../board/time'
import type { Block } from '../board/types'
import { he } from '../i18n/he'
import { makeBlock, makeMe, makePlan, makeToday, USER_ID } from '../test/boardFixtures'
import { createFakeApi, problem, type FakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'

const TODAY = '2026-11-18'
const SUNDAY = '2026-11-15'
const SATURDAY = '2026-11-21'

const WEEK_DAYS = ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']

function planPath(from: string, to: string) {
  return `/plan?from=${from}&to=${to}`
}

// A fake server whose answers follow `state.blocks`; GET /plan answers with whatever range it was asked.
function setup(path: string, { blocks = [makeBlock({ study_date: TODAY, starts_at: '2026-11-18T12:00:00Z', ends_at: '2026-11-18T13:00:00Z' })] }: { blocks?: Block[] } = {}) {
  const state = { blocks, frozen: false }
  const never = new Promise<never>(() => undefined)
  const fake = createFakeApi()
    .on('GET /me', makeMe())
    .on('GET /today', () => (state.frozen ? never : makeToday(state.blocks.filter((b) => b.study_date === TODAY), { date: TODAY })))
    .on({ method: 'GET', path: /^\/plan\?/ }, (call: { path: string }) => {
      if (state.frozen) return never
      const params = new URLSearchParams(call.path.slice(call.path.indexOf('?') + 1))
      return makePlan(state.blocks, { from: params.get('from') ?? '', to: params.get('to') ?? '' })
    })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rendered = renderRoute(path, { auth: createFakeAuth(fakeSession({ id: USER_ID })), api: fake.api, queryClient })
  return { fake, state, queryClient, ...rendered }
}

function day(date: string) {
  return screen.getByRole('region', { name: new RegExp(formatDay(date)) })
}

async function weekShown(from = SUNDAY) {
  expect(await screen.findByRole('region', { name: new RegExp(formatDay(from)) })).toBeInTheDocument()
}

function planCalls(fake: FakeApi) {
  return fake.calls('GET', /^\/plan\?/).map((c) => c.path)
}

describe('the week screen', () => {
  it('asks for the plan of the week of today, Sunday to Saturday', async () => {
    const { fake } = setup('/week')
    await weekShown()

    expect(planCalls(fake)).toContain(planPath(SUNDAY, SATURDAY))
    expect(planCalls(fake).every((p) => p === planPath(SUNDAY, SATURDAY))).toBe(true)
    expect(screen.getByRole('heading', { level: 1, name: he.week.title })).toBeInTheDocument()
    expect(screen.getByText(he.week.range(formatDay(SUNDAY), formatDay(SATURDAY)))).toBeInTheDocument()
  })

  it('shows seven days with headings, marks today, and says which days are free', async () => {
    setup('/week')
    await weekShown()

    const regions = WEEK_DAYS.map(day)
    expect(regions).toHaveLength(7)
    for (const date of WEEK_DAYS) {
      expect(within(day(date)).getByRole('heading', { name: new RegExp(formatDay(date)) })).toBeInTheDocument()
    }
    expect(day(TODAY)).toHaveAttribute('aria-current', 'date')
    expect(within(day(TODAY)).getByText(he.board.today)).toBeInTheDocument()
    expect(day('2026-11-17')).not.toHaveAttribute('aria-current')
    expect(within(day(TODAY)).getByRole('article', { name: 'פרק 3: גרפים' })).toBeInTheDocument()
    expect(within(day(TODAY)).queryByText(he.week.free)).not.toBeInTheDocument()
    expect(within(day(TODAY)).getByText(he.week.total('שעה'))).toBeInTheDocument()
    for (const date of WEEK_DAYS.filter((d) => d !== TODAY)) {
      expect(within(day(date)).getByText(he.week.free)).toBeInTheDocument()
    }
  })

  it('groups blocks by the study_date of the server, not by their times', async () => {
    // 00:30–01:30 on Tuesday in Jerusalem (UTC+2), but the server counts it in Monday's study day.
    const late = makeBlock({
      id: 'block-late',
      task_title: 'סימולציה מאוחרת',
      starts_at: '2026-11-16T22:30:00Z',
      ends_at: '2026-11-16T23:30:00Z',
      study_date: '2026-11-16',
    })
    const morning = makeBlock({
      id: 'block-morning',
      task_title: 'חזרה של בוקר',
      starts_at: '2026-11-17T07:00:00Z',
      ends_at: '2026-11-17T07:45:00Z',
      study_date: '2026-11-17',
    })
    setup('/week', { blocks: [morning, late] })
    await weekShown()

    expect(within(day('2026-11-16')).getByRole('article', { name: 'סימולציה מאוחרת' })).toBeInTheDocument()
    expect(within(day('2026-11-17')).queryByRole('article', { name: 'סימולציה מאוחרת' })).not.toBeInTheDocument()
    expect(within(day('2026-11-17')).getByRole('article', { name: 'חזרה של בוקר' })).toBeInTheDocument()
    expect(within(day('2026-11-17')).getByText(he.week.total('45 דקות'))).toBeInTheDocument()
  })

  it('the next, previous and this-week buttons move the week through ?from=', async () => {
    const user = userEvent.setup()
    const { fake, router } = setup('/week')
    await weekShown()

    await user.click(screen.getByRole('button', { name: he.week.next }))
    expect(router.state.location.search).toBe('?from=2026-11-22')
    await weekShown('2026-11-22')
    expect(planCalls(fake)).toContain(planPath('2026-11-22', '2026-11-28'))

    await user.click(screen.getByRole('button', { name: he.week.previous }))
    await user.click(screen.getByRole('button', { name: he.week.previous }))
    expect(router.state.location.search).toBe('?from=2026-11-08')
    await weekShown('2026-11-08')
    expect(planCalls(fake)).toContain(planPath('2026-11-08', '2026-11-14'))

    await user.click(screen.getByRole('button', { name: he.week.thisWeek }))
    expect(router.state.location.search).toBe('')
    await weekShown()
  })

  it('?from= on any day shows the week that contains it', async () => {
    const { fake } = setup('/week?from=2026-12-02')
    await weekShown('2026-11-29')
    expect(planCalls(fake)).toContain(planPath('2026-11-29', '2026-12-05'))
    expect(screen.getAllByRole('region')).toHaveLength(7)
  })

  it('an invalid ?from= shows the current week', async () => {
    const { fake } = setup('/week?from=2026-02-31')
    await weekShown()
    expect(planCalls(fake).every((p) => p === planPath(SUNDAY, SATURDAY))).toBe(true)
  })

  it('a ?from= further than the API accepts shows the current week', async () => {
    const { fake } = setup('/week?from=2099-01-04')
    await weekShown()
    expect(planCalls(fake).every((p) => p === planPath(SUNDAY, SATURDAY))).toBe(true)
  })

  it('a menu action updates the week, and today has the block done without waiting for a request', async () => {
    const user = userEvent.setup()
    const block = makeBlock({ study_date: TODAY, starts_at: '2026-11-18T12:00:00Z', ends_at: '2026-11-18T13:00:00Z' })
    const { fake, state, queryClient, router } = setup('/week', { blocks: [block] })
    await weekShown()
    await waitFor(() => {
      expect(queryClient.getQueryData(todayKey(USER_ID))).toBeDefined()
    })
    // Nothing the server says after this point reaches the screen: what shows is the cache.
    state.frozen = true
    fake.on('POST /blocks/block-1/complete', () => new Promise<never>(() => undefined))

    await user.click(within(day(TODAY)).getByRole('button', { name: he.board.actionsLabel(block.task_title) }))
    await user.click(await screen.findByRole('menuitem', { name: he.board.complete }))

    expect(await within(day(TODAY)).findByText(he.board.states.done)).toBeInTheDocument()
    expect(queryClient.getQueryData<{ blocks: Block[] }>(todayKey(USER_ID))?.blocks[0]?.status).toBe('done')
    expect(fake.calls('POST', '/blocks/block-1/complete')).toHaveLength(1)

    await user.click(within(screen.getByRole('navigation', { name: he.shell.mainNav })).getByRole('link', { name: he.shell.today }))
    expect(router.state.location.pathname).toBe('/today')
    expect(queryClient.getQueryData<{ blocks: Block[] }>(todayKey(USER_ID))?.blocks[0]?.state).toBe('done')
  })

  it('a network error with no data shows an alert, and retry loads the week', async () => {
    const user = userEvent.setup()
    const failure = problem(0, 'network')
    const { fake } = setup('/week')
    fake.on({ method: 'GET', path: /^\/plan\?/ }, failure)

    expect(await screen.findByRole('alert')).toHaveTextContent(errorMessage(failure))
    fake.on({ method: 'GET', path: /^\/plan\?/ }, makePlan([], { from: SUNDAY, to: SATURDAY }))
    await user.click(screen.getByRole('button', { name: he.common.retry }))

    await weekShown()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a failed GET /today with no date shows an alert, and retry works', async () => {
    const user = userEvent.setup()
    const failure = problem(0, 'network')
    const { fake } = setup('/week')
    fake.on('GET /today', failure)

    expect(await screen.findByRole('alert')).toHaveTextContent(errorMessage(failure))
    fake.on('GET /today', makeToday([], { date: TODAY }))
    await user.click(screen.getByRole('button', { name: he.common.retry }))
    await weekShown()
  })

  it('shows loading until the week is known', async () => {
    const { state } = setup('/week')
    state.frozen = true
    await screen.findByRole('heading', { level: 1, name: he.week.title })
    expect(within(screen.getByRole('main')).getByRole('status')).toHaveTextContent(he.common.loading)
    expect(screen.queryAllByRole('region')).toHaveLength(0)
  })

  it('a failed refresh keeps the week and says it may be out of date', async () => {
    const { fake, queryClient } = setup('/week')
    await weekShown()
    fake.on({ method: 'GET', path: /^\/plan\?/ }, problem(0, 'network'))

    await queryClient.refetchQueries({ queryKey: ['board', USER_ID, 'plan'] })
    expect(await screen.findByText(he.week.stale)).toBeInTheDocument()
    expect(day(TODAY)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
