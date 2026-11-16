import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { errorMessage } from '../api/client'
import { shortfallText, unscheduledText } from '../i18n/codes'
import { he } from '../i18n/he'
import { EXAM_ID, EXAMS, USER_ID, makeMe, makePlan, makePreview, renderBoard } from '../test/boardFixtures'
import { createFakeApi, problem } from '../test/fakeApi'
import { planKey } from './api'
import { PlanReport } from './PlanReport'
import { durationText } from './time'
import type { ReplanPreview, Unplaced } from './types'

const EXAM_2 = 'exam-2'
const exams = [...EXAMS, { id: EXAM_2, name: 'הסתברות' }]

const UNPLACED: Unplaced[] = [
  { task_id: 'task-1', exam_id: EXAM_ID, title: 'פרק 3: גרפים', minutes: 90 },
  { task_id: 'task-2', exam_id: EXAM_ID, title: 'סימולציה 1', minutes: 180 },
]

function setup({ unplaced = UNPLACED, preview = makePreview() }: { unplaced?: Unplaced[]; preview?: ReplanPreview | Error } = {}) {
  const fake = createFakeApi()
    .on('GET /me', makeMe())
    .on({ method: 'GET', path: /^\/plan/ }, makePlan([], { unplaced }))
    .on('GET /exams', exams)
    .on('POST /plan/replan', preview)
  const rendered = renderBoard(<PlanReport />, { api: fake.api })
  return { fake, ...rendered }
}

async function report() {
  return within(await screen.findByRole('region', { name: he.board.report.title }))
}

// The region exists only while a toast shows.
async function toasts() {
  return within(await screen.findByRole('region', { name: he.common.notifications }))
}

const withReasons = makePreview({
  unscheduled: [
    { task_id: 'task-1', minutes: 90, reason: 'not_enough_time', blocked_by: null },
    { task_id: 'task-2', minutes: 180, reason: 'dependency_cycle', blocked_by: null },
  ],
  shortfalls: [{ exam_id: EXAM_ID, minutes: 270, daily_minutes: 300 }],
})

describe('PlanReport', () => {
  it('renders nothing and never asks for a preview when everything fits', async () => {
    const { fake, container, queryClient } = setup({ unplaced: [] })
    await waitFor(() => {
      expect(queryClient.getQueryData(planKey(USER_ID))).toBeDefined()
    })
    expect(container.querySelector('#report')).toBeNull()
    expect(screen.queryByText(he.board.report.title)).not.toBeInTheDocument()
    expect(fake.calls('POST', '/plan/replan')).toHaveLength(0)
  })

  it('asks the preview, and shows the shortfall with the exam name and every task with its reason', async () => {
    const { fake, container } = setup({ preview: withReasons })
    const r = await report()
    expect(container.querySelector('#report')).not.toBeNull()
    expect(await r.findByText(shortfallText('אלגוריתמים', 270, 300))).toBeInTheDocument()
    expect(fake.calls('POST', '/plan/replan').map((c) => c.body)).toEqual([{ preview: true }])

    const items = r.getAllByRole('listitem').filter((li) => li.textContent.includes('('))
    expect(items[0]).toHaveTextContent(he.board.report.task('פרק 3: גרפים', durationText(90)))
    expect(items[0]).toHaveTextContent(unscheduledText('not_enough_time'))
    expect(unscheduledText('not_enough_time')).toBe(he.codes.not_enough_time)
    expect(items[1]).toHaveTextContent(he.board.report.task('סימולציה 1', durationText(180)))
    expect(items[1]).toHaveTextContent(unscheduledText('dependency_cycle'))
  })

  it('raises the daily minutes, then offers a replan', async () => {
    const user = userEvent.setup()
    const { fake } = setup({ preview: withReasons })
    fake.on('PATCH /me', { ...makeMe(), daily_study_minutes: 300 })
    const r = await report()

    await user.click(await r.findByRole('button', { name: he.board.report.raise(durationText(300)) }))
    expect(fake.calls('PATCH', '/me').map((c) => c.body)).toEqual([{ daily_study_minutes: 300 }])
    const dialog = within(await screen.findByRole('dialog', { name: he.replan.title }))
    expect(dialog.getByText(he.board.report.raised(durationText(300)))).toBeInTheDocument()
  })

  it('raises to the largest daily minutes over every exam', async () => {
    const user = userEvent.setup()
    const { fake } = setup({
      preview: makePreview({
        shortfalls: [
          { exam_id: EXAM_ID, minutes: 120, daily_minutes: 240 },
          { exam_id: EXAM_2, minutes: 60, daily_minutes: 300 },
          { exam_id: 'exam-3', minutes: 60, daily_minutes: null },
        ],
      }),
    })
    fake.on('PATCH /me', makeMe())
    const r = await report()
    expect(await r.findByText(shortfallText('הסתברות', 60, 300))).toBeInTheDocument()
    expect(r.getByText(shortfallText('אלגוריתמים', 120, 240))).toBeInTheDocument()

    await user.click(r.getByRole('button', { name: he.board.report.raise(durationText(300)) }))
    expect(fake.calls('PATCH', '/me').map((c) => c.body)).toEqual([{ daily_study_minutes: 300 }])
  })

  it('has no raise button when no daily minutes would fit', async () => {
    setup({ preview: makePreview({ shortfalls: [{ exam_id: EXAM_ID, minutes: 120, daily_minutes: null }] }) })
    const r = await report()
    expect(await r.findByText(shortfallText('אלגוריתמים', 120, null))).toBeInTheDocument()
    expect(r.queryByRole('button')).not.toBeInTheDocument()
  })

  it('a failed raise says why and does not offer a replan', async () => {
    const user = userEvent.setup()
    const { fake } = setup({ preview: withReasons })
    const failure = problem(422, 'validation_error')
    fake.on('PATCH /me', failure)
    const r = await report()

    await user.click(await r.findByRole('button', { name: he.board.report.raise(durationText(300)) }))
    const t = await toasts()
    expect(await t.findByText(errorMessage(failure))).toBeInTheDocument()
    expect(t.queryByText(he.board.report.raised(durationText(300)))).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: he.replan.title })).not.toBeInTheDocument()
  })

  it('a failed preview says so, still lists the tasks, and retry asks again', async () => {
    const user = userEvent.setup()
    const { fake } = setup({ preview: problem(0, 'network') })
    const r = await report()
    expect(await r.findByRole('alert')).toHaveTextContent(he.board.report.failed)
    expect(r.getByText(he.board.report.task('פרק 3: גרפים', durationText(90)))).toBeInTheDocument()

    fake.on('POST /plan/replan', withReasons)
    await user.click(r.getByRole('button', { name: he.common.retry }))
    expect(await r.findByText(shortfallText('אלגוריתמים', 270, 300))).toBeInTheDocument()
    expect(r.queryByRole('alert')).not.toBeInTheDocument()
    expect(fake.calls('POST', '/plan/replan')).toHaveLength(2)
  })
})
